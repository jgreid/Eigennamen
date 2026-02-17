/**
 * Room Handler Utilities
 *
 * Helper functions shared across room-related socket handlers.
 * Extracted from roomHandlers.ts for clarity and reusability.
 */

import type { Player, GameState } from '../../types';
import type { GameSocket } from './types';
import type { RoomStats, TeamStats } from '../../services/playerService';
import type { TimerStatus } from '../../services/timerService';

import logger from '../../utils/logger';
import { SOCKET_EVENTS } from '../../config/constants';
import { getSocketFunctions } from '../socketFunctionProvider';
import { getSocketRateLimiter } from '../rateLimitHandler';
import { isPlayerSpectator } from '../playerContext';

/**
 * Send timer status to a socket
 */
export async function sendTimerStatus(
    socket: GameSocket,
    roomCode: string,
    context: string
): Promise<void> {
    try {
        const { getTimerStatus } = getSocketFunctions();
        const timerStatus: TimerStatus | null = await getTimerStatus(roomCode);
        if (timerStatus && timerStatus.endTime) {
            socket.emit(SOCKET_EVENTS.TIMER_STATUS, {
                roomCode,
                remainingSeconds: timerStatus.remainingSeconds,
                endTime: timerStatus.endTime,
                isPaused: timerStatus.isPaused || false
            });
        }
    } catch (timerError) {
        logger.warn(`Failed to send timer status on ${context}: ${timerError instanceof Error ? timerError.message : String(timerError)}`);
    }
}

/**
 * Send spymaster view if player is a spymaster with active game
 * Performance fix: Use game.types directly instead of re-fetching from Redis.
 * getGameStateForPlayer already includes full types for spymasters.
 */
export async function sendSpymasterViewIfNeeded(
    socket: GameSocket,
    player: Player,
    game: GameState | null,
    _roomCode: string
): Promise<void> {
    if (player.role === 'spymaster' && game && !game.gameOver && game.types) {
        // In Duet mode, Blue spymasters see duetTypes (their perspective),
        // not types (Red's perspective). Red spymasters always see types.
        const isDuetBlue = game.gameMode === 'duet' && player.team === 'blue' && game.duetTypes;
        const typesToSend = isDuetBlue ? game.duetTypes : game.types;
        socket.emit(SOCKET_EVENTS.GAME_SPYMASTER_VIEW, { types: typesToSend });
    }
}

/**
 * Track failed join attempt for rate limiting
 * Prevents room code enumeration attacks by limiting failed attempts
 */
export async function trackFailedJoinAttempt(socket: GameSocket): Promise<void> {
    try {
        const rateLimiter = getSocketRateLimiter();
        const limiter = rateLimiter.getLimiter('room:join:failed');
        // Consume a rate limit token for failed attempts
        await new Promise<void>((resolve) => {
            limiter(socket, {}, (err: Error | undefined) => {
                if (err) {
                    logger.warn('Failed join rate limit exceeded', {
                        socketId: socket.id,
                        sessionId: socket.sessionId
                    });
                }
                resolve();
            });
        });
    } catch (error) {
        // Non-critical - log but don't block
        logger.debug('Failed to track join attempt', { error: error instanceof Error ? error.message : String(error) });
    }
}

/**
 * Compute room stats from a players array as a fallback when getRoomStats fails.
 * Avoids hardcoding zeros which would show incorrect team/spectator counts.
 */
export function computeFallbackStats(players: Player[]): RoomStats {
    const teamStats = (team: string): TeamStats => {
        const teamPlayers = players.filter(p => p.team === team);
        return {
            total: teamPlayers.length,
            spymaster: teamPlayers.find(p => p.role === 'spymaster')?.nickname || null,
            clicker: teamPlayers.find(p => p.role === 'clicker')?.nickname || null
        };
    };
    return {
        totalPlayers: players.length,
        spectatorCount: players.filter(p => isPlayerSpectator(p)).length,
        teams: { red: teamStats('red'), blue: teamStats('blue') }
    };
}
