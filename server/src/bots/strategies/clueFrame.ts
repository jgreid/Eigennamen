/**
 * Sense enumeration + frame doubt (Phase 4.1 of docs/BOT_NUANCE_PLAN.md,
 * ledger lesson 20 — frame monopolization and its tell).
 *
 * The clue-capitalization house rule makes senses ENUMERABLE from outside the
 * backend: a mixed-case clue forces the proper-reference reading and an
 * all-lowercase clue forces the common reading, so probing the same clue in
 * the flipped case scores the other sense. The frame-doubt tell is uniform
 * weakness: when the given reading's best fit on the live board is below the
 * doubt floor while the flipped reading clears FRAME_SWITCH_BAR on enough
 * candidates, the guesser's frame — not the board — is the problem, and a
 * disciplined clicker re-ranks under the other sense instead of spending
 * guesses inside a frame that explains nothing (the round-3 human did exactly
 * this: handed "Tinder" with no app-related cards in sight, they read
 * tinder → fire → TORCH).
 */
import { clueRetrieval, type SemanticBackend } from '../semantics/backend';
import { caseSignal } from '../semantics/properAssociations';
import type { BotClickerView } from './types';

/** Below this best-fit, the given reading explains nothing on this board
 *  (initial decision, no guesses spent). */
export const FRAME_DOUBT_FLOOR = 0.35;
/**
 * Mid-clue the doubt floor drops to the spymaster's PROMISE_FLOOR (0.3,
 * spymasters.ts): a tail card the spymaster could legitimately promise must
 * never be doubted away from a delivering clue. With the 0.35 floor applied
 * mid-clue, a sound "Cinderella 2" whose promised second card fit 0.32 was
 * hijacked into the common sense — a channel the clue's assassin gate never
 * evaluated (correctness-review finding, runtime-reproduced).
 */
export const MID_CLUE_DOUBT_FLOOR = 0.3;
/** The alternate sense must carry REAL signal to switch to it… */
export const FRAME_SWITCH_BAR = 0.5;
/** …on at least this many live candidates (one hit could be coincidence). */
export const FRAME_SWITCH_MIN_CANDIDATES = 2;

export interface ClueFrame {
    /** The clue word to score with — the given word, or its case-flipped
     *  alternate sense when the frame switched. */
    readonly word: string;
    readonly switched: boolean;
}

/** Optional decision context for mid-clue continuation. */
export interface FrameContext {
    /** Guesses already spent under this clue (0 / absent = initial decision). */
    readonly guessesUsed?: number;
    /** Own-team cards already revealed. Continuation EVIDENCE: within a live
     *  clue every prior guess was a success, so a revealed own card that fits
     *  the alternate sense strongly means the switched frame was already in
     *  play — then a single strong leftover candidate is continuation, not
     *  coincidence. Without such evidence the min-2 guard applies mid-clue
     *  exactly as it does initially (a delivering given frame must never be
     *  hijacked just because its strong cards were consumed first). */
    readonly revealedOwn?: readonly string[];
}

/**
 * Frame context from a clicker view. Own-card attribution follows the same
 * duet rule as the cliff estimate (clickers.ts): a duet clicker's masked
 * types[] is always the side-A key, so attribution works for one seat and not
 * the other — duet passes no evidence and mid-clue stays on the strict guard.
 */
export function frameContextFromView(view: BotClickerView): FrameContext {
    const revealedOwn: string[] = [];
    if (view.gameMode !== 'duet') {
        for (let i = 0; i < view.revealed.length; i++) {
            if (view.revealed[i] && view.types[i] === view.team) {
                revealedOwn.push(view.words[i] as string);
            }
        }
    }
    return { guessesUsed: view.guessesUsed, revealedOwn };
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
    context: FrameContext = {}
): ClueFrame {
    const sig = caseSignal(clueWord);
    if (candidates.length === 0 || (sig !== 'proper' && sig !== 'common')) {
        return { word: clueWord, switched: false };
    }
    const midClue = (context.guessesUsed ?? 0) > 0;
    const doubtFloor = midClue ? MID_CLUE_DOUBT_FLOOR : FRAME_DOUBT_FLOOR;
    const bestGiven = Math.max(...candidates.map((w) => clueRetrieval(backend, clueWord, w)));
    if (bestGiven >= doubtFloor) return { word: clueWord, switched: false };

    // The flipped sense. proper → lowercase is exact (the common reading);
    // common → Title-case is a heuristic probe that hits ordinary reference
    // keys ("Cinderella") and misses intercap/acronym forms ("iPhone",
    // "NASA") — acceptable: a missed probe just means no switch.
    const alternate =
        sig === 'proper' ? clueWord.toLowerCase() : clueWord.charAt(0).toUpperCase() + clueWord.slice(1).toLowerCase();
    const altScores = candidates.map((w) => clueRetrieval(backend, alternate, w));
    const strong = altScores.filter((s) => s >= FRAME_SWITCH_BAR).length;
    // Mid-clue continuation needs EVIDENCE, not just elapsed guesses: a prior
    // success that fits the alternate sense strongly shows the switched frame
    // was already in play, and only then does one strong leftover suffice.
    const continuation =
        midClue && (context.revealedOwn ?? []).some((w) => clueRetrieval(backend, alternate, w) >= FRAME_SWITCH_BAR);
    const minStrong = continuation ? 1 : FRAME_SWITCH_MIN_CANDIDATES;
    if (strong >= minStrong && Math.max(...altScores) > bestGiven) {
        return { word: alternate, switched: true };
    }
    return { word: clueWord, switched: false };
}
