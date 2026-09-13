/* Offline cache for the Atbalsts radio exercise page.

   The airplane-mode demonstration only means anything if the page still opens
   after the network is gone, so the page adds itself to this cache and every
   GET is served from it first. POSTs (the diagnostic log) are left alone. */
const CACHE = "atbalsts-radio-exercise-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit =>
      hit || fetch(e.request).then(res => {
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit))
  );
});
