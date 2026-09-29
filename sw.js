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
      .then((cache) =>
        cache.addAll(ASSETS.map((u) => new Request(u, { cache: "reload" }))),
      )
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
