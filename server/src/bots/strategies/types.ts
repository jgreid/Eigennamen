/**
 * Bot strategy contracts.
 *
 * Strategies are PURE and synchronous: given a role-filtered view and a context
 * (which carries a seeded RNG and skill knobs), they return a single BotAction.
 * They must never touch Redis, sockets, or async IO — the controller/harness
 * owns all side effects. Views are structural subsets of the existing
 * PlayerGameState, built by playOneAction via getGameStateForPlayer, so no new
 * board-masking logic is introduced.
 */
import type { CardType, Team } from '../../types';
import type { GameMode } from '../../shared/gameRules';

/** Deterministic per-decision RNG (Mulberry32-backed). Every random draw a
 *  strategy makes MUST flow through this so (gameSeed, botSeed) is reproducible. */
export interface SeededRng {
    /** float in [0, 1) */
    next(): number;
    /** integer in [0, n) */
    int(n: number): number;
}

/** Typed skill knobs — pure data. Adding a difficulty is a new preset only. */
export interface SkillParams {
    /** 0 = always pick the argmax (strongest); higher = more exploration. */
    temperature: number;
    /** probability of an outright random legal move (weak-player model). */
    blunderRate: number;
    /** clicker stop-vs-continue aggressiveness (0 = reckless, 1 = very cautious). */
    riskAversion: number;
    /** seeds the per-bot SeededRng. */
    seed: number;
}

/** Immutable context passed to every decision. */
export interface BotContext {
    readonly gameMode: GameMode;
    readonly skill: SkillParams;
    readonly rng: SeededRng;
}

/** A clue that has been given this turn (clicker view). */
export interface BotClue {
    readonly word: string;
    readonly number: number;
    readonly team: Team;
}

/** Spymaster's view: full unmasked types[]. */
export interface BotSpymasterView {
    readonly role: 'spymaster';
    readonly team: Team;
    readonly gameMode: GameMode;
    readonly words: readonly string[];
    readonly revealed: readonly boolean[];
    readonly types: readonly CardType[]; // unmasked
    readonly currentTurn: Team;
}

/** Clicker's view: types[] masked to null for unrevealed cards. */
export interface BotClickerView {
    readonly role: 'clicker';
    readonly team: Team;
    readonly gameMode: GameMode;
    readonly words: readonly string[];
    readonly revealed: readonly boolean[];
    readonly types: readonly (CardType | null)[]; // null = hidden
    readonly currentTurn: Team;
    readonly currentClue: BotClue | null;
    readonly guessesUsed: number;
    readonly guessesAllowed: number; // 0 = unlimited
}

/** One variant per legal move; maps 1:1 to a game action. */
export type BotAction =
    | { kind: 'clue'; word: string; number: number }
    | { kind: 'reveal'; index: number }
    | { kind: 'endTurn' }
    | { kind: 'noop' };

export interface SpymasterStrategy {
    readonly strategyId: string;
    chooseClue(view: BotSpymasterView, ctx: BotContext): BotAction;
}

export interface ClickerStrategy {
    readonly strategyId: string;
    chooseGuess(view: BotClickerView, ctx: BotContext): BotAction;
}

/** Registry entry. Adding a bot type = one entry in registry.ts. */
export interface StrategyFactory {
    readonly strategyId: string;
    /** Human-readable label (used to build default bot nicknames). */
    readonly label: string;
    makeSpymaster?(skill: SkillParams): SpymasterStrategy;
    makeClicker?(skill: SkillParams): ClickerStrategy;
}

/** Persisted per-bot descriptor (Redis key bot:{sessionId}:cfg). */
export interface BotConfig {
    readonly strategyId: string;
    readonly skillPreset: string;
    readonly seed: number;
}
