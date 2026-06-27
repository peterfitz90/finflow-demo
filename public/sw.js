// Ledgrly service worker — v2
// Caching strategy:
//   Navigation (HTML): network-first → cached shell only when offline
//   Hashed static assets (JS/CSS): cache-first → immutable once fetched
//   /api/*: network-first, no caching
//   Cross-origin (Clerk, Supabase, fonts): pass-through, not intercepted

const CACHE_VERSION = 'ledgrly-v2';

// Assets to pre-cache on install (shell only — hashed assets are cached on first fetch)
const PRECACHE = ['/mobile', '/manifest.json', '/icon-180.png', '/icon-192.png', '/icon-512.png'];

// ── Lifecycle ─────────────────────────────────────────────────────────────────

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then(c => c.addAll(PRECACHE).catch(() => {})) // soft-fail if offline at install time
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch handler ─────────────────────────────────────────────────────────────

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Skip cross-origin requests entirely (Clerk, Supabase, Google Fonts, etc.)
  if (url.origin !== location.origin) return;

  // /api/ — network-first, no caching
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  // Hashed static assets (Vite output: /assets/index-XXXXXXXX.js etc.)
  // These are content-addressed so cache-first is safe.
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_VERSION).then(c => c.put(request, clone));
          }
          return resp;
        });
      })
    );
    return;
  }

  // Everything else (navigations, /mobile, /, /manifest.json, icons, etc.)
  // Network-first: always try to get a fresh response; fall back to cache only if offline.
  // This ensures stale HTML/JS bundles are never served to installed users after a redeploy.
  e.respondWith(
    fetch(request)
      .then(resp => {
        if (resp.ok && request.method === 'GET') {
          const clone = resp.clone();
          caches.open(CACHE_VERSION).then(c => c.put(request, clone));
        }
        return resp;
      })
      .catch(() => caches.match(request))
  );
});

// ── Push (scaffolded — not yet wired from server) ─────────────────────────────

self.addEventListener('push', e => {
  if (!e.data) return;
  let data = {};
  try { data = e.data.json(); } catch { data = { title: 'Ledgrly', body: e.data.text() }; }
  e.waitUntil(
    self.registration.showNotification(data.title || 'Ledgrly', {
      body:  data.body  || '',
      icon:  '/icon-192.png',
      badge: '/icon-192.png',
      data,
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url || '/mobile'));
});
