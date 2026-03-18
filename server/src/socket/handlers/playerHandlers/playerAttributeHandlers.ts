import type { Server } from 'socket.io';
import type { Player } from '../../../types';
import type { GameSocket, RoomContext } from '../types';

import * as playerService from '../../../services/playerService';
import { playerNicknameSchema } from '../../../validators/schemas';
import logger from '../../../utils/logger';
import { SOCKET_EVENTS } from '../../../config/constants';
import { createRoomHandler } from '../../contextHandler';
import { sanitizeHtml } from '../../../utils/sanitize';
import { safeEmitToRoom } from '../../safeEmit';
import { PlayerError } from '../../../errors/GameError';

interface PlayerNicknameInput {
    nickname: string;
}

export default function playerAttributeHandlers(io: Server, socket: GameSocket): void {
    /**
     * Update nickname
     */
    socket.on(
        SOCKET_EVENTS.PLAYER_SET_NICKNAME,
        createRoomHandler(
            socket,
            SOCKET_EVENTS.PLAYER_SET_NICKNAME,
            playerNicknameSchema,
            async (ctx: RoomContext, validated: PlayerNicknameInput) => {
                const player: Player | null = await playerService.setNickname(ctx.sessionId, validated.nickname);

                if (!player) {
                    throw PlayerError.notFound(ctx.sessionId);
                }

                // Broadcast to room — frontend renders via textContent (XSS-safe),
                // so no server-side HTML encoding needed
                safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.PLAYER_UPDATED, {
                    sessionId: ctx.sessionId,
                    changes: { nickname: player.nickname },
                });

                logger.info(`Player ${ctx.sessionId} changed nickname to ${sanitizeHtml(player.nickname)}`);

                return { player };
            }
        )
    );
}
