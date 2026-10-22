import { useCallback, useEffect, useState } from "react";
import { locale } from "./i18n";

// Web Push for best-before notifications. The API sends them (see apps/api/src/expiry-job.ts);
// this device only subscribes and tells the API where to send them.

export type PushState =
  | "loading"
  | "hidden" // not configured on the server, or the browser has no Web Push
  | "install" // iOS/iPadOS in Safari: Web Push needs the installed app
  | "blocked" // the user denied notifications for this site
  | "off"
  | "on";

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function keyBytes(base64url: string) {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function registration() {
  // `ready` never settles without a service worker, so give up after a while.
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 5000)),
  ]);
}

async function currentSubscription() {
  if (!supported()) return null;
  return (await (await registration())?.pushManager.getSubscription()) ?? null;
}

async function saveSubscription(sub: PushSubscription) {
  const json = sub.toJSON();
  const res = await fetch("/api/push/subscriptions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, locale }),
  });
  if (!res.ok) throw new Error(`push subscription rejected: ${res.status}`);
}

/** On sign-out: stop notifications for the account that is leaving this device. Best effort. */
export async function forgetPushSubscription() {
  try {
    const sub = await currentSubscription();
    if (!sub) return;
    await fetch("/api/push/subscriptions", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    await sub.unsubscribe();
  } catch {
    // Signing out must not fail because of this.
  }
}

export function usePush() {
  const [state, setState] = useState<PushState>("loading");
  const [key, setKey] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!supported()) return setState(isIos() && !isStandalone() ? "install" : "hidden");
      const res = await fetch("/api/push/key").catch(() => null);
      if (!res?.ok) return setState("hidden");
      const { publicKey } = (await res.json()) as { publicKey: string };
      const sub = await currentSubscription();
      if (cancelled) return;
      setKey(publicKey);
      if (Notification.permission === "denied") return setState("blocked");
      if (sub && Notification.permission === "granted") {
        setState("on");
        // Keep the server's copy current (locale, a subscription the server dropped). Errors don't matter here.
        void saveSubscription(sub).catch(() => {});
      } else setState("off");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Must be called directly from a tap: iOS only shows the permission prompt for a user gesture.
  const enable = useCallback(async () => {
    if (!key) return false;
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setState(permission === "denied" ? "blocked" : "off");
      return true;
    }
    try {
      const reg = await registration();
      if (!reg) throw new Error("no service worker");
      const options = { userVisibleOnly: true, applicationServerKey: keyBytes(key) };
      let sub: PushSubscription;
      try {
        sub = await reg.pushManager.subscribe(options);
      } catch {
        // Subscribed with an older server key: start over.
        await (await reg.pushManager.getSubscription())?.unsubscribe();
        sub = await reg.pushManager.subscribe(options);
      }
      await saveSubscription(sub);
      setState("on");
      return true;
    } catch {
      setState("off");
      return false;
    }
  }, [key]);

  const disable = useCallback(async () => {
    await forgetPushSubscription();
    setState("off");
  }, []);

  return { state, enable, disable };
}
