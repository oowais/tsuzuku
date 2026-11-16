// Served as the Flutter web build's `flutter_service_worker.js` (#108, step 4.1; copied over it in the Dockerfile).
// The first images built the web app with Flutter's default offline-first service worker, which kept serving the old
// build after a deploy. The web build now has none (`--pwa-strategy=none`, decision #5); a browser that still has the
// old worker fetches this script on its next update check, which clears the old caches, unregisters itself and
// reloads the open tabs from the network.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) await caches.delete(key);
      await self.registration.unregister();
      for (const client of await self.clients.matchAll({ type: "window" }))
        client.navigate(client.url);
    })(),
  );
});
