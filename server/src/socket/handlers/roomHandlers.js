/**
 * Room Socket Event Handlers
 */

const roomService = require('../../services/roomService');
const gameService = require('../../services/gameService');
const playerService = require('../../services/playerService');
const eventLogService = require('../../services/eventLogService');
const { validateInput } = require('../../middleware/validation');
const { roomCreateSchema, roomJoinSchema, roomSettingsSchema } = require('../../validators/schemas');
const logger = require('../../utils/logger');
const { ERROR_CODES } = require('../../config/constants');
const { createRateLimitedHandler } = require('../rateLimitHandler');
const { RoomError } = require('../../errors/GameError');
const { withTimeout, TIMEOUTS } = require('../../utils/timeout');
const { getSocketFunctions } = require('../socketFunctionProvider');

/**
 * Helper: Send timer status to a socket
 * Extracted to reduce code duplication across join/resync/reconnect handlers
 */
async function sendTimerStatus(socket, roomCode, context) {
    try {
        const { getTimerStatus } = getSocketFunctions();
        const timerStatus = await getTimerStatus(roomCode);
        if (timerStatus && timerStatus.endTime) {
            socket.emit('timer:status', {
                roomCode,
                remainingSeconds: timerStatus.remainingSeconds,
                endTime: timerStatus.endTime,
                isPaused: timerStatus.isPaused || false
            });
        }
    } catch (timerError) {
        logger.warn(`Failed to send timer status on ${context}: ${timerError.message}`);
    }
}

/**
 * Helper: Send spymaster view if player is a spymaster with active game
 * Extracted to reduce code duplication across join/resync/reconnect handlers
 */
async function sendSpymasterViewIfNeeded(socket, player, game, roomCode) {
    if (player.role === 'spymaster' && game && !game.gameOver) {
        const fullGame = await gameService.getGame(roomCode);
        if (fullGame) {
            socket.emit('game:spymasterView', { types: fullGame.types });
        }
    }
}

