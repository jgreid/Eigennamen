/**
 * Player Context - Unified session state management
 *
 * Instead of each handler independently validating socket.roomCode and fetching
 * player data from Redis, this module provides a single source of truth that
 * handlers can rely on.
 *
 * Key benefits:
 * 1. Socket and Redis state are validated together at the start
 * 2. Handlers receive a guaranteed-valid context object
 * 3. State inconsistencies are detected and corrected early
 * 4. Reduces boilerplate in every handler
 */

const playerService = require('../services/playerService');
const gameService = require('../services/gameService');
const logger = require('../utils/logger');
const { RoomError, PlayerError } = require('../errors/GameError');
const { ERROR_CODES } = require('../config/constants');

/**
 * Build a validated player context from socket state.
 * This is the ONLY place where socket.roomCode and Redis state are reconciled.
 *
 * @param {Object} socket - Socket.io socket instance
 * @param {Object} options - Options for context building
 * @param {boolean} options.requireRoom - Throw if not in a room (default: true)
 * @param {boolean} options.requireGame - Throw if no active game (default: false)
 * @param {boolean} options.requireHost - Throw if not the host (default: false)
 * @param {boolean} options.requireTeam - Throw if not on a team (default: false)
 * @param {string} options.requireRole - Throw if not this role (default: null)
 * @returns {Promise<Object>} PlayerContext
 */
async function getPlayerContext(socket, options = {}) {
    const {
        requireRoom = true,
        requireGame = false,
        requireHost = false,
        requireTeam = false,
        requireRole = null
    } = options;

    const sessionId = socket.sessionId;

    // Step 1: Get player data from Redis (single source of truth)
    const player = await playerService.getPlayer(sessionId);

    // Step 2: Determine the authoritative roomCode
    const redisRoomCode = player?.roomCode || null;
    const socketRoomCode = socket.roomCode || null;

    // Step 3: Detect and handle state inconsistency
    if (redisRoomCode !== socketRoomCode) {
        logger.warn('Socket/Redis room state mismatch detected', {
            sessionId,
            socketRoomCode,
            redisRoomCode,
            playerExists: !!player
        });

        if (redisRoomCode) {
            // Leave old room if socket was in a different one
            if (socketRoomCode) {
                socket.leave(`room:${socketRoomCode}`);
                socket.leave(`spectators:${socketRoomCode}`);
            }
            socket.roomCode = redisRoomCode;
            socket.join(`room:${redisRoomCode}`);
            socket.join(`player:${sessionId}`);
            logger.info('Corrected socket room membership to match Redis', {
                sessionId,
                roomCode: redisRoomCode
            });
        } else {
            if (socketRoomCode) {
                socket.leave(`room:${socketRoomCode}`);
                socket.leave(`spectators:${socketRoomCode}`);
            }
            socket.roomCode = null;
            logger.info('Cleared stale socket room membership', {
                sessionId,
                staleRoomCode: socketRoomCode
            });
        }
    }

    const roomCode = redisRoomCode;

    // Step 4: Build the context object
    const context = {
        sessionId,
        roomCode,
        player,
        game: null,
        isInRoom: !!roomCode && !!player,
        isHost: player?.isHost || false,
        team: player?.team || null,
        role: player?.role || null
    };

    // Step 5: Apply requirements

    if (requireRoom && !context.isInRoom) {
        throw new RoomError(
            ERROR_CODES.ROOM_NOT_FOUND,
            'You must be in a room to perform this action',
            { roomCode: 'none' }
        );
    }

    if (roomCode) {
        context.game = await gameService.getGame(roomCode);
    }

    if (requireGame && !context.game) {
        throw new RoomError(
            ERROR_CODES.GAME_NOT_STARTED,
            'No active game in this room',
            { roomCode }
        );
    }

    if (requireHost && !context.isHost) {
        throw PlayerError.notHost();
    }

    if (requireTeam && !context.team) {
        throw new PlayerError(
            ERROR_CODES.NOT_AUTHORIZED,
            'You must join a team first',
            { sessionId }
        );
    }

    if (requireRole && context.role !== requireRole) {
        throw new PlayerError(
            ERROR_CODES.NOT_AUTHORIZED,
            `This action requires the ${requireRole} role`,
            { sessionId, currentRole: context.role, requiredRole: requireRole }
        );
    }

    return context;
}

/**
 * Check if a player can change their team/role during an active game.
 *
 * @param {Object} ctx - The player context
 * @returns {{allowed: boolean, reason?: string}}
 */
function canChangeTeamOrRole(ctx) {
    const { player, game } = ctx;

    if (!game || game.gameOver) {
        return { allowed: true };
    }

    if (player.role === 'spymaster' || player.role === 'clicker') {
        if (game.currentTurn === player.team) {
            return {
                allowed: false,
                reason: `Cannot change while you are the active ${player.role} during your team's turn`
            };
        }
    }

    return { allowed: true };
}

/**
 * Sync socket room membership to match player state.
 * Call after any operation that might change player's room/team/role.
 *
 * @param {Object} socket - Socket.io socket
 * @param {Object} player - Updated player object from Redis
 * @param {Object} previousPlayer - Player object before the change
 */
function syncSocketRooms(socket, player, previousPlayer = null) {
    if (!player || !player.roomCode) {
        return;
    }

    const roomCode = player.roomCode;
    const wasSpectator = previousPlayer
        ? (!previousPlayer.team || previousPlayer.role === 'spectator')
        : true;
    const isNowSpectator = !player.team || player.role === 'spectator';

    if (wasSpectator && !isNowSpectator) {
        socket.leave(`spectators:${roomCode}`);
    } else if (!wasSpectator && isNowSpectator) {
        socket.join(`spectators:${roomCode}`);
    }
}

module.exports = {
    getPlayerContext,
    canChangeTeamOrRole,
    syncSocketRooms
};
