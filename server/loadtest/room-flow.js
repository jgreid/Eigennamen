/**
 * K6 Load Test: Room Creation & Join Flow
 *
 * Tests the HTTP API under load for room operations.
 *
 * IMPORTANT (D5): /api/rooms/:code/exists is rate-limited to 10/min/IP. Ramping
 * 200 VUs from one IP means every request after the first 10 is a 429, so the
 * latency Trends would measure rate-limited fast-rejects, not real handler time.
 * Run the server with the load-test relax flag so the limiter is bypassed
 * (fail-closed in production):
 *   LOADTEST_RELAX_RATE_LIMITS=true REDIS_URL=memory npm run dev
 *   k6 run loadtest/room-flow.js
 * Any 429s that still occur are counted in the separate `rate_limited_429`
 * metric and excluded from the latency Trends.
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
// 429s are tracked separately so they never pollute the latency Trends. D5.
const rateLimited = new Counter('rate_limited_429');

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
        // `count>0` guards make a threshold FAIL if the metric never accumulated
        // a sample, instead of silently passing on zero data. D5.
        room_check_latency: ['p(95)<50', 'count>0'],
        room_info_latency: ['p(95)<100', 'count>0'],
        health_check_latency: ['p(95)<50', 'count>0'],
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

    // A 429 means the per-IP limiter fired (run with LOADTEST_RELAX_RATE_LIMITS
    // to avoid it). Count it separately and DON'T fold its fast-reject timing
    // into the latency Trend, which is meant to reflect real handler time. D5.
    if (existsRes.status === 429) {
        rateLimited.add(1);
    } else {
        roomCheckLatency.add(existsRes.timings.duration);
        const existsOk = check(existsRes, {
            'room exists returns 200': (r) => r.status === 200,
            'room exists has valid body': (r) => {
                const body = r.json();
                return body !== null && typeof body.exists === 'boolean';
            },
        });
        if (!existsOk) errors.add(1);
    }

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
