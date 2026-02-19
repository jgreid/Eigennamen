/**
 * Shared types for all socket event handlers.
 *
 * Previously, GameSocket and RoomContext were duplicated across every handler
 * file (roomHandlers, gameHandlers, playerHandlers, timerHandlers, chatHandlers).
 * Centralizing them here eliminates redundancy and ensures consistency.
 */

import type { Socket } from 'socket.io';
import type { Player, GameState } from '../../types';

/**
 * Extended Socket type with game-specific properties.
 * Set during socket authentication middleware.
 *
 * This is the single canonical definition — all socket code should
 * import GameSocket from this file (or re-export it).
 */
export interface GameSocket extends Socket {
    sessionId: string;
    roomCode: string | null;
    clientIP?: string;
    flyInstanceId?: string;
    rateLimiter?: { cleanupSocket: (socketId: string) => void };
}

/**
 * Room handler context provided by createRoomHandler / createHostHandler.
 * Contains pre-validated player state and game data.
 */
export interface RoomContext {
    sessionId: string;
    roomCode: string;
    player: Player;
    game: GameState | null;
}

/**
 * Game handler context provided by createGameHandler.
 * Guarantees an active game exists (game is non-null).
 */
export interface GameContext {
    sessionId: string;
    roomCode: string;
    player: Player;
    game: GameState;
}
