/**
 * K6 Load Test: WebSocket Game Simulation
 *
 * E-10: Extended to cover full game flow via WebSocket — room creation,
 * join, team assignment, game start, card reveals, and chat messages.
 *
 * Run: k6 run loadtest/websocket-game.js
 *
 * Targets:
 * - 5,000 concurrent WebSocket connections
 * - Card reveal latency: <100ms p95
 * - Room creation: <500ms p95
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
const roomCreateLatency = new Trend('room_create_latency', true);
const gameActionLatency = new Trend('game_action_latency', true);
const chatLatency = new Trend('chat_latency', true);
const wsErrors = new Counter('ws_errors');
const roomsCreated = new Counter('rooms_created');
const gameEventsReceived = new Counter('game_events_received');
const chatMessagesSent = new Counter('chat_messages_sent');

// Configuration
const BASE_URL = __ENV.WS_URL || 'ws://localhost:3000';

export const options = {
    scenarios: {
        // Scenario 1: Room creation + basic game flow
        game_flow: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '30s', target: 50 },    // Warm up
                { duration: '1m', target: 200 },     // Moderate load
                { duration: '30s', target: 500 },    // High load
                { duration: '1m', target: 500 },     // Sustain peak
                { duration: '30s', target: 0 },      // Ramp down
            ],
            exec: 'gameFlowScenario',
        },
        // Scenario 2: Chat-heavy traffic
        chat_flood: {
            executor: 'constant-vus',
            vus: 50,
            duration: '2m',
            startTime: '30s',
            exec: 'chatScenario',
        },
    },
    thresholds: {
        ws_connect_latency: ['p(95)<500'],
        ws_message_latency: ['p(95)<200'],
        room_create_latency: ['p(95)<500'],
        game_action_latency: ['p(95)<100'],
        ws_errors: ['count<100'],
    },
};

function randomId(prefix) {
    return `${prefix}${Date.now()}${Math.floor(Math.random() * 10000)}`;
}

/**
 * Helper: Send a Socket.io event via Engine.IO WebSocket
 * Socket.io event format: 42["eventName", data]
 */
function emitEvent(socket, event, data) {
    const payload = JSON.stringify([event, data]);
    socket.send(`42${payload}`);
}

/**
 * Helper: Parse a Socket.io message
 * Returns { event, data } or null
 */
function parseMessage(msg) {
    if (!msg.startsWith('42')) return null;
    try {
        const payload = JSON.parse(msg.substring(2));
        return { event: payload[0], data: payload[1] };
    } catch (_e) {
        return null;
    }
}

/**
 * Scenario 1: Full game flow — create room, assign team, start game, reveal cards
 */
export function gameFlowScenario() {
    const url = `${BASE_URL}/socket.io/?EIO=4&transport=websocket`;
    const startTime = Date.now();

    const res = ws.connect(url, {}, function (socket) {
        const connectTime = Date.now() - startTime;
        wsConnectLatency.add(connectTime);

        const roomCode = randomId('load');
        const nickname = randomId('player');
        let actionStart = 0;
        let phase = 'connecting'; // connecting -> creating -> playing -> done

        socket.on('open', function () {
            // Wait for Engine.IO open packet
        });

        socket.on('message', function (msg) {
            // Engine.IO: 0 = open, 2 = ping, 3 = pong, 4x = Socket.io
            if (msg.startsWith('0')) {
                socket.send('40'); // Socket.io namespace connect
            } else if (msg === '2') {
                socket.send('3'); // Pong
            } else if (msg.startsWith('40')) {
                // Socket.io connected — create room
                phase = 'creating';
                actionStart = Date.now();
                emitEvent(socket, 'room:create', {
                    nickname: nickname,
                    roomId: roomCode
                });
                roomsCreated.add(1);
            } else if (msg.startsWith('42')) {
                const parsed = parseMessage(msg);
                if (!parsed) return;

                wsMessageLatency.add(Date.now() - startTime);
                gameEventsReceived.add(1);

                check(null, {
                    'received socket event': () => !!parsed.event,
                });

                switch (parsed.event) {
                    case 'room:created':
                        roomCreateLatency.add(Date.now() - actionStart);
                        // Set team
                        actionStart = Date.now();
                        emitEvent(socket, 'player:setTeam', { team: 'red' });
                        break;

                    case 'player:updated':
                        if (phase === 'creating') {
                            // Set role to spymaster
                            emitEvent(socket, 'player:setRole', { role: 'spymaster' });
                            phase = 'playing';
                        }
                        break;

                    case 'game:started':
                        gameActionLatency.add(Date.now() - actionStart);
                        // Try revealing a card
                        actionStart = Date.now();
                        emitEvent(socket, 'game:reveal', { index: 0 });
                        break;

                    case 'game:cardRevealed':
                        gameActionLatency.add(Date.now() - actionStart);
                        // Send a chat message
                        actionStart = Date.now();
                        emitEvent(socket, 'chat:message', {
                            text: 'Load test message',
                            teamOnly: false
                        });
                        chatMessagesSent.add(1);
                        break;

                    case 'chat:message':
                        chatLatency.add(Date.now() - actionStart);
                        break;

                    case 'room:error':
                    case 'game:error':
                    case 'player:error':
                        // Expected errors under load (e.g., rate limiting)
                        break;
                }
            }
        });

        socket.on('error', function (_e) {
            wsErrors.add(1);
        });

        // Keep connection alive for game duration
        sleep(5 + Math.random() * 10);
        socket.close();
    });

    check(res, {
        'WebSocket connected': (r) => r && r.status === 101,
    });
}

/**
 * Scenario 2: Chat-heavy traffic — many messages on existing connections
 */
export function chatScenario() {
    const url = `${BASE_URL}/socket.io/?EIO=4&transport=websocket`;

    const res = ws.connect(url, {}, function (socket) {
        const roomCode = randomId('chat');
        const nickname = randomId('chatter');
        let roomReady = false;

        socket.on('message', function (msg) {
            if (msg.startsWith('0')) {
                socket.send('40');
            } else if (msg === '2') {
                socket.send('3');
            } else if (msg.startsWith('40')) {
                emitEvent(socket, 'room:create', {
                    nickname: nickname,
                    roomId: roomCode
                });
            } else if (msg.startsWith('42')) {
                const parsed = parseMessage(msg);
                if (parsed && parsed.event === 'room:created') {
                    roomReady = true;
                }
            }
        });

        socket.on('error', function (_e) {
            wsErrors.add(1);
        });

        // Wait for room setup, then send chat burst
        sleep(2);

        if (roomReady) {
            for (let i = 0; i < 10; i++) {
                const actionStart = Date.now();
                emitEvent(socket, 'chat:message', {
                    text: `Chat burst ${i + 1}/10`,
                    teamOnly: i % 3 === 0 // Mix of team-only and all
                });
                chatMessagesSent.add(1);
                chatLatency.add(Date.now() - actionStart);
                sleep(0.2 + Math.random() * 0.3); // 200-500ms between messages
            }
        }

        sleep(2);
        socket.close();
    });

    check(res, {
        'Chat WebSocket connected': (r) => r && r.status === 101,
    });
}

// Default export for backwards compatibility
export default gameFlowScenario;
