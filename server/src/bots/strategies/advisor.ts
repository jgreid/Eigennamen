/**
 * Advisor suggestions.
 *
 * An advisor bot sees exactly what a human clicker sees (the masked board + the
 * current clue) and produces a short, ranked list of suggested guesses with a
 * confidence and a one-line reason. It is ADVISORY ONLY — the human clicker still
 * makes every reveal — so this never returns a BotAction and never reveals.
 *
 * The advisor honours its skill preset: a strong ("scary good") advisor picks the
 * best-fitting cards with full confidence; a weaker ("off-kilter but sensible")
 * one samples among plausible cards and reports dampened confidence, so a host can
 * seat anything from a reliable coach to a loose second opinion.
 */
import type { BotClickerView, SkillParams, SeededRng } from './types';
import type { SemanticBackend } from '../semantics/backend';
import { defaultSemanticBackend } from '../semantics/backend';
import { referenceSignal } from '../semantics/properAssociations';

export interface GuessSuggestion {
    /** Board index of the suggested card. */
    index: number;
    /** How strongly the card fits the clue, in [0, 1]. */
    confidence: number;
    /** Short human-readable rationale. */
    reason: string;
}

interface Scored {
    index: number;
    score: number;
}

/** Sample `k` distinct items by softmax over score, hottest-first-ish. */
function sampleWithoutReplacement(items: Scored[], k: number, temperature: number, rng: SeededRng): Scored[] {
    const pool = [...items];
    const picks: Scored[] = [];
    while (picks.length < k && pool.length > 0) {
        const maxScore = pool.reduce((m, p) => (p.score > m ? p.score : m), -Infinity);
        const weights = pool.map((p) => Math.exp((p.score - maxScore) / temperature));
        const total = weights.reduce((a, w) => a + w, 0);
        let r = rng.next() * total;
        let idx = pool.length - 1;
        for (let i = 0; i < pool.length; i++) {
            r -= weights[i] as number;
            if (r <= 0) {
                idx = i;
                break;
            }
        }
        picks.push(pool[idx] as Scored);
        pool.splice(idx, 1);
    }
    return picks;
}

/**
 * Rank the unrevealed cards by relatedness to the current clue and return the top
 * few (bounded by the clue's remaining number) that carry a real signal. Empty
 * when there is no active clue or nothing looks related.
 *
 * When `skill`/`rng` are supplied and the skill's temperature is positive, the
 * selection is softmax-sampled (a weaker advisor may surface a plausible-but-
 * suboptimal card) and the reported confidence is dampened; otherwise it is a
 * deterministic top-N at full confidence.
 */
export function suggestGuesses(
    view: BotClickerView,
    backend: SemanticBackend = defaultSemanticBackend,
    maxSuggestions = 3,
    skill?: SkillParams,
    rng?: SeededRng
): GuessSuggestion[] {
    const clue = view.currentClue;
    if (!clue) return [];

    const scored: Scored[] = [];
    for (let i = 0; i < view.revealed.length; i++) {
        if (view.revealed[i]) continue;
        scored.push({ index: i, score: backend.relatedness(view.words[i] as string, clue.word) });
    }
    scored.sort((a, b) => b.score - a.score);

    // Never suggest more than the clue's remaining intended guesses.
    const remaining = clue.number > 0 ? Math.max(1, clue.number - view.guessesUsed) : scored.length;
    const limit = Math.min(maxSuggestions, remaining);
    const positive = scored.filter((s) => s.score > 0);

    const temperature = skill?.temperature ?? 0;
    const picks =
        temperature > 0 && rng && positive.length > limit
            ? sampleWithoutReplacement(positive, limit, temperature, rng)
            : positive.slice(0, limit);

    // A less confident advisor visibly hedges its confidence. A mixed-case clue
    // carries the house-rule proper-noun signal, so the advisor says which
    // reading its suggestions follow.
    const damp = 1 - Math.min(0.5, temperature * 0.25);
    const reason =
        referenceSignal(clue.word) === 'proper' ? `fits “${clue.word}” (the reference)` : `fits “${clue.word}”`;
    return picks.map((s) => ({
        index: s.index,
        confidence: Math.round(Math.min(1, s.score) * damp * 100) / 100,
        reason,
    }));
}
