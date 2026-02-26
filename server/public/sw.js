/**
 * Eigennamen Online - Service Worker
 *
 * Cache strategy:
 * - Static assets (CSS, JS, icons): Cache-first with network fallback
 * - HTML pages: Network-first with cache fallback
 * - API calls: Network-only (real-time game state must be fresh)
 * - WebSocket: Bypassed (not cacheable)
 */

const CACHE_NAME = 'eigennamen-v3';
const STATIC_ASSETS = [
    '/',
    '/css/variables.css',
    '/css/layout.css',
    '/css/components.css',
    '/css/modals.css',
    '/css/responsive.css',
    '/css/accessibility.css',
    '/css/multiplayer.css',
    '/css/replay.css',
    '/js/modules/app.js',
    '/js/socket-client.js',
    '/js/socket.io.min.js',
    '/manifest.json',
    '/icons/icon.svg'
];

// Install: pre-cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                // Use addAll with individual fallbacks to handle missing files gracefully
                return Promise.allSettled(
                    STATIC_ASSETS.map((url) => cache.add(url).catch(() => {
                        console.warn(`SW: Failed to cache ${url}`);
                    }))
                );
            })
            .then(() => self.skipWaiting())
    );
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
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

// Fetch: apply cache strategy based on request type
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') return;

    // Skip WebSocket and Socket.io requests
    if (url.pathname.startsWith('/socket.io')) return;

    // Skip API requests - these need fresh data
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin/')) return;

    // Skip health checks
    if (url.pathname.startsWith('/health')) return;

    // HTML pages: Network-first
    if (request.headers.get('accept')?.includes('text/html')) {
        event.respondWith(networkFirst(request));
        return;
    }

    // Static assets (CSS, JS, images): Cache-first
    if (isStaticAsset(url.pathname)) {
        event.respondWith(cacheFirst(request));
        return;
    }

    // Locale files: Cache-first (rarely change)
    if (url.pathname.startsWith('/locales/')) {
        event.respondWith(cacheFirst(request));
        return;
    }

    // Default: Network-first
    event.respondWith(networkFirst(request));
});

/**
 * Cache-first strategy: try cache, fall back to network
 */
async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        // Return offline fallback if available
        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
    }
}

/**
 * Network-first strategy: try network, fall back to cache
 */
async function networkFirst(request) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
    }
}

/**
 * Check if a path is a static asset
 */
function isStaticAsset(pathname) {
    return pathname.startsWith('/css/') ||
           pathname.startsWith('/js/') ||
           pathname.startsWith('/icons/') ||
           pathname.endsWith('.svg') ||
           pathname.endsWith('.png') ||
           pathname.endsWith('.ico');
}
