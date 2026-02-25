import type { GameState, Room } from '../../types';
import type { GameDataInput } from '../../services/gameHistoryService';

import * as gameService from '../../services/gameService';
import * as roomService from '../../services/roomService';
import * as gameHistoryService from '../../services/gameHistoryService';
import logger from '../../utils/logger';

/**
 * Save completed game to history (non-critical — errors are logged but don't break game flow)
 */
export async function saveCompletedGameHistory(roomCode: string): Promise<void> {
    try {
        const [completedGame, roomForHistory] = await Promise.all([
            gameService.getGame(roomCode),
            roomService.getRoom(roomCode)
        ]) as [GameState | null, Room | null];
        if (completedGame) {
            const gameDataWithTeamNames = {
                ...completedGame,
                winner: completedGame.winner ?? undefined,
                teamNames: roomForHistory?.settings?.teamNames || { red: 'Red', blue: 'Blue' }
            } as GameDataInput;
            await gameHistoryService.saveGameResult(roomCode, gameDataWithTeamNames);
        }
    } catch (historyError) {
        logger.error(`Failed to save game history for room ${roomCode}:`, historyError);
    }
}
