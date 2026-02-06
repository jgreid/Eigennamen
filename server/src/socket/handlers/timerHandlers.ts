/**
 * Timer Socket Event Handlers
 * Host-only operations for manual timer control in multiplayer games.
 *
 * Migrated to use context handler architecture for consistent
 * validation, error handling, and socket room management.
 */

import type { Server, Socket } from 'socket.io';
import type { Player, GameState } from '../../types';

/* eslint-disable @typescript-eslint/no-var-requires */
const timerService = require('../../services/timerService');
const logger = require('../../utils/logger');
const { ERROR_CODES, SOCKET_EVENTS } = require('../../config/constants');
const { createHostHandler } = require('../contextHandler');
const { getSocketFunctions } = require('../socketFunctionProvider');
const { timerAddTimeSchema } = require('../../validators/schemas');
const { GameStateError } = require('../../errors/GameError');
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
 * Timer add time input
 */
interface TimerAddTimeInput {
    seconds: number;
}

/**
 * Pause result
 */
interface PauseResult {
    remainingSeconds: number;
}

/**
 * Timer info
 */
interface TimerInfo {
    endTime: number;
    remainingSeconds: number;
}

function timerHandlers(io: Server, socket: GameSocket): void {

    /**
     * Pause the current turn timer (host only)
     */
    socket.on(SOCKET_EVENTS.TIMER_PAUSE, createHostHandler(socket, SOCKET_EVENTS.TIMER_PAUSE, null,
        async (ctx: RoomContext) => {
            const result: PauseResult | null = await timerService.pauseTimer(ctx.roomCode);

            // Bug #18 fix: Throw error instead of emitting error event
            // This ensures ACK response is consistent with the error state
            if (!result) {
                throw new GameStateError(ERROR_CODES.SERVER_ERROR, 'No active timer to pause');
            }

            io.to(`room:${ctx.roomCode}`).emit(SOCKET_EVENTS.TIMER_PAUSED, {
                roomCode: ctx.roomCode,
                remainingSeconds: result.remainingSeconds,
                pausedAt: Date.now()
            });
            logger.info(`Timer paused in room ${ctx.roomCode} by host ${ctx.player.nickname}`);
        }
    ));

    /**
     * Resume a paused timer (host only)
     */
    socket.on(SOCKET_EVENTS.TIMER_RESUME, createHostHandler(socket, SOCKET_EVENTS.TIMER_RESUME, null,
        async (ctx: RoomContext) => {
            const { createTimerExpireCallback } = getSocketFunctions();
            const result: TimerInfo | null = await timerService.resumeTimer(ctx.roomCode, createTimerExpireCallback());

            // Bug #18 fix: Throw error instead of emitting error event
            // This ensures ACK response is consistent with the error state
            if (!result) {
                throw new GameStateError(ERROR_CODES.SERVER_ERROR, 'No paused timer to resume');
            }

            io.to(`room:${ctx.roomCode}`).emit(SOCKET_EVENTS.TIMER_RESUMED, {
                roomCode: ctx.roomCode,
                remainingSeconds: result.remainingSeconds,
                endTime: result.endTime
            });
            logger.info(`Timer resumed in room ${ctx.roomCode} by host ${ctx.player.nickname}`);
        }
    ));

    /**
     * Add time to the current timer (host only)
     */
    socket.on(SOCKET_EVENTS.TIMER_ADD_TIME, createHostHandler(socket, SOCKET_EVENTS.TIMER_ADD_TIME, timerAddTimeSchema,
        async (ctx: RoomContext, validated: TimerAddTimeInput) => {
            const { createTimerExpireCallback } = getSocketFunctions();
            const result: TimerInfo | null = await timerService.addTime(ctx.roomCode, validated.seconds, createTimerExpireCallback());

            // Bug #18 fix: Throw error instead of emitting error event
            // This ensures ACK response is consistent with the error state
            if (!result) {
                throw new GameStateError(ERROR_CODES.SERVER_ERROR, 'No active timer to add time to');
            }

            io.to(`room:${ctx.roomCode}`).emit(SOCKET_EVENTS.TIMER_TIME_ADDED, {
                roomCode: ctx.roomCode,
                secondsAdded: validated.seconds,
                newEndTime: result.endTime,
                remainingSeconds: result.remainingSeconds
            });
            logger.info(`Added ${validated.seconds}s to timer in room ${ctx.roomCode} by host ${ctx.player.nickname}`);
        }
    ));

    /**
     * Stop the current timer (host only)
     */
    socket.on(SOCKET_EVENTS.TIMER_STOP, createHostHandler(socket, SOCKET_EVENTS.TIMER_STOP, null,
        async (ctx: RoomContext) => {
            await timerService.stopTimer(ctx.roomCode);

            io.to(`room:${ctx.roomCode}`).emit(SOCKET_EVENTS.TIMER_STOPPED, {
                roomCode: ctx.roomCode,
                stoppedAt: Date.now()
            });

            logger.info(`Timer stopped in room ${ctx.roomCode} by host ${ctx.player.nickname}`);
        }
    ));
}

module.exports = timerHandlers;
export default timerHandlers;
