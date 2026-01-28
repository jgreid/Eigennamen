/**
 * Player Context - Unified session state management
 *
 * ARCHITECTURAL FIX: Instead of each handler independently validating
 * socket.roomCode and fetching player data from Redis, this module provides
 * a single source of truth that handlers can rely on.
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
 * Player context object - immutable snapshot of player's current state
 * @typedef {Object} PlayerContext
 * @property {string} sessionId - Player's session ID
 * @property {string|null} roomCode - Current room (null if not in room)
 * @property {Object|null} player - Full player data from Redis
 * @property {Object|null} game - Current game state (if any)
 * @property {boolean} isInRoom - Whether player is actively in a room
 * @property {boolean} isHost - Whether player is the host
 * @property {string|null} team - Player's team
 * @property {string|null} role - Player's role
 */

/**
 * Build a validated player context from socket state
 * This is the ONLY place where socket.roomCode and Redis state are reconciled
 *
 * @param {Object} socket - Socket.io socket instance
 * @param {Object} options - Options for context building
 * @param {boolean} options.requireRoom - Throw if not in a room (default: true)
 * @param {boolean} options.requireGame - Throw if no active game (default: false)
 * @param {boolean} options.requireHost - Throw if not the host (default: false)
 * @param {boolean} options.requireTeam - Throw if not on a team (default: false)
 * @param {string} options.requireRole - Throw if not this role (default: null)
 * @returns {Promise<PlayerContext>}
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

    // Step 1: Get player data from Redis (single source of truth for player state)
    const player = await playerService.getPlayer(sessionId);

    // Step 2: Determine the authoritative roomCode
    // Redis player data is authoritative; socket.roomCode is a cache
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

        // Correct the socket state to match Redis (Redis is authoritative)
        if (redisRoomCode) {
            // Player is in a room according to Redis, but socket doesn't know
            socket.roomCode = redisRoomCode;
            socket.join(`room:${redisRoomCode}`);
            socket.join(`player:${sessionId}`);
            logger.info('Corrected socket room membership to match Redis', {
                sessionId,
                roomCode: redisRoomCode
            });
        } else {
            // Player is not in a room according to Redis, but socket thinks it is
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

    const roomCode = redisRoomCode; // Use the corrected/validated roomCode

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

    // Step 5: Apply requirements and fetch additional data as needed

    if (requireRoom && !context.isInRoom) {
        throw new RoomError(
            ERROR_CODES.ROOM_NOT_FOUND,
            'You must be in a room to perform this action',
            { roomCode: 'none' }
        );
    }

    if (roomCode) {
        // Fetch game state if in a room (many operations need it)
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
            ERROR_CODES.NOT_ON_TEAM,
            'You must join a team first',
            { sessionId }
        );
    }

    if (requireRole && context.role !== requireRole) {
        throw new PlayerError(
            ERROR_CODES.WRONG_ROLE,
            `This action requires the ${requireRole} role`,
            { sessionId, currentRole: context.role, requiredRole: requireRole }
        );
    }

    return context;
}

/**
 * Check if a player can change their team/role during an active game
 * Encapsulates the game-state permission logic that was scattered across handlers
 *
 * @param {PlayerContext} ctx - The player context
 * @returns {{allowed: boolean, reason?: string}}
 */
function canChangeTeamOrRole(ctx) {
    const { player, game } = ctx;

    // No game = always allowed
    if (!game || game.gameOver) {
        return { allowed: true };
    }

    // If player has an active role (spymaster/clicker) during their team's turn
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
 * Invalidate a player's context (force refetch on next operation)
 * Used when we know the state has changed and cached values are stale
 *
 * @param {Object} socket - Socket.io socket instance
 */
function invalidateContext(socket) {
    // Currently a no-op since we don't cache the context
    // But this provides a hook for future optimization where we might cache
    // the PlayerContext on the socket for the duration of a request
    socket._contextInvalidated = true;
}

/**
 * Sync socket room membership to match player state
 * Call after any operation that might change player's room/team/role
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

    // Manage spectator room membership
    if (wasSpectator && !isNowSpectator) {
        socket.leave(`spectators:${roomCode}`);
    } else if (!wasSpectator && isNowSpectator) {
        socket.join(`spectators:${roomCode}`);
    }
}

module.exports = {
    getPlayerContext,
    canChangeTeamOrRole,
    invalidateContext,
    syncSocketRooms
};
