/**
 * Word-embedding semantic backend (the §20 "real embeddings" path).
 *
 * Loads pre-trained word vectors from a text file in the standard word2vec /
 * GloVe / fastText / ConceptNet-Numberbatch format and scores relatedness as the
 * cosine similarity of the two word vectors (clamped to [0, 1]). For any word it
 * has no vector for it defers to a fallback backend (the baked table, which in
 * turn falls back to lexical), so custom / out-of-vocabulary board words still
 * get a signal. It implements the SAME SemanticBackend interface as the table
 * and lexical backends, so greedyClicker and embeddingSpymaster consume it
 * unchanged — dropping in fastText or Numberbatch is purely an operator action
 * (set BOT_EMBEDDINGS_PATH), no code change.
 *
 * Supported file format (auto-detected, optionally gzip-trimmed beforehand):
 *   - optional header line "<count> <dim>" (word2vec text; GloVe has none)
 *   - one word per line: "<token> v1 v2 ... vD" (space-separated floats)
 *   - ConceptNet "/c/en/<token>" prefixes and "_"-joined phrases are handled
 *     (prefix stripped; multi-token phrases skipped).
 *
 * The loader reads at most `maxWords` vectors via a bounded chunked read, so a
 * multi-GB file never gets slurped whole into memory; trim with `head` for an
 * even smaller footprint. Vectors are L2-normalised at load so relatedness is a
 * single dot product.
 */
import { openSync, readSync, closeSync, existsSync } from 'fs';
import type { SemanticBackend } from './backend';
import { tableBackend } from './tableBackend';
import { caseSignal } from './properAssociations';
import { normalizeClueWord } from '../../shared/gameRules';
import logger from '../../utils/logger';

export interface VectorBackendOptions {
    /** Path to the vectors file (word2vec / GloVe / fastText / Numberbatch text). */
    path: string;
    /** OOV fallback backend. Defaults to the baked table (→ lexical). */
    fallback?: SemanticBackend;
    /** Cap on vectors loaded into memory (frequency-ordered files keep the most common). */
    maxWords?: number;
    /** Cap on clue candidates returned by vocabulary(). */
    vocabCap?: number;
    /** Min/max length of a token to be offered as a clue candidate. */
    minLen?: number;
    maxLen?: number;
}

const DEFAULTS = {
    maxWords: 50_000,
    vocabCap: 2_000,
    minLen: 3,
    maxLen: 12,
};

const CHUNK_BYTES = 1 << 20; // 1 MiB read buffer

/** Strip a ConceptNet "/c/<lang>/" prefix if present; return the bare token. */
function stripConceptNet(token: string): string {
    const m = /^\/c\/[a-z]{2,3}\/(.+)$/.exec(token);
    return m?.[1] ?? token;
}

interface LoadedVectors {
    vecs: Map<string, Float32Array>;
    vocab: string[];
    /** True when any token carried a ConceptNet "/c/<lang>/" prefix. Numberbatch
     *  files are ALPHABETICALLY ordered, so file rank is not a frequency prior. */
    conceptNet: boolean;
    /** True when the file's tokens arrived in lexicographic order — the tell of
     *  an alphabetically-sorted export (e.g. the bare-token English-only
     *  Numberbatch file, which carries NO /c/ prefix), where file rank is
     *  alphabetical position, not frequency. */
    alphabetical: boolean;
}

/**
 * Bounded, chunked line reader: reads the file in 1 MiB blocks and parses
 * vectors until `maxWords` is reached, then stops — never loading the whole file.
 */
