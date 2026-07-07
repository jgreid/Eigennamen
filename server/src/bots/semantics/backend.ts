/**
 * Pluggable semantic backend (§20 of the bots spec).
 *
 * A SemanticBackend scores how related two words are in [0, 1]. The default
 * `lexicalBackend` needs NO external assets — it uses character-bigram overlap
 * (Dice coefficient) as a floor heuristic. Embedding-backed implementations
 * (ConceptNet Numberbatch, fastText subword — see vectorBackend.ts) sit behind
 * this same interface; greedyClicker and embeddingSpymaster consume any backend
 * unchanged.
 */
import { normalizeClueWord } from '../../shared/gameRules';

/**
 * How a clue retrieves a word — the concreteness gradient (ledger lesson 16):
 * contents > members/parts > compounds > function/attribute. A 'content' edge
 * is a thing vividly INSIDE the clue's frame (Cinderella → SLIPPER); 'member'
 * and 'part' are taxonomic (ANIMAL → BEAR, tree → BARK); 'compound' is phrase
 * formation (whip + lash); 'function' and 'attribute' are what a thing does or
 * is like — the weakest, most misfire-prone retrieval path.
 */
export type EdgeKind = 'content' | 'member' | 'part' | 'compound' | 'function' | 'attribute';

/**
 * Per-edge channel data (Phase 2 of docs/BOT_NUANCE_PLAN.md — the keystone
 * widening). `strength` mirrors relatedness for the direct edge; `kind` is the
 * concreteness class above; `penetration` is fame-of-fact (ledger lesson 14):
 * the fraction of guessers who retrieve THIS edge at table speed — distinct
 * from word commonness (Hooke is a word many know; Hooke→SPRING is an edge few
 * retrieve). All channels optional: absent data must read as "no adjustment".
 */
export interface EdgeInfo {
    strength: number;
    kind?: EdgeKind;
    penetration?: number;
}

export interface SemanticBackend {
    readonly id: string;
    /** Relatedness of two words in [0, 1]. */
    relatedness(a: string, b: string): number;
    /**
     * Channel data for the DIRECT edge between a clue and a word, or null when
     * the backend has no per-edge record for the pair. Optional: only backends
     * with weighted edge data (v2 semantic maps) provide it; consumers must
     * treat a missing method, a null edge, and missing channel fields all as
     * "no signal, no adjustment".
     */
    edgeInfo?(clue: string, word: string): EdgeInfo | null;
    /**
     * Phrase/compound completion frequency of the pair in [0, 1] (either order:
     * "manta ray", "engine box"). This is the completion-entropy source (ledger
     * lesson 13): a compound reading is AUTOMATIC for a human guesser — it
     * competes with associative fit directly, whatever the model's relatedness
     * says. Optional; 0 or a missing method means "no phrase signal".
     */
    collocation?(a: string, b: string): number;
    /** Candidate clue words this backend knows about (spymaster vocabulary).
     *  Optional — backends without a fixed vocabulary (e.g. lexical) omit it. */
    vocabulary?(): string[];
    /**
     * Candidate clue words nearest the centroid of `words`, best first. This is
     * what lets a spymaster GENERATE board-specific clues (words near its own
     * cards) rather than only scoring a fixed vocabulary — the key to strong,
     * creative clues. Optional: backends without a vector space (table, lexical)
     * omit it, and the spymaster falls back to scanning vocabulary().
     */
    nearest?(words: string[], k: number): Array<{ word: string; score: number }>;
    /**
     * Asynchronously warm the nearest() cache for a batch of queries, yielding
     * the event loop between chunks so the up-to-16 full-vocabulary scans a first
     * clue decision triggers don't block every other room (E4). After it resolves,
     * the matching sync nearest() calls are cache hits. Optional: only a
     * scan-backed backend (vectors) implements it; without it callers skip the
     * warm-up and pay the sync scans as before. Idempotent — safe to call with
     * queries already cached.
     */
    prewarm?(queries: ReadonlyArray<{ words: readonly string[]; k: number }>): Promise<void>;
    /**
     * Prior in [0, 1] for how common/recognizable a word is (1 = everyday word,
     * → 0 = deep cut). The spymaster uses it to prefer clues anchored in SHARED
     * knowledge over idiosyncratic sub-associations — a rare clue word that the
     * model relates strongly may light up something entirely different in a
     * human guesser's head. Optional: backends without a frequency signal omit
     * it and the rarity penalty is skipped (treated as commonness 1).
     */
    commonness?(word: string): number;
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

/**
 * How strongly a clue actually RETRIEVES a board word for a human guesser: the
 * best of associative relatedness and phrase completion. A guesser completes
 * "engine ___" before they reason about categories (misfire class D in the
 * ledger — member-beats-compound), so every consumer that predicts or models
 * guessing behaviour must rank by this, not by relatedness alone. Exact no-op
 * for backends without a collocation channel.
 */
export function clueRetrieval(backend: SemanticBackend, clue: string, word: string): number {
    const rel = backend.relatedness(clue, word);
    if (!backend.collocation) return rel;
    return Math.max(rel, backend.collocation(clue, word));
}

/** The backend used when no semantic asset is configured. */
export const defaultSemanticBackend: SemanticBackend = lexicalBackend;
