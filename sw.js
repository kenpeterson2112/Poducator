/**
 * sw.js — service worker (spec §10's PWA requirement).
 *
 * Strategy, and the reasoning behind it:
 *
 *   App shell   → cache-first. The HTML, CSS and modules never need to be
 *                 fresh mid-lesson, and a student on school wifi should not
 *                 watch the UI fail to load.
 *   Everything  → network-only, never cached. Wiki lookups, Claude calls and
 *   else          Supabase writes are all either large, personal, or both.
 *                 Caching a generated lesson would also mean caching a
 *                 student's answers on a shared Chromebook, which is exactly
 *                 what the privacy model exists to prevent.
 *
 * Bump CACHE_VERSION on any shell change — old caches are cleared on activate.
 */

const CACHE_VERSION = 'poducator-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/ui.js',
  './js/config.js',
  './js/claude.js',
  './js/tts.js',
  './js/store.js',
  './js/assessment.js',
  './js/objectives.js',
  './js/sources/index.js',
  './js/sources/mediawiki.js',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      // addAll is all-or-nothing; a single 404 would leave the shell uncached
      // entirely, so each entry is added independently and allowed to fail.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Only ever serve our own origin from cache. Anything cross-origin — wiki
  // APIs, the Claude API, Supabase — goes straight to the network.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
            }
            return res;
          })
          // A navigation that misses both cache and network still gets the
          // shell, so an offline student sees the app rather than a browser
          // error page.
          .catch(() => (request.mode === 'navigate' ? caches.match('./index.html') : undefined))
    )
  );
});
