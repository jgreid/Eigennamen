/**
 * Room Socket Event Handlers
 *
 * All handlers use the context handler architecture:
 * - room:create and room:join use createPreRoomHandler (no room context needed)
 * - room:reconnect uses createPreRoomHandler (token-based auth flow)
 * - room:leave, room:settings, room:resync, room:getReconnectionToken use
 *   createRoomHandler/createHostHandler (require room context)
 */

const roomService = require('../../services/roomService');
const gameService = require('../../services/gameService');
const playerService = require('../../services/playerService');
const { roomCreateSchema, roomJoinSchema, roomSettingsSchema, roomReconnectSchema } = require('../../validators/schemas');
const logger = require('../../utils/logger');
const { ERROR_CODES, SOCKET_EVENTS, SESSION_SECURITY } = require('../../config/constants');
const { createRoomHandler, createHostHandler, createPreRoomHandler } = require('../contextHandler');
const { RoomError, PlayerError, ServerError } = require('../../errors/GameError');
const { withTimeout, TIMEOUTS } = require('../../utils/timeout');
const { getSocketFunctions } = require('../socketFunctionProvider');

/**
 * Helper: Send timer status to a socket
 */
async function sendTimerStatus(socket, roomCode, context) {
    try {
        const { getTimerStatus } = getSocketFunctions();
        const timerStatus = await getTimerStatus(roomCode);
        if (timerStatus && timerStatus.endTime) {
            socket.emit(SOCKET_EVENTS.TIMER_STATUS, {
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
 */
async function sendSpymasterViewIfNeeded(socket, player, game, roomCode) {
    if (player.role === 'spymaster' && game && !game.gameOver) {
        const fullGame = await gameService.getGame(roomCode);
        if (fullGame) {
            socket.emit(SOCKET_EVENTS.GAME_SPYMASTER_VIEW, { types: fullGame.types });
        }
    }
}

module.exports = function roomHandlers(io, socket) {

    /**
     * Create a new room
     */
    socket.on(SOCKET_EVENTS.ROOM_CREATE, createPreRoomHandler(socket, SOCKET_EVENTS.ROOM_CREATE, roomCreateSchema,
        async (validated) => {
            const { room, player } = await withTimeout(
                roomService.createRoom(validated.roomId, socket.sessionId, validated.settings),
                TIMEOUTS.SOCKET_HANDLER,
                'room:create'
            );

            socket.join(`room:${room.code}`);
            socket.join(`player:${socket.sessionId}`);
            socket.roomCode = room.code;

            // Host starts as spectator
            socket.join(`spectators:${room.code}`);

            const roomStats = await playerService.getRoomStats(room.code);

            socket.emit(SOCKET_EVENTS.ROOM_CREATED, { room, player, stats: roomStats });

            logger.info(`Room created: ${room.code} by ${socket.sessionId}`);
        }
    ));

    /**
     * Join an existing room
     */
    socket.on(SOCKET_EVENTS.ROOM_JOIN, createPreRoomHandler(socket, SOCKET_EVENTS.ROOM_JOIN, roomJoinSchema,
        async (validated) => {
            const { room, players, game, player } = await withTimeout(
                roomService.joinRoom(
                    validated.roomId,
                    socket.sessionId,
                    validated.nickname
                ),
                TIMEOUTS.JOIN_ROOM,
                'room:join'
            );

            socket.join(`room:${room.code}`);
            socket.join(`player:${socket.sessionId}`);
            socket.roomCode = room.code;

            const isSpectator = player.role === 'spectator' || !player.team;
            if (isSpectator) {
                socket.join(`spectators:${room.code}`);
            }

            const [, roomStats] = await Promise.all([
                playerService.invalidateReconnectionToken(socket.sessionId),
                playerService.getRoomStats(room.code)
            ]);

            socket.emit(SOCKET_EVENTS.ROOM_JOINED, { room, players, game, you: player, stats: roomStats });

            await Promise.all([
                sendSpymasterViewIfNeeded(socket, player, game, room.code),
                sendTimerStatus(socket, room.code, 'join')
            ]);

            const isReconnect = !!player.lastConnected;

            if (isReconnect) {
                socket.to(`room:${room.code}`).emit(SOCKET_EVENTS.ROOM_PLAYER_RECONNECTED, {
                    sessionId: socket.sessionId,
                    nickname: player.nickname,
                    team: player.team
                });
            } else {
                socket.to(`room:${room.code}`).emit(SOCKET_EVENTS.ROOM_PLAYER_JOINED, { player });
            }

            logger.info(`Player ${validated.nickname} joined room ${room.code}`);
        }
    ));

    /**
     * Leave the current room
     */
    socket.on(SOCKET_EVENTS.ROOM_LEAVE, createRoomHandler(socket, SOCKET_EVENTS.ROOM_LEAVE, null,
        async (ctx) => {
            // Invalidate reconnection token when explicitly leaving
            await playerService.invalidateReconnectionToken(ctx.sessionId);

            const result = await roomService.leaveRoom(ctx.roomCode, ctx.sessionId);

            // Leave all socket rooms for this room
            socket.leave(`room:${ctx.roomCode}`);
            socket.leave(`spectators:${ctx.roomCode}`);
            socket.leave(`player:${ctx.sessionId}`);

            const remainingPlayers = await playerService.getPlayersInRoom(ctx.roomCode);

            io.to(`room:${ctx.roomCode}`).emit(SOCKET_EVENTS.ROOM_PLAYER_LEFT, {
                sessionId: ctx.sessionId,
                newHost: result?.newHostId || null,
                players: remainingPlayers || []
            });

            // Broadcast updated stats so clients reflect the player departure
            const roomStats = await playerService.getRoomStats(ctx.roomCode, remainingPlayers);
            io.to(`room:${ctx.roomCode}`).emit(SOCKET_EVENTS.ROOM_STATS_UPDATED, { stats: roomStats });

            logger.info(`Player ${ctx.sessionId} left room ${ctx.roomCode}`);
            socket.roomCode = null;
        }
    ));

    /**
     * Update room settings (host only)
     */
    socket.on(SOCKET_EVENTS.ROOM_SETTINGS, createHostHandler(socket, SOCKET_EVENTS.ROOM_SETTINGS, roomSettingsSchema,
        async (ctx, validated) => {
            const settings = await roomService.updateSettings(
                ctx.roomCode,
                ctx.sessionId,
                validated
            );

            io.to(`room:${ctx.roomCode}`).emit(SOCKET_EVENTS.ROOM_SETTINGS_UPDATED, { settings });

            logger.info(`Room ${ctx.roomCode} settings updated`);
        }
    ));

    /**
     * Request full state resync
     */
    socket.on(SOCKET_EVENTS.ROOM_RESYNC, createRoomHandler(socket, SOCKET_EVENTS.ROOM_RESYNC, null,
        async (ctx) => {
            const statePromise = (async () => {
                const [room, players] = await Promise.all([
                    roomService.getRoom(ctx.roomCode),
                    playerService.getPlayersInRoom(ctx.roomCode)
                ]);

                if (!room) {
                    throw RoomError.notFound(ctx.roomCode);
                }
                if (!players || !Array.isArray(players)) {
                    throw RoomError.notFound(ctx.roomCode);
                }

                let gameState = null;
                if (ctx.game) {
                    gameState = gameService.getGameStateForPlayer(ctx.game, ctx.player);
                }

                return { room, players, gameState };
            })();

            const { room, players, gameState } = await withTimeout(
                statePromise,
                TIMEOUTS.RECONNECT,
                'room:resync'
            );

            const roomStats = await playerService.getRoomStats(ctx.roomCode);

            socket.emit(SOCKET_EVENTS.ROOM_RESYNCED, {
                room,
                players,
                game: gameState,
                you: ctx.player,
                stats: roomStats
            });

            await Promise.all([
                sendSpymasterViewIfNeeded(socket, ctx.player, ctx.game, ctx.roomCode),
                sendTimerStatus(socket, ctx.roomCode, 'resync')
            ]);

            logger.info(`State resynced for player ${ctx.sessionId} in room ${ctx.roomCode}`);
        }
    ));

    /**
     * Request a reconnection token
     */
    socket.on(SOCKET_EVENTS.ROOM_GET_RECONNECTION_TOKEN, createRoomHandler(socket, SOCKET_EVENTS.ROOM_GET_RECONNECTION_TOKEN, null,
        async (ctx) => {
            let token = await playerService.getExistingReconnectionToken(ctx.sessionId);

            if (!token) {
                token = await playerService.generateReconnectionToken(ctx.sessionId);
            }

            if (!token) {
                throw new ServerError('Failed to generate reconnection token');
            }

            socket.emit(SOCKET_EVENTS.ROOM_RECONNECTION_TOKEN, {
                token,
                sessionId: ctx.sessionId,
                roomCode: ctx.roomCode
            });

            logger.debug(`Reconnection token sent to player ${ctx.sessionId}`);
        }
    ));

    /**
     * Reconnect with a secure token
     */
    socket.on(SOCKET_EVENTS.ROOM_RECONNECT, createPreRoomHandler(socket, SOCKET_EVENTS.ROOM_RECONNECT, roomReconnectSchema,
        async (validated) => {
            const { code, reconnectionToken } = validated;

            const reconnectPromise = (async () => {
                const validation = await playerService.validateReconnectionToken(reconnectionToken, socket.sessionId);

                if (!validation.valid) {
                    throw new PlayerError(ERROR_CODES.NOT_AUTHORIZED, `Invalid reconnection token: ${validation.reason}`);
                }

                const { tokenData } = validation;

                if (tokenData.roomCode !== code) {
                    throw new PlayerError(ERROR_CODES.INVALID_INPUT, 'Token does not match room');
                }

                const room = await roomService.getRoom(code);
                if (!room) {
                    throw RoomError.notFound(code);
                }

                await playerService.updatePlayer(socket.sessionId, {
                    connected: true,
                    lastSeen: Date.now()
                });

                const [player, players, game] = await Promise.all([
                    playerService.getPlayer(socket.sessionId),
                    playerService.getPlayersInRoom(code),
                    gameService.getGame(code)
                ]);

                if (!player) {
                    throw PlayerError.notFound(socket.sessionId);
                }
                if (!players || !Array.isArray(players)) {
                    throw RoomError.notFound(code);
                }

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

            socket.join(`room:${code}`);
            socket.join(`player:${socket.sessionId}`);
            socket.roomCode = code;

            const isSpectator = player.role === 'spectator' || !player.team;
            if (isSpectator) {
                socket.join(`spectators:${code}`);
            } else {
                socket.leave(`spectators:${code}`);
            }

            const roomStats = await playerService.getRoomStats(code);

            let newReconnectionToken = null;
            if (SESSION_SECURITY.ROTATE_SESSION_ON_RECONNECT) {
                try {
                    newReconnectionToken = await playerService.generateReconnectionToken(socket.sessionId);
                    logger.debug(`Session rotated for player ${player.nickname} in room ${code}`);
                } catch (tokenError) {
                    logger.warn(`Failed to rotate session token: ${tokenError.message}`);
                }
            }

            socket.emit(SOCKET_EVENTS.ROOM_RECONNECTED, {
                room,
                players,
                game: gameState,
                you: player,
                stats: roomStats,
                reconnectionToken: newReconnectionToken
            });

            await Promise.all([
                sendSpymasterViewIfNeeded(socket, player, game, code),
                sendTimerStatus(socket, code, 'reconnect')
            ]);

            socket.to(`room:${code}`).emit(SOCKET_EVENTS.ROOM_PLAYER_RECONNECTED, {
                sessionId: socket.sessionId,
                nickname: player.nickname,
                team: player.team
            });

            logger.info(`Player ${player.nickname} securely reconnected to room ${code}`);
        }
    ));
};
