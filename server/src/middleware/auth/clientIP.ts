/**
 * Client IP Resolution
 *
 * Extracts the real client IP address from Socket.io connections,
 * handling reverse proxy headers (X-Forwarded-For) securely.
 * Only trusts proxy headers when explicitly configured or in known
 * deployment environments (Fly.io, Heroku).
 */

import type { Socket } from 'socket.io';

/**
 * Check if we should trust proxy headers (X-Forwarded-For)
 * Only trust when explicitly configured or in known deployment environments
 */
function shouldTrustProxy(): boolean {
    // Trust proxy if explicitly configured
    if (process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1') {
        return true;
    }
    // Auto-detect Fly.io deployment (sets FLY_APP_NAME)
    if (process.env.FLY_APP_NAME) {
        return true;
    }
    // Auto-detect Heroku (sets DYNO)
    if (process.env.DYNO) {
        return true;
    }
    // Don't trust by default in other environments
    return false;
}

/**
 * Get client IP address from socket, handling proxies securely
 * Only trusts X-Forwarded-For when behind a known/configured proxy
 */
function getClientIP(socket: Socket): string {
    // Only check X-Forwarded-For if we're configured to trust proxy
    if (shouldTrustProxy()) {
        const xForwardedFor = socket.handshake.headers['x-forwarded-for'];
        if (xForwardedFor) {
            // X-Forwarded-For can contain multiple IPs; the first one is the original client
            const headerValue = Array.isArray(xForwardedFor) ? xForwardedFor[0] : xForwardedFor;
            const ips = (headerValue || '').split(',').map(ip => ip.trim());
            return ips[0] || socket.handshake.address;
        }
    }
    // Fall back to direct connection address
    return socket.handshake.address;
}

module.exports = { shouldTrustProxy, getClientIP };

export { shouldTrustProxy, getClientIP };
