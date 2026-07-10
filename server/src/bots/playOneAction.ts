/**
 * The pure decision chokepoint shared by the live botController and (Phase 2)
 * the headless harness. Given a game, a bot seat, the resolved strategy, and a
 * context, it builds the role-filtered view and returns a single BotAction.
 *
 * No IO: it only reads the in-memory game and calls the (pure) strategy. The
 * clicker view is built via getGameStateForPlayer so the masking that hides
 * unrevealed card types is the SAME logic the server uses for human clients —
 * the spymaster view is the unmasked truth (the bot legitimately sees all).
 */
import type { GameState, Player, CardType } from '../types';
import type { GameMode } from '../shared/gameRules';
import { getGameStateForPlayer } from '../services/game/revealEngine';
import type { SemanticBackend } from './semantics/backend';
import { buildTargeting, clueCandidateQueries } from './strategies/spymasters';
import type {
    BotAction,
    BotClickerView,
    BotContext,
    BotSpymasterView,
    ClickerStrategy,
    SpymasterStrategy,
} from './strategies/types';

function gameModeOf(game: GameState): GameMode {
    return (game.gameMode as GameMode) ?? 'classic';
}

export function buildSpymasterView(game: GameState, team: 'red' | 'blue'): BotSpymasterView {
    const mode = gameModeOf(game);
    // In Duet each side has its own key card: types[] is the side-A (red)
    // perspective (its greens encoded as 'red'), duetTypes[] is the side-B (blue)
    // perspective (its greens encoded as 'blue'). Mirror getGameStateForPlayer's
    // per-team split so the blue spymaster groups its OWN greens/assassins rather
    // than red's — otherwise it finds zero own cards and never clues meaningfully.
    const types = mode === 'duet' && team === 'blue' ? (game.duetTypes ?? game.types) : game.types;
    return {
        role: 'spymaster',
        team,
        gameMode: mode,
        words: game.words,
        revealed: game.revealed,
        types,
        currentTurn: game.currentTurn,
        // Spymasters see the full board, including match-mode point values.
        cardScores: game.cardScores,
    };
}

export function buildClickerView(game: GameState, seat: Player, team: 'red' | 'blue'): BotClickerView {
    const masked = getGameStateForPlayer(game, seat);
    const clue = game.currentClue
        ? { word: game.currentClue.word, number: game.currentClue.number, team: game.currentClue.team }
        : null;
    return {
        role: 'clicker',
        team,
        gameMode: gameModeOf(game),
        words: game.words,
        revealed: game.revealed,
        types: (masked?.types ?? game.revealed.map(() => null)) as readonly (CardType | null)[],
        currentTurn: game.currentTurn,
        currentClue: clue,
        guessesUsed: game.guessesUsed ?? 0,
        guessesAllowed: game.guessesAllowed ?? 0,
    };
}

/**
 * Warm the semantic backend's nearest() cache for the clue queries a spymaster
 * decision is about to make, yielding the event loop between chunks (E4). The
 * subsequent SYNC playOneAction → chooseClue → generateClueCandidates then hits
 * the warm cache instead of running up to 16 full-vocabulary scans inline. A
 * no-op unless the backend implements prewarm (only the vectors backend does) and
 * the seat is a spymaster with own cards. Its query list comes from the same
 * clueCandidateQueries generateClueCandidates uses, so it can never drift.
 */
export async function prewarmSpymasterClues(
    game: GameState,
    team: 'red' | 'blue',
    backend: SemanticBackend
): Promise<void> {
    if (!backend.prewarm || !backend.nearest) return;
    const view = buildSpymasterView(game, team);
    // buildTargeting is the SAME helper chooseClue uses to derive the targetable
    // groups (incl. G1 closing-trap admission), so the prewarmed keys match the
    // live scan exactly — including the trap-bridging queries the closing case
    // needs. Using groupBoard() alone here would drift from the strategy.
    const queries = clueCandidateQueries(buildTargeting(view).groups, backend);
    if (queries.length > 0) await backend.prewarm(queries);
}

export function playOneAction(
    game: GameState,
    seat: Player,
    strategy: SpymasterStrategy | ClickerStrategy,
    ctx: BotContext
): BotAction {
    if (!seat.team) return { kind: 'noop' };
    const team = seat.team;

    if (seat.role === 'spymaster' && 'chooseClue' in strategy) {
        return strategy.chooseClue(buildSpymasterView(game, team), ctx);
    }
    if (seat.role === 'clicker' && 'chooseGuess' in strategy) {
        return strategy.chooseGuess(buildClickerView(game, seat, team), ctx);
    }
    return { kind: 'noop' };
}
