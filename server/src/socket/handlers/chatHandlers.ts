/**
 * Chat Socket Event Handlers
 *
 * Migrated to use context handler architecture for consistent
 * validation, error handling, and socket room management.
 */

import type { Server } from 'socket.io';
import type { Player, Team, Role } from '../../types';
import type { GameSocket, RoomContext } from './types';

import * as playerService from '../../services/playerService';
import { chatMessageSchema, spectatorChatSchema } from '../../validators/schemas';
import logger from '../../utils/logger';
import { SOCKET_EVENTS } from '../../config/constants';
import { createRoomHandler } from '../contextHandler';
import { sanitizeHtml } from '../../utils/sanitize';
import { PlayerError } from '../../errors/GameError';
import { safeEmitToRoom, safeEmitToPlayer, safeEmitToGroup } from '../safeEmit';

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

            // Spectator-only chat: use the spectators socket room instead of
            // fetching all players from Redis and iterating (O(n) -> O(1))
            if (validated.spectatorOnly) {
                safeEmitToGroup(io, `spectators:${ctx.roomCode}`, SOCKET_EVENTS.CHAT_MESSAGE, message);
            } else if (validated.teamOnly && ctx.player.team) {
                const teammates: Player[] = await playerService.getTeamMembers(ctx.roomCode, ctx.player.team);
                if (!teammates || !Array.isArray(teammates)) {
                    logger.warn(`No teammates found for ${ctx.player.team} team in room ${ctx.roomCode}`);
                    socket.emit(SOCKET_EVENTS.CHAT_MESSAGE, message);
                    return;
                }

                for (const teammate of teammates) {
                    safeEmitToPlayer(io, teammate.sessionId, SOCKET_EVENTS.CHAT_MESSAGE, message);
                }
            } else {
                safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.CHAT_MESSAGE, message);
            }
        }
    ));

    /**
     * Send a spectator-only chat message
     */
    socket.on(SOCKET_EVENTS.CHAT_SPECTATOR, createRoomHandler(socket, SOCKET_EVENTS.CHAT_SPECTATOR, spectatorChatSchema,
        async (ctx: RoomContext, validated: SpectatorChatInput) => {
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

            safeEmitToGroup(io, `spectators:${ctx.roomCode}`, SOCKET_EVENTS.CHAT_SPECTATOR_MESSAGE, message);
        }
    ));
}

export default chatHandlers;

// CommonJS interop — tests use require() which needs module.exports
module.exports = chatHandlers;
module.exports.default = chatHandlers;
