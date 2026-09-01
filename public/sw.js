/*
 * Service worker for Mujeeb AI.
 *
 * Exists for two reasons: a fetch handler is what makes the app
 * installable at all, and an offline page is better than the browser's
 * dinosaur when someone opens a home-screen icon on a bad connection.
 *
 * ## What is deliberately NOT cached
 *
 * A service worker cache is unencrypted origin storage that outlives the
 * session, shared by every profile on the device. So:
 *
 *   - **Nothing under /api/.** Chat responses, attachments and billing
 *     calls are per-user and often per-request.
 *   - **Nothing on the staff surface.** Administrative pages must never
 *     be readable from disk after sign-out, and the console lives behind
 *     a secret path that this file must not know either — so the rule is
 *     "cache only what is provably public" rather than a denylist of
 *     paths the worker would have to be told.
 *   - **No response carrying `Set-Cookie`, `Cache-Control: private`, or
 *     `no-store`.** The server has already said not to.
 *   - **No opaque cross-origin response**, whose status cannot be read.
 *
 * What is left is the public marketing shell and immutable build assets,
 * which is exactly what an offline launch needs.
 */

const VERSION = "v3";
const STATIC_CACHE = `mujeeb-static-${VERSION}`;
const PAGE_CACHE = `mujeeb-pages-${VERSION}`;
const OFFLINE_URL = "/offline.html";

const PRECACHE = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      // Individually, so one missing asset cannot fail the whole install
      // and leave the app without a worker at all.
      .then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("mujeeb-") && !key.endsWith(VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** Only ever cache things that are provably public and safe to keep. */
function isCacheableRequest(request) {
  if (request.method !== "GET") return false;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/api/")) return false;
  // An RSC payload is a rendered view of whatever the session could see.
  if (url.searchParams.has("_rsc")) return false;
  return true;
}

function isCacheableResponse(response) {
  if (!response || response.status !== 200 || response.type === "opaque") return false;
  if (response.headers.get("set-cookie")) return false;
  const control = (response.headers.get("cache-control") || "").toLowerCase();
  if (control.includes("private") || control.includes("no-store")) return false;
  return true;
}

/** Build output under /_next/static is content-hashed and immutable. */
function isImmutableAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (!isCacheableRequest(request)) return;

  const url = new URL(request.url);

  // Immutable assets: cache first. They never change without their name
  // changing, so a hit is always correct and always faster.
  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (isCacheableResponse(response)) {
              const copy = response.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Navigations: network first, so signed-in people always get fresh,
  // correctly-authorised HTML. The cache is only a fallback for being
  // offline, and only for pages the rules above allowed us to keep.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (isCacheableResponse(response)) {
            const copy = response.clone();
            caches.open(PAGE_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match(OFFLINE_URL))),
    );
  }
});

// Lets a new build take over without the user hunting for "reload".
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});
