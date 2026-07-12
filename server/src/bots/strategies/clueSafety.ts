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

// Spelling-variant tier — the "red flag" rule. A clue that is the SAME WORD as
// a board word in a different costume (CREME↔CREAM, GREY↔GRAY,
// THEATRE↔THEATER, TEETH↔TOOTH) is legal by the substring/stem letter of
// isClueLegalForBoard but sparks a table argument every time; the official
// rulebook bans spelling variants outright ("English has three ways to spell
// gray — you can't use any of them"). The mechanical fingerprint that separates
// a variant from a genuinely distinct look-alike (PLANT↔PLANE, GLASS↔GRASS,
// BEACH↔BENCH): variants keep the SAME CONSONANT SKELETON — only vowels change
// or move — within a tiny edit budget. Distinct words differ in a consonant.
// Bot-side only: dropping the occasional false positive costs the spymaster one
// candidate among thousands, and humans keep the looser shared rule (edge cases
// belong to the table, per the rulebook).
const VARIANT_MIN_LEN = 4;
const VARIANT_MAX_EDITS = 2;

/** The word with vowels removed (Y counts as a vowel so GREY/GRAY collapse). */
function consonantSkeleton(word: string): string {
    return word.replace(/[AEIOUY]/g, '');
}

/** Fold one trailing plural -S so CREMES still reads as a variant of CREAM.
 *  (A single S only: stripping -ES would mangle E-final words — CREMES is
 *  CREME+S, not CREM+ES.) */
function foldPlural(word: string): string {
    if (word.length > 3 && word.endsWith('S')) return word.slice(0, -1);
    return word;
}

/** Same word in a different costume, compared plural-folded. Two shapes:
 *  (1) same length + same first letter + same consonant skeleton + tiny edit
 *      distance — vowels swapped or moved (CREME/CREAM, GREY/GRAY,
 *      THEATRE/THEATER, TEETH/TOOTH). Length must match: a vowel INSERTION
 *      usually makes a different word (PLANT→PLANET), not a variant.
 *  (2) the British/American -OUR/-OR ending swap (COLOUR/COLOR), the one
 *      common variant family that DOES change length. */
function isSpellingVariant(a: string, b: string): boolean {
    const x = foldPlural(a);
    const y = foldPlural(b);
    if (Math.min(x.length, y.length) < VARIANT_MIN_LEN) return false;
    if (
        x.length === y.length &&
        x[0] === y[0] &&
        consonantSkeleton(x) === consonantSkeleton(y) &&
        boundedLevenshtein(x, y, VARIANT_MAX_EDITS) <= VARIANT_MAX_EDITS
    ) {
        return true;
    }
    const ourOr = (p: string, q: string): boolean =>
        p.endsWith('OUR') && q.endsWith('OR') && p.slice(0, -3) === q.slice(0, -2);
    return ourOr(x, y) || ourOr(y, x);
}

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
    // Orthographic comparison targets: each board word as a whole, plus the
    // tokens (≥3 chars) of multi-word entries — CREME must be tested against
    // CREAM, not against "ICE CREAM", or the guards below are blind to
    // compound boards (the same token treatment isClueLegalForBoard applies).
    const foldedTargets: string[] = [];
    const seenTargets = new Set<string>();
    for (const w of boardWords) {
        const folded = foldDiacritics(w);
        const parts = folded.includes(' ') ? [folded, ...folded.split(/\s+/).filter((p) => p.length >= 3)] : [folded];
        for (const t of parts) {
            if (t.length > 0 && !seenTargets.has(t)) {
                seenTargets.add(t);
                foldedTargets.push(t);
            }
        }
    }
    return (clue: string): boolean => {
        const c = normalizeClueWord(clue);
        if (c.length === 0) return false;
        // (a) Foreign-script guard: a non-ASCII letter absent from the board means
        // the clue is from a language the board isn't in.
        for (const ch of c) {
            if (isNonAscii(ch) && !boardSpecials.has(ch)) return false;
        }
        const cf = foldDiacritics(clue);
        for (const bf of foldedTargets) {
            // (b) Near-duplicate cognate guard: a LONG word sharing a LONG root.
            if (
                Math.min(cf.length, bf.length) >= NEARDUP_MIN_LEN &&
                sharedPrefixLen(cf, bf) >= NEARDUP_PREFIX &&
                boundedLevenshtein(cf, bf, NEARDUP_MAX_EDITS) <= NEARDUP_MAX_EDITS
            ) {
                return false;
            }
            // (c) Spelling-variant guard (the "red flag" rule).
            if (isSpellingVariant(cf, bf)) return false;
        }
        return true;
    };
}

/** Single-clue board-safety check (see makeBoardSafetyCheck). Exported for
 *  direct testing; prefer the precomputed predicate when filtering a pool. */
export function isClueBoardSafe(clue: string, boardWords: readonly string[]): boolean {
    return makeBoardSafetyCheck(boardWords)(clue);
}
