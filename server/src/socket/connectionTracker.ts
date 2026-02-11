/**
 * Connection Tracking for DoS Protection
 *
 * Tracks the number of active socket connections per IP address
 * and enforces per-IP connection limits. Includes periodic cleanup
 * that reconciles tracked counts against actual connected sockets.
 *
 * Extracted from socket/index.ts for separation of concerns.
 */

import type { Server as SocketIOServer } from 'socket.io';
import type { GameSocket } from './rateLimitHandler';

const logger = require('../utils/logger');
const { SOCKET } = require('../config/constants');

// Track connections per IP for DoS protection
const connectionsPerIP = new Map<string, number>();

// Maximum distinct IPs to track before rejecting new connections
const MAX_TRACKED_IPS = 10000;

// Periodic cleanup interval handle
let connectionsCleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Increment the connection count for a given IP address
 * @param ip - Client IP address
 */
function incrementConnectionCount(ip: string): void {
    const currentCount = connectionsPerIP.get(ip) || 0;
    // If this is a new IP and we've hit the cap, reject to prevent memory DoS
    if (currentCount === 0 && connectionsPerIP.size >= MAX_TRACKED_IPS) {
        logger.warn('Connection tracker IP map at capacity, rejecting new IP', { ip, mapSize: connectionsPerIP.size });
        return;
    }
    connectionsPerIP.set(ip, currentCount + 1);
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
    } else {
        connectionsPerIP.set(ip, currentCount - 1);
    }
}

/**
 * Check whether the given IP has reached the maximum allowed connections
 * @param ip - Client IP address
 * @returns True if the connection limit has been reached or exceeded
 */
function isConnectionLimitReached(ip: string): boolean {
    const currentCount = connectionsPerIP.get(ip) || 0;
    if (currentCount >= SOCKET.MAX_CONNECTIONS_PER_IP) return true;
    // Reject new IPs when map is at capacity to prevent memory DoS
    if (currentCount === 0 && connectionsPerIP.size >= MAX_TRACKED_IPS) return true;
    return false;
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
            for (const [ip, count] of actualCounts) {
                connectionsPerIP.set(ip, count);
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

module.exports = {
    incrementConnectionCount,
    decrementConnectionCount,
    isConnectionLimitReached,
    getConnectionCount,
    getConnectionsMap,
    startConnectionsCleanup,
    stopConnectionsCleanup
};

export {
    incrementConnectionCount,
    decrementConnectionCount,
    isConnectionLimitReached,
    getConnectionCount,
    getConnectionsMap,
    startConnectionsCleanup,
    stopConnectionsCleanup
};
