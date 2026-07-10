import type { Team, CardType, GameMode } from '../../types';

/**
 * Initial board state for replay
 */
export interface InitialBoardState {
    words: string[];
    types: CardType[];
    seed: string;
    firstTeam: Team;
    /**
     * Duet mode: the BLUE side's perspective key. Without it a duet replay
     * colours every blue-turn reveal from the red-side `types`, which is wrong
     * for a card that is an agent on one side and a bystander on the other (N7).
     */
    duetTypes?: CardType[];
    /** Match mode: per-card point values, so match replays can show card scores (N7). */
    cardScores?: number[];
}

/**
 * Final game state
 */
export interface FinalGameState {
    redScore: number;
    blueScore: number;
    redTotal: number;
    blueTotal: number;
    // null for a duet cooperative loss (no winning team).
    winner: Team | null;
    gameOver: boolean;
    // Duet mode extras (N7)
    greenFound?: number;
    greenTotal?: number;
    timerTokens?: number;
    // Match mode extras (N7)
    matchRound?: number;
    redMatchScore?: number;
    blueMatchScore?: number;
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
    winner?: Team | null;
    gameOver?: boolean;
    // Needed so validation can accept a null winner for a duet cooperative loss.
    gameMode?: GameMode;
    /**
     * Authoritative end reason captured when the game ended (from the reveal
     * that ended it). Lets a duet token/unreachable loss be recorded as a loss
     * rather than being indistinguishable from a completion (N7).
     */
    endReason?: EndReason;
    // Duet mode extras (N7)
    duetTypes?: CardType[];
    greenFound?: number;
    greenTotal?: number;
    timerTokens?: number;
    // Match mode extras (N7)
    cardScores?: number[];
    matchRound?: number;
    redMatchScore?: number;
    blueMatchScore?: number;
    createdAt?: number;
    clues?: GameClue[];
    history?: HistoryEntry[];
    teamNames?: TeamNames;
    wordListId?: string | null;
    wordListName?: string | null;
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
    /** Which game mode this game was played in (N7). Legacy entries may lack it. */
    gameMode?: GameMode;
    /** Authoritative end reason captured at game end (N7). Legacy entries may lack it. */
    endReason?: EndReason;
    initialBoard: InitialBoardState;
    finalState: FinalGameState;
    clues: GameClue[];
    history: HistoryEntry[];
    teamNames: TeamNames;
    wordListId: string | null;
    wordListName: string | null;
    stateVersion: number;
}

/**
 * How the game ended.
 * `timerTokens`/`unreachable` are duet cooperative losses — distinct from a
 * `completed` win so replays/summaries don't mislabel a loss as a completion (N7).
 */
export type EndReason = 'completed' | 'assassin' | 'forfeit' | 'timerTokens' | 'unreachable';

/**
 * Game history summary (for list views)
 */
export interface GameHistorySummary {
    id: string;
    timestamp: number;
    startedAt: number;
    endedAt: number;
    /** Game mode, so a duet cooperative win (winner:'red') isn't shown as a red-team win (N7). */
    gameMode?: GameMode;
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
    /** Game mode, so the replay renderer can colour duet boards / show match scores (N7). */
    gameMode?: GameMode;
    endReason?: EndReason;
    initialBoard: InitialBoardState;
    events: ReplayEvent[];
    finalState: FinalGameState;
    teamNames: TeamNames;
    duration: number;
    totalMoves: number;
    totalClues: number;
    /** Provenance: saved word list this game was played with (if any). */
    wordListId?: string | null;
    wordListName?: string | null;
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
