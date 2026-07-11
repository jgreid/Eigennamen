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
import { openSync, readSync, closeSync, existsSync, promises as fsp } from 'fs';
import type { SemanticBackend } from './backend';
import { tableBackend } from './tableBackend';
import { referenceSignal } from './properAssociations';
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
    /** Size of the frequency-trusted head region (see COMMONNESS_PRIOR_REF).
     *  Override only in tests — production artifacts are built against the
     *  default. */
    priorRef?: number;
}

const DEFAULTS = {
    maxWords: 50_000,
    vocabCap: 2_000,
    minLen: 3,
    maxLen: 12,
};

// The frequency prior (and with it, clue GENERATION) only trusts file ranks
// inside this region. A wide bake (build-board-vectors.mjs --wide) appends a
// large comprehension-only tail of rarer words AFTER the frequency-graded
// head so the bots UNDERSTAND a word-nerd's clue (SIDEREAL, FUMAROLE, INGOT)
// — but those words must never be GENERATED as clues, and the rank→commonness
// prior must not be diluted by the tail's presence (rank 45k of 150k would
// read as "common"). So: commonness ramps to 0 across this region and stays 0
// beyond it, and nearest()'s candidate pool excludes beyond-region words
// outright — a tax is not enough, because the rarity penalty is subtractive
// (and mostly waived at N=1 by the singles doctrine), so a junk tail token
// with a hot cosine could still ride into a single-card clue.
const COMMONNESS_PRIOR_REF = 50_000;

const CHUNK_BYTES = 1 << 20; // 1 MiB read buffer

/** Hand the event loop back once — used by the async loader between chunks so a
 *  multi-MB parse can't monopolise it and stall every room/socket (N20). */
