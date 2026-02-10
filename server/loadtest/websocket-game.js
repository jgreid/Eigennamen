/**
 * K6 Load Test: WebSocket Game Simulation
 *
 * Simulates concurrent players creating rooms and playing games via WebSocket.
 * Run: k6 run loadtest/websocket-game.js
 *
 * Targets:
 * - 5,000 concurrent WebSocket connections
 * - Card reveal latency: <40ms p95
 * - Room creation: <100ms p95
 *
 * Note: Requires k6 with WebSocket support.
 * For Socket.io testing, use the k6-socketio extension or
 * adapt to use the ws:// transport directly.
 */

import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// Custom metrics
const wsConnectLatency = new Trend('ws_connect_latency', true);
const wsMessageLatency = new Trend('ws_message_latency', true);
const wsErrors = new Counter('ws_errors');
const roomsCreated = new Counter('rooms_created');

// Configuration
const BASE_URL = __ENV.WS_URL || 'ws://localhost:3000';

export const options = {
    scenarios: {
        websocket_load: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '30s', target: 100 },   // Ramp up connections
                { duration: '1m', target: 500 },     // Moderate load
                { duration: '30s', target: 1000 },   // High load
                { duration: '1m', target: 1000 },    // Sustain peak
                { duration: '30s', target: 0 },      // Ramp down
            ],
        },
    },
    thresholds: {
        ws_connect_latency: ['p(95)<500'],
        ws_message_latency: ['p(95)<100'],
        ws_errors: ['count<50'],
    },
};

function randomId(prefix) {
    return `${prefix}${Date.now()}${Math.floor(Math.random() * 10000)}`;
}

export default function () {
    // Socket.io uses Engine.IO transport layer
    // Connect using the polling transport first, then upgrade
    // For raw k6 WebSocket, we connect to the Engine.IO WebSocket endpoint
    const url = `${BASE_URL}/socket.io/?EIO=4&transport=websocket`;

    const startTime = Date.now();

    const res = ws.connect(url, {}, function (socket) {
        const connectTime = Date.now() - startTime;
        wsConnectLatency.add(connectTime);

        let connected = false;
        const roomCode = randomId('load');
        const nickname = randomId('player');

        socket.on('open', function () {
            connected = true;
        });

        socket.on('message', function (msg) {
            const latency = Date.now() - startTime;

            // Engine.IO protocol: messages start with packet type
            // 0 = open, 2 = ping, 3 = pong, 4 = message
            if (msg.startsWith('0')) {
                // Connection opened - send Socket.io handshake
                // Socket.io namespace connect: 40 = message + connect
                socket.send('40');
            } else if (msg === '2') {
                // Ping - respond with pong
                socket.send('3');
            } else if (msg.startsWith('40')) {
                // Socket.io connected to namespace
                // Send room:create event
                // Socket.io event format: 42["eventName", data]
                const createEvent = JSON.stringify(['room:create', {
                    nickname: nickname,
                    roomId: roomCode
                }]);
                socket.send(`42${createEvent}`);
                roomsCreated.add(1);
            } else if (msg.startsWith('42')) {
                // Socket.io event received
                try {
                    const payload = JSON.parse(msg.substring(2));
                    const eventName = payload[0];
                    wsMessageLatency.add(Date.now() - startTime);

                    check(null, {
                        'received socket event': () => !!eventName,
                    });
                } catch (e) {
                    // Non-JSON message, ignore
                }
            }
        });

        socket.on('error', function (e) {
            wsErrors.add(1);
        });

        // Keep connection alive for duration
        sleep(5 + Math.random() * 10);

        socket.close();
    });

    check(res, {
        'WebSocket connected': (r) => r && r.status === 101,
    });
}
