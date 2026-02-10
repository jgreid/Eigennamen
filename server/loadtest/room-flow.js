/**
 * K6 Load Test: Room Creation & Join Flow
 *
 * Tests the HTTP API under load for room operations.
 * Run: k6 run loadtest/room-flow.js
 *
 * Targets:
 * - Room existence check: <50ms p95
 * - Room info fetch: <100ms p95
 * - Concurrent rooms: 1,000+
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// Custom metrics
const roomCheckLatency = new Trend('room_check_latency', true);
const roomInfoLatency = new Trend('room_info_latency', true);
const healthLatency = new Trend('health_check_latency', true);
const errors = new Counter('errors');

// Configuration
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const options = {
    scenarios: {
        // Ramp up to simulate growing user base
        room_checks: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '30s', target: 50 },   // Ramp up
                { duration: '1m', target: 100 },    // Sustain
                { duration: '30s', target: 200 },   // Peak
                { duration: '30s', target: 0 },     // Ramp down
            ],
            exec: 'roomCheckFlow',
        },
        // Constant health checks
        health_monitor: {
            executor: 'constant-vus',
            vus: 5,
            duration: '2m30s',
            exec: 'healthCheck',
        },
    },
    thresholds: {
        http_req_duration: ['p(95)<200', 'p(99)<500'],
        room_check_latency: ['p(95)<50'],
        room_info_latency: ['p(95)<100'],
        health_check_latency: ['p(95)<50'],
        errors: ['count<10'],
    },
};

// Generate random room codes
function randomRoomCode() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Room check flow: Check room existence + fetch room info
 */
export function roomCheckFlow() {
    const roomCode = randomRoomCode();

    // Check room existence
    const existsRes = http.get(`${BASE_URL}/api/rooms/${roomCode}/exists`, {
        tags: { name: 'room_exists' },
    });
    roomCheckLatency.add(existsRes.timings.duration);

    const existsOk = check(existsRes, {
        'room exists returns 200': (r) => r.status === 200,
        'room exists has valid body': (r) => {
            const body = r.json();
            return body !== null && typeof body.exists === 'boolean';
        },
    });
    if (!existsOk) errors.add(1);

    // Fetch room info (expected 404 for random codes)
    const infoRes = http.get(`${BASE_URL}/api/rooms/${roomCode}`, {
        tags: { name: 'room_info' },
    });
    roomInfoLatency.add(infoRes.timings.duration);

    check(infoRes, {
        'room info returns expected status': (r) => r.status === 200 || r.status === 404,
    });

    sleep(0.5 + Math.random());
}

/**
 * Health check monitoring
 */
export function healthCheck() {
    const res = http.get(`${BASE_URL}/health`, {
        tags: { name: 'health' },
    });
    healthLatency.add(res.timings.duration);

    const ok = check(res, {
        'health returns 200': (r) => r.status === 200,
        'health reports ok': (r) => {
            const body = r.json();
            return body && body.status === 'ok';
        },
    });
    if (!ok) errors.add(1);

    sleep(2);
}
