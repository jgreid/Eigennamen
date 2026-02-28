import type {
    Team,
    CardType,
    GameState,
    RevealResult,
    Player,
    PlayerGameState
} from '../../types';

import {
    BOARD_SIZE,
    DUET_BOARD_CONFIG
} from '../../config/constants';
import {
    GameStateError,
    ValidationError
} from '../../errors/GameError';

/**
 * Reveal outcome determination (internal)
 */
interface RevealOutcome {
    turnEnded: boolean;
    endReason: RevealResult['endReason'];
}

/**
 * Validate card index bounds
 */
export function validateCardIndex(index: number): void {
    if (typeof index !== 'number' || !Number.isFinite(index) ||
        index < 0 || index >= BOARD_SIZE || !Number.isInteger(index)) {
        throw ValidationError.invalidCardIndex(index, BOARD_SIZE);
    }
}

/**
 * Validate game state preconditions for revealing a card
 */
export function validateRevealPreconditions(game: GameState, index: number): void {
    if (game.gameOver) {
        throw GameStateError.gameOver();
    }

    if (game.guessesAllowed > 0 && game.guessesUsed >= game.guessesAllowed) {
        throw ValidationError.noGuessesRemaining();
    }

    if (game.revealed[index]) {
        throw GameStateError.cardAlreadyRevealed(index);
    }
}

/**
 * Execute the reveal and update scores
 * In Duet mode, uses the active team's perspective to determine card type
 */
export function executeCardReveal(game: GameState, index: number): CardType {
    // Defence-in-depth: guard against corrupted game data where types array
    // is shorter than expected (index validated upstream by validateCardIndex)
    if (index >= game.types.length) {
        throw GameStateError.corrupted(`types array too short (length ${game.types.length}, index ${index})`);
    }

    game.revealed[index] = true;

    // Track which team revealed this card (for match mode scoring)
    if (game.revealedBy) {
        game.revealedBy[index] = game.currentTurn;
    }

    let type: CardType;
    if (game.gameMode === 'duet') {
        if (game.currentTurn === 'blue' && game.duetTypes) {
            if (index >= game.duetTypes.length) {
                throw GameStateError.corrupted(`duetTypes array too short (length ${game.duetTypes.length}, index ${index})`);
            }
            type = game.duetTypes[index] as CardType;
        } else {
            type = game.types[index] as CardType;
        }

        if (type === 'red' || type === 'blue') {
            game.greenFound = (game.greenFound || 0) + 1;
            if (game.currentTurn === 'red') {
                game.redScore++;
            } else {
                game.blueScore++;
            }
        }
    } else {
        type = game.types[index] as CardType;
        if (type === 'red') {
            game.redScore++;
        } else if (type === 'blue') {
            game.blueScore++;
        }
    }

    game.guessesUsed = (game.guessesUsed || 0) + 1;

    return type;
}

/**
 * Switch turn to the other team and reset clue state
 */
export function switchTurn(game: GameState): void {
    game.currentTurn = game.currentTurn === 'red' ? 'blue' : 'red';
    game.currentClue = null;
    game.guessesUsed = 0;
    game.guessesAllowed = 0;
}

/**
 * Determine the outcome of revealing a card
 */
export function determineRevealOutcome(
    game: GameState,
    cardType: CardType,
    revealingTeam: Team
): RevealOutcome {
    const outcome: RevealOutcome = { turnEnded: false, endReason: null };

    if (game.gameMode === 'duet') {
        return determineDuetRevealOutcome(game, cardType, outcome);
    }

    // Classic mode logic
    if (cardType === 'assassin') {
        game.gameOver = true;
        game.winner = revealingTeam === 'red' ? 'blue' : 'red';
        outcome.endReason = 'assassin';
        outcome.turnEnded = true;
        return outcome;
    }

    if (game.redScore >= game.redTotal) {
        game.gameOver = true;
        game.winner = 'red';
        outcome.endReason = 'completed';
        outcome.turnEnded = true;
        return outcome;
    }

    if (game.blueScore >= game.blueTotal) {
        game.gameOver = true;
        game.winner = 'blue';
        outcome.endReason = 'completed';
        outcome.turnEnded = true;
        return outcome;
    }

    if (cardType !== revealingTeam) {
        switchTurn(game);
        outcome.turnEnded = true;
        return outcome;
    }

    if (game.guessesAllowed > 0 && game.guessesUsed >= game.guessesAllowed) {
        switchTurn(game);
        outcome.turnEnded = true;
        outcome.endReason = 'maxGuesses';
        return outcome;
    }

    return outcome;
}

/**
 * Determine reveal outcome for Duet mode (cooperative rules)
 */
