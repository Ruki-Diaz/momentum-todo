/**
 * Momentum — Production Service Worker
 * Strategy: Network-first static shell with offline cache fallback
 *
 * CRITICAL SECURITY & DATA PRIVACY INVARIANTS:
 * 1. Requests to /api/* are NEVER cached.
 * 2. Authenticated user data, task data, and credentials never enter Cache Storage.
 * 3. Non-GET requests (POST, PUT, PATCH, DELETE) bypass Cache Storage unconditionally.
 */

const CACHE_NAME = "momentum-static-v8";

const STATIC_SHELL_ASSETS = [
  "/",
  "/index.html",
  "/css/tokens.css",
  "/css/base.css",
  "/css/layout.css",
  "/css/tasks.css",
  "/css/rail.css",
  "/css/toasts-mobile.css",
  "/css/responsive.css",
  "/css/drawer-modals.css",
  "/css/calendar.css",
  "/css/palette.css",
  "/css/auth-account.css",
  "/css/motion.css",
  "/css/a11y.css",
  "/landing.css",
  "/js/cube-wave.js",
  "/js/data.js",
  "/js/icons.js",
  "/js/smart-input.js",
  "/js/motion.js",
  "/js/core.js",
  "/js/task-ui.js",
  "/js/account.js",
  "/js/views.js",
  "/js/actions.js",
  "/js/reminders.js",
  "/js/getting-started.js",
  "/js/phone.js",
  "/js/ambient.js",
  "/js/ai.js",
  "/js/main.js",
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

  // RULE 4: Network-first for same-origin static assets; cache is the offline fallback.
  // The app is split across several scripts/stylesheets, so serving a stale copy of one
  // file next to a fresh copy of another could mix versions. Network-first keeps every
  // online load consistent while the shell still works offline.
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === "basic") {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache));
        }
        return networkResponse;
      })
      .catch(async () => {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) return cachedResponse;
        if (request.mode === "navigate") return caches.match("/index.html");
        return Response.error();
      })
  );
});

// 4. Reminder notifications: open the task, or pass "Mark done" / "Snooze" to an open page.
self.addEventListener("notificationclick", (event) => {
  const notification = event.notification;
  const todoId = notification.data && notification.data.todoId;
  const action = event.action || "open";
  notification.close();

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const page = windows.find((c) => new URL(c.url).origin === self.location.origin);
      if (page) {
        page.postMessage({ type: "reminder-action", action, todoId });
        if (action === "open" && "focus" in page) await page.focus();
        return;
      }
      // No page open: just open the app (and the task, when the notification itself was tapped).
      const target = action === "open" && todoId ? `/?task=${encodeURIComponent(todoId)}` : "/";
      if (self.clients.openWindow) await self.clients.openWindow(target);
    })()
  );
});
