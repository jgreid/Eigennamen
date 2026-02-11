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

import type { Player, GameState, Team, Role } from '../types';
import type { GameSocket } from './rateLimitHandler';

import * as playerService from '../services/playerService';
import * as gameService from '../services/gameService';
import logger from '../utils/logger';
import { RoomError, PlayerError } from '../errors/GameError';
import { ERROR_CODES } from '../config/constants';
/**
 * Options for building player context
 */
export interface PlayerContextOptions {
    /** Throw if not in a room (default: true) */
    requireRoom?: boolean;
    /** Throw if no active game (default: false) */
    requireGame?: boolean;
    /** Throw if not the host (default: false) */
    requireHost?: boolean;
    /** Throw if not on a team (default: false) */
    requireTeam?: boolean;
    /** Throw if not this role (default: null) */
    requireRole?: Role | null;
}

/**
 * Player context returned from getPlayerContext
 */
export interface PlayerContextResult {
    /** Session ID */
    sessionId: string;
    /** Room code (null if not in room) */
    roomCode: string | null | undefined;
    /** Player data from Redis */
    player: Player | null;
    /** Game state (null if no active game) */
    game: GameState | null;
    /** Whether player is in a room */
    isInRoom: boolean;
    /** Whether player is the host */
    isHost: boolean;
    /** Player's team (null if unassigned) */
    team: Team | null;
    /** Player's role (null if not set) */
    role: Role | null;
}

/**
 * Result of team/role change check
 */
export interface CanChangeResult {
    /** Whether the change is allowed */
    allowed: boolean;
    /** Reason if not allowed */
    reason?: string;
    /** Error code if not allowed */
    code?: string;
}

/**
 * Options for team/role change check
 */
export interface ChangeCheckOptions {
    /** Whether this is a team change (default: false) */
    isTeamChange?: boolean;
    /** The role being changed to (for role changes) */
    targetRole?: Role | null;
}

/**
 * Build a validated player context from socket state.
 * This is the ONLY place where socket.roomCode and Redis state are reconciled.
 *
 * @param socket - Socket.io socket instance
 * @param options - Options for context building
 * @returns PlayerContext
 */
async function getPlayerContext(
    socket: GameSocket,
    options: PlayerContextOptions = {}
): Promise<PlayerContextResult> {
    const {
        requireRoom = true,
        requireGame = false,
        requireHost = false,
        requireTeam = false,
        requireRole = null
    } = options;

    const sessionId = socket.sessionId;

    // Step 1: Get player data from Redis (single source of truth)
    const player: Player | null = await playerService.getPlayer(sessionId);

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
    const context: PlayerContextResult = {
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
            { roomCode: roomCode || undefined }
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
 * @param ctx - The player context
 * @param options - Options for the check
 * @returns Object with allowed status and reason if not allowed
 */
function canChangeTeamOrRole(
    ctx: PlayerContextResult,
    { isTeamChange = false, targetRole = null }: ChangeCheckOptions = {}
): CanChangeResult {
    const { player, game } = ctx;

    if (!game || game.gameOver) {
        return { allowed: true };
    }

    if (!player) {
        return { allowed: true };
    }

    // Spymasters have seen card types - block team changes entirely during active game
    if (isTeamChange && player.role === 'spymaster') {
        return {
            allowed: false,
            reason: 'Cannot change teams as spymaster during an active game (card information would leak)',
            code: 'SPYMASTER_CANNOT_CHANGE_TEAM'
        };
    }

    if (player.role === 'spymaster' || player.role === 'clicker') {
        if (game.currentTurn === player.team) {
            // Allow switching between active roles on the same team (clicker <-> spymaster)
            // Only block leaving to spectator or changing teams
            if (!isTeamChange && targetRole && targetRole !== 'spectator') {
                return { allowed: true };
            }
            return {
                allowed: false,
                reason: `Cannot change while you are the active ${player.role} during your team's turn`
            };
        }
    }

    return { allowed: true };
}

/**
 * Sync socket room memberships based on player state changes.
 * Manages spectator room membership when players transition between
 * team roles and spectator status.
 *
 * @param socket - Socket.io socket instance
 * @param currentPlayer - Current player state
 * @param previousPlayer - Previous player state (null on first call)
 */
function syncSocketRooms(
    socket: GameSocket,
    currentPlayer: Player | null,
    previousPlayer: Player | null
): void {
    if (!currentPlayer || !currentPlayer.roomCode) {
        return;
    }

    const roomCode = currentPlayer.roomCode;

    // A player is a spectator if they have no team OR their role is 'spectator'
    const isSpectator = !currentPlayer.team || currentPlayer.role === 'spectator';

    // Default previous state to spectator (first call)
    const wasSpectator = previousPlayer
        ? (!previousPlayer.team || previousPlayer.role === 'spectator')
        : true;

    if (wasSpectator && !isSpectator) {
        // Transitioning from spectator to team player
        socket.leave(`spectators:${roomCode}`);
    } else if (!wasSpectator && isSpectator) {
        // Transitioning from team player to spectator
        socket.join(`spectators:${roomCode}`);
    }
}
export {
    getPlayerContext,
    canChangeTeamOrRole,
    syncSocketRooms
};
