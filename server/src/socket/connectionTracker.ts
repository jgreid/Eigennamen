import type { Server as SocketIOServer } from 'socket.io';
import type { GameSocket } from './rateLimitHandler';

import logger from '../utils/logger';
import { SOCKET } from '../config/constants';

// Track connections per IP for DoS protection
const connectionsPerIP = new Map<string, number>();

// Track last-seen time per IP for LRU eviction
const ipLastSeen = new Map<string, number>();

// Track auth failures per IP to prevent session ID brute-forcing
interface AuthFailureEntry {
    count: number;
    windowStart: number;
    blockedUntil: number;
}
const authFailuresPerIP = new Map<string, AuthFailureEntry>();

// Maximum distinct IPs to track before triggering LRU eviction
const MAX_TRACKED_IPS = 10000;

// Number of stale entries to evict when map is full
const LRU_EVICTION_BATCH = 1000;

// Periodic cleanup interval handle
let connectionsCleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Evict the oldest IPs with zero active connections when the map is full.
 * Falls back to evicting the oldest IPs regardless of count if needed.
 */
function evictStaleEntries(): void {
    // First pass: remove IPs with zero connections (stale entries)
    const zeroCountIPs: Array<[string, number]> = [];
    for (const [ip, lastSeen] of ipLastSeen) {
        if ((connectionsPerIP.get(ip) || 0) === 0) {
            zeroCountIPs.push([ip, lastSeen]);
        }
    }
    zeroCountIPs.sort((a, b) => a[1] - b[1]); // oldest first

    let evicted = 0;
    for (const [ip] of zeroCountIPs) {
        connectionsPerIP.delete(ip);
        ipLastSeen.delete(ip);
        evicted++;
        if (evicted >= LRU_EVICTION_BATCH) break;
    }

    // If we still need space, evict oldest regardless of count
    if (connectionsPerIP.size >= MAX_TRACKED_IPS) {
        const allIPs: Array<[string, number]> = Array.from(ipLastSeen.entries());
        allIPs.sort((a, b) => a[1] - b[1]);
        for (const [ip] of allIPs) {
            if (connectionsPerIP.size < MAX_TRACKED_IPS - LRU_EVICTION_BATCH) break;
            connectionsPerIP.delete(ip);
            ipLastSeen.delete(ip);
        }
    }

    if (evicted > 0) {
        logger.info(`Connection tracker: evicted ${evicted} stale IP entries, map size now ${connectionsPerIP.size}`);
    }
}

/**
 * Increment the connection count for a given IP address.
 * Uses LRU eviction when the map is full instead of rejecting new IPs.
 * @param ip - Client IP address
 */
function incrementConnectionCount(ip: string): void {
    const currentCount = connectionsPerIP.get(ip) || 0;
    // If this is a new IP and we've hit the cap, evict stale entries first
    if (currentCount === 0 && connectionsPerIP.size >= MAX_TRACKED_IPS) {
        evictStaleEntries();
        // If still at capacity after eviction, log warning but allow the connection
        if (connectionsPerIP.size >= MAX_TRACKED_IPS) {
            logger.warn('Connection tracker IP map at capacity after eviction, allowing new IP', { ip, mapSize: connectionsPerIP.size });
        }
    }
    connectionsPerIP.set(ip, currentCount + 1);
    ipLastSeen.set(ip, Date.now());
}

/**
 * Decrement the connection count for a given IP address.
 * Removes the entry entirely when the count reaches zero.
 * @param ip - Client IP address
 */
function decrementConnectionCount(ip: string): void {
    const currentCount = connectionsPerIP.get(ip) || 1;
    if (currentCount <= 1) {
        connectionsPerIP.delete(ip);
        ipLastSeen.delete(ip);
    } else {
        connectionsPerIP.set(ip, currentCount - 1);
        ipLastSeen.set(ip, Date.now());
    }
}

/**
 * Check whether the given IP has reached the maximum allowed connections
 * @param ip - Client IP address
 * @returns True if the connection limit has been reached or exceeded
 */
function isConnectionLimitReached(ip: string): boolean {
    const currentCount = connectionsPerIP.get(ip) || 0;
    return currentCount >= SOCKET.MAX_CONNECTIONS_PER_IP;
}

/**
 * Get the current connection count for an IP address
 * @param ip - Client IP address
 * @returns Current number of tracked connections
 */
function getConnectionCount(ip: string): number {
    return connectionsPerIP.get(ip) || 0;
}

/**
 * Get the raw connectionsPerIP map (for use in middleware and tests)
 * @returns The connectionsPerIP Map
 */
