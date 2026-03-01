/**
 * Game Type Definitions
 *
 * Core types for the Eigennamen game state, cards, and game logic.
 */

import type { GameMode } from '../config/gameConfig';

/**
 * Card types on the board
 */
export type CardType = 'red' | 'blue' | 'neutral' | 'assassin';

/**
 * Team identifiers
 */
export type Team = 'red' | 'blue';

/**
 * Player roles in the game
 */
export type Role = 'spymaster' | 'clicker' | 'spectator';

/**
 * Individual card on the board
 */
export interface Card {
    /** The word displayed on the card */
    word: string;
    /** The card's hidden type (only visible to spymasters) */
    type: CardType;
    /** Whether the card has been revealed */
    revealed: boolean;
    /** Position index on the board (0-24) */
    position: number;
}

/**
 * A clue given by a spymaster
 */
export interface Clue {
    /** The team that gave the clue */
    team: Team;
    /** The clue word */
    word: string;
    /** The number associated with the clue */
    number: number;
    /** The spymaster who gave the clue */
    spymaster: string;
    /** When the clue was given */
    timestamp: number;
}

/**
 * History entry for a card reveal action
 */
export interface RevealHistoryEntry {
    action: 'reveal';
    /** Card index that was revealed */
    index: number;
    /** The word on the card */
    word: string;
    /** The card's type */
    type: CardType;
    /** Team that made the reveal */
    team: Team;
    /** Player who revealed the card */
    player: string;
    /** Which guess number this was in the turn */
    guessNumber: number;
    /** When the action occurred */
    timestamp: number;
}

/**
 * History entry for a clue action
 */
export interface ClueHistoryEntry {
    action: 'clue';
    /** Team that gave the clue */
    team: Team;
    /** The clue word */
    word: string;
    /** The clue number */
    number: number;
    /** Number of guesses allowed */
    guessesAllowed: number;
    /** Spymaster who gave the clue */
    spymaster: string;
    /** When the action occurred */
    timestamp: number;
}

/**
 * History entry for ending a turn
 */
export interface EndTurnHistoryEntry {
    action: 'endTurn';
    /** Team that ended their turn */
    fromTeam: Team;
    /** Team whose turn it now is */
    toTeam: Team;
    /** Player who ended the turn */
    player: string;
    /** When the action occurred */
    timestamp: number;
}

/**
 * History entry for forfeiting
 */
export interface ForfeitHistoryEntry {
    action: 'forfeit';
    /** Team that forfeited */
    forfeitingTeam: Team;
    /** Team that won (null in Duet mode cooperative forfeit) */
    winner: Team | null;
    /** When the action occurred */
    timestamp: number;
}

/**
 * Union type for all history entry types
 */
export type GameHistoryEntry = RevealHistoryEntry | ClueHistoryEntry | EndTurnHistoryEntry | ForfeitHistoryEntry;

/**
 * Result of a completed round in match mode
 */
export interface RoundResult {
    /** Which round number this was (1-indexed) */
    roundNumber: number;
    /** Team that won the round (null for cooperative/no winner) */
    roundWinner: Team | null;
    /** Card points earned by red this round */
    redRoundScore: number;
    /** Card points earned by blue this round */
    blueRoundScore: number;
    /** Whether red received the round win bonus */
    redBonusAwarded: boolean;
    /** Whether blue received the round win bonus */
    blueBonusAwarded: boolean;
    /** How the round ended */
    endReason: string;
    /** When the round was completed */
    completedAt: number;
}

/**
 * Complete game state stored in Redis
 */
