const CACHE_NAME = "ebook-reader-v3"; // ← change version number when you update code

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./libs/epub.min.js",
  "./libs/jszip.min.js",
  "./libs/localforage.min.js",
];

// Install - cache the app shell
self.addEventListener("install", (event) => {
  console.log("[SW] Installing new version...");
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()), // activate immediately
  );
});

// Activate - delete old caches
self.addEventListener("activate", (event) => {
  console.log("[SW] Activating...");
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        return Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              console.log("[SW] Deleting old cache:", key);
              return caches.delete(key);
            }
          }),
        );
      })
      .then(() => self.clients.claim()),
  );
});

// Fetch strategy
self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Never interfere with these:
  if (
    request.url.startsWith("blob:") ||
    request.url.startsWith("data:") ||
    request.method !== "GET"
  ) {
    return; // let the browser handle it normally
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      if (cached) {
        return cached; // serve from cache (offline works)
      }

      // Not in cache → try network
      return fetch(request)
        .then((response) => {
          // Only cache successful responses of our own files
          if (
            response &&
            response.status === 200 &&
            request.url.startsWith(self.location.origin)
          ) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          if (request.mode === "navigate") return caches.match("./index.html");
          return new Response("Offline", { status: 503 });
        });
    }),
  );
});
