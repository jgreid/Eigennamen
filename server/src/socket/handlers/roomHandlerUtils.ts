import type { Player, GameState } from '../../types';
import type { GameSocket } from './types';
import type { RoomStats, TeamStats } from '../../services/playerService';
import type { TimerStatus } from '../../services/timerService';

import logger from '../../utils/logger';
import { SOCKET_EVENTS } from '../../config/constants';
import { getSocketFunctions } from '../socketFunctionProvider';
import { getSocketRateLimiter } from '../rateLimitHandler';
import { isPlayerSpectator } from '../playerContext';
import { RateLimitError } from '../../errors/GameError';

export async function sendTimerStatus(socket: GameSocket, roomCode: string, context: string): Promise<void> {
    try {
        const { getTimerStatus } = getSocketFunctions();
        const timerStatus: TimerStatus | null = await getTimerStatus(roomCode);
        if (timerStatus && timerStatus.endTime) {
            socket.emit(SOCKET_EVENTS.TIMER_STATUS, {
                roomCode,
                remainingSeconds: timerStatus.remainingSeconds,
                endTime: timerStatus.endTime,
                isPaused: timerStatus.isPaused || false,
            });
        }
    } catch (timerError) {
        logger.warn(
            `Failed to send timer status on ${context}: ${timerError instanceof Error ? timerError.message : String(timerError)}`
        );
    }
}

export interface SpymasterViewPayload {
    types: string[];
    duetTypes?: string[];
    cardScores?: number[];
}

/**
 * Build the perspective-correct `game:spymasterView` payload for a player, or
 * null if the player doesn't get a full-board view (not a spymaster/observer, or
 * no live game). Pure and socket-free so both the resync/role-change path and the
 * game-start path can reuse the exact same masking logic.
 */
export function buildSpymasterViewPayload(game: GameState | null, player: Player): SpymasterViewPayload | null {
    // Spymasters and observers both see the unmasked board. (Observers are
    // teamless, so they get the base `types` perspective.)
    const wantsFullBoard = player.role === 'spymaster' || player.role === 'observer';
    if (!(wantsFullBoard && game && !game.gameOver && game.types)) {
        return null;
    }
    // In Duet mode, Blue spymasters see duetTypes (their perspective),
    // not types (Red's perspective). Red spymasters always see types.
    const isDuetBlue = game.gameMode === 'duet' && player.team === 'blue' && game.duetTypes;
    const typesToSend = isDuetBlue ? game.duetTypes : game.types;
    const payload: SpymasterViewPayload = {
        types: typesToSend as string[],
    };
    if (game.gameMode === 'match' && game.cardScores) {
        payload.cardScores = game.cardScores;
    }
    // Observers watch the whole duet board, so give them BOTH sides' key cards.
    if (game.gameMode === 'duet' && player.role === 'observer' && game.duetTypes) {
        payload.duetTypes = game.duetTypes as string[];
    }
    return payload;
}

export async function sendSpymasterViewIfNeeded(
    socket: GameSocket,
    player: Player,
    game: GameState | null,
    _roomCode: string
): Promise<void> {
    const payload = buildSpymasterViewPayload(game, player);
    if (payload) {
        socket.emit(SOCKET_EVENTS.GAME_SPYMASTER_VIEW, payload);
    }
}

/**
 * Consume a rate limit token for a failed room:join attempt (room-code enumeration
 * guard). Throws RateLimitError once the 'room:join:failed' ceiling is exceeded —
 * the caller must let this propagate instead of swallowing it, or repeated
 * ROOM_NOT_FOUND/INVALID_INPUT probing is never actually throttled.
 */
export async function trackFailedJoinAttempt(socket: GameSocket): Promise<void> {
    let blocked: Error | undefined;
    try {
        const rateLimiter = getSocketRateLimiter();
        const limiter = rateLimiter.getLimiter('room:join:failed');
        blocked = await new Promise<Error | undefined>((resolve) => {
            limiter(socket, {}, (err: Error | undefined) => resolve(err));
        });
    } catch (error) {
        // Non-critical infrastructure failure (e.g. rate limiter not initialized) —
        // log but don't block the join failure the caller is already handling.
        logger.debug('Failed to track join attempt', { error: error instanceof Error ? error.message : String(error) });
        return;
    }

    if (blocked) {
        logger.warn('Failed join rate limit exceeded', {
            socketId: socket.id,
            sessionId: socket.sessionId,
        });
        throw new RateLimitError('Too many failed join attempts, please slow down');
    }
}

export function computeFallbackStats(players: Player[]): RoomStats {
    const teamStats = (team: string): TeamStats => {
        const teamPlayers = players.filter((p) => p.team === team);
        return {
            total: teamPlayers.length,
            spymaster: teamPlayers.find((p) => p.role === 'spymaster')?.nickname || null,
            clicker: teamPlayers.find((p) => p.role === 'clicker')?.nickname || null,
        };
    };
    return {
        totalPlayers: players.length,
        spectatorCount: players.filter((p) => isPlayerSpectator(p)).length,
        teams: { red: teamStats('red'), blue: teamStats('blue') },
    };
}