function yieldToEventLoop(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

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
 * Stateful line parser shared by the sync and async file readers. Accumulates
 * vectors as lines are fed to `handleLine` (which returns false once the
 * `maxWords` cap is hit, signalling "stop reading"); `result()` snapshots the
 * final LoadedVectors. Keeping the parse in one place means the sync `loadVectors`
 * and the async `loadVectorsAsync` (N20) can never drift in what they accept.
 */
function makeLineParser(opts: Required<VectorBackendOptions>): {
    handleLine: (raw: string) => boolean;
    result: () => LoadedVectors;
} {
    const vecs = new Map<string, Float32Array>();
    const vocab: string[] = [];
    const seenVocab = new Set<string>();
    let conceptNet = false;
    let sortedSoFar = true;
    let prevToken: string | null = null;
    let dim = -1;
    let isFirstLine = true;
    // Vector storage is POOLED: one shared Float32Array per POOL_WORDS words,
    // with each entry a subarray view into it. A per-word `new Float32Array`
    // carries ~200 bytes of object overhead on top of its 4·dim payload and
    // fragments the heap — at wide-bake scale (~140k words) that overhead and
    // the parse churn measurably dominated RSS. Views keep the scoring path
    // byte-identical (relatedness indexes a Float32Array either way).
    const POOL_WORDS = 10_000;
    let pool: Float32Array | null = null;
    let poolUsed = 0; // elements consumed in the current pool

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
        if (vecs.has(key)) return vecs.size < opts.maxWords; // duplicate token

        // Parse straight into pooled storage, then L2-normalise in place. A
        // rejected row (junk float, zero norm) rolls the pool cursor back.
        if (!pool || poolUsed + dim > pool.length) {
            pool = new Float32Array(POOL_WORDS * dim);
            poolUsed = 0;
        }
        const vec = pool.subarray(poolUsed, poolUsed + dim);
        let norm = 0;
        for (let i = 0; i < dim; i++) {
            const v = Number(values[i]);
            if (!Number.isFinite(v)) return true; // skip rows with junk floats
            vec[i] = v;
            norm += v * v;
        }
        if (norm === 0) return true;
        poolUsed += dim;
        const inv = 1 / Math.sqrt(norm);
        for (let i = 0; i < dim; i++) {
            vec[i] = (vec[i] as number) * inv;
        }

        {
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

    const result = (): LoadedVectors => ({
        vecs,
        vocab,
        conceptNet,
        alphabetical: sortedSoFar && vecs.size >= 2,
    });

    return { handleLine, result };
}

/**
 * Bounded, chunked line reader: reads the file in 1 MiB blocks and parses
 * vectors until `maxWords` is reached, then stops — never loading the whole file.
 * SYNCHRONOUS: blocks the event loop for the whole parse, so only safe off the
 * hot path (tests, or a caller that has already yielded). Production bootstrap
 * uses `loadVectorsAsync` instead (N20).
 */
function loadVectors(opts: Required<VectorBackendOptions>): LoadedVectors {
    const { handleLine, result } = makeLineParser(opts);

    const fd = openSync(opts.path, 'r');
    try {
        const buf = Buffer.allocUnsafe(CHUNK_BYTES);
        let remainder = '';
        let bytesRead = readSync(fd, buf, 0, CHUNK_BYTES, null);

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

    return result();
}

/**
 * Async twin of `loadVectors`: identical parse (shared `makeLineParser`), but
 * reads with `fs.promises` and yields the event loop between every 1 MiB chunk
 * so a multi-GB embeddings parse never blocks it. This is the loader the
 * bootstrap warm uses so the first bot decision after a restart doesn't stall
 * every room/socket/health-probe with a synchronous parse (N20).
 */
async function loadVectorsAsync(opts: Required<VectorBackendOptions>): Promise<LoadedVectors> {
    const { handleLine, result } = makeLineParser(opts);

    const handle = await fsp.open(opts.path, 'r');
    try {
        const buf = Buffer.allocUnsafe(CHUNK_BYTES);
        let remainder = '';
        let keepGoing = true;
        /* eslint-disable no-await-in-loop -- sequential chunked read, yielding between chunks */
        for (;;) {
            const { bytesRead } = await handle.read(buf, 0, CHUNK_BYTES, null);
            if (bytesRead <= 0) break;
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
            // Hand the loop back so the burst can't monopolise it (N20).
            await yieldToEventLoop();
        }
        /* eslint-enable no-await-in-loop */
        if (keepGoing && remainder.trim()) handleLine(remainder);
    } finally {
        await handle.close();
    }

    return result();
}

/** Coalesce per-field so an explicit `undefined` (e.g. an unset env var passed
 *  through) does not clobber a default. */
function resolveVectorOpts(options: VectorBackendOptions): Required<VectorBackendOptions> {
    return {
        path: options.path,
        fallback: options.fallback ?? tableBackend,
        maxWords: options.maxWords ?? DEFAULTS.maxWords,
        vocabCap: options.vocabCap ?? DEFAULTS.vocabCap,
        minLen: options.minLen ?? DEFAULTS.minLen,
        maxLen: options.maxLen ?? DEFAULTS.maxLen,
        priorRef: options.priorRef ?? COMMONNESS_PRIOR_REF,
    };
}

/**
 * Build a vector-backed SemanticBackend from a vectors file. Returns `null` (and
 * logs) if the file is missing or yields no usable vectors, so callers fall back
 * to the table backend. SYNCHRONOUS load (blocks the event loop for the parse) —
 * use `makeVectorBackendAsync` on the hot/bootstrap path. Construct once and reuse.
 */
export function makeVectorBackend(options: VectorBackendOptions): SemanticBackend | null {
    const opts = resolveVectorOpts(options);

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

    return buildVectorBackend(loaded, opts);
}

/**
 * Async twin of `makeVectorBackend` (N20): identical result, but the file parse
 * yields the event loop between chunks (`loadVectorsAsync`) so it never blocks.
 * The bootstrap warm calls this; until it resolves, callers keep using the cheap
 * table/map fallback. Returns `null` on a missing/empty/unusable file.
 */
export async function makeVectorBackendAsync(options: VectorBackendOptions): Promise<SemanticBackend | null> {
    const opts = resolveVectorOpts(options);

    if (!existsSync(opts.path)) {
        logger.warn(`Bot embeddings file not found, using fallback backend: ${opts.path}`);
        return null;
    }

    let loaded: LoadedVectors;
    try {
        loaded = await loadVectorsAsync(opts);
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

    return buildVectorBackend(loaded, opts);
}

/**
 * Construct the SemanticBackend object from an already-loaded vector set. Shared
 * by the sync and async makers so the two never drift in scoring/vocab/nearest
 * behaviour — only the file-read strategy differs.
 */
function buildVectorBackend(loaded: LoadedVectors, opts: Required<VectorBackendOptions>): SemanticBackend {
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
    // Unlike vocabulary() (capped for a fixed scan), this spans the loaded
    // model so the spymaster can generate clues from its whole vocabulary —
    // EXCEPT the wide bake's comprehension-only tail: on a frequency-ordered
    // file, words beyond COMMONNESS_PRIOR_REF are understood (relatedness,
    // hasSignal) but never offered as clue candidates (see the constant's
    // rationale). Without a frequency prior (ranks === null) there is no tail
    // notion and the whole model remains eligible, as before.
    const dim = vecs.size > 0 ? (vecs.values().next().value as Float32Array).length : 0;
    const candidateKeys: string[] = [];
    let fileRank = 0;
    for (const key of vecs.keys()) {
        const generationEligible = ranks === null || fileRank < opts.priorRef;
        fileRank++;
        if (!generationEligible) continue;
        if (key.length >= opts.minLen && key.length <= opts.maxLen && /^[A-ZÀ-ÖØ-Þ]+$/.test(key)) {
            candidateKeys.push(key);
        }
    }

    // Clue candidates = embedding vocab ∪ the curated table vocab, capped. Even a
    // small model thus widens the spymaster's clue space beyond the baked table.
    const tableVocab = fallback.vocabulary ? fallback.vocabulary() : [];
    const merged: string[] = [];
    const seen = new Set<string>();
    // Dedupe on the normalized key but keep the ORIGINAL word, so the fallback
    // table's display-cased proper references ("Cinderella", "NASA") survive into
    // vocabulary() instead of being flattened to all-caps — otherwise the
    // clue-capitalization house rule silently vanishes on the giving side (G2).
    // tableVocab FIRST so a display-cased reference key wins the dedupe over an
    // embeddings token of the same normalized form, and survives the vocabCap.
    for (const w of [...tableVocab, ...vocab]) {
        const k = normalizeClueWord(w);
        if (k && !seen.has(k)) {
            seen.add(k);
            merged.push(w);
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

    // Shared scan primitives, so the sync nearest() and the async prewarm()
    // produce BYTE-IDENTICAL cache entries (same candidateKeys order, same
    // centroid, same top-k tiebreak) — a prewarmed query is exactly what a later
    // nearest() would compute.
    const NEAREST_KEY = (inputSet: Set<string>, k: number): string => `${k}|${[...inputSet].sort().join(' ')}`;
    const better = (a: { word: string; score: number }, b: { word: string; score: number }): boolean =>
        a.score > b.score || (a.score === b.score && a.word < b.word);
    /** L2-normalised centroid of the input words' vectors, or null if none had one. */
    const buildCentroid = (inputSet: Set<string>): Float32Array | null => {
        const centroid = new Float32Array(dim);
        let n = 0;
        for (const key of inputSet) {
            const v = vecs.get(key);
            if (!v) continue;
            for (let i = 0; i < dim; i++) centroid[i] = (centroid[i] as number) + (v[i] as number);
            n++;
        }
        if (n === 0) return null;
        let norm = 0;
        for (let i = 0; i < dim; i++) norm += (centroid[i] as number) ** 2;
        if (norm === 0) return null;
        const inv = 1 / Math.sqrt(norm);
        for (let i = 0; i < dim; i++) centroid[i] = (centroid[i] as number) * inv;
        return centroid;
    };
    /** Cosine of a candidate against the centroid, or null to skip (input/≤0). */
    const scoreCandidate = (centroid: Float32Array, cand: string, inputSet: Set<string>): number | null => {
        if (inputSet.has(cand)) return null; // never suggest an input word itself
        const cv = vecs.get(cand) as Float32Array;
        let dot = 0;
        for (let i = 0; i < dim; i++) dot += (centroid[i] as number) * (cv[i] as number);
        return dot > 0 ? Math.min(1, dot) : null;
    };
    /** Bounded top-k insertion under the (score desc, word asc) total order. */
    const insertTopK = (
        top: Array<{ word: string; score: number }>,
        entry: { word: string; score: number },
        k: number
    ): void => {
        if (top.length === k && !better(entry, top[k - 1] as { word: string; score: number })) return;
        let lo = 0;
        let hi = top.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (better(entry, top[mid] as { word: string; score: number })) hi = mid;
            else lo = mid + 1;
        }
        top.splice(lo, 0, entry);
        if (top.length > k) top.pop();
    };
    const storeNearest = (cacheKey: string, top: Array<{ word: string; score: number }>): void => {
        if (nearestCache.size >= NEAREST_CACHE_MAX) {
            const oldest = nearestCache.keys().next().value;
            if (oldest !== undefined) nearestCache.delete(oldest);
        }
        nearestCache.set(cacheKey, top);
    };
    /** Candidates scanned between event-loop yields in prewarm() (E4). */
    const PREWARM_CHUNK = 5000;
    const yieldEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

    const backend: SemanticBackend = {
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
            if (referenceSignal(a) === 'proper' || referenceSignal(b) === 'proper') {
                return Math.max(cosine ?? 0, fallback.relatedness(a, b));
            }
            // Tiers COMPOSE, they don't shadow: when the curated chain beneath
            // (semantic maps / baked table) has REAL signal for the pair, the
            // stronger reading wins. Without this, enabling vectors silently
            // suppressed every curated edge between in-vocabulary words — a
            // curated TENTACLE→OCTOPUS 1.0 collapsed to a compressed cosine
            // (~0.3 under Numberbatch) — on both the guessing side and the
            // spymaster's danger margins. Gated on hasSignal so the lexical
            // bigram floor can never override a genuine cosine.
            if (cosine !== null) {
                if (fallback.hasSignal?.(a, b)) return Math.max(cosine, fallback.relatedness(a, b));
                return cosine;
            }
            // One or both OOV: defer to the fallback chain (table → lexical).
            return fallback.relatedness(a, b);
        },
        hasSignal(a: string, b: string): boolean {
            // A vector pair is real semantic knowledge; an OOV pair is informed
            // only if the fallback chain (table/maps) has its own signal for it.
            if (normalizeClueWord(a) === normalizeClueWord(b)) return true;
            if (vecs.has(normalizeClueWord(a)) && vecs.has(normalizeClueWord(b))) return true;
            return fallback.hasSignal?.(a, b) ?? false;
        },
        vocabulary(): string[] {
            return merged;
        },
        commonness(word: string): number {
            // For a proper-cased reference, the curated fame rating (via the
            // fallback chain) is a better "will the guessers know it?" prior
            // than the file rank of the sense-conflated token.
            if (referenceSignal(word) === 'proper') {
                const fame = fallback.commonness?.(word);
                if (fame !== undefined && fame < 1) return fame;
            }
            const key = normalizeClueWord(word);
            const rank = ranks?.get(key);
            if (rank === undefined) return fallback.commonness?.(word) ?? 1;
            // Grade against the frequency-trusted region, not the whole file:
            // normalising by vecs.size let a wide comprehension tail dilute the
            // prior (rank 45k of a 150k wide file would read as 0.7 "common").
            // For files at or under the region size this is exactly the old
            // rank/size formula; beyond it, commonness clamps to 0 (max rarity
            // tax) — the tail is for understanding clues, never for playing them.
            return Math.max(0, 1 - rank / Math.min(vecs.size, opts.priorRef));
        },
        displayCase(word: string): string {
            // Reference display case lives in the curated tables beneath the
            // embeddings (the model conflates every sense under one vector), so a
            // generated all-caps reference key is re-cased via the fallback chain (G2).
            return fallback.displayCase?.(word) ?? word;
        },
        nearest(words: string[], k: number): Array<{ word: string; score: number }> {
            if (dim === 0 || k <= 0) return [];
            const inputSet = new Set<string>();
            for (const w of words) inputSet.add(normalizeClueWord(w));
            const cacheKey = NEAREST_KEY(inputSet, k);
            const cached = nearestCache.get(cacheKey);
            if (cached) return cached;

            const centroid = buildCentroid(inputSet);
            if (!centroid) return []; // no input vector — not cached (cheap to redo)

            // Bounded top-k selection under the total order (score desc, word asc
            // tiebreak) — identical results to sorting every positive-scoring
            // candidate, without materialising and sorting ~half the vocabulary
            // per call (which measurably dominates the cost beyond the
            // unavoidable O(candidates × dim) scan).
            const top: Array<{ word: string; score: number }> = [];
            for (const cand of candidateKeys) {
                const score = scoreCandidate(centroid, cand, inputSet);
                if (score !== null) insertTopK(top, { word: cand, score }, k);
            }
            storeNearest(cacheKey, top);
            return top;
        },
        async prewarm(queries: ReadonlyArray<{ words: readonly string[]; k: number }>): Promise<void> {
            if (dim === 0) return;
            // Sequential + deliberate awaits: each yield hands the event loop back
            // between chunks so the scan burst can't monopolise it — the whole
            // point of prewarm (E4).
            /* eslint-disable no-await-in-loop */
            for (const q of queries) {
                if (q.k <= 0) continue;
                const inputSet = new Set<string>();
                for (const w of q.words) inputSet.add(normalizeClueWord(w));
                const cacheKey = NEAREST_KEY(inputSet, q.k);
                if (nearestCache.has(cacheKey)) continue; // already warm
                const centroid = buildCentroid(inputSet);
                if (!centroid) continue; // matches nearest(): no-vector queries aren't cached
                const top: Array<{ word: string; score: number }> = [];
                let scanned = 0;
                for (const cand of candidateKeys) {
                    const score = scoreCandidate(centroid, cand, inputSet);
                    if (score !== null) insertTopK(top, { word: cand, score }, q.k);
                    // Yield the event loop every chunk so a burst of full-vocabulary
                    // scans doesn't monopolise it and stall every other room (E4).
                    if (++scanned % PREWARM_CHUNK === 0) await yieldEventLoop();
                }
                storeNearest(cacheKey, top);
            }
            /* eslint-enable no-await-in-loop */
        },
    };

    // Phase-2 channels (edgeInfo/collocation) live in the curated tables, not
    // in the sense-conflated embeddings. When a prepared v2 map sits beneath
    // the vector backend in the chain, forward its channels through — else
    // clueRetrieval's `if (!backend.collocation)` and scoreClue's
    // `if (backend.edgeInfo)` see the top-level vector backend, find neither,
    // and every compound-interception / fame / concreteness signal silently
    // vanishes under embeddings (correctness-review finding). Forwarded ONLY
    // when the fallback actually provides them, so a channel-less chain keeps
    // reporting absence (the no-op contract those guards depend on).
    const fallbackEdgeInfo = opts.fallback.edgeInfo?.bind(opts.fallback);
    const fallbackCollocation = opts.fallback.collocation?.bind(opts.fallback);
    if (fallbackEdgeInfo) backend.edgeInfo = fallbackEdgeInfo;
    if (fallbackCollocation) backend.collocation = fallbackCollocation;
    return backend;
}
