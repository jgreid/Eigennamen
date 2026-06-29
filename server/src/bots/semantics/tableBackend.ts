/**
 * Association-table semantic backend (the §20 "baked table" path).
 *
 * Looks up the offline-baked ASSOCIATIONS table; for any pair it doesn't cover
 * it falls back to lexical similarity, so out-of-vocabulary / custom-list words
 * still produce a (weak) signal rather than nothing. The table's keys are the
 * spymaster's candidate clue vocabulary.
 */
import type { SemanticBackend } from './backend';
import { lexicalBackend } from './backend';
import { normalizeClueWord } from '../../shared/gameRules';
import { ASSOCIATIONS } from './associations';

/** Normalized lookup: clue -> set of related board words. */
const TABLE: Map<string, Set<string>> = new Map(
    Object.entries(ASSOCIATIONS).map(([clue, words]) => [
        normalizeClueWord(clue),
        new Set(words.map((w) => normalizeClueWord(w))),
    ])
);

export const tableBackend: SemanticBackend = {
    id: 'table',
    relatedness(a: string, b: string): number {
        const A = normalizeClueWord(a);
        const B = normalizeClueWord(b);
        if (A === B) return 1;
        // The table is keyed by clue word; check both orders.
        if (TABLE.get(A)?.has(B) || TABLE.get(B)?.has(A)) return 1;
        return lexicalBackend.relatedness(a, b);
    },
    vocabulary(): string[] {
        return [...TABLE.keys()];
    },
};
