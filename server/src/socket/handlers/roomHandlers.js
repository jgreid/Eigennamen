/**
 * Room Socket Event Handlers
 */

const roomService = require('../../services/roomService');
const gameService = require('../../services/gameService');
const eventLogService = require('../../services/eventLogService');
const { validateInput } = require('../../middleware/validation');
const { roomCreateSchema, roomJoinSchema, roomSettingsSchema } = require('../../validators/schemas');
const logger = require('../../utils/logger');
const { ERROR_CODES } = require('../../config/constants');
const { createRateLimitedHandler } = require('../rateLimitHandler');
const { RoomError } = require('../../errors/GameError');

module.exports = function roomHandlers(io, socket) {

    /**
     * Create a new room
     */
    socket.on('room:create', createRateLimitedHandler(socket, 'room:create', async (data) => {
        try {
            const validated = validateInput(roomCreateSchema, data);

            const { room, player } = await roomService.createRoom(
                socket.sessionId,
                validated.settings
            );

            // Join the socket to the room
            socket.join(`room:${room.code}`);
            socket.join(`player:${socket.sessionId}`);
            socket.roomCode = room.code;

            socket.emit('room:created', { room, player });

            // Log event for room history
            await eventLogService.logEvent(
                room.code,
                eventLogService.EVENT_TYPES.ROOM_CREATED,
                {
                    hostSessionId: socket.sessionId,
                    hostNickname: player.nickname,
                    settings: room.settings
                }
            );

            logger.info(`Room created: ${room.code} by ${socket.sessionId}`);

        } catch (error) {
            logger.error('Error creating room:', error);
            socket.emit('room:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));

    /**
     * Join an existing room
     */
    socket.on('room:join', createRateLimitedHandler(socket, 'room:join', async (data) => {
        let joinedRoomCode = null;
        try {
            const validated = validateInput(roomJoinSchema, data);

            const { room, players, game, player } = await roomService.joinRoom(
                validated.code,
                socket.sessionId,
                validated.nickname,
                validated.password // Pass password if provided
            );

            // Track the room code in case we need to leave on error
            joinedRoomCode = room.code;

            // Join the socket to the room
            socket.join(`room:${room.code}`);
            socket.join(`player:${socket.sessionId}`);
            socket.roomCode = room.code;

            // Send room state to the joining player
            socket.emit('room:joined', { room, players, game, you: player });

            // ISSUE #49 FIX: If player is a spymaster and game is active, send spymaster view
            if (player.role === 'spymaster' && game && !game.gameOver) {
                const fullGame = await gameService.getGame(room.code);
                if (fullGame) {
                    socket.emit('game:spymasterView', { types: fullGame.types });
                }
            }

            // ISSUE #50 FIX: Send timer status for full state recovery on reconnection
            try {
                const { getTimerStatus } = require('../index');
                const timerStatus = await getTimerStatus(room.code);
                if (timerStatus && timerStatus.endTime) {
                    socket.emit('timer:status', {
                        roomCode: room.code,
                        remainingSeconds: timerStatus.remainingSeconds,
                        endTime: timerStatus.endTime,
                        isPaused: timerStatus.isPaused || false
                    });
                }
            } catch (timerError) {
                logger.warn(`Failed to send timer status on join: ${timerError.message}`);
            }

            // Notify others in the room
            socket.to(`room:${room.code}`).emit('room:playerJoined', { player });

            // Log event for reconnection recovery
            await eventLogService.logEvent(
                room.code,
                eventLogService.EVENT_TYPES.PLAYER_JOINED,
                {
                    sessionId: socket.sessionId,
                    nickname: validated.nickname,
                    isReconnect: !!player.lastConnected
                }
            );

            logger.info(`Player ${validated.nickname} joined room ${room.code}`);

        } catch (error) {
            // Clean up socket room membership if we partially joined
            if (joinedRoomCode) {
                socket.leave(`room:${joinedRoomCode}`);
                socket.leave(`player:${socket.sessionId}`);
                socket.roomCode = null;
            }

            logger.error('Error joining room:', error);
            socket.emit('room:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));

    /**
     * Leave the current room
     */
    socket.on('room:leave', createRateLimitedHandler(socket, 'room:leave', async () => {
        try {
            if (!socket.roomCode) {
                return;
            }

            const result = await roomService.leaveRoom(socket.roomCode, socket.sessionId);

            // Leave the socket room
            socket.leave(`room:${socket.roomCode}`);

            // Notify others
            io.to(`room:${socket.roomCode}`).emit('room:playerLeft', {
                sessionId: socket.sessionId,
                newHost: result.newHostId
            });

            // Log event for room history
            await eventLogService.logEvent(
                socket.roomCode,
                eventLogService.EVENT_TYPES.PLAYER_LEFT,
                {
                    sessionId: socket.sessionId,
                    newHostId: result.newHostId
                }
            );

            logger.info(`Player ${socket.sessionId} left room ${socket.roomCode}`);
            socket.roomCode = null;

        } catch (error) {
            logger.error('Error leaving room:', error);
            socket.emit('room:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));

    /**
     * Update room settings (host only)
     */
    socket.on('room:settings', createRateLimitedHandler(socket, 'room:settings', async (data) => {
        try {
            if (!socket.roomCode) {
                throw RoomError.notFound(socket.roomCode);
            }

            const validated = validateInput(roomSettingsSchema, data);

            const settings = await roomService.updateSettings(
                socket.roomCode,
                socket.sessionId,
                validated
            );

            // Broadcast to all in room
            io.to(`room:${socket.roomCode}`).emit('room:settingsUpdated', { settings });

            // Log event for room history
            await eventLogService.logEvent(
                socket.roomCode,
                eventLogService.EVENT_TYPES.SETTINGS_UPDATED,
                {
                    sessionId: socket.sessionId,
                    settings
                }
            );

            logger.info(`Room ${socket.roomCode} settings updated`);

        } catch (error) {
            logger.error('Error updating settings:', error);
            socket.emit('room:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));

    /**
     * ISSUE #50 FIX: Request full state resync (for recovery after disconnect/reconnect)
     * Clients can call this if they detect they're out of sync
     */
    socket.on('room:resync', createRateLimitedHandler(socket, 'room:resync', async () => {
        try {
            if (!socket.roomCode) {
                throw RoomError.notFound(socket.roomCode);
            }

            const playerService = require('../../services/playerService');

            // Get full room state
            const room = await roomService.getRoom(socket.roomCode);
            if (!room) {
                throw RoomError.notFound(socket.roomCode);
            }

            // Get player data
            const player = await playerService.getPlayer(socket.sessionId);
            if (!player) {
                throw RoomError.notFound(socket.roomCode);
            }

            // Get all players in room
            const players = await playerService.getPlayersInRoom(socket.roomCode);

            // Get game state if exists
            const game = await gameService.getGame(socket.roomCode);
            let gameState = null;
            if (game) {
                gameState = gameService.getGameStateForPlayer(game, player);
            }

            // Send full state
            socket.emit('room:resynced', {
                room,
                players,
                game: gameState,
                you: player
            });

            // If player is spymaster and game active, send spymaster view
            if (player.role === 'spymaster' && game && !game.gameOver) {
                socket.emit('game:spymasterView', { types: game.types });
            }

            // Send timer status
            try {
                const { getTimerStatus } = require('../index');
                const timerStatus = await getTimerStatus(socket.roomCode);
                if (timerStatus && timerStatus.endTime) {
                    socket.emit('timer:status', {
                        roomCode: socket.roomCode,
                        remainingSeconds: timerStatus.remainingSeconds,
                        endTime: timerStatus.endTime,
                        isPaused: timerStatus.isPaused || false
                    });
                }
            } catch (timerError) {
                logger.warn(`Failed to send timer status on resync: ${timerError.message}`);
            }

            logger.info(`State resynced for player ${socket.sessionId} in room ${socket.roomCode}`);

        } catch (error) {
            logger.error('Error resyncing state:', error);
            socket.emit('room:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));
};
