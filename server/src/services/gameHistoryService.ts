/**
 * Game History Service — barrel re-export
 *
 * Implementation split into focused modules under gameHistory/:
 *   - types.ts       — All type/interface definitions
 *   - validation.ts  — Data validation and clue counting
 *   - storage.ts     — Redis CRUD operations (save, get, cleanup)
 *   - replayEngine.ts — Replay event construction
 */
export {
    // Types
    type InitialBoardState,
    type FinalGameState,
    type TeamNames,
    type GameClue,
    type HistoryEntry,
    type GameDataInput,
    type GameHistoryEntry,
    type EndReason,
    type GameHistorySummary,
    type ReplayEvent,
    type ReplayData,
    type ValidationResult,
    type HistoryStats,
    // Validation
    countCluesFromHistory,
    validateGameData,
    // Storage
    GAME_HISTORY_TTL,
    MAX_HISTORY_PER_ROOM,
    saveGameResult,
    getGameHistory,
    getGameById,
    cleanupOldHistory,
    clearRoomHistory,
    getHistoryStats,
    // Replay
    getReplayEvents,
} from './gameHistory/index';
