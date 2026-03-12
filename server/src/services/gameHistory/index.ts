// Barrel export for gameHistory module
export type {
    InitialBoardState,
    FinalGameState,
    TeamNames,
    GameClue,
    HistoryEntry,
    GameDataInput,
    GameHistoryEntry,
    EndReason,
    GameHistorySummary,
    ReplayEvent,
    ReplayData,
    ValidationResult,
    HistoryStats,
} from './types';

export { countCluesFromHistory, validateGameData } from './validation';

export {
    GAME_HISTORY_TTL,
    MAX_HISTORY_PER_ROOM,
    saveGameResult,
    getGameHistory,
    getGameById,
    cleanupOldHistory,
    clearRoomHistory,
    getHistoryStats,
} from './storage';

export { getReplayEvents } from './replayEngine';
