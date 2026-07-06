/**
 * Service Worker for Eigennamen Online PWA
 *
 * Provides offline caching so standalone mode (URL-encoded game state)
 * works without a network connection. Uses network-first strategy to
 * ensure users always get the latest version when online.
 */

// Auto-synced from package.json by esbuild.config.js during build
const CACHE = 'eigennamen-v5.11.0';

const OFFLINE_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/icons/icon-180.png',
    '/icons/icon.svg',
    '/js/socket.io.min.js?v=9336af8f',
    '/js/socket-client.js?v=80d91e19',
    '/css/variables.css',
    '/css/layout.css',
    '/css/components.css',
    '/css/modals.css',
    '/css/accessibility.css',
    '/css/responsive.css',
    '/css/multiplayer.css',
    '/css/setup.css',
    '/css/replay.css',
    '/js/modules/app.js?v=4c34d627',
    '/js/app-fallback.js',
    '/js/modules/chunks/chunk-UORGLZ2T.js',
    '/js/modules/chunks/history-EZ33REAA.js',
    '/locales/en.json',
    '/locales/de.json',
    '/locales/es.json',
    '/locales/fr.json'
];

// Install - cache assets needed for offline standalone mode
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then((cache) => cache.addAll(OFFLINE_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Activate - clean up old caches and take control immediately
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(
                names.filter((n) => n !== CACHE).map((n) => caches.delete(n))
            ))
            .then(() => self.clients.claim())
    );
});

// Fetch - network-first, fall back to cache for offline support
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);

    // Never intercept socket.io transport or API calls
    if (url.pathname.startsWith('/socket.io') ||
        url.pathname.startsWith('/api') ||
        url.pathname.startsWith('/health') ||
        url.pathname.startsWith('/metrics')) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Update cache with fresh response
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE).then((cache) => cache.put(event.request, clone));
                }
                return response;
            })
            .catch(() => caches.match(event.request).then((cached) => {
                if (cached) return cached;
                // Offline navigation to a bookmarked/shared standalone game URL
                // (e.g. /?game=…&r=…&t=red): the query string encodes the game
                // state, so an exact cache match misses the cached '/'. The SPA
                // restores state from location.search on load, so serve the cached
                // app shell for ANY navigation request instead of a bare 503.
                if (event.request.mode === 'navigate') {
                    return caches.match('/index.html').then((shell) => shell || caches.match('/'));
                }
                return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
            }))
    );
});
