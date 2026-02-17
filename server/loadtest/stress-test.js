#!/usr/bin/env node
/**
 * Eigennamen Load Test - Stress Test
 *
 * Simulates concurrent players to measure server performance.
 *
 * Usage:
 *   node stress-test.js [options]
 *
 * Options:
 *   --clients=N      Number of concurrent clients (default: 50)
 *   --rooms=N        Number of rooms to create (default: 10)
 *   --duration=N     Test duration in seconds (default: 60)
 *   --ramp-up=N      Ramp-up time in seconds (default: 10)
 *   --url=URL        Server URL (default: http://localhost:3000)
 *
 * Example:
 *   node stress-test.js --clients=100 --rooms=20 --duration=120
 */

const { io } = require('socket.io-client');

// Parse CLI arguments
function parseArgs() {
    const args = {
        clients: 50,
        rooms: 10,
        duration: 60,
        rampUp: 10,
        url: 'http://localhost:3000'
    };

    for (const arg of process.argv.slice(2)) {
        const [key, value] = arg.replace('--', '').split('=');
        if (key === 'clients') args.clients = parseInt(value, 10);
        if (key === 'rooms') args.rooms = parseInt(value, 10);
        if (key === 'duration') args.duration = parseInt(value, 10);
        if (key === 'ramp-up') args.rampUp = parseInt(value, 10);
        if (key === 'url') args.url = value;
    }

    return args;
}

// Metrics collector
class MetricsCollector {
    constructor() {
        this.connections = { success: 0, failed: 0 };
        this.latencies = [];
        this.errors = [];
        this.events = { sent: 0, received: 0 };
        this.startTime = Date.now();
    }

    recordLatency(ms) {
        this.latencies.push(ms);
    }

    recordError(error) {
        this.errors.push({ time: Date.now() - this.startTime, message: error.message || error });
    }

    getPercentile(p) {
        if (this.latencies.length === 0) return 0;
        const sorted = [...this.latencies].sort((a, b) => a - b);
        const index = Math.ceil((p / 100) * sorted.length) - 1;
        return sorted[Math.max(0, index)];
    }

    report() {
        const elapsed = (Date.now() - this.startTime) / 1000;
        console.log('\n=== Load Test Results ===');
        console.log(`Duration: ${elapsed.toFixed(1)}s`);
        console.log(`\nConnections:`);
        console.log(`  Successful: ${this.connections.success}`);
        console.log(`  Failed: ${this.connections.failed}`);
        console.log(`  Rate: ${(this.connections.success / elapsed).toFixed(1)}/s`);
        console.log(`\nEvents:`);
        console.log(`  Sent: ${this.events.sent}`);
        console.log(`  Received: ${this.events.received}`);
        console.log(`  Rate: ${(this.events.sent / elapsed).toFixed(1)} sent/s`);

        if (this.latencies.length > 0) {
            console.log(`\nLatency (ms):`);
            console.log(`  Min: ${Math.min(...this.latencies).toFixed(1)}`);
            console.log(`  Max: ${Math.max(...this.latencies).toFixed(1)}`);
            console.log(`  Avg: ${(this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length).toFixed(1)}`);
            console.log(`  P50: ${this.getPercentile(50).toFixed(1)}`);
            console.log(`  P95: ${this.getPercentile(95).toFixed(1)}`);
            console.log(`  P99: ${this.getPercentile(99).toFixed(1)}`);
        }

        if (this.errors.length > 0) {
            console.log(`\nErrors: ${this.errors.length}`);
            // Show unique error messages
            const uniqueErrors = [...new Set(this.errors.map(e => e.message))];
            uniqueErrors.forEach(msg => {
                const count = this.errors.filter(e => e.message === msg).length;
                console.log(`  ${msg} (x${count})`);
            });
        }

        console.log('\n========================');
    }
}