function loadVectors(opts: Required<VectorBackendOptions>): LoadedVectors {
    const vecs = new Map<string, Float32Array>();
    const vocab: string[] = [];
    const seenVocab = new Set<string>();
    let conceptNet = false;
    let sortedSoFar = true;
    let prevToken: string | null = null;

    const fd = openSync(opts.path, 'r');
    try {
        const buf = Buffer.allocUnsafe(CHUNK_BYTES);
        let remainder = '';
        let dim = -1;
        let isFirstLine = true;
        let bytesRead = readSync(fd, buf, 0, CHUNK_BYTES, null);

        const handleLine = (raw: string): boolean => {
            // returns false to signal "stop reading"
            const line = raw.trim();
            if (!line) return true;
            const parts = line.split(/\s+/);

            // Header line "<count> <dim>" (word2vec text). Detect once, up front.
            if (isFirstLine) {
                isFirstLine = false;
                const [p0, p1] = parts;
                if (parts.length === 2 && p0 && p1 && /^\d+$/.test(p0) && /^\d+$/.test(p1)) {
                    return true; // skip header
                }
            }

            if (parts.length < 3) return true; // not a valid vector row
            const rawToken = parts[0];
            if (rawToken === undefined) return true;
            // Ordering probe for the frequency prior: compare RAW tokens (the
            // file's own sort key) across every data row, including rows later
            // skipped as phrases, so the verdict reflects the file's true order.
            if (sortedSoFar && prevToken !== null && rawToken < prevToken) sortedSoFar = false;
            prevToken = rawToken;
            const token = stripConceptNet(rawToken);
            if (token !== rawToken) conceptNet = true;
            if (token.includes('_')) return true; // skip multi-word phrases
            const key = normalizeClueWord(token);
            if (!key || /\s/.test(key)) return true;

            const values = parts.slice(1);
            if (dim === -1) dim = values.length;
            if (values.length !== dim) return true; // malformed / ragged row

            // Parse into a plain array, then build the normalised Float32Array.
            const rawVec: number[] = new Array(dim);
            let norm = 0;
            for (let i = 0; i < dim; i++) {
                const v = Number(values[i]);
                if (!Number.isFinite(v)) return true; // skip rows with junk floats
                rawVec[i] = v;
                norm += v * v;
            }
            if (norm === 0) return true;
            const inv = 1 / Math.sqrt(norm);
            const vec = new Float32Array(dim);
            for (let i = 0; i < dim; i++) {
                vec[i] = (rawVec[i] ?? 0) * inv;
            }

            if (!vecs.has(key)) {
                vecs.set(key, vec);
                if (
                    vocab.length < opts.vocabCap &&
                    !seenVocab.has(key) &&
                    key.length >= opts.minLen &&
                    key.length <= opts.maxLen &&
                    /^[A-ZÀ-ÖØ-Þ]+$/.test(key)
                ) {
                    seenVocab.add(key);
                    vocab.push(key);
                }
            }
            return vecs.size < opts.maxWords;
        };

        // keepGoing goes false when handleLine hits the maxWords cap; the inner
        // `if (!keepGoing) break` exits the outer loop, and the trailing-line check
        // below honours it — so it is NOT part of this header condition.
        let keepGoing = true;
        while (bytesRead > 0) {
            remainder += buf.toString('utf8', 0, bytesRead);
            let nl = remainder.indexOf('\n');
            while (nl !== -1) {
                if (!handleLine(remainder.slice(0, nl))) {
                    keepGoing = false;
                    break;
                }
                remainder = remainder.slice(nl + 1);
                nl = remainder.indexOf('\n');
            }
            if (!keepGoing) break;
            bytesRead = readSync(fd, buf, 0, CHUNK_BYTES, null);
        }
        // Trailing line with no final newline.
        if (keepGoing && remainder.trim()) handleLine(remainder);
    } finally {
        closeSync(fd);
    }

    return { vecs, vocab, conceptNet, alphabetical: sortedSoFar && vecs.size >= 2 };
}

/**
 * Build a vector-backed SemanticBackend from a vectors file. Returns `null` (and
 * logs) if the file is missing or yields no usable vectors, so callers fall back
 * to the table backend. Loading is eager but bounded; construct once and reuse.
 */
