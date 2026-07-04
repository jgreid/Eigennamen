/**
 * Association-table semantic backend (the §20 "baked table" path).
 *
 * Looks up the offline-baked ASSOCIATIONS table. Relatedness is GRADED rather
 * than a hard 0/1 so both sides of the clue channel behave more naturally:
 *
 *  - A direct clue→board-word entry (either lookup order) scores 1 — the strong,
 *    intended signal a concept clue carries.
 *  - Otherwise, two words that co-occur in one or more concept groups get a
 *    partial score that grows with the number of shared concepts. This is what
 *    lets a bot clicker make sense of a HUMAN clue that isn't itself a table key
 *    (e.g. clue BEAR → ranks LION/HORSE, which share ANIMAL/MAMMAL/WILD), and
 *    gives the greedy clicker graded — not perfectly deterministic — rankings.
 *  - Anything the table can't relate falls back to lexical (orthographic)
 *    similarity, so out-of-vocabulary / custom-list words still produce a weak
 *    signal rather than nothing.
 *
 * Case signal (house rule, see properAssociations.ts): a mixed-case clue
 * ("Alien") denotes the specific proper-noun reference and reads from the
 * PROPER_ASSOCIATIONS table — related words score full, everything else is
 * dampened to lexical noise, because the reference sense deliberately EXCLUDES
 * the common sense. An all-lowercase clue ("alien") explicitly means the
 * common sense and never reads the proper table. Legacy ALL-CAPS clues carry
 * no signal and take the best of both readings — EXCEPT an exact match of a
 * canonical all-caps reference key ("NASA", "CIA"), which carries the proper
 * signal: case matters for each letter, and an acronym's canonical case is
 * its signal.
 *
 * The table's keys — common concepts plus display-cased proper references —
 * are the spymaster's candidate clue vocabulary.
 */
import type { SemanticBackend } from './backend';
import { lexicalBackend } from './backend';
import { normalizeClueWord } from '../../shared/gameRules';
import { ASSOCIATIONS } from './associations';
import { buildAssociationIndex, scoreCommonAssociation } from './associationIndex';
import {
    PROPER_ASSOCIATIONS,
    PROPER_RIVALS,
    PROPER_HYPERNYMS,
    PROPER_FAME,
    DEFAULT_PROPER_FAME,
    caseSignal,
    referenceSignal,
} from './properAssociations';

/** Concept table + inverted membership index (see associationIndex.ts). */
const INDEX = buildAssociationIndex(ASSOCIATIONS);

/** Weighted proper-reference index: key → contents with per-edge weights
 *  (1 for the classic plain entries, curated lower for second-tier pulls like
 *  Tinder → GOLD). Only the direct-edge lookups are used — references have no
 *  co-membership semantics. */
const PROPER_INDEX = buildAssociationIndex(PROPER_ASSOCIATIONS);

/** Normalized key → display-case key ("CINDERELLA" → "Cinderella"): the case
 *  the spymaster must EMIT for the clue to carry the proper-noun signal. */
const PROPER_DISPLAY: Map<string, string> = new Map(
    Object.keys(PROPER_ASSOCIATIONS).map((key) => [normalizeClueWord(key), key])
);

/** Normalized key → fame (recognizability prior for commonness()). */
const PROPER_FAME_NORM: Map<string, number> = new Map(
    Object.keys(PROPER_ASSOCIATIONS).map((key) => [normalizeClueWord(key), PROPER_FAME[key] ?? DEFAULT_PROPER_FAME])
);

/** Normalized rival lookup: key → rivals with normalized weighted contents. */
const RIVAL_TABLE: Map<string, Array<{ fame: number; contents: Map<string, number> }>> = new Map(
    Object.entries(PROPER_RIVALS).map(([key, rivals]) => [
        normalizeClueWord(key),
        rivals.map((r) => ({
            fame: r.fame,
            contents: new Map(
                r.contents.map((t) =>
                    typeof t === 'string' ? [normalizeClueWord(t), 1] : [normalizeClueWord(t.word), t.weight ?? 1]
                )
            ),
        })),
    ])
);

/** Normalized hypernym lookup: key → type-level board words. */
const HYPERNYM_TABLE: Map<string, Set<string>> = new Map(
    Object.entries(PROPER_HYPERNYMS).map(([key, words]) => [
        normalizeClueWord(key),
        new Set(words.map((w) => normalizeClueWord(w))),
    ])
);

