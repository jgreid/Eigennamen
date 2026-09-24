/**
 * Guesser dry-run for bot clues (the fix for the verifier/guesser asymmetry —
 * see docs/BOT_LLM.md).
 *
 * The spymaster's margins, halos, and assassin berth are certified against the
 * SEMANTIC BACKEND's read of the board — but the guesser who acts on the clue
 * is the LLM clicker (or a human), whose reads are richer. Observed live, that
 * asymmetry has three faces:
 *  - assassin: ROUND passed the berth (backend 0.10 to REVOLUTION) and the LLM
 *    clicker took the assassin ("a revolution IS a round");
 *  - halos: NOVEL → HOBBIT (neutral, backend 0.17), DOLL → BUTTON (opponent,
 *    backend 0.07) — invisible to the gate, obvious to the guesser;
 *  - promise: LAUNDRY 2 covering WASHER+BUTTON is real to any human, but the
 *    backend scores the tail 0.04, so the trim collapsed clue after clue to 1
 *    (the "1-clue treadmill", worst against human clickers whose unknown
 *    competence maximises the margins).
 *
 * The fix: after the spymaster picks its clue, make ONE extra LLM call — the
 * clicker's exact scoring call — on the chosen clue, and read the resulting
 * ranking with the key in hand:
 *  - assassin in reach of the guess grant (number+1) → VETO the clue (the
 *    caller burns the word and re-picks once);
 *  - the TOP read is a wrong card held with real confidence → VETO too: the
 *    first guess lands on it whatever the number says (a bounce ends the
 *    turn), so no trim can save the clue — it communicates the wrong card
 *    entirely (live: CURVE 2 for TRIANGLE+FORK, backend 0.41/0.29 over
 *    SHOULDER 0.14, and the clicker took red SHOULDER first);
 *  - an opponent/neutral card intruding inside the promise → TRIM the number
 *    to the clean own-card prefix;
 *  - a clean own-card prefix LONGER than the promise (each card carrying a
 *    real read) → RAISE the number to the prefix, which is what kills the
 *    1-clue treadmill.
 *
 * Every failure mode (advice disabled, timeout, malformed reply) leaves the
 * clue exactly as chosen — the dry-run can only refine, never stall. Duet is
 * exempt (its dual-key semantics don't fit the single-key walk).
 */
import type { BotClickerView } from '../strategies/types';
import { rankGuesses, llmAdviceConfig, type LLMAdviceConfig, type LLMAdviceRole } from './llmAdvice';
import { normalizeClueWord, CLUE_NUMBER_MAX } from '../../shared/gameRules';

/** A raise only ever promises cards the simulated guesser reads with real
 *  confidence — a cold board's argmax noise must not inflate the number. */
export const DRYRUN_RAISE_MIN_SCORE = 0.5;

/** A wrong card at the TOP of the ranking vetoes only when the guesser holds
 *  it with real confidence; a cold wrong argmax trims to 1 instead — burning
 *  the clue over simulation noise would cost re-picks for nothing. */
export const DRYRUN_MISREAD_VETO_MIN_SCORE = 0.5;

export type DryRunVetoReason = 'assassin' | 'misread';

export interface DryRunAdjustment {
    /** The refined promise. Meaningless when veto is true. */
    readonly number: number;
    /** Do not give this clue: the assassin sits inside the guess grant, or
     *  the guesser's confident top read is a wrong card (reason says which). */
    readonly veto: boolean;
    readonly reason?: DryRunVetoReason;
}

/** Human-readable veto cause for the driver's log line. */
export function describeDryRunVeto(adjustment: DryRunAdjustment): string {
    return adjustment.reason === 'misread'
        ? "the guesser's top read is a wrong card"
        : "the assassin is in the guesser's reach";
}

export interface DryRunBoard {
    readonly words: readonly string[];
    readonly revealed: readonly boolean[];
    /** The REAL key — the spymaster legitimately holds it. */
    readonly types: readonly (string | null)[];
    readonly team: string;
}

/**
 * Refine a chosen clue's number from the simulated guesser's ranking.
 * Pure — the LLM call happens in dryRunChosenClue below.
 */
