/**
 * Momentum — Production Service Worker
 * Strategy: Conservative Static Shell Caching
 *
 * CRITICAL SECURITY & DATA PRIVACY INVARIANTS:
 * 1. Requests to /api/* are NEVER cached.
 * 2. Authenticated user data, task data, and credentials never enter Cache Storage.
 * 3. Non-GET requests (POST, PUT, PATCH, DELETE) bypass Cache Storage unconditionally.
 */

const CACHE_NAME = "momentum-static-v2";

const STATIC_SHELL_ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/landing.css",
  "/app.js",
  "/landing.js",
  "/manifest.webmanifest",
  "/favicon.svg"
];

// 1. Install: Pre-cache core application shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => {
        console.warn("[Momentum SW] Pre-cache warning:", err);
      })
  );
});

// 2. Activate: Clean up old cache versions and claim clients
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        );
      })
      .then(() => self.clients.claim())
  );
});

// 3. Fetch: Strict routing rules
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // RULE 1: Never intercept or cache non-GET requests
  if (request.method !== "GET") {
    return;
  }

  // RULE 2: Never cache /api/* routes (authenticated user endpoints)
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // RULE 3: Never cache external CDNs or Clerk authentication bundles
  if (url.origin !== self.location.origin) {
    return;
  }

  // RULE 4: For same-origin static assets, serve Stale-While-Revalidate
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === "basic") {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // If offline and request is for page navigation, return cached index.html
          if (request.mode === "navigate") {
            return caches.match("/index.html");
          }
          return cachedResponse;
        });

      return cachedResponse || fetchPromise;
    })
  );
});
