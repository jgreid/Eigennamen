/**
 * Timer Socket Event Handlers
 * Host-only operations for manual timer control in multiplayer games
 */

const playerService = require('../../services/playerService');
const timerService = require('../../services/timerService');
const { validateInput } = require('../../middleware/validation');
const logger = require('../../utils/logger');
const { ERROR_CODES } = require('../../config/constants');
const { createRateLimitedHandler } = require('../rateLimitHandler');
const { RoomError, PlayerError } = require('../../errors/GameError');
const { getSocketFunctions } = require('../socketFunctionProvider');
const { z } = require('zod');

// Define schema inline to avoid circular import issues with validators/schemas.js
// Max 300 seconds (5 minutes) matches TIMER.MAX_TURN_SECONDS
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
    socket.on('timer:pause', createRateLimitedHandler(socket, 'timer:status', async () => {
        try {
            if (!socket.roomCode) {
                throw new RoomError(ERROR_CODES.ROOM_NOT_FOUND, 'Not in a room', { roomCode: 'none' });
            }

            // Verify requester is the host
            const player = await playerService.getPlayer(socket.sessionId);
            if (!player || !player.isHost) {
                throw PlayerError.notHost();
            }

            const result = await timerService.pauseTimer(socket.roomCode);

            if (result) {
                io.to(`room:${socket.roomCode}`).emit('timer:paused', {
                    roomCode: socket.roomCode,
                    remainingSeconds: result.remainingSeconds,
                    pausedAt: Date.now()
                });
                logger.info(`Timer paused in room ${socket.roomCode} by host ${player.nickname}`);
            } else {
                socket.emit('timer:error', {
                    code: ERROR_CODES.SERVER_ERROR,
                    message: 'No active timer to pause'
                });
            }

        } catch (error) {
            logger.error('Error pausing timer:', error);
            socket.emit('timer:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));

    /**
     * Resume a paused timer (host only)
     */
    socket.on('timer:resume', createRateLimitedHandler(socket, 'timer:status', async () => {
        try {
            if (!socket.roomCode) {
                throw new RoomError(ERROR_CODES.ROOM_NOT_FOUND, 'Not in a room', { roomCode: 'none' });
            }

            // Verify requester is the host
            const player = await playerService.getPlayer(socket.sessionId);
            if (!player || !player.isHost) {
                throw PlayerError.notHost();
            }

            // Get the timer expire callback from socket functions
            const { startTurnTimer } = getSocketFunctions();

            // resumeTimer needs an onExpire callback - use the standard one
            const result = await timerService.resumeTimer(socket.roomCode, async (roomCode) => {
                // This callback is invoked when the timer expires
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
                io.to(`room:${socket.roomCode}`).emit('timer:resumed', {
                    roomCode: socket.roomCode,
                    remainingSeconds: result.remainingSeconds,
                    endTime: result.endTime
                });
                logger.info(`Timer resumed in room ${socket.roomCode} by host ${player.nickname}`);
            } else {
                socket.emit('timer:error', {
                    code: ERROR_CODES.SERVER_ERROR,
                    message: 'No paused timer to resume'
                });
            }

        } catch (error) {
            logger.error('Error resuming timer:', error);
            socket.emit('timer:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));

    /**
     * Add time to the current timer (host only)
     */
    socket.on('timer:addTime', createRateLimitedHandler(socket, 'timer:status', async (data) => {
        try {
            if (!socket.roomCode) {
                throw new RoomError(ERROR_CODES.ROOM_NOT_FOUND, 'Not in a room', { roomCode: 'none' });
            }

            // Verify requester is the host
            const player = await playerService.getPlayer(socket.sessionId);
            if (!player || !player.isHost) {
                throw PlayerError.notHost();
            }

            const validated = validateInput(timerAddTimeSchema, data);

            const result = await timerService.addTime(socket.roomCode, validated.seconds, async (roomCode) => {
                // Timer expire callback
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
                io.to(`room:${socket.roomCode}`).emit('timer:timeAdded', {
                    roomCode: socket.roomCode,
                    secondsAdded: validated.seconds,
                    newEndTime: result.endTime,
                    remainingSeconds: result.remainingSeconds
                });
                logger.info(`Added ${validated.seconds}s to timer in room ${socket.roomCode} by host ${player.nickname}`);
            } else {
                socket.emit('timer:error', {
                    code: ERROR_CODES.SERVER_ERROR,
                    message: 'No active timer to add time to'
                });
            }

        } catch (error) {
            logger.error('Error adding time to timer:', error);
            socket.emit('timer:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));

    /**
     * Stop the current timer (host only)
     */
    socket.on('timer:stop', createRateLimitedHandler(socket, 'timer:status', async () => {
        try {
            if (!socket.roomCode) {
                throw new RoomError(ERROR_CODES.ROOM_NOT_FOUND, 'Not in a room', { roomCode: 'none' });
            }

            // Verify requester is the host
            const player = await playerService.getPlayer(socket.sessionId);
            if (!player || !player.isHost) {
                throw PlayerError.notHost();
            }

            await timerService.stopTimer(socket.roomCode);

            io.to(`room:${socket.roomCode}`).emit('timer:stopped', {
                roomCode: socket.roomCode,
                stoppedAt: Date.now()
            });

            logger.info(`Timer stopped in room ${socket.roomCode} by host ${player.nickname}`);

        } catch (error) {
            logger.error('Error stopping timer:', error);
            socket.emit('timer:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));
};
