/**
 * Timer Socket Event Handlers
 * Host-only operations for manual timer control in multiplayer games.
 *
 * Migrated to use context handler architecture for consistent
 * validation, error handling, and socket room management.
 */

const timerService = require('../../services/timerService');
const logger = require('../../utils/logger');
const { ERROR_CODES, SOCKET_EVENTS } = require('../../config/constants');
const { createHostHandler } = require('../contextHandler');
const { getSocketFunctions } = require('../socketFunctionProvider');
const { z } = require('zod');

// Define schema inline to avoid circular import issues with validators/schemas.js
const timerAddTimeSchema = z.object({
    seconds: z.number()
        .int()
        .min(10, 'Must add at least 10 seconds')
        .max(300, 'Cannot add more than 5 minutes')
});

module.exports = function timerHandlers(io, socket) {

    /**
     * Pause the current turn timer (host only)
     */
    socket.on(SOCKET_EVENTS.TIMER_PAUSE, createHostHandler(socket, SOCKET_EVENTS.TIMER_PAUSE, null,
        async (ctx) => {
            const result = await timerService.pauseTimer(ctx.roomCode);

            if (result) {
                io.to(`room:${ctx.roomCode}`).emit(SOCKET_EVENTS.TIMER_PAUSED, {
                    roomCode: ctx.roomCode,
                    remainingSeconds: result.remainingSeconds,
                    pausedAt: Date.now()
                });
                logger.info(`Timer paused in room ${ctx.roomCode} by host ${ctx.player.nickname}`);
            } else {
                socket.emit(SOCKET_EVENTS.TIMER_ERROR, {
                    code: ERROR_CODES.SERVER_ERROR,
                    message: 'No active timer to pause'
                });
            }
        }
    ));

    /**
     * Resume a paused timer (host only)
     */
    socket.on(SOCKET_EVENTS.TIMER_RESUME, createHostHandler(socket, SOCKET_EVENTS.TIMER_RESUME, null,
        async (ctx) => {
            const { createTimerExpireCallback } = getSocketFunctions();
            const result = await timerService.resumeTimer(ctx.roomCode, createTimerExpireCallback());

            if (result) {
                io.to(`room:${ctx.roomCode}`).emit(SOCKET_EVENTS.TIMER_RESUMED, {
                    roomCode: ctx.roomCode,
                    remainingSeconds: result.remainingSeconds,
                    endTime: result.endTime
                });
                logger.info(`Timer resumed in room ${ctx.roomCode} by host ${ctx.player.nickname}`);
            } else {
                socket.emit(SOCKET_EVENTS.TIMER_ERROR, {
                    code: ERROR_CODES.SERVER_ERROR,
                    message: 'No paused timer to resume'
                });
            }
        }
    ));

    /**
     * Add time to the current timer (host only)
     */
    socket.on(SOCKET_EVENTS.TIMER_ADD_TIME, createHostHandler(socket, SOCKET_EVENTS.TIMER_ADD_TIME, timerAddTimeSchema,
        async (ctx, validated) => {
            const { createTimerExpireCallback } = getSocketFunctions();
            const result = await timerService.addTime(ctx.roomCode, validated.seconds, createTimerExpireCallback());

            if (result) {
                io.to(`room:${ctx.roomCode}`).emit(SOCKET_EVENTS.TIMER_TIME_ADDED, {
                    roomCode: ctx.roomCode,
                    secondsAdded: validated.seconds,
                    newEndTime: result.endTime,
                    remainingSeconds: result.remainingSeconds
                });
                logger.info(`Added ${validated.seconds}s to timer in room ${ctx.roomCode} by host ${ctx.player.nickname}`);
            } else {
                socket.emit(SOCKET_EVENTS.TIMER_ERROR, {
                    code: ERROR_CODES.SERVER_ERROR,
                    message: 'No active timer to add time to'
                });
            }
        }
    ));

    /**
     * Stop the current timer (host only)
     */
    socket.on(SOCKET_EVENTS.TIMER_STOP, createHostHandler(socket, SOCKET_EVENTS.TIMER_STOP, null,
        async (ctx) => {
            await timerService.stopTimer(ctx.roomCode);

            io.to(`room:${ctx.roomCode}`).emit(SOCKET_EVENTS.TIMER_STOPPED, {
                roomCode: ctx.roomCode,
                stoppedAt: Date.now()
            });

            logger.info(`Timer stopped in room ${ctx.roomCode} by host ${ctx.player.nickname}`);
        }
    ));
};
