import type { Server } from 'socket.io';
import type { GameSocket, RoomContext } from '../types';

import * as roomService from '../../../services/roomService';
import { roomSettingsSchema } from '../../../validators/schemas';
import logger from '../../../utils/logger';
import { SOCKET_EVENTS } from '../../../config/constants';
import { createHostHandler } from '../../contextHandler';
import { safeEmitToRoom } from '../../safeEmit';

export default function roomSettingsHandlers(io: Server, socket: GameSocket): void {
    /**
     * Update room settings (host only)
     */
    socket.on(
        SOCKET_EVENTS.ROOM_SETTINGS,
        createHostHandler(
            socket,
            SOCKET_EVENTS.ROOM_SETTINGS,
            roomSettingsSchema,
            async (ctx: RoomContext, validated: Record<string, unknown>) => {
                const settings = await roomService.updateSettings(ctx.roomCode, ctx.sessionId, validated);

                safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.ROOM_SETTINGS_UPDATED, { settings });

                logger.info(`Room ${ctx.roomCode} settings updated`);
            }
        )
    );
}
