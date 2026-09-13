/* Offline shell for the passenger page.
 *
 * Strategy is stale-while-revalidate, not cache-first. A passenger standing in a
 * station with no signal must get *a* page; a passenger with signal must get the
 * *current* one. Cache-first satisfies the first and fails the second forever,
 * which is how a venue ends up unable to push a correction.
 *
 * The API is never cached: a stale template bundle is worse than a failed sync,
 * because it renders confidently and wrongly.
 */
const CACHE = "cicada-listen-v2";
const SHELL = [
  "/listen", "/cicada.js", "/cicada-capture.js",
  "/sdk/core.js", "/sdk/frame.js", "/sdk/audio.js", "/sdk/simulate.js",
  "/announce/template.js", "/listen.webmanifest",
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      // One missing file must not abandon the whole shell.
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/v1/")) return;

  e.respondWith((async () => {
    const cached = await caches.match(e.request, { ignoreSearch: true });
    const live = fetch(e.request).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => null);

    // Serve the cached copy immediately if there is one, but always refresh it.
    if (cached) { live.catch(() => {}); return cached; }
    const res = await live;
    return res ?? new Response("Offline and not cached.", { status: 503 });
  })());
});
