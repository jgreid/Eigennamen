/**
 * Embedded-Redis shutdown-ordering regression test.
 *
 * Boots a real embedded Redis (REDIS_URL=memory, same as luaScripts.test.ts),
 * then makes the main client's quit() hang forever and verifies disconnectRedis()
 * still (a) resolves within its per-call timeout budget and (b) kills the spawned
 * redis-server child — proven by the child's port refusing new connections
 * afterward. See docs/HARDENING_PLAN.md P1-3.
 */
process.env['REDIS_URL'] = 'memory';

import { connectRedis, disconnectRedis, getRedis } from '../../config/redis';
import { Socket } from 'net';

const CONNECT_TIMEOUT_MS = 20000;

function canConnect(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = new Socket();
        socket.setTimeout(1000);
        socket.once('connect', () => {
            socket.destroy();
            resolve(true);
        });
        socket.once('error', () => resolve(false));
        socket.once('timeout', () => {
            socket.destroy();
            resolve(false);
        });
        socket.connect(port, '127.0.0.1');
    });
}

describe('disconnectRedis shutdown ordering (embedded Redis)', () => {
    afterEach(async () => {
        // Best-effort cleanup in case a test fails before its own disconnectRedis() runs.
        try {
            await disconnectRedis();
        } catch {
            // Ignore — already disconnected.
        }
    });

    it(
        'kills the embedded redis-server child even when a client quit() hangs forever',
        async () => {
            await connectRedis();

            const client = getRedis() as unknown as { options?: { url?: string }; quit: () => Promise<unknown> };
            const url = client.options?.url ?? '';
            const port = Number(url.split(':').pop());
            expect(Number.isInteger(port)).toBe(true);

            expect(await canConnect(port)).toBe(true);

            // Make quit() hang forever — never resolves, never rejects.
            client.quit = () => new Promise(() => {});

            const start = Date.now();
            await disconnectRedis();
            const elapsedMs = Date.now() - start;

            // The per-client quit() timeout is 3s; disconnectRedis() must not exceed that
            // by more than a small margin regardless of how many clients hang.
            expect(elapsedMs).toBeLessThan(6000);

            // The embedded redis-server child must be gone — proving stopEmbeddedRedis()
            // ran in the finally block despite the hung quit().
            expect(await canConnect(port)).toBe(false);
        },
        CONNECT_TIMEOUT_MS
    );
});
