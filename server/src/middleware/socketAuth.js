/**
 * Socket.io Authentication Middleware
 */

const { v4: uuidv4, validate: isValidUuid } = require('uuid');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const playerService = require('../services/playerService');

/**
 * Check if we should trust proxy headers (X-Forwarded-For)
 * Only trust when explicitly configured or in known deployment environments
 */
function shouldTrustProxy() {
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
function getClientIP(socket) {
    // Only check X-Forwarded-For if we're configured to trust proxy
    if (shouldTrustProxy()) {
        const xForwardedFor = socket.handshake.headers['x-forwarded-for'];
        if (xForwardedFor) {
            // X-Forwarded-For can contain multiple IPs; the first one is the original client
            const ips = xForwardedFor.split(',').map(ip => ip.trim());
            return ips[0];
        }
    }
    // Fall back to direct connection address
    return socket.handshake.address;
}

/**
 * Authenticate socket connection
 * Includes session validation to prevent hijacking
 */
async function authenticateSocket(socket, next) {
    try {
        const { sessionId, token } = socket.handshake.auth;

        // Get client IP (handles proxies)
        const currentIP = getClientIP(socket);

        // Validate and use provided session ID, or generate new one
        let validatedSessionId = null;

        if (sessionId) {
            // Validate session ID format (must be valid UUID)
            if (isValidUuid(sessionId)) {
                // Check if there's an existing player with this session
                const existingPlayer = await playerService.getPlayer(sessionId);

                if (existingPlayer) {
                    // Only allow session reuse if player is disconnected (legitimate reconnection)
                    if (!existingPlayer.connected) {
                        // Additional security: check if IP address matches (if tracked)
                        if (existingPlayer.lastIP && existingPlayer.lastIP !== currentIP) {
                            // Different IP - could be hijacking, require fresh session
                            logger.warn(`Session reuse blocked for ${sessionId} - IP mismatch (was ${existingPlayer.lastIP}, now ${currentIP})`);
                            validatedSessionId = null;
                        } else {
                            validatedSessionId = sessionId;
                            logger.debug(`Session ${sessionId} validated for reconnection`);
                        }
                    } else {
                        // Player is currently connected - potential hijacking attempt
                        logger.warn(`Session hijacking attempt blocked for ${sessionId} from ${currentIP}`);
                        // Generate new session instead of rejecting (more user-friendly)
                        validatedSessionId = null;
                    }
                } else {
                    // No existing player with this session - could be returning user or stale session
                    // Allow it (session will be created fresh when they join a room)
                    validatedSessionId = sessionId;
                }
            } else {
                // Invalid UUID format - ignore and generate new
                logger.warn(`Invalid session ID format rejected: ${sessionId}`);
            }
        }

        // Use validated session ID or generate new one
        socket.sessionId = validatedSessionId || uuidv4();

        // Store client IP on socket for rate limiting
        socket.clientIP = currentIP;

        // If token provided, verify and attach user info (only if JWT_SECRET is configured)
        if (token) {
            const secret = process.env.JWT_SECRET;
            if (!secret) {
                logger.debug('JWT_SECRET not configured, skipping socket token verification');
            } else {
                try {
                    const decoded = jwt.verify(token, secret);
                    socket.userId = decoded.userId;
                    socket.user = decoded;
                } catch (err) {
                    // Invalid token, continue as anonymous
                    logger.warn(`Invalid token for socket ${socket.id}`);
                }
            }
        }

        // Map socket ID to session ID for this connection (with IP tracking for security)
        await playerService.setSocketMapping(socket.sessionId, socket.id, currentIP);

        logger.debug(`Socket authenticated: ${socket.id} -> session ${socket.sessionId}`);
        next();

    } catch (error) {
        logger.error('Socket authentication error:', error);
        next(new Error('Authentication failed'));
    }
}

/**
 * Middleware to require authenticated user
 */
function requireAuth(socket, next) {
    if (!socket.userId) {
        return next(new Error('Authentication required'));
    }
    next();
}

module.exports = {
    authenticateSocket,
    requireAuth
};
