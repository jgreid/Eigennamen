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
}

/**
 * Bounded, chunked line reader: reads the file in 1 MiB blocks and parses
 * vectors until `maxWords` is reached, then stops — never loading the whole file.
 */
function loadVectors(opts: Required<VectorBackendOptions>): LoadedVectors {
    const vecs = new Map<string, Float32Array>();
    const vocab: string[] = [];
    const seenVocab = new Set<string>();

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
            const token = stripConceptNet(rawToken);
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

    return { vecs, vocab };
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

    return {
        id: 'vectors',
        relatedness(a: string, b: string): number {
            const A = normalizeClueWord(a);
            const B = normalizeClueWord(b);
            if (A === B) return 1;
            const va = vecs.get(A);
            const vb = vecs.get(B);
            if (va && vb) {
                let dot = 0;
                for (let i = 0; i < va.length; i++) {
                    const x = va[i];
                    const y = vb[i];
                    if (x !== undefined && y !== undefined) dot += x * y;
                }
                return dot > 0 ? Math.min(1, dot) : 0;
            }
            // One or both OOV: defer to the fallback chain (table → lexical).
            return fallback.relatedness(a, b);
        },
        vocabulary(): string[] {
            return merged;
        },
    };
}
