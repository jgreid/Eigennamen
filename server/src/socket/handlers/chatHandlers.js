/**
 * Chat Socket Event Handlers
 */

const playerService = require('../../services/playerService');
const { validateInput } = require('../../middleware/validation');
const { chatMessageSchema, spectatorChatSchema } = require('../../validators/schemas');
const logger = require('../../utils/logger');
const { ERROR_CODES, SOCKET_EVENTS } = require('../../config/constants');
const { createRateLimitedHandler } = require('../rateLimitHandler');

/**
 * Sanitize text by encoding HTML entities (defense-in-depth against XSS)
 * The frontend should also sanitize when rendering, but this adds extra protection
 */
function sanitizeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

module.exports = function chatHandlers(io, socket) {

    /**
     * Send a chat message
     * ISSUE #29 FIX: Added type check for data before validation
     */
    socket.on('chat:message', createRateLimitedHandler(socket, 'chat:message', async (data) => {
        try {
            if (!socket.roomCode) {
                throw { code: ERROR_CODES.ROOM_NOT_FOUND, message: 'Not in a room' };
            }

            // ISSUE #29 FIX: Validate data is an object before passing to Zod
            if (!data || typeof data !== 'object') {
                throw { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid message format' };
            }

            const validated = validateInput(chatMessageSchema, data);

            const player = await playerService.getPlayer(socket.sessionId);
            if (!player) {
                throw { code: ERROR_CODES.SERVER_ERROR, message: 'Player not found' };
            }

            const message = {
                from: {
                    sessionId: player.sessionId,
                    nickname: sanitizeHtml(player.nickname),
                    team: player.team,
                    role: player.role // US-16.1: Include role for spectator identification
                },
                text: sanitizeHtml(validated.text),
                teamOnly: validated.teamOnly,
                spectatorOnly: validated.spectatorOnly || false, // US-16.1: Spectator-only flag
                timestamp: Date.now()
            };

            // US-16.1: Spectator-only chat
            if (validated.spectatorOnly && player.role === 'spectator') {
                // Send only to other spectators
                const allPlayers = await playerService.getPlayersInRoom(socket.roomCode);
                const spectators = allPlayers.filter(p => p.role === 'spectator' && p.connected);

                for (const spectator of spectators) {
                    try {
                        io.to(`player:${spectator.sessionId}`).emit('chat:message', message);
                    } catch (emitError) {
                        logger.error(`Failed to emit chat:message to spectator ${spectator.sessionId}:`, emitError);
                    }
                }
            } else if (validated.teamOnly && player.team) {
                // Send only to teammates - O(1) lookup using team sets
                const teammates = await playerService.getTeamMembers(socket.roomCode, player.team);

                for (const teammate of teammates) {
                    try {
                        io.to(`player:${teammate.sessionId}`).emit('chat:message', message);
                    } catch (emitError) {
                        logger.error(`Failed to emit chat:message to ${teammate.sessionId}:`, emitError);
                    }
                }
            } else {
                // Send to everyone in the room
                try {
                    io.to(`room:${socket.roomCode}`).emit('chat:message', message);
                } catch (emitError) {
                    logger.error(`Failed to emit chat:message to room ${socket.roomCode}:`, emitError);
                }
            }

        } catch (error) {
            logger.error('Error sending chat message:', error);
            socket.emit('chat:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));

    /**
     * Send a spectator-only chat message
     * Only spectators (players without a team or with role='spectator') can send
     * Messages are broadcast to all spectators in the room
     */
    socket.on(SOCKET_EVENTS.CHAT_SPECTATOR, createRateLimitedHandler(socket, 'chat:spectator', async (data) => {
        try {
            if (!socket.roomCode) {
                throw { code: ERROR_CODES.ROOM_NOT_FOUND, message: 'Not in a room' };
            }

            // Validate data is an object before passing to Zod
            if (!data || typeof data !== 'object') {
                throw { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid message format' };
            }

            const validated = validateInput(spectatorChatSchema, data);

            const player = await playerService.getPlayer(socket.sessionId);
            if (!player) {
                throw { code: ERROR_CODES.SERVER_ERROR, message: 'Player not found' };
            }

            // Only allow spectators to send spectator chat messages
            // A spectator is defined as: role='spectator' OR no team assigned
            const isSpectator = player.role === 'spectator' || !player.team;
            if (!isSpectator) {
                throw { code: ERROR_CODES.NOT_AUTHORIZED, message: 'Only spectators can send spectator chat messages' };
            }

            const message = {
                from: {
                    sessionId: player.sessionId,
                    nickname: sanitizeHtml(player.nickname),
                    team: player.team,
                    role: player.role
                },
                text: sanitizeHtml(validated.message),
                timestamp: Date.now()
            };

            // Broadcast to all spectators in the room using the spectators socket room
            try {
                io.to(`spectators:${socket.roomCode}`).emit(SOCKET_EVENTS.CHAT_SPECTATOR_MESSAGE, message);
            } catch (emitError) {
                logger.error(`Failed to emit ${SOCKET_EVENTS.CHAT_SPECTATOR_MESSAGE} to spectators in room ${socket.roomCode}:`, emitError);
            }

        } catch (error) {
            logger.error('Error sending spectator chat message:', error);
            socket.emit('chat:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));
};
