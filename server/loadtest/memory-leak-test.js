#!/usr/bin/env node
/**
 * Eigennamen Memory Leak Test
 *
 * Creates and destroys rooms repeatedly to detect memory leaks.
 * Monitors server memory via /health/metrics endpoint.
 *
 * Usage:
 *   node memory-leak-test.js [--iterations=100] [--url=http://localhost:3000]
 *
 * Because every iteration opens sockets from the same (local) IP, run the
 * server with the per-IP connection cap raised, e.g.:
 *   MAX_CONNECTIONS_PER_IP=500 REDIS_URL=memory npm run dev
 * Otherwise the default cap (10) rejects most iterations with
 * "Too many connections from this IP".
 *
 * D5: previously this test could never do its job — it built a 23+ char room
 * code (the cap is 20), so every room:create was rejected and the snapshot
 * block was never reached; it put the nickname inside `settings` (the schema
 * wants it top-level) and used the reserved name 'host'; and it did arithmetic
 * on the 'NNMB' heap *strings* from /health/metrics. It also exited 0 no matter
 * how many iterations errored. All fixed below.
 */

const { io } = require('socket.io-client');
const http = require('http');

function parseArgs() {
    const args = { iterations: 100, url: 'http://localhost:3000' };
    for (const arg of process.argv.slice(2)) {
        const [key, value] = arg.replace('--', '').split('=');
        if (key === 'iterations') args.iterations = parseInt(value, 10);
        if (key === 'url') args.url = value;
    }
    return args;
}

function fetchMetrics(url) {
    return new Promise((resolve, reject) => {
        http.get(`${url}/health/metrics`, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch {
                    resolve(null);
                }
            });
        }).on('error', reject);
    });
}

/**
 * /health/metrics reports memory.heapUsed as a string like "45MB" (see
 * healthRoutes.ts). Parse the leading number so growth math is numeric, not
 * string concatenation/NaN. Returns null if unparseable.
 */
function heapMB(metrics) {
    const raw = metrics && metrics.memory && metrics.memory.heapUsed;
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string') {
        const n = parseInt(raw, 10);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

function createSocket(url) {
    return new Promise((resolve, reject) => {
        const socket = io(url, { transports: ['websocket'], reconnection: false, timeout: 5000 });
        const timeout = setTimeout(() => {
            socket.disconnect();
            reject(new Error('timeout'));
        }, 5000);
        socket.on('connect', () => {
            clearTimeout(timeout);
            resolve(socket);
        });
        socket.on('connect_error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
    const config = parseArgs();
    console.log('Memory Leak Test');
    console.log(`Iterations: ${config.iterations}`);
    console.log(`Server: ${config.url}`);
    console.log('');

    // Short, unique-per-run room-code prefix so codes stay within the 20-char
    // cap (createRoomIdSchema) and don't collide across runs. base36 is lowercase
    // alphanumeric — exactly what normalizeRoomCode/roomIdRegex accept.
    const runId = Math.floor(Math.random() * 1e6).toString(36);

    const snapshots = [];
    let errorCount = 0;

    // Get baseline
    const baseline = await fetchMetrics(config.url);
    const baselineHeap = heapMB(baseline);
    if (baselineHeap === null) {
        console.error('FATAL: could not read a numeric heap from /health/metrics — is the server up?');
        process.exit(1);
    }
    console.log(`Baseline memory: ${baselineHeap} MB heap`);
    snapshots.push({ iteration: 0, heap: baselineHeap });

    for (let i = 1; i <= config.iterations; i++) {
        try {
            // Create room — code ≤ 20 chars, nickname top-level and NOT reserved.
            const socket1 = await createSocket(config.url);
            const roomCode = `ml${runId}${i}`;

            await new Promise((resolve, reject) => {
                const t = setTimeout(() => reject(new Error('create timeout')), 10000);
                socket1.once('room:created', () => {
                    clearTimeout(t);
                    resolve();
                });
                socket1.once('room:error', (e) => {
                    clearTimeout(t);
                    reject(new Error(e && e.message ? e.message : 'room:error'));
                });
                socket1.emit('room:create', { roomId: roomCode, nickname: 'tester1' });
            });

            // Join with second player
            const socket2 = await createSocket(config.url);
            await new Promise((resolve, reject) => {
                const t = setTimeout(() => reject(new Error('join timeout')), 10000);
                socket2.once('room:joined', () => {
                    clearTimeout(t);
                    resolve();
                });
                socket2.once('room:error', (e) => {
                    clearTimeout(t);
                    reject(new Error(e && e.message ? e.message : 'room:error'));
                });
                socket2.emit('room:join', { roomId: roomCode, nickname: 'tester2' });
            });

            // Both leave
            socket1.emit('room:leave');
            socket2.emit('room:leave');
            await sleep(100);

            socket1.disconnect();
            socket2.disconnect();
            // Let the server process both disconnects (releasing the per-IP
            // connection count) before the next iteration opens two more.
            await sleep(100);

            // Sample memory every 10 iterations
            if (i % 10 === 0) {
                const metrics = await fetchMetrics(config.url);
                const heap = heapMB(metrics);
                if (heap !== null) {
                    snapshots.push({ iteration: i, heap });
                    process.stdout.write(`\r  Iteration ${i}/${config.iterations} - Heap: ${heap} MB`);
                } else {
                    errorCount++;
                    console.error(`\n  Iteration ${i}: could not read heap from /health/metrics`);
                }
            }
        } catch (error) {
            errorCount++;
            console.error(`\n  Error at iteration ${i}: ${error.message}`);
        }
    }

    console.log('\n\n=== Memory Snapshots ===');
    for (const snap of snapshots) {
        console.log(`  Iteration ${snap.iteration}: ${snap.heap} MB heap`);
    }

    // Expect a snapshot at iteration 0 plus one every 10 iterations. Far fewer
    // means most iterations failed (e.g. every room:create rejected) — treat
    // that as a failed run, not a silent pass, so the test can actually fail.
    const expectedSnapshots = 1 + Math.floor(config.iterations / 10);
    let failed = false;

    if (snapshots.length >= 2) {
        const first = snapshots[0].heap;
        const last = snapshots[snapshots.length - 1].heap;
        const growth = last - first;
        console.log(`\nMemory growth: ${growth > 0 ? '+' : ''}${growth} MB`);

        if (growth > 50) {
            console.log('WARNING: Significant memory growth detected - possible leak');
            failed = true;
        } else {
            console.log('Memory growth within acceptable range');
        }
    } else {
        console.error('\nFAIL: not enough memory snapshots to assess growth');
        failed = true;
    }

    if (errorCount > 0) {
        console.error(`\nFAIL: ${errorCount} iteration(s) errored`);
        failed = true;
    }
    if (snapshots.length < expectedSnapshots) {
        console.error(`\nFAIL: only ${snapshots.length}/${expectedSnapshots} expected snapshots accumulated`);
        failed = true;
    }

    process.exit(failed ? 1 : 0);
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
