/**
 * Dhela service worker.
 *
 * Written by hand rather than generated. vite-plugin-pwa would have to be
 * threaded through the TanStack Start / Nitro build, and the caching rules
 * below are the whole point of this file: getting them wrong on a billing app
 * means showing somebody yesterday's stock as though it were today's.
 *
 * Three rules, by kind of request:
 *
 *   hashed build assets   cache-first      the filename changes on deploy, so
 *                                          a cached copy can never be stale
 *   navigations           network-first    always try for fresh HTML; fall back
 *                                          to the shell so the app opens at all
 *   Supabase GET reads    network-first    fresh when possible, last-known when
 *                                          not, and every served-from-cache
 *                                          response is tagged so the UI can say
 *
 * Everything else, including every write, is passed straight through. A queued
 * POST that replays itself later is exactly how you get a duplicate invoice.
 */

/*
 * Replaced at build time with the build's own id, which is the point: a service
 * worker is only reinstalled when its bytes change. A static sw.js is
 * byte-identical after every deploy, so the browser never notices a new
 * version, never re-runs install, and keeps serving the previous build's
 * chunks forever. Verified: two builds, and the worker stayed active with
 * waiting:false until this was baked in.
 */
const VERSION = "__BUILD_VERSION__";
const SHELL = `dhela-shell-${VERSION}`;
const ASSETS = `dhela-assets-${VERSION}`;
const DATA = `dhela-data-${VERSION}`;
const KEEP = [SHELL, ASSETS, DATA];

/**
 * Precache the whole app, not just what has been visited.
 *
 * Caching only what passed through the worker meant a screen the operator had
 * not opened that day had never had its chunk stored, so with no signal it
 * failed with "Failed to fetch dynamically imported module" — the app looking
 * broken rather than offline. The manifest is written after the build, because
 * the filenames are content-hashed.
 *
 * addAll is not used: it rejects the whole batch if a single file 404s, and
 * losing the entire precache to one stale entry is worse than missing one file.
 */
self.addEventListener("install", (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      await Promise.allSettled(
        ["/", "/manifest.webmanifest"].map(async (u) => cache.put(u, await fetchOrThrow(u))),
      ).catch(() => {});
      try {
        const res = await fetch("/asset-manifest.json", { cache: "no-store" });
        if (!res.ok) return;
        const { assets = [] } = await res.json();
        const assetCache = await caches.open(ASSETS);
        await Promise.allSettled(
          assets.map(async (u) => {
            const r = await fetch(u, { cache: "no-store" });
            if (r.ok) await assetCache.put(u, r);
          }),
        );
      } catch {
        // No manifest, or offline while installing. The runtime rules below
        // still cache whatever is visited, so this degrades rather than fails.
      }
    })(),
  );
  // Deliberately no skipWaiting(). Taking over immediately would activate the
  // new worker under tabs that are already open, and activate deletes the
  // previous version's caches — pulling the chunks a running tab still needs
  // out from under it. That is the "Failed to fetch dynamically imported
  // module" people were seeing after a deploy.
  //
  // Instead the new worker waits. The page notices it waiting, offers a reload,
  // and only then is it told to take over.
});

async function fetchOrThrow(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  return r;
}

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Signing out must not leave one person's stock and parties readable on a
// shared godown phone.
self.addEventListener("message", (e) => {
  if (e.data === "clear-data-cache") {
    e.waitUntil(caches.delete(DATA));
  }
  // Sent when the operator accepts the update. Only then does the new worker
  // take over and clear the old caches.
  if (e.data === "skip-waiting") self.skipWaiting();
});

const isAsset = (url) =>
  url.origin === self.location.origin &&
  /\.(js|css|woff2?|png|svg|ico|jpg|jpeg|webp)$/.test(url.pathname);

const isSupabaseRead = (req, url) =>
  req.method === "GET" && /\.supabase\.co$/.test(url.hostname) && url.pathname.startsWith("/rest/");

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Writes are never touched. Not cached, not queued, not retried.
  if (req.method !== "GET") return;

  if (isAsset(url)) {
    event.respondWith(
      caches.match(req).then((hit) =>
        hit || fetch(req).then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(ASSETS).then((c) => c.put(req, copy)); }
          return res;
        }),
      ),
    );
    return;
  }

  if (isSupabaseRead(req, url)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(DATA).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(async () => {
          const hit = await caches.match(req);
          if (!hit) throw new Error("offline and not cached");
          // Tagged so the app can tell "this is live" from "this is what we
          // had", instead of quietly presenting old figures as current.
          const h = new Headers(hit.headers);
          h.set("x-dhela-from-cache", "1");
          return new Response(await hit.blob(), { status: 200, headers: h });
        }),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match(req).then((hit) => hit || caches.match("/"))),
    );
  }
});
