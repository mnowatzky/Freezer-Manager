/// <reference lib="webworker" />
// Service worker (vite-plugin-pwa "injectManifest"): precaches the app shell like the generated
// worker did before, and additionally shows best-before push notifications.
import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare const self: ServiceWorkerGlobalScope;

// registerType "autoUpdate": a new worker takes over right away.
void self.skipWaiting();
clientsClaim();

cleanupOutdatedCaches();
// oxlint-disable-next-line no-underscore-dangle -- name injected by workbox
precacheAndRoute(self.__WB_MANIFEST);
// App shell offline; API, auth callbacks and data are never served from the SW.
// (In dev, Vite serves index.html itself and it isn't precached.)
if (import.meta.env.PROD) registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html"), { denylist: [/^\/api\//] }));

type PushPayload = { title: string; body: string; url?: string; tag?: string };

self.addEventListener("push", (event) => {
  let data: PushPayload | undefined;
  try {
    data = event.data?.json() as PushPayload | undefined;
  } catch {
    return;
  }
  if (!data?.title) return;
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag ?? "eat-soon",
      icon: "/pwa-192x192.png",
      badge: "/badge-96x96.png",
      data: { url: data.url ?? "/" },
    }),
  );
});

// Open the app on the "Eat soon" section: reuse an open window if there is one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data as { url?: string } | null)?.url ?? "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        try {
          const navigated = (await client.navigate(url)) ?? client;
          await navigated.focus().catch(() => {});
          return;
        } catch {
          // Not controlled by this worker (navigate throws); try the next one or open a new window.
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
