/**
 * Sense enumeration + frame doubt (Phase 4.1 of docs/BOT_NUANCE_PLAN.md,
 * ledger lesson 20 — frame monopolization and its tell).
 *
 * The clue-capitalization house rule makes senses ENUMERABLE from outside the
 * backend: a mixed-case clue forces the proper-reference reading and an
 * all-lowercase clue forces the common reading, so probing the same clue in
 * the flipped case scores the other sense. The frame-doubt tell is uniform
 * weakness: when the given reading's best fit on the live board is below
 * FRAME_DOUBT_FLOOR while the flipped reading clears FRAME_SWITCH_BAR on at
 * least two candidates, the guesser's frame — not the board — is the problem,
 * and a disciplined clicker re-ranks under the other sense instead of
 * spending guesses inside a frame that explains nothing (the round-3 human
 * did exactly this: handed "Tinder" with no app-related cards in sight, they
 * read tinder → fire → TORCH).
 */
import { clueRetrieval, type SemanticBackend } from '../semantics/backend';
import { caseSignal } from '../semantics/properAssociations';

/** Below this best-fit, the given reading explains nothing on this board. */
export const FRAME_DOUBT_FLOOR = 0.35;
/** The alternate sense must carry REAL signal to switch to it… */
export const FRAME_SWITCH_BAR = 0.5;
/** …on at least this many live candidates for the INITIAL switch (one hit
 *  could be coincidence). Mid-clue the caller lowers this to 1: once guesses
 *  are spent and the given frame still explains nothing, a single strong
 *  alternate candidate is the continuation of the working frame — otherwise
 *  consuming the first switched-frame card would un-switch the frame and
 *  strand its remaining targets. */
export const FRAME_SWITCH_MIN_CANDIDATES = 2;

export interface ClueFrame {
    /** The clue word to score with — the given word, or its case-flipped
     *  alternate sense when the frame switched. */
    readonly word: string;
    readonly switched: boolean;
}

/**
 * Resolve which sense of the clue to guess under, given the unrevealed board
 * words. Deterministic and stateless: every tick re-derives the same frame
 * from the same view, so the switch needs no cross-guess state. Neutral
 * (ALL-CAPS / legacy) clues never switch — backends already read those both
 * ways, so the flip could add nothing.
 */
export function resolveClueFrame(
    clueWord: string,
    candidates: readonly string[],
    backend: SemanticBackend,
    minStrong: number = FRAME_SWITCH_MIN_CANDIDATES
): ClueFrame {
    const sig = caseSignal(clueWord);
    if (candidates.length === 0 || (sig !== 'proper' && sig !== 'common')) {
        return { word: clueWord, switched: false };
    }
    const bestGiven = Math.max(...candidates.map((w) => clueRetrieval(backend, clueWord, w)));
    if (bestGiven >= FRAME_DOUBT_FLOOR) return { word: clueWord, switched: false };

    // The flipped sense. proper → lowercase is exact (the common reading);
    // common → Title-case is a heuristic probe that hits ordinary reference
    // keys ("Cinderella") and misses intercap/acronym forms ("iPhone",
    // "NASA") — acceptable: a missed probe just means no switch.
    const alternate =
        sig === 'proper' ? clueWord.toLowerCase() : clueWord.charAt(0).toUpperCase() + clueWord.slice(1).toLowerCase();
    const altScores = candidates.map((w) => clueRetrieval(backend, alternate, w));
    const strong = altScores.filter((s) => s >= FRAME_SWITCH_BAR).length;
    if (strong >= Math.max(1, minStrong) && Math.max(...altScores) > bestGiven) {
        return { word: alternate, switched: true };
    }
    return { word: clueWord, switched: false };
}
