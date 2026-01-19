/**
 * Socket.io Authentication Middleware
 */

const { v4: uuidv4, validate: isValidUuid } = require('uuid');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const playerService = require('../services/playerService');

/**
 * Authenticate socket connection
 * Includes session validation to prevent hijacking
 */
async function authenticateSocket(socket, next) {
    try {
        const { sessionId, token } = socket.handshake.auth;

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
                        const currentIP = socket.handshake.address;
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
                        logger.warn(`Session hijacking attempt blocked for ${sessionId} from ${socket.handshake.address}`);
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

        // If token provided, verify and attach user info
        if (token) {
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                socket.userId = decoded.userId;
                socket.user = decoded;
            } catch (err) {
                // Invalid token, continue as anonymous
                logger.warn(`Invalid token for socket ${socket.id}`);
            }
        }

        // Map socket ID to session ID for this connection (with IP tracking for security)
        await playerService.setSocketMapping(socket.sessionId, socket.id, socket.handshake.address);

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