// Create a test client that simulates a player
function createClient(config, roomCode, nickname, metrics) {
    return new Promise((resolve) => {
        const start = Date.now();
        const socket = io(config.url, {
            transports: ['websocket'],
            reconnection: false,
            timeout: 10000
        });

        const timeout = setTimeout(() => {
            metrics.connections.failed++;
            metrics.recordError({ message: 'Connection timeout' });
            socket.disconnect();
            resolve(null);
        }, 10000);

        socket.on('connect', () => {
            clearTimeout(timeout);
            metrics.connections.success++;
            metrics.recordLatency(Date.now() - start);

            resolve({
                socket,
                roomCode,
                nickname,
                async joinRoom() {
                    const joinStart = Date.now();
                    metrics.events.sent++;
                    socket.emit('room:join', { roomId: roomCode, nickname });

                    return new Promise((res) => {
                        const joinTimeout = setTimeout(() => {
                            metrics.recordError({ message: 'Join timeout' });
                            res(false);
                        }, 15000);

                        socket.once('room:joined', () => {
                            clearTimeout(joinTimeout);
                            metrics.events.received++;
                            metrics.recordLatency(Date.now() - joinStart);
                            res(true);
                        });

                        socket.once('room:error', (error) => {
                            clearTimeout(joinTimeout);
                            metrics.events.received++;
                            // Room not found is expected for first client (needs to create room)
                            if (error?.code !== 'ROOM_NOT_FOUND') {
                                metrics.recordError({ message: `Join error: ${error?.message || error?.code}` });
                            }
                            res(false);
                        });
                    });
                },
                async createRoom() {
                    const createStart = Date.now();
                    metrics.events.sent++;
                    socket.emit('room:create', { roomId: roomCode, settings: { nickname } });

                    return new Promise((res) => {
                        const createTimeout = setTimeout(() => {
                            metrics.recordError({ message: 'Create timeout' });
                            res(false);
                        }, 15000);

                        socket.once('room:created', () => {
                            clearTimeout(createTimeout);
                            metrics.events.received++;
                            metrics.recordLatency(Date.now() - createStart);
                            res(true);
                        });

                        socket.once('room:error', (error) => {
                            clearTimeout(createTimeout);
                            metrics.events.received++;
                            res(false);
                        });
                    });
                },
                disconnect() {
                    socket.disconnect();
                }
            });
        });

        socket.on('connect_error', (error) => {
            clearTimeout(timeout);
            metrics.connections.failed++;
            metrics.recordError(error);
            resolve(null);
        });
    });
}

// Sleep utility
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Main test runner
async function run() {
    const config = parseArgs();
    const metrics = new MetricsCollector();
    const clients = [];

    console.log('Eigennamen Load Test');
    console.log('==================');
    console.log(`URL: ${config.url}`);
    console.log(`Clients: ${config.clients}`);
    console.log(`Rooms: ${config.rooms}`);
    console.log(`Duration: ${config.duration}s`);
    console.log(`Ramp-up: ${config.rampUp}s`);
    console.log('');

    // Generate room codes
    const roomCodes = Array.from({ length: config.rooms }, (_, i) => `loadtest-${i}`);

    // Phase 1: Ramp up connections
    console.log('Phase 1: Ramping up connections...');
    const delayPerClient = (config.rampUp * 1000) / config.clients;

    for (let i = 0; i < config.clients; i++) {
        const roomCode = roomCodes[i % config.rooms];
        const nickname = `player-${i}`;
        const isFirstInRoom = i < config.rooms; // First client in each room creates it

        const client = await createClient(config, roomCode, nickname, metrics);

        if (client) {
            if (isFirstInRoom) {
                await client.createRoom();
            } else {
                await client.joinRoom();
            }
            clients.push(client);
        }

        if (delayPerClient > 0) {
            await sleep(delayPerClient);
        }

        // Progress indicator
        if ((i + 1) % 10 === 0 || i === config.clients - 1) {
            process.stdout.write(`\r  Connected: ${metrics.connections.success}/${config.clients}`);
        }
    }
    console.log('');

    // Phase 2: Sustain load
    console.log(`Phase 2: Sustaining load for ${config.duration}s...`);
    const endTime = Date.now() + (config.duration * 1000);
    let actionCount = 0;

    while (Date.now() < endTime) {
        // Each connected client performs an action
        for (const client of clients) {
            if (!client || !client.socket.connected) continue;

            const action = actionCount % 3;
            const actionStart = Date.now();
            metrics.events.sent++;

            if (action === 0) {
                // Set team
                client.socket.emit('player:setTeam', { team: actionCount % 2 === 0 ? 'red' : 'blue' });
            } else if (action === 1) {
                // Set role
                client.socket.emit('player:setRole', { role: 'spectator' });
            } else {
                // Request resync
                client.socket.emit('room:resync');
            }

            actionCount++;
        }

        // Wait between action bursts
        await sleep(1000);

        const remaining = Math.ceil((endTime - Date.now()) / 1000);
        if (remaining >= 0 && remaining % 10 === 0) {
            process.stdout.write(`\r  Remaining: ${remaining}s, Actions: ${actionCount}`);
        }
    }
    console.log('');

    // Phase 3: Wind down
    console.log('Phase 3: Disconnecting clients...');
    for (const client of clients) {
        if (client) client.disconnect();
    }

    // Report
    metrics.report();

    process.exit(metrics.errors.length > 0 ? 1 : 0);
}

run().catch(console.error);
