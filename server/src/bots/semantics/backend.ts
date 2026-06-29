/**
 * Pluggable semantic backend (§20 of the bots spec).
 *
 * A SemanticBackend scores how related two words are in [0, 1]. The default
 * `lexicalBackend` needs NO external assets — it uses character-bigram overlap
 * (Dice coefficient) as a floor heuristic. Phase 3 adds embedding-backed
 * implementations (ConceptNet Numberbatch, fastText subword) behind this same
 * interface; greedyClicker and the future embeddingSpymaster consume it without
 * change.
 */
import { normalizeClueWord } from '../../shared/gameRules';

export interface SemanticBackend {
    readonly id: string;
    /** Relatedness of two words in [0, 1]. */
    relatedness(a: string, b: string): number;
}

/** Character bigrams of an uppercased word (e.g. "FRUIT" -> FR,RU,UI,IT). */
function bigrams(word: string): string[] {
    const w = normalizeClueWord(word).replace(/\s+/g, '');
    if (w.length < 2) return w.length === 1 ? [w] : [];
    const out: string[] = [];
    for (let i = 0; i < w.length - 1; i++) {
        out.push(w.slice(i, i + 2));
    }
    return out;
}

/**
 * Lexical (orthographic) relatedness via the Sørensen–Dice coefficient over
 * character bigrams. Deterministic, asset-free, language-agnostic. This is a
 * weak proxy for true semantic association — it is the §20 "floor" fallback,
 * not a substitute for embeddings — but it makes greedyClicker deterministic
 * and runnable with no downloads.
 */
export const lexicalBackend: SemanticBackend = {
    id: 'lexical',
    relatedness(a: string, b: string): number {
        const ba = bigrams(a);
        const bb = bigrams(b);
        if (ba.length === 0 || bb.length === 0) return 0;
        // Multiset intersection size
        const counts = new Map<string, number>();
        for (const g of ba) counts.set(g, (counts.get(g) ?? 0) + 1);
        let overlap = 0;
        for (const g of bb) {
            const c = counts.get(g) ?? 0;
            if (c > 0) {
                overlap++;
                counts.set(g, c - 1);
            }
        }
        return (2 * overlap) / (ba.length + bb.length);
    },
};

/** The backend used when no semantic asset is configured. */
export const defaultSemanticBackend: SemanticBackend = lexicalBackend;
