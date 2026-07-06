// Candidate-quality board-safety filter (embeddings clue hygiene).
//
// Extracted from spymasters.ts (H3) to keep that file under the decomposition
// convention — this is the file-per-concern board-safety module. See
// docs/IMPROVEMENT_PLAN.md H3.
//
// A nearest()-generated clue pool drawn from a large model surfaces two classes
// of junk that pass isClueLegalForBoard (which only rejects exact/substring/stem
// collisions) yet are terrible clues in play:
//   1. Cross-language cognates / orthographic near-duplicates of a board word
//      (REVOLUCIÓN when REVOLUTION is on the board): non-substring, so legal, but
//      a guesser reads it straight back to the board word — a self-leak.
//   2. Foreign-script tokens the model happens to place near an own card, in a
//      language the board isn't even in (accented tokens on an English board).
// Both are caught here, board-derived so the test is language-agnostic: the
// allowed "special" (non-ASCII) letters are exactly those the board itself uses,
// so a Spanish board keeps its ñ/accents while an English board rejects them.

import { normalizeClueWord } from '../../shared/gameRules';

/** Diacritic-stripped uppercase form (NFD → drop combining marks → A–Z-ish). */
function foldDiacritics(word: string): string {
    return normalizeClueWord(word)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

/** Length of the shared leading run of two strings. */
function sharedPrefixLen(a: string, b: string): number {
    const n = Math.min(a.length, b.length);
    let i = 0;
    while (i < n && a[i] === b[i]) i++;
    return i;
}

/** Levenshtein distance, short-circuited once it exceeds `cap` (returns cap+1). */
function boundedLevenshtein(a: string, b: string, cap: number): number {
    if (Math.abs(a.length - b.length) > cap) return cap + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const curr = [i];
        let rowMin = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            const v = Math.min((prev[j] as number) + 1, (curr[j - 1] as number) + 1, (prev[j - 1] as number) + cost);
            curr[j] = v;
            if (v < rowMin) rowMin = v;
        }
        if (rowMin > cap) return cap + 1; // whole row already past the cap
        prev = curr;
    }
    return prev[b.length] as number;
}

// Near-duplicate thresholds — deliberately CONSERVATIVE. An orthographic test
// cannot tell a real cross-language cognate leak (REVOLUCION↔REVOLUTION) from an
// unrelated same-prefix look-alike (PLANT↔PLANE, CROWD↔CROWN, CHAIN↔CHAIR): both
// are one edit apart over a short shared prefix. Since dropping a good candidate
// is a real cost (a strong clue lost on any board that happens to hold the
// look-alike) and the primary target — accented foreign cognates — is already
// caught by the foreign-script guard above, the near-dup guard fires only on the
// unambiguous case: a LONG word (≥6) sharing a LONG root (prefix ≥6) within a
// tiny edit budget. That still catches REVOLUCION↔REVOLUTION and
// ORGANISATION↔ORGANIZATION while leaving every 4-letter-prefix look-alike alone.
const NEARDUP_MIN_LEN = 6;
const NEARDUP_PREFIX = 6;
const NEARDUP_MAX_EDITS = 2;

/** Only characters ABOVE the ASCII range signal a foreign script. ASCII
 *  punctuation (apostrophe, hyphen, period) inside a legitimate reference clue
 *  like "McDonald's" or "Spider-Man" must pass — it is not a language marker. */
function isNonAscii(ch: string): boolean {
    return ch.charCodeAt(0) > 127;
}

/**
 * Build a board-safety predicate, precomputing the board-derived data (the set
 * of non-ASCII letters the board itself uses, and the diacritic-folded board
 * words) ONCE so a whole candidate pool is filtered without rebuilding it per
 * clue. The returned predicate answers whether a clue is SAFE to offer beyond
 * bare legality: it neither (a) uses a non-ASCII letter absent from every board
 * word (a wrong-language token), nor (b) is an orthographic near-duplicate of a
 * board word (a cognate that leaks the word it resembles). Board-derived and
 * language-agnostic. Assumes the clue already passed isClueLegalForBoard.
 */
export function makeBoardSafetyCheck(boardWords: readonly string[]): (clue: string) => boolean {
    // Non-ASCII letters the board itself uses — the accents a same-language clue
    // is allowed to carry (ü on a German board, ñ on a Spanish one). Derived from
    // the 25 drawn words, not a per-language alphabet, so a locale clue whose one
    // accent happens to be absent from the drawn board is over-rejected — bounded
    // and only reachable via a prepared locale semantic map (lexical backends emit
    // no candidates); accepted over threading a language alphabet through.
    const boardSpecials = new Set<string>();
    for (const w of boardWords) {
        for (const ch of normalizeClueWord(w)) {
            if (isNonAscii(ch)) boardSpecials.add(ch);
        }
    }
    const foldedBoard = boardWords.map((w) => foldDiacritics(w));
    return (clue: string): boolean => {
        const c = normalizeClueWord(clue);
        if (c.length === 0) return false;
        // (a) Foreign-script guard: a non-ASCII letter absent from the board means
        // the clue is from a language the board isn't in.
        for (const ch of c) {
            if (isNonAscii(ch) && !boardSpecials.has(ch)) return false;
        }
        // (b) Near-duplicate guard on the diacritic-folded forms.
        const cf = foldDiacritics(clue);
        for (const bf of foldedBoard) {
            if (Math.min(cf.length, bf.length) < NEARDUP_MIN_LEN) continue;
            if (sharedPrefixLen(cf, bf) < NEARDUP_PREFIX) continue;
            if (boundedLevenshtein(cf, bf, NEARDUP_MAX_EDITS) <= NEARDUP_MAX_EDITS) return false;
        }
        return true;
    };
}

/** Single-clue board-safety check (see makeBoardSafetyCheck). Exported for
 *  direct testing; prefer the precomputed predicate when filtering a pool. */
export function isClueBoardSafe(clue: string, boardWords: readonly string[]): boolean {
    return makeBoardSafetyCheck(boardWords)(clue);
}
