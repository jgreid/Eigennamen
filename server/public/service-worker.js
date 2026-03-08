/**
 * Service Worker for Eigennamen Online PWA
 *
 * Provides offline caching so standalone mode (URL-encoded game state)
 * works without a network connection. Uses network-first strategy to
 * ensure users always get the latest version when online.
 */

// Keep in sync with version in package.json
const CACHE = 'eigennamen-v5.4.0-beta.5';

const OFFLINE_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json'
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
                return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
            }))
    );
});
