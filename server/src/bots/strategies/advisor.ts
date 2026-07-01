/**
 * Advisor suggestions.
 *
 * An advisor bot sees exactly what a human clicker sees (the masked board + the
 * current clue) and produces a short, ranked list of suggested guesses with a
 * confidence and a one-line reason. It is ADVISORY ONLY — the human clicker still
 * makes every reveal — so this never returns a BotAction and never reveals.
 */
import type { BotClickerView } from './types';
import type { SemanticBackend } from '../semantics/backend';
import { defaultSemanticBackend } from '../semantics/backend';

export interface GuessSuggestion {
    /** Board index of the suggested card. */
    index: number;
    /** How strongly the card fits the clue, in [0, 1]. */
    confidence: number;
    /** Short human-readable rationale. */
    reason: string;
}

/**
 * Rank the unrevealed cards by relatedness to the current clue and return the top
 * few (bounded by the clue's remaining number) that carry a real signal. Empty
 * when there is no active clue or nothing looks related.
 */
export function suggestGuesses(
    view: BotClickerView,
    backend: SemanticBackend = defaultSemanticBackend,
    maxSuggestions = 3
): GuessSuggestion[] {
    const clue = view.currentClue;
    if (!clue) return [];

    const scored: Array<{ index: number; score: number }> = [];
    for (let i = 0; i < view.revealed.length; i++) {
        if (view.revealed[i]) continue;
        scored.push({ index: i, score: backend.relatedness(view.words[i] as string, clue.word) });
    }
    scored.sort((a, b) => b.score - a.score);

    // Never suggest more than the clue's remaining intended guesses.
    const remaining = clue.number > 0 ? Math.max(1, clue.number - view.guessesUsed) : scored.length;
    const limit = Math.min(maxSuggestions, remaining);

    const out: GuessSuggestion[] = [];
    for (const s of scored) {
        if (out.length >= limit || s.score <= 0) break;
        out.push({
            index: s.index,
            confidence: Math.round(Math.min(1, s.score) * 100) / 100,
            reason: `fits “${clue.word}”`,
        });
    }
    return out;
}
