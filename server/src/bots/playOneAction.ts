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

function buildSpymasterView(game: GameState, team: 'red' | 'blue'): BotSpymasterView {
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
    };
}

function buildClickerView(game: GameState, seat: Player, team: 'red' | 'blue'): BotClickerView {
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
