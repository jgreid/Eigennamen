import type { Server } from 'socket.io';
import type { GameState, Room } from '../../types';
import type { GameDataInput, HistoryEntry } from '../../services/gameHistoryService';

import * as gameService from '../../services/gameService';
import * as roomService from '../../services/roomService';
import * as gameHistoryService from '../../services/gameHistoryService';
import logger from '../../utils/logger';
import { SOCKET_EVENTS } from '../../config/constants';
import { safeEmitToRoom } from '../safeEmit';

/**
 * Save completed game to history (non-critical — errors are logged but don't break game flow)
 */
export async function saveCompletedGameHistory(roomCode: string): Promise<void> {
    try {
        const [completedGame, roomForHistory] = (await Promise.all([
            gameService.getGame(roomCode),
            roomService.getRoom(roomCode),
        ])) as [GameState | null, Room | null];
        if (completedGame) {
            // Explicitly extract GameDataInput fields to avoid unsafe cast
            // and ensure compile-time errors if GameState stops including required fields.
            const gameData: GameDataInput = {
                id: completedGame.id,
                words: completedGame.words,
                types: completedGame.types,
                seed: completedGame.seed,
                redScore: completedGame.redScore,
                blueScore: completedGame.blueScore,
                redTotal: completedGame.redTotal,
                blueTotal: completedGame.blueTotal,
                winner: completedGame.winner ?? undefined,
                gameOver: completedGame.gameOver,
                createdAt: completedGame.createdAt,
                clues: completedGame.clues,
                // Map GameHistoryEntry[] to HistoryEntry[] (winner: Team|null → Team|undefined)
                history: completedGame.history as unknown as HistoryEntry[],
                teamNames: roomForHistory?.settings?.teamNames || { red: 'Red', blue: 'Blue' },
                wordListId: completedGame.wordListId,
                stateVersion: completedGame.stateVersion,
            };
            await gameHistoryService.saveGameResult(roomCode, gameData);
        }
    } catch (historyError) {
        logger.error(`Failed to save game history for room ${roomCode}:`, historyError);
    }
}

/**
 * Atomically finalize a match round and emit the appropriate event.
 * Shared by the reveal and forfeit handlers.
 *
 * Uses gameService.finalizeMatchRound (optimistic-locking transaction)
 * instead of raw redis.set, preventing race conditions.
 *
 * No-ops gracefully if the game is not in match mode.
 */
export async function handleMatchRoundFinalization(io: Server, roomCode: string): Promise<void> {
    const result = await gameService.finalizeMatchRound(roomCode);
    if (!result) return;

    if (result.matchOver) {
        safeEmitToRoom(io, roomCode, SOCKET_EVENTS.GAME_MATCH_OVER, {
            matchWinner: result.matchWinner,
            redMatchScore: result.redMatchScore,
            blueMatchScore: result.blueMatchScore,
            roundHistory: result.roundHistory,
            roundResult: result.roundResult,
        });
    } else {
        safeEmitToRoom(io, roomCode, SOCKET_EVENTS.GAME_ROUND_ENDED, {
            roundResult: result.roundResult,
            redMatchScore: result.redMatchScore,
            blueMatchScore: result.blueMatchScore,
            matchRound: result.matchRound,
        });
    }
}
