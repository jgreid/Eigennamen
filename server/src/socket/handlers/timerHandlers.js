/**
 * Timer Socket Event Handlers
 * Host-only operations for manual timer control in multiplayer games.
 *
 * Migrated to use context handler architecture for consistent
 * validation, error handling, and socket room management.
 */

const roomService = require('../../services/roomService');
const timerService = require('../../services/timerService');
const logger = require('../../utils/logger');
const { ERROR_CODES } = require('../../config/constants');
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
    socket.on('timer:pause', createHostHandler(socket, 'timer:pause', null,
        async (ctx) => {
            const result = await timerService.pauseTimer(ctx.roomCode);

            if (result) {
                io.to(`room:${ctx.roomCode}`).emit('timer:paused', {
                    roomCode: ctx.roomCode,
                    remainingSeconds: result.remainingSeconds,
                    pausedAt: Date.now()
                });
                logger.info(`Timer paused in room ${ctx.roomCode} by host ${ctx.player.nickname}`);
            } else {
                socket.emit('timer:error', {
                    code: ERROR_CODES.SERVER_ERROR,
                    message: 'No active timer to pause'
                });
            }
        }
    ));

    /**
     * Resume a paused timer (host only)
     */
    socket.on('timer:resume', createHostHandler(socket, 'timer:resume', null,
        async (ctx) => {
            const result = await timerService.resumeTimer(ctx.roomCode, async (roomCode) => {
                const room = await roomService.getRoom(roomCode);
                if (!room) {
                    logger.warn(`Timer expired but room ${roomCode} no longer exists`);
                    return;
                }

                const gameService = require('../../services/gameService');
                const game = await gameService.getGame(roomCode);
                if (game && !game.gameOver) {
                    const endResult = await gameService.endTurn(roomCode, 'Timer');
                    io.to(`room:${roomCode}`).emit('game:turnEnded', {
                        currentTurn: endResult.currentTurn,
                        previousTurn: endResult.previousTurn,
                        reason: 'timerExpired'
                    });
                    io.to(`room:${roomCode}`).emit('timer:expired', { roomCode });
                }
            });

            if (result) {
                io.to(`room:${ctx.roomCode}`).emit('timer:resumed', {
                    roomCode: ctx.roomCode,
                    remainingSeconds: result.remainingSeconds,
                    endTime: result.endTime
                });
                logger.info(`Timer resumed in room ${ctx.roomCode} by host ${ctx.player.nickname}`);
            } else {
                socket.emit('timer:error', {
                    code: ERROR_CODES.SERVER_ERROR,
                    message: 'No paused timer to resume'
                });
            }
        }
    ));

    /**
     * Add time to the current timer (host only)
     */
    socket.on('timer:addTime', createHostHandler(socket, 'timer:addTime', timerAddTimeSchema,
        async (ctx, validated) => {
            const result = await timerService.addTime(ctx.roomCode, validated.seconds, async (roomCode) => {
                const room = await roomService.getRoom(roomCode);
                if (!room) {
                    logger.warn(`Timer expired but room ${roomCode} no longer exists`);
                    return;
                }

                const gameService = require('../../services/gameService');
                const game = await gameService.getGame(roomCode);
                if (game && !game.gameOver) {
                    const endResult = await gameService.endTurn(roomCode, 'Timer');
                    io.to(`room:${roomCode}`).emit('game:turnEnded', {
                        currentTurn: endResult.currentTurn,
                        previousTurn: endResult.previousTurn,
                        reason: 'timerExpired'
                    });
                    io.to(`room:${roomCode}`).emit('timer:expired', { roomCode });
                }
            });

            if (result) {
                io.to(`room:${ctx.roomCode}`).emit('timer:timeAdded', {
                    roomCode: ctx.roomCode,
                    secondsAdded: validated.seconds,
                    newEndTime: result.endTime,
                    remainingSeconds: result.remainingSeconds
                });
                logger.info(`Added ${validated.seconds}s to timer in room ${ctx.roomCode} by host ${ctx.player.nickname}`);
            } else {
                socket.emit('timer:error', {
                    code: ERROR_CODES.SERVER_ERROR,
                    message: 'No active timer to add time to'
                });
            }
        }
    ));

    /**
     * Stop the current timer (host only)
     */
    socket.on('timer:stop', createHostHandler(socket, 'timer:stop', null,
        async (ctx) => {
            await timerService.stopTimer(ctx.roomCode);

            io.to(`room:${ctx.roomCode}`).emit('timer:stopped', {
                roomCode: ctx.roomCode,
                stoppedAt: Date.now()
            });

            logger.info(`Timer stopped in room ${ctx.roomCode} by host ${ctx.player.nickname}`);
        }
    ));
};