export interface GameState {
    /** Unique game identifier */
    id: string;
    /** Seed used for deterministic board generation */
    seed: string;
    /** ID of the word list used (null if using default or custom) */
    wordListId: string | null;
    /** The 25 words on the board */
    words: string[];
    /** The card types (hidden from non-spymasters) */
    types: CardType[];
    /** Which cards have been revealed */
    revealed: boolean[];
    /** Which team's turn it is */
    currentTurn: Team;
    /** Red team's current score */
    redScore: number;
    /** Blue team's current score */
    blueScore: number;
    /** Total cards red team needs to find */
    redTotal: number;
    /** Total cards blue team needs to find */
    blueTotal: number;
    /** Whether the game has ended */
    gameOver: boolean;
    /** Winning team (null if game not over) */
    winner: Team | null;
    /** Current clue (null if none given this turn) */
    currentClue: Clue | null;
    /** Number of guesses used this turn */
    guessesUsed: number;
    /** Maximum guesses allowed (0 = unlimited) */
    guessesAllowed: number;
    /** All clues given in the game */
    clues: Clue[];
    /** Game history entries */
    history: GameHistoryEntry[];
    /** State version for optimistic locking */
    stateVersion: number;
    /** When the game was created */
    createdAt: number;
    /** Game mode (classic, duet, match) */
    gameMode?: GameMode;
    // Duet mode fields (optional, only present in duet games)
    /** Side B's key card types (blue team's perspective) */
    duetTypes?: CardType[];
    /** Timer tokens remaining (wrong guesses cost tokens) */
    timerTokens?: number;
    /** Total unique green cards found */
    greenFound?: number;
    /** Total unique green cards needed to win */
    greenTotal?: number;
    // Match mode fields (optional, only present in match games)
    /** Point value for each card position (parallel to types[]) */
    cardScores?: number[];
    /** Which team revealed each card (parallel to revealed[]) */
    revealedBy?: (Team | null)[];
    /** Current round number (1-indexed) */
    matchRound?: number;
    /** Cumulative red team match score across rounds */
    redMatchScore?: number;
    /** Cumulative blue team match score across rounds */
    blueMatchScore?: number;
    /** Results of completed rounds */
    roundHistory?: RoundResult[];
    /** Whether the match has ended */
    matchOver?: boolean;
    /** Match winner */
    matchWinner?: Team | null;
    /** Which team went first in each round */
    firstTeamHistory?: Team[];
}

/**
 * Game state as seen by a player (types may be hidden)
 */
export interface PlayerGameState extends Omit<
    GameState,
    'types' | 'duetTypes' | 'cardScores' | 'seed' | 'wordListId' | 'stateVersion' | 'createdAt'
> {
    /** Card types - null for unrevealed cards if not spymaster */
    types: (CardType | null)[];
    /** Duet: Side B types (only visible to blue team spymaster) */
    duetTypes?: (CardType | null)[];
    /** Match: card scores - null for unrevealed cards if not spymaster */
    cardScores?: (number | null)[];
}

/**
 * Options for creating a new game
 */
export interface CreateGameOptions {
    /** UUID of a database word list to use */
    wordListId?: string;
    /** Custom words to use (takes precedence over wordListId) */
    wordList?: string[];
    /** Game mode (classic, duet, match) */
    gameMode?: GameMode;
    /** Match state to carry forward when starting next round */
    matchCarryOver?: {
        matchRound: number;
        redMatchScore: number;
        blueMatchScore: number;
        roundHistory: RoundResult[];
        firstTeamHistory: Team[];
    };
}

/**
 * Result of revealing a card
 */
export interface RevealResult {
    /** Card index that was revealed */
    index: number;
    /** The card's type */
    type: CardType;
    /** The word on the card */
    word: string;
    /** Current red team score */
    redScore: number;
    /** Current blue team score */
    blueScore: number;
    /** Which team's turn it is now */
    currentTurn: Team;
    /** Guesses used this turn */
    guessesUsed: number;
    /** Maximum guesses allowed */
    guessesAllowed: number;
    /** Whether the turn ended */
    turnEnded: boolean;
    /** Whether the game is over */
    gameOver: boolean;
    /** Winner if game is over */
    winner: Team | null;
    /** Reason the turn/game ended */
    endReason: 'assassin' | 'completed' | 'maxGuesses' | 'timerTokens' | null;
    /** All card types (only included if game is over) */
    allTypes: CardType[] | null;
    // Duet mode fields
    /** Duet: timer tokens remaining */
    timerTokens?: number;
    /** Duet: unique green cards found */
    greenFound?: number;
    /** Duet: all Side B types (only included if game over) */
    allDuetTypes?: CardType[] | null;
    // Match mode fields
    /** Match: point value of the revealed card */
    cardScore?: number;
    /** Match: updated cumulative red match score */
    redMatchScore?: number;
    /** Match: updated cumulative blue match score */
    blueMatchScore?: number;
}

/**
 * Result of ending a turn
 */
export interface EndTurnResult {
    /** Team whose turn it is now */
    currentTurn: Team;
    /** Team whose turn just ended */
    previousTurn: Team;
}

/**
 * Result of forfeiting the game
 */
export interface ForfeitResult {
    /** The winning team (null for cooperative Duet mode forfeit) */
    winner: Team | null;
    /** The team that forfeited */
    forfeitingTeam: Team;
    /** All card types (revealed after forfeit) */
    allTypes: CardType[];
}

/**
 * Board configuration constants type
 */
export interface BoardConfig {
    /** Total number of cards on the board */
    BOARD_SIZE: number;
    /** Cards for the team that goes first */
    FIRST_TEAM_CARDS: number;
    /** Cards for the team that goes second */
    SECOND_TEAM_CARDS: number;
    /** Neutral cards */
    NEUTRAL_CARDS: number;
    /** Assassin cards */
    ASSASSIN_CARDS: number;
}
