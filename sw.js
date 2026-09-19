/**
 * sw.js — service worker (spec §10's PWA requirement).
 *
 * Strategy, and the reasoning behind it:
 *
 *   App shell   → network-first, falling back to cache. Fresh code reaches a
 *                 returning visitor on their next load; a student with no
 *                 connection still gets the last shell that loaded. (This was
 *                 cache-first and had to change — see the fetch handler.)
 *   Everything  → network-only, never cached. Wiki lookups, Claude calls and
 *   else          Supabase writes are all either large, personal, or both.
 *                 Caching a generated lesson would also mean caching a
 *                 student's answers on a shared Chromebook, which is exactly
 *                 what the privacy model exists to prevent.
 *
 * Bump CACHE_VERSION on any shell change — old caches are cleared on activate.
 */

const CACHE_VERSION = 'poducator-v4';

/**
 * A shell request that always checks with the server first.
 *
 * Without this the service worker's own fetch() is answered by the browser's
 * HTTP cache, so "network-first" quietly means "HTTP-cache-first" and a
 * returning visitor keeps the old build anyway — which is exactly what was
 * happening. 'no-cache' forces revalidation rather than a blind re-download:
 * unchanged files still come back as a 304 and cost nothing.
 */
function fresh(url) {
  return new Request(url, { cache: 'no-cache', credentials: 'same-origin' });
}

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
  './js/sessionfile.js',
  './js/assessment.js',
  './js/objectives.js',
  './js/sources/index.js',
  './js/sources/mediawiki.js',
  // The curriculum and its item bank are part of the shell, not content
  // fetched at runtime. Caching them is what lets an offline learner still
  // answer the pre-pod quiz — only the chapter audio needs the network.
  './js/curriculum/index.js',
  './js/curriculum/items.js',
  './js/curriculum/ontario-sci-7-d.js',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      // addAll is all-or-nothing; a single 404 would leave the shell uncached
      // entirely, so each entry is added independently and allowed to fail.
      // Each one revalidates (see fresh()), or install would happily fill the
      // new cache from the browser's stale copy of the old build.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(fresh(url)).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const stale = keys.filter((k) => k !== CACHE_VERSION);
      await Promise.all(stale.map((k) => caches.delete(k)));
      await self.clients.claim();

      // Claiming is where this ends, deliberately. The page that installed a
      // new worker is still showing HTML the OLD one served, so someone stuck
      // on the pre-fix cache-first shell needs one more load to escape it.
      // Both ways of closing that gap were worse than the gap: re-navigating
      // clients from here killed the renderer, and reloading from a
      // controllerchange handler would yank a student out of a lesson in
      // progress every time a deploy landed mid-podcast. Network-first already
      // makes every load fresh, so the one extra load is only ever paid once,
      // by people the old worker had pinned permanently.
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Only our own origin is cached at all. Anything cross-origin — wiki APIs,
  // the Claude API, Supabase — goes straight to the network, untouched.
  if (url.origin !== self.location.origin) return;

  /*
   * NETWORK-FIRST, cache as the fallback.
   *
   * This used to be cache-first, and that was wrong in a way that took three
   * merged PRs to notice: the cache is only evicted when CACHE_VERSION
   * changes, so every returning visitor was pinned to whatever shell they
   * first loaded. Two releases rewrote index.html, the CSS and every module
   * while that string sat unchanged, and those users could not receive the new
   * code by any action short of clearing site data.
   *
   * The bug was the strategy, not the missed bump. Freshness that depends on a
   * human remembering a manual step during every shell change is freshness
   * that will break again — it already broke twice in a row.
   *
   * Now: online gets the newest code every load, offline gets the last copy
   * that actually loaded. The offline guarantee is unchanged; the cache simply
   * stops being the FIRST choice when a network is available.
   */
  event.respondWith(
    fetch(fresh(request.url))
      .then((res) => {
        // Refresh the cache on every success, so the offline copy tracks the
        // last version the learner really saw rather than one frozen at
        // install time.
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        }
        return res;
      })
      .catch(async () => {
        // Offline. Serve the cached copy; a navigation with nothing cached for
        // that exact URL still gets the shell, so a student sees the app
        // rather than the browser's error page.
        const hit = await caches.match(request);
        if (hit) return hit;
        if (request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      })
  );
});