export function adjustClueFromDryRun(
    board: DryRunBoard,
    scores: ReadonlyMap<string, number>,
    number: number
): DryRunAdjustment {
    // Rank the unrevealed cards the way the greedy clicker will: by the
    // guesser's score, descending (ties break to board order, matching the
    // clicker's stable argmax scan).
    const ranked: Array<{ index: number; score: number }> = [];
    let ownRemaining = 0;
    for (let i = 0; i < board.words.length; i++) {
        if (board.revealed[i]) continue;
        if (board.types[i] === board.team) ownRemaining++;
        ranked.push({ index: i, score: scores.get(normalizeClueWord(board.words[i] as string)) ?? 0 });
    }
    ranked.sort((a, b) => b.score - a.score);

    // Walk the ranking: the clean own-card prefix, the strong clean prefix
    // (raise-eligible), and where the assassin sits.
    let cleanPrefix = 0;
    let strongCleanPrefix = 0;
    let assassinRank = Infinity;
    for (let r = 0; r < ranked.length; r++) {
        const entry = ranked[r] as { index: number; score: number };
        const type = board.types[entry.index];
        if (type === 'assassin' && r < assassinRank) assassinRank = r;
        if (r === cleanPrefix && type === board.team) {
            cleanPrefix++;
            if (r === strongCleanPrefix && entry.score >= DRYRUN_RAISE_MIN_SCORE) strongCleanPrefix++;
        }
    }

    // The engine grants number+1 guesses, so the assassin is in reach whenever
    // its rank is <= number. Trimming can move it out of reach only while a
    // clean guess remains ahead of it; assassin at rank 0 or 1 is unfixable.
    if (assassinRank <= 1) return { number, veto: true, reason: 'assassin' };

    // A confidently wrong TOP read is equally unfixable by number: the first
    // guess lands on it regardless of the promise and the bounce ends the
    // turn, so the clue communicates the wrong card entirely. (An assassin on
    // top was already vetoed above with the graver reason.)
    if (cleanPrefix === 0 && (ranked[0]?.score ?? 0) >= DRYRUN_MISREAD_VETO_MIN_SCORE) {
        return { number, veto: true, reason: 'misread' };
    }

    let refined = Math.max(number, strongCleanPrefix); // raise
    refined = Math.min(refined, Math.max(1, cleanPrefix)); // trim to the clean prefix
    refined = Math.min(refined, assassinRank - 1); // keep the +1 grant short of the assassin
    refined = Math.min(refined, ownRemaining, CLUE_NUMBER_MAX);
    return { number: Math.max(1, refined), veto: false };
}

/** The dry-run bills to whichever seat has a model: the spymaster's (it is
 *  part of the spymaster's decision) with the clicker's as fallback, so a
 *  clicker-only LLM setup still gets its clues verified. */
export function dryRunAdviceConfig(): LLMAdviceConfig {
    const roles: LLMAdviceRole[] = ['spymaster', 'clicker'];
    for (const role of roles) {
        const cfg = llmAdviceConfig(role);
        if (cfg.model) return cfg;
    }
    return llmAdviceConfig();
}

/**
 * Simulate the guesser on a chosen clue and refine its number. Null scores
 * (advice off, timeout, refusal) return the clue unchanged — never throws.
 */
export async function dryRunChosenClue(board: DryRunBoard, word: string, number: number): Promise<DryRunAdjustment> {
    const cfg = dryRunAdviceConfig();
    if (!cfg.model) return { number, veto: false };
    const view = {
        role: 'clicker',
        team: board.team,
        gameMode: 'classic',
        words: [...board.words],
        revealed: [...board.revealed],
        types: board.words.map(() => null),
        currentTurn: board.team,
        currentClue: { word, number, team: board.team },
        guessesUsed: 0,
        guessesAllowed: number > 0 ? number + 1 : 0,
    } as unknown as BotClickerView;
    const scores = await rankGuesses(view, cfg);
    if (!scores) return { number, veto: false };
    return adjustClueFromDryRun(board, scores, number);
}
