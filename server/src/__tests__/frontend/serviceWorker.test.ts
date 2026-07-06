import fs from 'fs';
import path from 'path';
import vm from 'vm';

/**
 * Guards the PWA offline story (C3): the precache must cover every asset the app
 * needs to boot offline, and offline navigation to a standalone game URL must
 * fall back to the cached shell rather than a 503.
 */

const PUBLIC_DIR = path.join(__dirname, '../../../public');
const swSource = fs.readFileSync(path.join(PUBLIC_DIR, 'service-worker.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

/** Pull the string literals out of the OFFLINE_ASSETS array. */
function offlineAssets(): string[] {
    const block = swSource.match(/const OFFLINE_ASSETS = \[([\s\S]*?)\];/);
    if (!block) throw new Error('OFFLINE_ASSETS not found in service-worker.js');
    return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('service worker precache (OFFLINE_ASSETS)', () => {
    const assets = new Set(offlineAssets());

    test('every same-origin script/stylesheet index.html references is precached with the same URL', () => {
        const refs = [...indexHtml.matchAll(/(?:src|href)="(\/[^"?#]+(?:\?v=[A-Za-z0-9]+)?)"/g)]
            .map((m) => m[1])
            .filter((u) => /\.(?:js|css)(?:\?|$)/.test(u));
        const missing = refs.filter((u) => !assets.has(u));
        expect(missing).toEqual([]);
    });

    test('the app JavaScript is precached (the C3 regression — it used to be entirely omitted)', () => {
        expect([...assets].some((u) => u.startsWith('/js/modules/app.js'))).toBe(true);
        expect([...assets].some((u) => u.startsWith('/js/socket-client.js'))).toBe(true);
        expect(assets.has('/js/app-fallback.js')).toBe(true);
        // Code-split chunks the module imports must be cached too.
        expect([...assets].some((u) => u.startsWith('/js/modules/chunks/'))).toBe(true);
    });

    test('all four locale bundles are precached', () => {
        for (const lang of ['en', 'de', 'es', 'fr']) {
            expect(assets.has(`/locales/${lang}.json`)).toBe(true);
        }
    });

    test('every precached asset exists on disk (cache.addAll fails install on any 404)', () => {
        for (const url of assets) {
            if (url === '/') continue;
            const rel = url.replace(/\?.*$/, '').replace(/^\//, '');
            expect(fs.existsSync(path.join(PUBLIC_DIR, rel))).toBe(true);
        }
    });
});

describe('service worker fetch fallback', () => {
    /** Evaluate service-worker.js against mocked SW globals and return its fetch handler. */
    function loadFetchHandler(cache: Record<string, unknown>) {
        const listeners: Record<string, (e: unknown) => void> = {};
        const sandbox: Record<string, unknown> = {
            self: {
                addEventListener: (type: string, handler: (e: unknown) => void) => {
                    listeners[type] = handler;
                },
                skipWaiting: () => {},
                clients: { claim: () => {} },
            },
            caches: {
                open: async () => ({ addAll: async () => {}, put: async () => {}, match: async () => undefined }),
                keys: async () => [],
                delete: async () => {},
                match: async (req: unknown) => {
                    const key = typeof req === 'string' ? req : (req as { url: string }).url;
                    return cache[key];
                },
            },
            fetch: async () => {
                throw new Error('offline');
            },
            URL,
            Response: class {
                status: number;
                constructor(_body: unknown, init: { status?: number } = {}) {
                    this.status = init.status ?? 200;
                }
            },
        };
        vm.createContext(sandbox);
        vm.runInContext(swSource, sandbox);
        return listeners['fetch'];
    }

    test('offline navigation to a standalone game URL resolves to the cached shell, not a 503', async () => {
        const shell = { marker: 'cached-index' };
        const handler = loadFetchHandler({ '/index.html': shell });

        let responded: Promise<unknown> | undefined;
        const event = {
            request: { method: 'GET', url: 'http://localhost/?game=1&r=0&t=red', mode: 'navigate' },
            respondWith: (p: Promise<unknown>) => {
                responded = p;
            },
        };
        handler(event);
        await expect(responded).resolves.toBe(shell);
    });

    test('offline fetch of an uncached non-navigation asset still yields a 503', async () => {
        const handler = loadFetchHandler({});

        let responded: Promise<{ status: number }> | undefined;
        const event = {
            request: { method: 'GET', url: 'http://localhost/js/missing.js', mode: 'no-cors' },
            respondWith: (p: Promise<{ status: number }>) => {
                responded = p;
            },
        };
        handler(event);
        const res = await responded;
        expect(res?.status).toBe(503);
    });
});
