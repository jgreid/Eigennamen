/**
 * Socket.io Authentication Middleware
 */

const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const playerService = require('../services/playerService');

/**
 * Authenticate socket connection
 */
async function authenticateSocket(socket, next) {
    try {
        const { sessionId, token } = socket.handshake.auth;

        // Use provided session ID or generate new one
        if (sessionId) {
            socket.sessionId = sessionId;
        } else {
            socket.sessionId = uuidv4();
        }

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

        // Map socket ID to session ID for this connection
        await playerService.setSocketMapping(socket.sessionId, socket.id);

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
