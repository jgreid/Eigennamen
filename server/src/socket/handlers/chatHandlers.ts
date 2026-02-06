/**
 * Chat Socket Event Handlers
 *
 * Migrated to use context handler architecture for consistent
 * validation, error handling, and socket room management.
 */

import type { Server, Socket } from 'socket.io';
import type { Player, GameState, Team, Role } from '../../types';

/* eslint-disable @typescript-eslint/no-var-requires */
const playerService = require('../../services/playerService');
const { chatMessageSchema, spectatorChatSchema } = require('../../validators/schemas');
const logger = require('../../utils/logger');
const { SOCKET_EVENTS } = require('../../config/constants');
const { createRoomHandler } = require('../contextHandler');
const { sanitizeHtml } = require('../../utils/sanitize');
const { RoomError, PlayerError } = require('../../errors/GameError');
/* eslint-enable @typescript-eslint/no-var-requires */

/**
 * Extended Socket type with custom properties
 */
interface GameSocket extends Socket {
    sessionId: string;
    roomCode: string | null;
}

/**
 * Room handler context
 */
interface RoomContext {
    sessionId: string;
    roomCode: string;
    player: Player;
    game: GameState | null;
}

/**
 * Chat message input
 */
interface ChatMessageInput {
    text: string;
    teamOnly?: boolean;
    spectatorOnly?: boolean;
}

/**
 * Spectator chat input
 */
interface SpectatorChatInput {
    message: string;
}

/**
 * Chat message structure
 */
interface ChatMessage {
    from: {
        sessionId: string;
        nickname: string;
        team: Team | null;
        role: Role;
    };
    text: string;
    teamOnly?: boolean;
    spectatorOnly?: boolean;
    timestamp: number;
}

function chatHandlers(io: Server, socket: GameSocket): void {

    /**
     * Send a chat message
     */
    socket.on(SOCKET_EVENTS.CHAT_MESSAGE, createRoomHandler(socket, SOCKET_EVENTS.CHAT_MESSAGE, chatMessageSchema,
        async (ctx: RoomContext, validated: ChatMessageInput) => {
            const message: ChatMessage = {
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

            // Validate spectatorOnly flag - only spectators can send spectator-only messages
            if (validated.spectatorOnly && ctx.player.role !== 'spectator') {
                throw PlayerError.notAuthorized();
            }

            // Spectator-only chat
            if (validated.spectatorOnly) {
                const allPlayers: Player[] = await playerService.getPlayersInRoom(ctx.roomCode);
                if (!allPlayers || !Array.isArray(allPlayers)) {
                    throw RoomError.notFound(ctx.roomCode);
                }
                const spectators = allPlayers.filter((p: Player) => p.role === 'spectator' && p.connected);

                for (const spectator of spectators) {
                    try {
                        io.to(`player:${spectator.sessionId}`).emit(SOCKET_EVENTS.CHAT_MESSAGE, message);
                    } catch (emitError) {
                        logger.error(`Failed to emit chat:message to spectator ${spectator.sessionId}:`, emitError);
                    }
                }
            } else if (validated.teamOnly && ctx.player.team) {
                const teammates: Player[] = await playerService.getTeamMembers(ctx.roomCode, ctx.player.team);
                if (!teammates || !Array.isArray(teammates)) {
                    logger.warn(`No teammates found for ${ctx.player.team} team in room ${ctx.roomCode}`);
                    socket.emit(SOCKET_EVENTS.CHAT_MESSAGE, message);
                    return;
                }

                for (const teammate of teammates) {
                    try {
                        io.to(`player:${teammate.sessionId}`).emit(SOCKET_EVENTS.CHAT_MESSAGE, message);
                    } catch (emitError) {
                        logger.error(`Failed to emit chat:message to ${teammate.sessionId}:`, emitError);
                    }
                }
            } else {
                try {
                    io.to(`room:${ctx.roomCode}`).emit(SOCKET_EVENTS.CHAT_MESSAGE, message);
                } catch (emitError) {
                    logger.error(`Failed to emit chat:message to room ${ctx.roomCode}:`, emitError);
                }
            }
        }
    ));

    /**
     * Send a spectator-only chat message
     */
    socket.on(SOCKET_EVENTS.CHAT_SPECTATOR, createRoomHandler(socket, SOCKET_EVENTS.CHAT_SPECTATOR, spectatorChatSchema,
        (ctx: RoomContext, validated: SpectatorChatInput) => {
            // Only allow spectators to send spectator-only messages
            if (ctx.player.role !== 'spectator') {
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
}

module.exports = chatHandlers;
export default chatHandlers;
