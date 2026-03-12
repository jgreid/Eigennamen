import type { Team, CardType } from '../../types';

/**
 * Initial board state for replay
 */
export interface InitialBoardState {
    words: string[];
    types: CardType[];
    seed: string;
    firstTeam: Team;
}

/**
 * Final game state
 */
export interface FinalGameState {
    redScore: number;
    blueScore: number;
    redTotal: number;
    blueTotal: number;
    winner: Team;
    gameOver: boolean;
}

/**
 * Team names configuration
 */
export interface TeamNames {
    red: string;
    blue: string;
}

/**
 * Clue given during a game
 */
export interface GameClue {
    team: Team;
    word: string;
    number: number;
    spymaster?: string;
    guessesAllowed?: number;
    timestamp?: number;
}

/**
 * History entry for game actions
 */
export interface HistoryEntry {
    action: 'clue' | 'reveal' | 'endTurn' | 'forfeit';
    timestamp?: number;
    team?: Team;
    word?: string;
    number?: number;
    spymaster?: string;
    guessesAllowed?: number;
    index?: number;
    type?: CardType;
    player?: string;
    guessNumber?: number;
    fromTeam?: Team;
    toTeam?: Team;
    forfeitingTeam?: Team;
    winner?: Team;
}

/**
 * Game data input for saving to history
 */
export interface GameDataInput {
    id?: string;
    words: string[];
    types: CardType[];
    seed: string;
    redScore: number;
    blueScore: number;
    redTotal: number;
    blueTotal: number;
    winner?: Team;
    gameOver?: boolean;
    createdAt?: number;
    clues?: GameClue[];
    history?: HistoryEntry[];
    teamNames?: TeamNames;
    wordListId?: string | null;
    stateVersion?: number;
}

/**
 * Game history entry stored in Redis
 */
export interface GameHistoryEntry {
    id: string;
    roomCode: string;
    timestamp: number;
    startedAt: number;
    endedAt: number;
    initialBoard: InitialBoardState;
    finalState: FinalGameState;
    clues: GameClue[];
    history: HistoryEntry[];
    teamNames: TeamNames;
    wordListId: string | null;
    stateVersion: number;
}

/**
 * How the game ended
 */
export type EndReason = 'completed' | 'assassin' | 'forfeit';

/**
 * Game history summary (for list views)
 */
export interface GameHistorySummary {
    id: string;
    timestamp: number;
    startedAt: number;
    endedAt: number;
    winner?: Team;
    redScore?: number;
    blueScore?: number;
    redTotal?: number;
    blueTotal?: number;
    teamNames?: TeamNames;
    clueCount: number;
    moveCount: number;
    endReason: EndReason;
    duration: number;
}

/**
 * Replay event data
 */
export interface ReplayEvent {
    timestamp?: number;
    type: string;
    data: Record<string, unknown>;
}

/**
 * Replay data structure
 */
export interface ReplayData {
    id: string;
    roomCode: string;
    timestamp: number;
    initialBoard: InitialBoardState;
    events: ReplayEvent[];
    finalState: FinalGameState;
    teamNames: TeamNames;
    duration: number;
    totalMoves: number;
    totalClues: number;
    /** Number of corrupted history entries skipped during replay construction */
    skippedEntries?: number;
}

/**
 * Validation result
 */
export interface ValidationResult {
    valid: boolean;
    errors: string[];
}

/**
 * History statistics
 */
export interface HistoryStats {
    count: number;
    oldest: { id: string; timestamp: number } | null;
    newest: { id: string; timestamp: number } | null;
    error?: string;
}
