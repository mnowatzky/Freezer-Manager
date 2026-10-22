import * as schema from "@freezer/shared/db-schema";
import { DAY_MS, EAT_SOON_DAYS, todayAsDate } from "@freezer/shared/domain";
import { messages, pickLocale } from "@freezer/shared/i18n";
import { between, eq, inArray, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { errorFields, log } from "./log";

// Daily best-before notifications via Web Push. Every member of a freezer gets one notification
// per device that lists the items to eat soon:
//   "soon": the best-before date is at most EAT_SOON_DAYS away
//   "due":  the date is today (or passed within DUE_CATCH_UP_DAYS, in case a run was missed)
// expiry_notice records which date each kind was sent for, so nothing is sent twice.

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
type Subscription = { endpoint: string; p256dh: string; auth: string };
export type PushPayload = { title: string; body: string; url: string; tag: string };
/** Sends one push message; resolves with the push service's HTTP status. */
export type Send = (subscription: Subscription, payload: PushPayload) => Promise<{ statusCode: number }>;

const DUE_CATCH_UP_DAYS = 3;
const MAX_LISTED = 5;
// Arbitrary constant for pg_try_advisory_xact_lock, so only one API replica runs the job at a time.
const LOCK_ID = 7_431_901;

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const fromIso = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

export async function runExpiryJob({ db, now, send }: { db: Db; now: Date; send: Send }) {
  const today = todayAsDate(now);
  return db.transaction(async (tx) => {
    // postgres-js returns the rows as an array, PGlite (tests) as { rows }.
    type Locked = { locked: boolean };
    const lock = (await tx.execute(sql`select pg_try_advisory_xact_lock(${LOCK_ID}) as locked`)) as Locked[] | { rows: Locked[] };
    const rows = Array.isArray(lock) ? lock : lock.rows;
    if (!rows[0]?.locked) return { items: 0, sent: 0, removed: 0 };

    const candidates = await tx
      .select({ id: schema.item.id, name: schema.item.name, freezerId: schema.item.freezerId, bestBefore: schema.item.bestBefore })
      .from(schema.item)
      .where(between(schema.item.bestBefore, isoDate(today - DUE_CATCH_UP_DAYS * DAY_MS), isoDate(today + EAT_SOON_DAYS * DAY_MS)));
    if (candidates.length === 0) return { items: 0, sent: 0, removed: 0 };

    const notices = await tx
      .select()
      .from(schema.expiryNotice)
      .where(inArray(schema.expiryNotice.itemId, candidates.map((c) => c.id)));
    const sentFor = new Set(notices.map((n) => `${n.itemId}:${n.kind}:${n.bestBefore}`));
    const pending = candidates
      .map((c) => ({ ...c, bestBefore: fromIso(c.bestBefore!), kind: fromIso(c.bestBefore!) <= today ? ("due" as const) : ("soon" as const) }))
      .filter((c) => !sentFor.has(`${c.id}:${c.kind}:${isoDate(c.bestBefore)}`))
      .sort((a, b) => a.bestBefore - b.bestBefore);
    if (pending.length === 0) return { items: 0, sent: 0, removed: 0 };

    const members = await tx
      .select({ freezerId: schema.freezerMember.freezerId, userId: schema.freezerMember.userId })
      .from(schema.freezerMember)
      .where(inArray(schema.freezerMember.freezerId, [...new Set(pending.map((p) => p.freezerId))]));
    const subscriptions = members.length
      ? await tx
          .select()
          .from(schema.pushSubscription)
          .where(inArray(schema.pushSubscription.userId, [...new Set(members.map((m) => m.userId))]))
      : [];

    let sent = 0;
    let removed = 0;
    for (const sub of subscriptions) {
      const freezers = new Set(members.filter((m) => m.userId === sub.userId).map((m) => m.freezerId));
      const items = pending.filter((p) => freezers.has(p.freezerId));
      if (items.length === 0) continue;
      const t = messages[pickLocale([sub.locale])];
      const listed = items
        .slice(0, MAX_LISTED)
        .map((i) => `${i.name} (${t.item.bestBeforeRelative(Math.round((i.bestBefore - today) / DAY_MS))})`);
      const payload: PushPayload = {
        title: t.push.title(items.length),
        body: listed.join(", ") + (items.length > MAX_LISTED ? ", …" : ""),
        url: "/?soon",
        tag: "eat-soon",
      };
      try {
        const { statusCode } = await send(sub, payload);
        if (statusCode === 404 || statusCode === 410) {
          // The push service says this subscription is gone (app uninstalled, permission revoked).
          await tx.delete(schema.pushSubscription).where(eq(schema.pushSubscription.id, sub.id));
          removed++;
        } else if (statusCode >= 200 && statusCode < 300) {
          await tx.update(schema.pushSubscription).set({ lastSuccessAt: now }).where(eq(schema.pushSubscription.id, sub.id));
          sent++;
        } else {
          log("warn", "push rejected", { statusCode, subscription: sub.id });
        }
      } catch (err) {
        log("warn", "push failed", { subscription: sub.id, ...errorFields(err) });
      }
    }

    // Recorded even for people without a subscription: the item has been handled for this date.
    for (const p of pending)
      await tx
        .insert(schema.expiryNotice)
        .values({ itemId: p.id, kind: p.kind, bestBefore: isoDate(p.bestBefore) })
        .onConflictDoUpdate({
          target: [schema.expiryNotice.itemId, schema.expiryNotice.kind],
          set: { bestBefore: isoDate(p.bestBefore) },
        });

    return { items: pending.length, sent, removed };
  });
}

/**
 * Checks hourly and runs the job once a day, after `notifyHour` in the container's time zone (TZ).
 * Several API replicas are fine: the advisory lock serializes them and the notices prevent repeats.
 */
export function startExpiryJob({ db, send, notifyHour }: { db: Db; send: Send; notifyHour: number }) {
  let lastRun: string | null = null;
  const tick = async () => {
    const now = new Date();
    const day = isoDate(todayAsDate(now));
    if (now.getHours() < notifyHour || lastRun === day) return;
    lastRun = day;
    try {
      const result = await runExpiryJob({ db, now, send });
      if (result.items) log("info", "best-before notifications", result);
    } catch (err) {
      lastRun = null; // retry on the next tick
      log("error", "best-before notifications failed", errorFields(err));
    }
  };
  setTimeout(() => void tick(), 60_000).unref();
  setInterval(() => void tick(), 60 * 60_000).unref();
}
