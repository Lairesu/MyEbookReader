const CACHE_NAME = "ebook-reader-v7"; // bump when ASSETS change

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./highlights.js",
  "./backup.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./libs/epub.min.js",
  "./libs/jszip.min.js",
  "./libs/localforage.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        cache.addAll(ASSETS.map((u) => new Request(u, { cache: "reload" }))),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Network first (always fresh code when online), cache as offline fallback
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || !request.url.startsWith(self.location.origin))
    return;

  event.respondWith(
    fetch(request, { cache: "no-cache" })
      .then((response) => {
        if (response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches
          .match(request, { ignoreSearch: true })
          .then(
            (cached) =>
              cached ||
              (request.mode === "navigate"
                ? caches.match("./index.html")
                : new Response("Offline", { status: 503 })),
          ),
      ),
  );
});