/** A proper-noun reference clue that misses still carries SOME orthographic
 *  noise, but dampened — the reference sense excludes the common sense. */
const PROPER_MISS_DAMP = 0.5;

/** Type-level reading of a reference ("Thunderball" → NOVEL): real but weak —
 *  below every content match, above the promise floor (exemplar asymmetry,
 *  ledger lesson 7). */
const HYPERNYM_SCORE = 0.55;

/**
 * Best reading of `other` under a KNOWN reference key (both normalized):
 * a content edge at its curated weight, the type-level hypernym, or a rival
 * referent's content pull scaled by the rival's fame — "Apollo" reaches
 * FIGHTER through Apollo Creed for every guesser who lands on the rival
 * first, and the spymaster's margin machinery must see that pull (ledger
 * lessons 7/10/19). Returns 0 when the reference says nothing about `other`.
 */
function knownReferenceReading(refKey: string, other: string): number {
    let best = PROPER_INDEX.table.get(refKey)?.get(other)?.weight ?? 0;
    if (HYPERNYM_TABLE.get(refKey)?.has(other)) best = Math.max(best, HYPERNYM_SCORE);
    for (const rival of RIVAL_TABLE.get(refKey) ?? []) {
        const w = rival.contents.get(other);
        if (w !== undefined) best = Math.max(best, w * rival.fame);
    }
    return best;
}

/** Best proper reading of a pair with either side as the reference key. */
function properReading(a: string, b: string): number {
    const A = normalizeClueWord(a);
    const B = normalizeClueWord(b);
    let best = 0;
    if (PROPER_INDEX.table.has(A)) best = knownReferenceReading(A, B);
    if (PROPER_INDEX.table.has(B)) best = Math.max(best, knownReferenceReading(B, A));
    return best;
}

/** The common-sense reading: concept table → co-membership → lexical floor. */
function commonRelatedness(a: string, b: string): number {
    return scoreCommonAssociation(INDEX, a, b) ?? lexicalBackend.relatedness(a, b);
}

export const tableBackend: SemanticBackend = {
    id: 'table',
    relatedness(a: string, b: string): number {
        if (normalizeClueWord(a) === normalizeClueWord(b)) return 1;

        const aSig = referenceSignal(a);
        const bSig = referenceSignal(b);
        // An explicit lowercase word is the common sense, PERIOD — the clue
        // side of the convention outranks any reference reading of its partner
        // (board words are never lowercase, so a 'common' signal always comes
        // from the clue).
        if (aSig === 'common' || bSig === 'common') return commonRelatedness(a, b);
        // Mixed case = the house-rule signal for a specific reference (or the
        // exact canonical form of an all-caps acronym like NASA — "case
        // matters for each letter").
        if (aSig === 'proper' || bSig === 'proper') {
            const reference = aSig === 'proper' ? a : b;
            const other = aSig === 'proper' ? b : a;
            const refKey = normalizeClueWord(reference);
            if (PROPER_INDEX.table.has(refKey)) {
                // "Alien" means the film, NOT anything foreign: contents score
                // their curated weight, type-level hypernyms and rival-referent
                // pulls their graded reading, everything else drops to dampened
                // lexical noise.
                const reading = knownReferenceReading(refKey, normalizeClueWord(other));
                if (reading > 0) return reading;
                return lexicalBackend.relatedness(a, b) * PROPER_MISS_DAMP;
            }
            // A reference this table doesn't know: read it like any other word
            // (graceful — a human guesser falls back the same way).
            return commonRelatedness(a, b);
        }
        // No signal (legacy ALL-CAPS): the best of both readings.
        return Math.max(commonRelatedness(a, b), properReading(a, b));
    },
    vocabulary(): string[] {
        // Common concept keys plus display-cased proper references — emitting a
        // reference verbatim ("Cinderella") is itself the case signal.
        return [...INDEX.table.keys(), ...PROPER_DISPLAY.values()];
    },
    commonness(word: string): number {
        // Fame prior for proper references ("only clue culture references the
        // guessers are going to know"): feeds the spymaster's rarity penalty,
        // scaled by the persona's commonnessBias. An explicit lowercase word is
        // the common sense, never judged as a reference. (caseSignal, not
        // referenceSignal: fame keys off the table membership itself here.)
        const fame = PROPER_FAME_NORM.get(normalizeClueWord(word));
        if (fame !== undefined && caseSignal(word) !== 'common') return fame;
        return 1;
    },
};