export function makeVectorBackend(options: VectorBackendOptions): SemanticBackend | null {
    // Coalesce per-field so an explicit `undefined` (e.g. an unset env var passed
    // through) does not clobber a default.
    const opts: Required<VectorBackendOptions> = {
        path: options.path,
        fallback: options.fallback ?? tableBackend,
        maxWords: options.maxWords ?? DEFAULTS.maxWords,
        vocabCap: options.vocabCap ?? DEFAULTS.vocabCap,
        minLen: options.minLen ?? DEFAULTS.minLen,
        maxLen: options.maxLen ?? DEFAULTS.maxLen,
    };

    if (!existsSync(opts.path)) {
        logger.warn(`Bot embeddings file not found, using fallback backend: ${opts.path}`);
        return null;
    }

    let loaded: LoadedVectors;
    try {
        loaded = loadVectors(opts);
    } catch (err) {
        logger.warn(`Failed to load bot embeddings (${opts.path}), using fallback backend`, {
            error: err instanceof Error ? err.message : String(err),
        });
        return null;
    }

    if (loaded.vecs.size === 0) {
        logger.warn(`Bot embeddings file had no usable vectors, using fallback backend: ${opts.path}`);
        return null;
    }

    const { vecs, vocab } = loaded;
    const fallback = opts.fallback;

    // File-rank frequency prior: word2vec/GloVe/fastText files list vectors most-
    // frequent-first, so a word's position is a real commonness signal (rank 0 =
    // everyday word). ConceptNet Numberbatch is alphabetical — rank would call
    // AARDVARK common and ZEBRA obscure — so the prior is disabled for it. The
    // multilingual export is caught by its /c/<lang>/ prefixes; the English-only
    // export has BARE tokens, so sorted-order detection is what catches it (and
    // any other alphabetized file). A frequency-ordered file is never sorted.
    const ranks: Map<string, number> | null = loaded.conceptNet || loaded.alphabetical ? null : new Map();
    if (ranks) {
        let i = 0;
        for (const key of vecs.keys()) ranks.set(key, i++);
    }

    // Vector dimensionality (all vectors share it) and the full set of
    // clue-suitable words that HAVE a vector — the search space for nearest().
    // Unlike vocabulary() (capped for a fixed scan), this spans the whole loaded
    // model so the spymaster can generate clues from its entire vocabulary.
    const dim = vecs.size > 0 ? (vecs.values().next().value as Float32Array).length : 0;
    const candidateKeys: string[] = [];
    for (const key of vecs.keys()) {
        if (key.length >= opts.minLen && key.length <= opts.maxLen && /^[A-ZÀ-ÖØ-Þ]+$/.test(key)) {
            candidateKeys.push(key);
        }
    }

    // Clue candidates = embedding vocab ∪ the curated table vocab, capped. Even a
    // small model thus widens the spymaster's clue space beyond the baked table.
    const tableVocab = fallback.vocabulary ? fallback.vocabulary() : [];
    const merged: string[] = [];
    const seen = new Set<string>();
    for (const w of [...vocab, ...tableVocab]) {
        const k = normalizeClueWord(w);
        if (k && !seen.has(k)) {
            seen.add(k);
            merged.push(k);
            if (merged.length >= opts.vocabCap) break;
        }
    }

    logger.info(`Bot embeddings loaded: ${vecs.size} vectors, ${merged.length} clue candidates from ${opts.path}`);

    // nearest() is a pure, deterministic function of (input word set, k) over the
    // fixed loaded vectors, and the spymaster re-issues the same per-card and
    // pair-centroid queries on every clue decision of a game (board words never
    // change; the own set only shrinks) — so results are memoised. Each miss
    // costs a synchronous O(candidates × dim) scan on the live server's event
    // loop; a hit is free. Bounded FIFO keeps a long-lived server from growing
    // it without limit. Cached arrays are shared — callers must not mutate them.
    const NEAREST_CACHE_MAX = 4096;
    const nearestCache = new Map<string, Array<{ word: string; score: number }>>();

    return {
        id: 'vectors',
        relatedness(a: string, b: string): number {
            const A = normalizeClueWord(a);
            const B = normalizeClueWord(b);
            if (A === B) return 1;
            const va = vecs.get(A);
            const vb = vecs.get(B);
            let cosine: number | null = null;
            if (va && vb) {
                let dot = 0;
                for (let i = 0; i < va.length; i++) {
                    const x = va[i];
                    const y = vb[i];
                    if (x !== undefined && y !== undefined) dot += x * y;
                }
                cosine = dot > 0 ? Math.min(1, dot) : 0;
            }
            // House-rule case signal: a mixed-case clue names a specific
            // reference. Embeddings conflate every sense of a token under one
            // vector, so the curated proper table's explicit reading (via the
            // fallback chain) can only sharpen the score — take the max.
            if (caseSignal(a) === 'proper' || caseSignal(b) === 'proper') {
                return Math.max(cosine ?? 0, fallback.relatedness(a, b));
            }
            if (cosine !== null) return cosine;
            // One or both OOV: defer to the fallback chain (table → lexical).
            return fallback.relatedness(a, b);
        },
        vocabulary(): string[] {
            return merged;
        },
        commonness(word: string): number {
            // For a proper-cased reference, the curated fame rating (via the
            // fallback chain) is a better "will the guessers know it?" prior
            // than the file rank of the sense-conflated token.
            if (caseSignal(word) === 'proper') {
                const fame = fallback.commonness?.(word);
                if (fame !== undefined && fame < 1) return fame;
            }
            const key = normalizeClueWord(word);
            const rank = ranks?.get(key);
            if (rank === undefined) return fallback.commonness?.(word) ?? 1;
            return 1 - rank / vecs.size;
        },
        nearest(words: string[], k: number): Array<{ word: string; score: number }> {
            if (dim === 0 || k <= 0) return [];
            const inputSet = new Set<string>();
            for (const w of words) inputSet.add(normalizeClueWord(w));
            const cacheKey = `${k}|${[...inputSet].sort().join(' ')}`;
            const cached = nearestCache.get(cacheKey);
            if (cached) return cached;

            // Centroid of the input words' vectors (those we have), then L2-normalise
            // so scores are cosine similarities in [0, 1].
            const centroid = new Float32Array(dim);
            let n = 0;
            for (const key of inputSet) {
                const v = vecs.get(key);
                if (!v) continue;
                for (let i = 0; i < dim; i++) centroid[i] = (centroid[i] as number) + (v[i] as number);
                n++;
            }
            if (n === 0) return [];
            let norm = 0;
            for (let i = 0; i < dim; i++) norm += (centroid[i] as number) ** 2;
            if (norm === 0) return [];
            const inv = 1 / Math.sqrt(norm);
            for (let i = 0; i < dim; i++) centroid[i] = (centroid[i] as number) * inv;

            // Bounded top-k selection under the total order (score desc, word asc
            // tiebreak) — identical results to sorting every positive-scoring
            // candidate, without materialising and sorting ~half the vocabulary
            // per call (which measurably dominates the cost beyond the
            // unavoidable O(candidates × dim) scan).
            const better = (a: { word: string; score: number }, b: { word: string; score: number }): boolean =>
                a.score > b.score || (a.score === b.score && a.word < b.word);
            const top: Array<{ word: string; score: number }> = [];
            for (const cand of candidateKeys) {
                if (inputSet.has(cand)) continue; // never suggest an input word itself
                const cv = vecs.get(cand) as Float32Array;
                let dot = 0;
                for (let i = 0; i < dim; i++) dot += (centroid[i] as number) * (cv[i] as number);
                if (dot <= 0) continue;
                const entry = { word: cand, score: Math.min(1, dot) };
                if (top.length === k && !better(entry, top[k - 1] as { word: string; score: number })) continue;
                let lo = 0;
                let hi = top.length;
                while (lo < hi) {
                    const mid = (lo + hi) >> 1;
                    if (better(entry, top[mid] as { word: string; score: number })) hi = mid;
                    else lo = mid + 1;
                }
                top.splice(lo, 0, entry);
                if (top.length > k) top.pop();
            }

            if (nearestCache.size >= NEAREST_CACHE_MAX) {
                const oldest = nearestCache.keys().next().value;
                if (oldest !== undefined) nearestCache.delete(oldest);
            }
            nearestCache.set(cacheKey, top);
            return top;
        },
    };
}
