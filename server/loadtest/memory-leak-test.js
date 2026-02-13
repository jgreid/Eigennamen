#!/usr/bin/env node
/**
 * Codenames Memory Leak Test
 *
 * Creates and destroys rooms repeatedly to detect memory leaks.
 * Monitors server memory via /health/metrics endpoint.
 *
 * Usage:
 *   node memory-leak-test.js [--iterations=100] [--url=http://localhost:3000]
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
            res.on('data', (chunk) => data += chunk);
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

function createSocket(url) {
    return new Promise((resolve, reject) => {
        const socket = io(url, { transports: ['websocket'], reconnection: false, timeout: 5000 });
        const timeout = setTimeout(() => { socket.disconnect(); reject(new Error('timeout')); }, 5000);
        socket.on('connect', () => { clearTimeout(timeout); resolve(socket); });
        socket.on('connect_error', (err) => { clearTimeout(timeout); reject(err); });
    });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function run() {
    const config = parseArgs();
    console.log('Memory Leak Test');
    console.log(`Iterations: ${config.iterations}`);
    console.log(`Server: ${config.url}`);
    console.log('');

    const snapshots = [];

    // Get baseline
    const baseline = await fetchMetrics(config.url);
    if (baseline) {
        console.log(`Baseline memory: ${baseline.memory?.heapUsed || 'unknown'} MB heap`);
        snapshots.push({ iteration: 0, heap: baseline.memory?.heapUsed });
    }

    for (let i = 1; i <= config.iterations; i++) {
        try {
            // Create room
            const socket1 = await createSocket(config.url);
            const roomCode = `memleak-${i}-${Date.now()}`;

            await new Promise((resolve, reject) => {
                const t = setTimeout(() => reject(new Error('create timeout')), 10000);
                socket1.once('room:created', () => { clearTimeout(t); resolve(); });
                socket1.once('room:error', (e) => { clearTimeout(t); reject(new Error(e.message)); });
                socket1.emit('room:create', { roomId: roomCode, settings: { nickname: 'host' } });
            });

            // Join with second player
            const socket2 = await createSocket(config.url);
            await new Promise((resolve, reject) => {
                const t = setTimeout(() => reject(new Error('join timeout')), 10000);
                socket2.once('room:joined', () => { clearTimeout(t); resolve(); });
                socket2.once('room:error', (e) => { clearTimeout(t); reject(new Error(e.message)); });
                socket2.emit('room:join', { roomId: roomCode, nickname: 'guest' });
            });

            // Both leave
            socket1.emit('room:leave');
            socket2.emit('room:leave');
            await sleep(100);

            socket1.disconnect();
            socket2.disconnect();

            // Sample memory every 10 iterations
            if (i % 10 === 0) {
                const metrics = await fetchMetrics(config.url);
                if (metrics) {
                    snapshots.push({ iteration: i, heap: metrics.memory?.heapUsed });
                    process.stdout.write(`\r  Iteration ${i}/${config.iterations} - Heap: ${metrics.memory?.heapUsed || '?'} MB`);
                }
            }
        } catch (error) {
            console.error(`\n  Error at iteration ${i}: ${error.message}`);
        }
    }

    console.log('\n\n=== Memory Snapshots ===');
    for (const snap of snapshots) {
        console.log(`  Iteration ${snap.iteration}: ${snap.heap} MB heap`);
    }

    if (snapshots.length >= 2) {
        const first = snapshots[0].heap;
        const last = snapshots[snapshots.length - 1].heap;
        const growth = last - first;
        console.log(`\nMemory growth: ${growth > 0 ? '+' : ''}${growth} MB`);

        if (growth > 50) {
            console.log('WARNING: Significant memory growth detected - possible leak');
            process.exit(1);
        } else {
            console.log('Memory growth within acceptable range');
        }
    }
}

run().catch(console.error);
