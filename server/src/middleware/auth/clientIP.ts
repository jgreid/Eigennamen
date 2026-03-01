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
    // Only check proxy headers if we're configured to trust proxy
    if (shouldTrustProxy()) {
        // Prefer platform-specific headers that cannot be spoofed by clients
        // Fly.io sets Fly-Client-IP at the edge proxy
        const flyClientIP = socket.handshake.headers['fly-client-ip'];
        if (flyClientIP) {
            const ip = Array.isArray(flyClientIP) ? flyClientIP[0] : flyClientIP;
            if (ip) return ip.trim();
        }

        const xForwardedFor = socket.handshake.headers['x-forwarded-for'];
        if (xForwardedFor) {
            // X-Forwarded-For can contain multiple IPs: "client, proxy1, proxy2"
            // Each proxy appends the connecting IP to the RIGHT side.
            // The leftmost IP is client-provided and can be spoofed.
            // With a single trusted proxy layer, the rightmost IP is the real
            // client IP (added by the trusted proxy closest to us).
            const headerValue = Array.isArray(xForwardedFor) ? xForwardedFor[0] : xForwardedFor;
            const ips = (headerValue || '')
                .split(',')
                .map((ip) => ip.trim())
                .filter((ip) => ip.length > 0);
            if (ips.length > 0) {
                return ips[ips.length - 1] || socket.handshake.address;
            }
        }
    }
    // Fall back to direct connection address
    return socket.handshake.address;
}

export { shouldTrustProxy, getClientIP };