function determineDuetRevealOutcome(
    game: GameState,
    cardType: CardType,
    outcome: RevealOutcome
): RevealOutcome {
    if (cardType === 'assassin') {
        game.gameOver = true;
        game.winner = null;
        outcome.endReason = 'assassin';
        outcome.turnEnded = true;
        return outcome;
    }

    if ((game.greenFound || 0) >= (game.greenTotal || DUET_BOARD_CONFIG.greenTotal)) {
        game.gameOver = true;
        game.winner = 'red';
        outcome.endReason = 'completed';
        outcome.turnEnded = true;
        return outcome;
    }

    if (cardType === 'neutral') {
        game.timerTokens = Math.max((game.timerTokens || 0) - 1, 0);

        if (game.timerTokens <= 0) {
            game.gameOver = true;
            game.winner = null;
            outcome.endReason = 'timerTokens';
            outcome.turnEnded = true;
            return outcome;
        }

        switchTurn(game);
        outcome.turnEnded = true;
        return outcome;
    }

    if (game.guessesAllowed > 0 && game.guessesUsed >= game.guessesAllowed) {
        switchTurn(game);
        outcome.turnEnded = true;
        outcome.endReason = 'maxGuesses';
        return outcome;
    }

    return outcome;
}

/**
 * Build the reveal result object
 */
export function buildRevealResult(
    game: GameState,
    index: number,
    type: CardType,
    outcome: RevealOutcome
): RevealResult {
    const word = (game.words && index >= 0 && index < game.words.length)
        ? game.words[index]
        : 'UNKNOWN';

    const result: RevealResult = {
        index,
        type,
        word: word || 'UNKNOWN',
        redScore: game.redScore ?? 0,
        blueScore: game.blueScore ?? 0,
        currentTurn: game.currentTurn,
        guessesUsed: game.guessesUsed ?? 0,
        guessesAllowed: game.guessesAllowed ?? 0,
        turnEnded: outcome.turnEnded,
        gameOver: game.gameOver ?? false,
        winner: game.winner,
        endReason: outcome.endReason,
        allTypes: game.gameOver ? game.types : null
    };

    if (game.gameMode === 'duet') {
        result.timerTokens = game.timerTokens;
        result.greenFound = game.greenFound;
        result.allDuetTypes = game.gameOver ? (game.duetTypes || null) : null;
    }

    // Match mode: include card score and cumulative match scores
    if (game.gameMode === 'match' && game.cardScores) {
        result.cardScore = game.cardScores[index];
        result.redMatchScore = game.redMatchScore ?? 0;
        result.blueMatchScore = game.blueMatchScore ?? 0;
    }

    return result;
}

/**
 * Get game state for a specific player (hides card types for non-spymasters)
 */
export function getGameStateForPlayer(
    game: GameState | null,
    player: Player | null
): PlayerGameState | null {
    if (!game) {
        return null;
    }

    const isDuet = game.gameMode === 'duet';
    const isMatch = game.gameMode === 'match';
    const state: PlayerGameState = {
        id: game.id,
        words: game.words,
        revealed: game.revealed,
        currentTurn: game.currentTurn,
        redScore: game.redScore,
        blueScore: game.blueScore,
        redTotal: game.redTotal,
        blueTotal: game.blueTotal,
        gameOver: game.gameOver,
        winner: game.winner,
        currentClue: game.currentClue,
        guessesUsed: game.guessesUsed || 0,
        guessesAllowed: game.guessesAllowed || 0,
        clues: game.clues || [],
        history: game.history || [],
        types: [],
        ...(isDuet ? {
            gameMode: game.gameMode,
            timerTokens: game.timerTokens,
            greenFound: game.greenFound,
            greenTotal: game.greenTotal
        } : {}),
        ...(isMatch ? {
            gameMode: game.gameMode,
            matchRound: game.matchRound,
            redMatchScore: game.redMatchScore ?? 0,
            blueMatchScore: game.blueMatchScore ?? 0,
            roundHistory: game.roundHistory ?? [],
            matchOver: game.matchOver ?? false,
            matchWinner: game.matchWinner ?? null,
            revealedBy: game.revealedBy
        } : {})
    };

    const isSpymaster = player && player.role === 'spymaster';
    const playerTeam = player?.team;

    if (isDuet) {
        if (game.gameOver) {
            state.types = game.types;
            state.duetTypes = game.duetTypes;
        } else if (isSpymaster && playerTeam === 'red') {
            state.types = game.types;
            state.duetTypes = game.duetTypes?.map((type, i) =>
                game.revealed[i] ? type : null
            );
        } else if (isSpymaster && playerTeam === 'blue') {
            state.duetTypes = game.duetTypes;
            state.types = game.types.map((type, i) =>
                game.revealed[i] ? type : null
            );
        } else {
            state.types = game.types.map((type, i) =>
                game.revealed[i] ? type : null
            );
            state.duetTypes = game.duetTypes?.map((type, i) =>
                game.revealed[i] ? type : null
            );
        }
    } else {
        if (isSpymaster || game.gameOver) {
            state.types = game.types;
        } else {
            state.types = game.types.map((type, i) =>
                game.revealed[i] ? type : null
            );
        }
    }

    // Match mode: card scores visibility
    if (isMatch && game.cardScores) {
        if (isSpymaster || game.gameOver) {
            // Spymasters see all card scores; everyone sees all after game over
            state.cardScores = game.cardScores;
        } else {
            // Non-spymasters only see scores of revealed cards
            state.cardScores = game.cardScores.map((score, i) =>
                game.revealed[i] ? score : null
            );
        }
    }

    return state;
}

