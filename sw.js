"use strict";

const CACHE_VERSION = "school-tools-v2-shell-v5";
const SCOPE_PATH = "/school-tools-v2/";
const STATIC_ASSETS = Object.freeze([
  SCOPE_PATH,
  `${SCOPE_PATH}index.html`,
  `${SCOPE_PATH}styles.css`,
  `${SCOPE_PATH}config.js`,
  `${SCOPE_PATH}device-session-store.js`,
  `${SCOPE_PATH}api-client.js`,
  `${SCOPE_PATH}app.js`,
  `${SCOPE_PATH}pwa.js`,
  `${SCOPE_PATH}manifest.webmanifest`,
  `${SCOPE_PATH}icons/icon-192.png`,
  `${SCOPE_PATH}icons/icon-512.png`,
  `${SCOPE_PATH}icons/icon-maskable-192.png`,
  `${SCOPE_PATH}icons/icon-maskable-512.png`,
  `${SCOPE_PATH}icons/apple-touch-icon.png`
]);

function isSensitiveApiPath(pathname) {
  const sensitivePaths = ["/auth/session", "/auth/refresh", "/auth/logout", "/teachers"];
  return sensitivePaths.some((path) => pathname === path || pathname.endsWith(path));
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
  )));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // All Cloud Function/API traffic bypasses the service worker completely.
  if (url.origin !== self.location.origin || isSensitiveApiPath(url.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, `${SCOPE_PATH}index.html`));
    return;
  }
  if (!STATIC_ASSETS.includes(url.pathname)) return;
  event.respondWith(networkFirst(request, url.pathname));
});

async function networkFirst(request, fallbackPath) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request, { cache: "no-cache" });
    if (response.ok && response.type === "basic") await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || (await cache.match(fallbackPath)) || Response.error();
  }
}