function getConnectionsMap(): Map<string, number> {
    return connectionsPerIP;
}

/**
 * Start the periodic cleanup interval that reconciles tracked connection
 * counts against actual connected sockets. Runs every CONNECTIONS_CLEANUP_INTERVAL_MS.
 *
 * @param io - Socket.io server instance used to enumerate connected sockets
 */
function startConnectionsCleanup(io: SocketIOServer): void {
    if (connectionsCleanupInterval) clearInterval(connectionsCleanupInterval);
    connectionsCleanupInterval = setInterval(() => {
        try {
            if (!io) return;
            const actualCounts = new Map<string, number>();
            for (const [, socket] of io.sockets.sockets) {
                const ip = (socket as GameSocket).clientIP || 'unknown';
                actualCounts.set(ip, (actualCounts.get(ip) || 0) + 1);
            }
            // Reset to actual counts
            connectionsPerIP.clear();
            ipLastSeen.clear();
            const now = Date.now();
            for (const [ip, count] of actualCounts) {
                connectionsPerIP.set(ip, count);
                ipLastSeen.set(ip, now);
            }

            // Prune expired auth failure entries to prevent unbounded memory growth.
            // Entries are checked individually by isAuthBlocked(), but IPs that never
            // reconnect would accumulate indefinitely without this periodic sweep.
            for (const [ip, entry] of authFailuresPerIP) {
                if (now - entry.windowStart > SOCKET.AUTH_FAILURE_WINDOW_MS && entry.blockedUntil < now) {
                    authFailuresPerIP.delete(ip);
                }
            }
        } catch (error) {
            logger.error('Error during connectionsPerIP cleanup:', error);
        }
    }, SOCKET.CONNECTIONS_CLEANUP_INTERVAL_MS);
}

/**
 * Stop the periodic connections cleanup interval.
 * Safe to call even if no interval is running.
 */
function stopConnectionsCleanup(): void {
    if (connectionsCleanupInterval) {
        clearInterval(connectionsCleanupInterval);
        connectionsCleanupInterval = null;
    }
}

/**
 * Record an authentication failure for the given IP.
 * If the failure count exceeds AUTH_FAILURE_MAX_PER_IP within the window,
 * the IP is blocked for AUTH_FAILURE_BLOCK_MS.
 * @param ip - Client IP address
 * @returns true if the IP is now blocked
 */
function recordAuthFailure(ip: string): boolean {
    const now = Date.now();
    const entry = authFailuresPerIP.get(ip);

    if (!entry || now - entry.windowStart > SOCKET.AUTH_FAILURE_WINDOW_MS) {
        // Start a new window
        authFailuresPerIP.set(ip, { count: 1, windowStart: now, blockedUntil: 0 });
        return false;
    }

    entry.count++;

    if (entry.count >= SOCKET.AUTH_FAILURE_MAX_PER_IP) {
        entry.blockedUntil = now + SOCKET.AUTH_FAILURE_BLOCK_MS;
        logger.warn('Auth failure limit exceeded, blocking IP', {
            ip,
            failures: entry.count,
            blockedUntilMs: SOCKET.AUTH_FAILURE_BLOCK_MS
        });
        return true;
    }

    return false;
}

/**
 * Check whether the given IP is currently blocked due to excessive auth failures.
 * Automatically clears expired blocks.
 * @param ip - Client IP address
 * @returns true if the IP is blocked
 */
function isAuthBlocked(ip: string): boolean {
    const entry = authFailuresPerIP.get(ip);
    if (!entry || entry.blockedUntil === 0) return false;

    if (Date.now() >= entry.blockedUntil) {
        // Block expired, clear the entry
        authFailuresPerIP.delete(ip);
        return false;
    }

    return true;
}

/**
 * Clear auth failure tracking for an IP (e.g., after successful auth).
 * @param ip - Client IP address
 */
function clearAuthFailures(ip: string): void {
    authFailuresPerIP.delete(ip);
}

/**
 * Get the auth failures map (for testing).
 */
function getAuthFailuresMap(): Map<string, AuthFailureEntry> {
    return authFailuresPerIP;
}

export {
    incrementConnectionCount,
    decrementConnectionCount,
    isConnectionLimitReached,
    getConnectionCount,
    getConnectionsMap,
    startConnectionsCleanup,
    stopConnectionsCleanup,
    recordAuthFailure,
    isAuthBlocked,
    clearAuthFailures,
    getAuthFailuresMap
};
export type { AuthFailureEntry };
