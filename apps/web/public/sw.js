/* LPLUDO service worker — enables the browser's native "Install App"
 * (beforeinstallprompt) flow so the Android default install dialog is offered
 * instead of downloading a real APK.
 *
 * Strategy: network-first for API/socket (always fresh money data), and a
 * stale-while-revalidate cache for the static app shell so the PWA opens fast.
 * Never cache responses for /api/* or /socket.io/ so balances/sockets are live.
 */
const SHELL_CACHE = "lpludo-shell-v1";
const CORE_ASSETS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
];
const isApi = (url) =>
  url.pathname.startsWith("/api/") ||
  url.pathname.startsWith("/socket.io/") ||
  url.pathname.startsWith("/uploads/");

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || isApi(url)) return; // let the network / browser handle it

  if (event.request.mode === "navigate") {
    // App shell: serve from cache if offline, otherwise network + cache copy
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put("/index.html", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }

  // Static assets: stale-while-revalidate
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});