/**
 * Chat Socket Event Handlers
 *
 * Migrated to use context handler architecture for consistent
 * validation, error handling, and socket room management.
 */

const playerService = require('../../services/playerService');
const { chatMessageSchema, spectatorChatSchema } = require('../../validators/schemas');
const logger = require('../../utils/logger');
const { ERROR_CODES, SOCKET_EVENTS } = require('../../config/constants');
const { createRoomHandler } = require('../contextHandler');
const { sanitizeHtml } = require('../../utils/sanitize');
const { RoomError, PlayerError } = require('../../errors/GameError');

module.exports = function chatHandlers(io, socket) {

    /**
     * Send a chat message
     */
    socket.on('chat:message', createRoomHandler(socket, 'chat:message', chatMessageSchema,
        async (ctx, validated) => {
            const message = {
                from: {
                    sessionId: ctx.player.sessionId,
                    nickname: sanitizeHtml(ctx.player.nickname),
                    team: ctx.player.team,
                    role: ctx.player.role
                },
                text: sanitizeHtml(validated.text),
                teamOnly: validated.teamOnly,
                spectatorOnly: validated.spectatorOnly || false,
                timestamp: Date.now()
            };

            // Spectator-only chat
            if (validated.spectatorOnly && ctx.player.role === 'spectator') {
                const allPlayers = await playerService.getPlayersInRoom(ctx.roomCode);
                if (!allPlayers || !Array.isArray(allPlayers)) {
                    throw RoomError.notFound(ctx.roomCode);
                }
                const spectators = allPlayers.filter(p => p.role === 'spectator' && p.connected);

                for (const spectator of spectators) {
                    try {
                        io.to(`player:${spectator.sessionId}`).emit('chat:message', message);
                    } catch (emitError) {
                        logger.error(`Failed to emit chat:message to spectator ${spectator.sessionId}:`, emitError);
                    }
                }
            } else if (validated.teamOnly && ctx.player.team) {
                const teammates = await playerService.getTeamMembers(ctx.roomCode, ctx.player.team);
                if (!teammates || !Array.isArray(teammates)) {
                    logger.warn(`No teammates found for ${ctx.player.team} team in room ${ctx.roomCode}`);
                    socket.emit('chat:message', message);
                    return;
                }

                for (const teammate of teammates) {
                    try {
                        io.to(`player:${teammate.sessionId}`).emit('chat:message', message);
                    } catch (emitError) {
                        logger.error(`Failed to emit chat:message to ${teammate.sessionId}:`, emitError);
                    }
                }
            } else {
                try {
                    io.to(`room:${ctx.roomCode}`).emit('chat:message', message);
                } catch (emitError) {
                    logger.error(`Failed to emit chat:message to room ${ctx.roomCode}:`, emitError);
                }
            }
        }
    ));

    /**
     * Send a spectator-only chat message
     */
    socket.on(SOCKET_EVENTS.CHAT_SPECTATOR, createRoomHandler(socket, 'chat:spectator', spectatorChatSchema,
        async (ctx, validated) => {
            // Only allow spectators (no team or explicitly spectator role)
            if (ctx.player.team && ctx.player.role !== 'spectator') {
                throw PlayerError.notAuthorized();
            }

            const message = {
                from: {
                    sessionId: ctx.player.sessionId,
                    nickname: sanitizeHtml(ctx.player.nickname),
                    team: ctx.player.team,
                    role: ctx.player.role
                },
                text: sanitizeHtml(validated.message),
                timestamp: Date.now()
            };

            try {
                io.to(`spectators:${ctx.roomCode}`).emit(SOCKET_EVENTS.CHAT_SPECTATOR_MESSAGE, message);
            } catch (emitError) {
                logger.error(`Failed to emit ${SOCKET_EVENTS.CHAT_SPECTATOR_MESSAGE} to spectators in room ${ctx.roomCode}:`, emitError);
            }
        }
    ));
};