module.exports = function roomHandlers(io, socket) {

    /**
     * Create a new room
     * Host provides a room ID which serves as both room name and access key
     */
    socket.on('room:create', createRateLimitedHandler(socket, 'room:create', async (data) => {
        let createdRoomCode = null;
        try {
            const validated = validateInput(roomCreateSchema, data);

            const { room, player } = await withTimeout(
                roomService.createRoom(validated.roomId, socket.sessionId, validated.settings),
                TIMEOUTS.SOCKET_HANDLER,
                'room:create'
            );

            // Track the room code in case we need to clean up on error
            createdRoomCode = room.code;

            // Join the socket to the room
            socket.join(`room:${room.code}`);
            socket.join(`player:${socket.sessionId}`);
            socket.roomCode = room.code;

            // Host starts as spectator, so add to spectators room for consistency with join behavior
            socket.join(`spectators:${room.code}`);

            // US-16.1: Get initial room stats
            const roomStats = await playerService.getRoomStats(room.code);

            socket.emit('room:created', { room, player, stats: roomStats });

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
            // ISSUE #2 FIX: Clean up socket room membership if we partially created
            if (createdRoomCode) {
                socket.leave(`room:${createdRoomCode}`);
                socket.leave(`spectators:${createdRoomCode}`);
                socket.leave(`player:${socket.sessionId}`);
                socket.roomCode = null;
            }

            logger.error('Error creating room:', error);
            socket.emit('room:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));

    /**
     * Join an existing room
     * Players join by entering the room ID provided by the host
     */
    socket.on('room:join', createRateLimitedHandler(socket, 'room:join', async (data) => {
        let joinedRoomCode = null;
        try {
            const validated = validateInput(roomJoinSchema, data);

            const { room, players, game, player } = await withTimeout(
                roomService.joinRoom(
                    validated.roomId,
                    socket.sessionId,
                    validated.nickname
                ),
                TIMEOUTS.JOIN_ROOM,
                'room:join'
            );

            // Track the room code in case we need to leave on error
            joinedRoomCode = room.code;

            // Join the socket to the room
            socket.join(`room:${room.code}`);
            socket.join(`player:${socket.sessionId}`);
            socket.roomCode = room.code;

            // Join spectators room if player is a spectator (no team or role='spectator')
            const isSpectator = player.role === 'spectator' || !player.team;
            if (isSpectator) {
                socket.join(`spectators:${room.code}`);
            }

            // ISSUE #17 FIX: Invalidate any existing reconnection token on successful join
            await playerService.invalidateReconnectionToken(socket.sessionId);

            // US-16.1: Get room stats including spectator count
            const roomStats = await playerService.getRoomStats(room.code);

            // Send room state to the joining player
            socket.emit('room:joined', { room, players, game, you: player, stats: roomStats });

            // ISSUE #49 FIX: If player is a spymaster and game is active, send spymaster view
            await sendSpymasterViewIfNeeded(socket, player, game, room.code);

            // ISSUE #50 FIX: Send timer status for full state recovery on reconnection
            await sendTimerStatus(socket, room.code, 'join');

            // Detect if this is a reconnection (player existed before with lastConnected timestamp)
            const isReconnect = !!player.lastConnected;

            // Notify others in the room with appropriate event type
            if (isReconnect) {
                // Use room:playerReconnected for consistency with token-based reconnection
                socket.to(`room:${room.code}`).emit('room:playerReconnected', {
                    sessionId: socket.sessionId,
                    nickname: player.nickname,
                    team: player.team
                });
            } else {
                socket.to(`room:${room.code}`).emit('room:playerJoined', { player });
            }

            // Log event for reconnection recovery
            await eventLogService.logEvent(
                room.code,
                eventLogService.EVENT_TYPES.PLAYER_JOINED,
                {
                    sessionId: socket.sessionId,
                    nickname: validated.nickname,
                    isReconnect
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
                throw RoomError.notFound('Not currently in a room');
            }

            // ISSUE #17 FIX: Invalidate reconnection token when explicitly leaving
            await playerService.invalidateReconnectionToken(socket.sessionId);

            const result = await roomService.leaveRoom(socket.roomCode, socket.sessionId);

            // Leave all socket rooms for this room
            socket.leave(`room:${socket.roomCode}`);
            socket.leave(`spectators:${socket.roomCode}`);

            // Notify others (result may be null if room was already deleted)
            io.to(`room:${socket.roomCode}`).emit('room:playerLeft', {
                sessionId: socket.sessionId,
                newHost: result?.newHostId || null
            });

            // Log event for room history
            await eventLogService.logEvent(
                socket.roomCode,
                eventLogService.EVENT_TYPES.PLAYER_LEFT,
                {
                    sessionId: socket.sessionId,
                    newHostId: result?.newHostId || null
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

            // Wrap all state fetching in a timeout to prevent hanging
            const statePromise = (async () => {
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

                return { room, player, players, game, gameState };
            })();

            const { room, player, players, game, gameState } = await withTimeout(
                statePromise,
                TIMEOUTS.RECONNECT,
                'room:resync'
            );

            // US-16.1: Get room stats including spectator count
            const roomStats = await playerService.getRoomStats(socket.roomCode);

            // Send full state
            socket.emit('room:resynced', {
                room,
                players,
                game: gameState,
                you: player,
                stats: roomStats
            });

            // If player is spymaster and game active, send spymaster view (non-critical, no timeout needed)
            await sendSpymasterViewIfNeeded(socket, player, game, socket.roomCode);

            // Send timer status (non-critical, has its own error handling)
            await sendTimerStatus(socket, socket.roomCode, 'resync');

            logger.info(`State resynced for player ${socket.sessionId} in room ${socket.roomCode}`);

        } catch (error) {
            const isTimeout = error.code === 'OPERATION_TIMEOUT';
            logger.error(`Error resyncing state${isTimeout ? ' (timeout)' : ''}:`, error);
            socket.emit('room:error', {
                code: isTimeout ? ERROR_CODES.SERVER_ERROR : (error.code || ERROR_CODES.SERVER_ERROR),
                message: isTimeout ? 'Server is busy, please try again' : error.message
            });
        }
    }));

    /**
     * ISSUE #17 FIX: Request a reconnection token for secure reconnection
     * Clients should call this before intentional disconnects or periodically
     * to have a token ready for reconnection
     */
    socket.on('room:getReconnectionToken', createRateLimitedHandler(socket, 'room:getReconnectionToken', async () => {
        try {
            if (!socket.roomCode) {
                throw RoomError.notFound(socket.roomCode);
            }

            // Check if there's an existing valid token
            let token = await playerService.getExistingReconnectionToken(socket.sessionId);

            // If no existing token, generate a new one
            if (!token) {
                token = await playerService.generateReconnectionToken(socket.sessionId);
            }

            if (!token) {
                throw { code: ERROR_CODES.SERVER_ERROR, message: 'Failed to generate reconnection token' };
            }

            socket.emit('room:reconnectionToken', {
                token,
                sessionId: socket.sessionId,
                roomCode: socket.roomCode
            });

            logger.debug(`Reconnection token sent to player ${socket.sessionId}`);

        } catch (error) {
            logger.error('Error generating reconnection token:', error);
            socket.emit('room:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));

    /**
     * ISSUE #17 FIX: Reconnect with a secure token
     * Allows clients to reconnect using a previously obtained token
     */
    socket.on('room:reconnect', createRateLimitedHandler(socket, 'room:reconnect', async (data) => {
        try {
            const { code, reconnectionToken } = data || {};

            if (!code || !reconnectionToken) {
                throw { code: ERROR_CODES.INVALID_INPUT, message: 'Room code and reconnection token required' };
            }

            // Wrap reconnection logic in timeout
            const reconnectPromise = (async () => {
                // Validate the reconnection token
                const validation = await playerService.validateReconnectionToken(reconnectionToken, socket.sessionId);

                if (!validation.valid) {
                    throw { code: ERROR_CODES.NOT_AUTHORIZED, message: `Invalid reconnection token: ${validation.reason}` };
                }

                // Token is valid - reconnect the player
                const { tokenData } = validation;

                // Verify room code matches
                if (tokenData.roomCode !== code) {
                    throw { code: ERROR_CODES.INVALID_INPUT, message: 'Token does not match room' };
                }

                // Get current room state
                const room = await roomService.getRoom(code);
                if (!room) {
                    throw RoomError.notFound(code);
                }

                // Restore player's connected status
                await playerService.updatePlayer(socket.sessionId, {
                    connected: true,
                    lastSeen: Date.now()
                });

                // Get full state for the reconnected player
                const player = await playerService.getPlayer(socket.sessionId);
                const players = await playerService.getPlayersInRoom(code);
                const game = await gameService.getGame(code);

                let gameState = null;
                if (game) {
                    gameState = gameService.getGameStateForPlayer(game, player);
                }

                return { room, player, players, game, gameState };
            })();

            const { room, player, players, game, gameState } = await withTimeout(
                reconnectPromise,
                TIMEOUTS.RECONNECT,
                'room:reconnect'
            );

            // Join the socket to the room (after timeout check passes)
            socket.join(`room:${code}`);
            socket.join(`player:${socket.sessionId}`);
            socket.roomCode = code;

            // Join spectators room if player is a spectator (no team or role='spectator')
            const isSpectator = player.role === 'spectator' || !player.team;
            if (isSpectator) {
                socket.join(`spectators:${code}`);
            }

            // US-16.1: Get room stats including spectator count
            const roomStats = await playerService.getRoomStats(code);

            // Sprint 19: Session rotation - generate new reconnection token after successful reconnect
            let newReconnectionToken = null;
            const { SESSION_SECURITY } = require('../../config/constants');
            if (SESSION_SECURITY.ROTATE_SESSION_ON_RECONNECT) {
                try {
                    newReconnectionToken = await playerService.generateReconnectionToken(socket.sessionId);
                    logger.debug(`Session rotated for player ${player.nickname} in room ${code}`);
                } catch (tokenError) {
                    logger.warn(`Failed to rotate session token: ${tokenError.message}`);
                    // Non-critical - continue without new token
                }
            }

            // Send reconnection success with full state
            socket.emit('room:reconnected', {
                room,
                players,
                game: gameState,
                you: player,
                stats: roomStats,
                // Sprint 19: Include new token for future reconnections
                reconnectionToken: newReconnectionToken
            });

            // If player is spymaster and game active, send spymaster view (non-critical)
            await sendSpymasterViewIfNeeded(socket, player, game, code);

            // Send timer status (non-critical, has its own error handling)
            await sendTimerStatus(socket, code, 'reconnect');

            // Notify others in the room
            socket.to(`room:${code}`).emit('room:playerReconnected', {
                sessionId: socket.sessionId,
                nickname: player.nickname,
                team: player.team
            });

            // Log event (non-critical)
            await eventLogService.logEvent(
                code,
                eventLogService.EVENT_TYPES.PLAYER_JOINED,
                {
                    sessionId: socket.sessionId,
                    nickname: player.nickname,
                    isReconnect: true,
                    usedToken: true
                }
            );

            logger.info(`Player ${player.nickname} securely reconnected to room ${code}`);

        } catch (error) {
            const isTimeout = error.code === 'OPERATION_TIMEOUT';
            logger.error(`Error during secure reconnection${isTimeout ? ' (timeout)' : ''}:`, error);
            socket.emit('room:error', {
                code: isTimeout ? ERROR_CODES.SERVER_ERROR : (error.code || ERROR_CODES.SERVER_ERROR),
                message: isTimeout ? 'Server is busy, please try again' : error.message
            });
        }
    }));
};
