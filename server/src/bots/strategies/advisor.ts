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
import { clueRetrieval, defaultSemanticBackend } from '../semantics/backend';
import { referenceSignal } from '../semantics/properAssociations';
import { resolveClueFrame, FRAME_DOUBT_FLOOR } from './clueFrame';

export interface GuessSuggestion {
    /** Board index of the suggested card. */
    index: number;
    /** How strongly the card fits the clue, in [0, 1]. */
    confidence: number;
    /** Short human-readable rationale. */
    reason: string;
    /** Optional caution flag (Phase 4.2 — the human-facing payoff of ledger
     *  lessons 11/15/18/19). DISCIPLINE RULE (failure G): warnings are FIXED
     *  strings derived only from the masked view, the clue, and public
     *  reveals — they must never name a board word or encode key information
     *  beyond the suggestion itself. */
    warning?: string;
}

/** Optional public context for warning triggers (never key information). */
export interface AdvisorContext {
    /** Own-team cards still unrevealed — public via the room score. Enables
     *  the late-game stretch warning. */
    ownRemaining?: number;
}

// Endgame slice for the late-stretch warning; mirrors the harness's
// ENDGAME_OWN_MAX (both live-play assassin hits were endgame events).
const ADVISOR_ENDGAME_OWN_MAX = 3;
// A suggestion this weak is a stretch, not a read (aligned with the clicker's
// CLIFF_ABS_CEILING band).
const STRETCH_SCORE_CEILING = 0.35;

// Fixed warning strings (failure-G discipline: no interpolation, ever).
const WARNING_FRAME_DOUBT =
    'The direct reading of the clue fits nothing here — these follow its other sense. Verify the frame before clicking.';
const WARNING_UNRESOLVED_REFERENCE =
    'Unfamiliar reference — consider type-level readings (a novel, a film, a brand) and stop early rather than stretch.';
const WARNING_LATE_STRETCH = 'Late-game stretch beyond the strong core — run the assassin check before touching this.';

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
    rng?: SeededRng,
    advisorCtx?: AdvisorContext
): GuessSuggestion[] {
    const clue = view.currentClue;
    if (!clue) return [];

    // Frame doubt (Phase 4.1, shared with the clicker): when the given
    // reading fits nothing and the case-flipped sense clears the bar, rank
    // under that sense — and say so. Mid-clue one strong alternate candidate
    // suffices (same continuation rule as the clicker).
    const unrevealedWords: string[] = [];
    for (let i = 0; i < view.revealed.length; i++) {
        if (!view.revealed[i]) unrevealedWords.push(view.words[i] as string);
    }
    const frame = resolveClueFrame(clue.word, unrevealedWords, backend, view.guessesUsed > 0 ? 1 : undefined);

    const scored: Scored[] = [];
    for (let i = 0; i < view.revealed.length; i++) {
        if (view.revealed[i]) continue;
        // clueRetrieval, not bare relatedness: the advisor advises a HUMAN
        // clicker, and a human's compound completion competes directly with
        // associative fit (same model as the greedy clicker).
        scored.push({ index: i, score: clueRetrieval(backend, frame.word, view.words[i] as string) });
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

    // Warning triggers, strongest first (one per suggestion). All derive only
    // from the masked view + public counts — never from key information.
    const bestFit = positive.length > 0 ? (positive[0] as Scored).score : 0;
    const unresolvedReference =
        !frame.switched && referenceSignal(clue.word) === 'proper' && bestFit < FRAME_DOUBT_FLOOR;
    const endgame = advisorCtx?.ownRemaining !== undefined && advisorCtx.ownRemaining <= ADVISOR_ENDGAME_OWN_MAX;
    const warningFor = (score: number): string | undefined => {
        if (frame.switched) return WARNING_FRAME_DOUBT;
        if (unresolvedReference) return WARNING_UNRESOLVED_REFERENCE;
        if (endgame && score < STRETCH_SCORE_CEILING) return WARNING_LATE_STRETCH;
        return undefined;
    };

    return picks.map((s) => {
        const warning = warningFor(s.score);
        const suggestion: GuessSuggestion = {
            index: s.index,
            confidence: Math.round(Math.min(1, s.score) * damp * 100) / 100,
            reason,
        };
        if (warning) suggestion.warning = warning;
        return suggestion;
    });
}
