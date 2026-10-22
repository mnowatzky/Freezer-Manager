import { serve } from "@hono/node-server";
import webpush from "web-push";
import { app } from "./app";
import { db, sql } from "./db";
import { env } from "./env";
import { startExpiryJob } from "./expiry-job";
import { log } from "./log";

const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
  log("info", "API listening", { port: info.port });
});

if (env.vapid) {
  const { publicKey, privateKey, subject } = env.vapid;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  startExpiryJob({
    db,
    notifyHour: env.notifyHour,
    send: async (sub, payload) => {
      try {
        const res = await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), {
          TTL: 24 * 60 * 60,
          urgency: "normal",
          topic: payload.tag,
        });
        return { statusCode: res.statusCode };
      } catch (err) {
        if (err instanceof webpush.WebPushError) return { statusCode: err.statusCode };
        throw err;
      }
    },
  });
  log("info", "push notifications enabled", { notifyHour: env.notifyHour });
}

// Graceful shutdown (docker stop sends SIGTERM): stop accepting connections, let in-flight
// requests finish, close the database pool. Force-exit if that takes longer than 10 s.
let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log("info", "shutting down", { signal });
  setTimeout(() => {
    log("error", "shutdown timed out, exiting");
    process.exit(1);
  }, 10_000).unref();
  server.close((err) => {
    void sql.end({ timeout: 5 }).finally(() => process.exit(err ? 1 : 0));
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
