/**
 * Tests for the word-embedding vector backend + backend selection.
 *
 * A tiny synthetic vectors file (word2vec text format) is written to a temp path
 * so the loader, cosine scoring, OOV fallback, vocabulary and selection logic are
 * all exercised without any large external asset.
 */
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makeVectorBackend, makeVectorBackendAsync } from '../../bots/semantics/vectorBackend';
import { getSemanticBackend, resetSemanticBackendCache, warmSemanticBackend } from '../../bots/semantics/selectBackend';
import type { SemanticBackend } from '../../bots/semantics/backend';

let dir: string;
let vecPath: string;

beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'eig-vec-'));
    vecPath = join(dir, 'vectors.vec');
    // Header "<count> <dim>", lowercase tokens (as real files have), one phrase
    // and one ConceptNet-prefixed token to exercise stripping/skipping.
    writeFileSync(
        vecPath,
        [
            '6 3',
            'king 1 1 0',
            'queen 1 0.9 0.1',
            'apple 0 0.1 1',
            'man 0.9 1 0',
            '/c/en/dog 0.2 0.2 0.9',
            'new_york 0.5 0.5 0.5',
            '',
        ].join('\n')
    );
});

afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe('makeVectorBackend', () => {
    it('loads vectors and scores cosine relatedness', () => {
        const be = makeVectorBackend({ path: vecPath });
        expect(be).not.toBeNull();
        const b = be as SemanticBackend;

        // Identical word is always 1.
        expect(b.relatedness('king', 'king')).toBe(1);
        // KING is far closer to QUEEN than to APPLE.
        expect(b.relatedness('king', 'queen')).toBeGreaterThan(0.5);
        expect(b.relatedness('king', 'queen')).toBeGreaterThan(b.relatedness('king', 'apple'));
        // Negative/near-orthogonal cosine clamps to [0, ~).
        expect(b.relatedness('king', 'apple')).toBeGreaterThanOrEqual(0);
        expect(b.relatedness('king', 'apple')).toBeLessThan(0.3);
    });

    it('strips ConceptNet prefixes and skips "_"-joined phrases', () => {
        const b = makeVectorBackend({ path: vecPath }) as SemanticBackend;
        // "/c/en/dog" became DOG.
        expect(b.relatedness('dog', 'dog')).toBe(1);
        const vocab = b.vocabulary!();
        expect(vocab).toContain('DOG');
        expect(vocab).toContain('KING');
        expect(vocab).toContain('QUEEN');
        // The phrase row was skipped.
        expect(vocab).not.toContain('NEW_YORK');
        expect(vocab).not.toContain('NEWYORK');
    });

    it('falls back to the wrapped backend for out-of-vocabulary words', () => {
        const fallback: SemanticBackend = {
            id: 'stub',
            relatedness: () => 0.42,
            vocabulary: () => ['STUBCLUE'],
        };
        const b = makeVectorBackend({ path: vecPath, fallback }) as SemanticBackend;
        // ZEBRA has no vector → defers to the fallback's sentinel score.
        expect(b.relatedness('king', 'zebra')).toBe(0.42);
        // Merged vocabulary includes the fallback's clue words.
        expect(b.vocabulary!()).toContain('STUBCLUE');
    });

    it('returns null when the file is missing', () => {
        expect(makeVectorBackend({ path: join(dir, 'does-not-exist.vec') })).toBeNull();
    });

    it('forwards the fallback chain’s Phase-2 channels (edgeInfo/collocation)', () => {
        // When a prepared v2 map sits beneath the embeddings, its per-edge
        // channels must survive the vector layer — else clueRetrieval and
        // scoreClue, which probe the TOP-LEVEL backend, see neither and every
        // compound-interception / fame / concreteness signal vanishes under
        // embeddings (correctness-review finding).
        const fallback: SemanticBackend = {
            id: 'chan-stub',
            relatedness: () => 0,
            edgeInfo: (clue: string, word: string) =>
                clue === 'ENGINE' && word === 'BOX' ? { strength: 0.3, kind: 'compound' } : null,
            collocation: (a: string, b: string) =>
                (a === 'ENGINE' && b === 'BOX') || (a === 'BOX' && b === 'ENGINE') ? 0.8 : 0,
        };
        const b = makeVectorBackend({ path: vecPath, fallback }) as SemanticBackend;
        expect(typeof b.edgeInfo).toBe('function');
        expect(typeof b.collocation).toBe('function');
        expect(b.edgeInfo!('ENGINE', 'BOX')).toEqual({ strength: 0.3, kind: 'compound' });
        expect(b.collocation!('ENGINE', 'BOX')).toBe(0.8);
        expect(b.collocation!('BOX', 'ENGINE')).toBe(0.8);
    });

    it('preserves the fallback’s display-cased reference keys in vocabulary (G2)', () => {
        // The fallback (baked table) offers proper references in canonical case;
        // the merged vocab must keep that case, not flatten "Cinderella" to
        // all-caps — else the clue-capitalization house rule vanishes on emit.
        const fallback: SemanticBackend = {
            id: 'ref-stub',
            relatedness: () => 0,
            vocabulary: () => ['Cinderella', 'NASA'],
            displayCase: (w: string) => (w.toUpperCase() === 'CINDERELLA' ? 'Cinderella' : w),
        };
        const b = makeVectorBackend({ path: vecPath, fallback }) as SemanticBackend;
        expect(b.vocabulary!()).toContain('Cinderella');
        expect(b.vocabulary!()).not.toContain('CINDERELLA');
    });

    it('re-cases a generated all-caps reference key via the fallback chain (G2)', () => {
        const fallback: SemanticBackend = {
            id: 'ref-stub',
            relatedness: () => 0,
            displayCase: (w: string) => (w.toUpperCase() === 'CINDERELLA' ? 'Cinderella' : w),
        };
        const b = makeVectorBackend({ path: vecPath, fallback }) as SemanticBackend;
        expect(b.displayCase!('CINDERELLA')).toBe('Cinderella'); // normalized key → canonical case
        expect(b.displayCase!('KING')).toBe('KING'); // non-reference unchanged
    });

    it('reports channel ABSENCE when the fallback has none (preserves the no-op contract)', () => {
        // clueRetrieval/scoreClue guard on `!backend.collocation` /
        // `backend.edgeInfo` — a channel-less chain must keep those falsy.
        const fallback: SemanticBackend = { id: 'plain-stub', relatedness: () => 0 };
        const b = makeVectorBackend({ path: vecPath, fallback }) as SemanticBackend;
        expect(b.edgeInfo).toBeUndefined();
        expect(b.collocation).toBeUndefined();
    });

    it('honours the maxWords cap', () => {
        const b = makeVectorBackend({ path: vecPath, maxWords: 2 }) as SemanticBackend;
        // Only KING and QUEEN load; APPLE is beyond the cap so its pair scores via
        // the (default table→lexical) fallback rather than a real cosine.
        expect(b.relatedness('king', 'queen')).toBeGreaterThan(0.5);
    });

    it('nearest() generates candidates ranked by similarity to the input words', () => {
        const b = makeVectorBackend({ path: vecPath }) as SemanticBackend;
        const words = b.nearest!(['KING'], 2).map((n) => n.word);
        // In this toy space KING sits next to MAN and QUEEN, far from APPLE.
        expect(words).toEqual(expect.arrayContaining(['MAN', 'QUEEN']));
        expect(words).not.toContain('KING'); // never suggests the input word itself
        expect(words).not.toContain('APPLE');
        expect(b.nearest!(['KING'], 2).every((n) => n.score >= 0 && n.score <= 1)).toBe(true);
    });

    // E4: prewarm() fills the same cache nearest() reads, off the event loop.
    describe('prewarm() (E4 async cache warm)', () => {
        it('warms the cache so a later nearest() is byte-identical to a cold one', async () => {
            const warm = makeVectorBackend({ path: vecPath }) as SemanticBackend;
            const cold = makeVectorBackend({ path: vecPath }) as SemanticBackend;

            await warm.prewarm!([{ words: ['KING'], k: 2 }]);
            // Same reference back (served from cache), and identical to a cold scan.
            expect(warm.nearest!(['KING'], 2)).toEqual(cold.nearest!(['KING'], 2));
        });

        it('is idempotent and safe on already-cached / empty / no-vector queries', async () => {
            const b = makeVectorBackend({ path: vecPath }) as SemanticBackend;
            b.nearest!(['KING'], 2); // pre-cache
            await expect(
                b.prewarm!([
                    { words: ['KING'], k: 2 }, // already cached
                    { words: [], k: 3 }, // no input vector
                    { words: ['ZZZOOV'], k: 3 }, // OOV → no centroid
                    { words: ['QUEEN'], k: 0 }, // k <= 0
                ])
            ).resolves.toBeUndefined();
        });

        it('yields the event loop while scanning a large vocabulary (no monopolising block)', async () => {
            // candidateKeys only admits letter-only words of len 3–12, so generate
            // >2×PREWARM_CHUNK (5000) unique 3-letter tokens to force ≥2 yields.
            const letters = 'abcdefghijklmnopqrstuvwxyz';
            const wordFor = (i: number): string => {
                let s = '';
                let n = i;
                for (let d = 0; d < 3; d++) {
                    s = letters[n % 26] + s;
                    n = Math.floor(n / 26);
                }
                return s;
            };
            const bigPath = join(dir, 'big.vec');
            const rows = ['12000 3'];
            for (let i = 0; i < 12000; i++) rows.push(`${wordFor(i)} ${(i % 7) / 7} ${(i % 5) / 5} ${(i % 3) / 3}`);
            rows.push('');
            writeFileSync(bigPath, rows.join('\n'));
            const b = makeVectorBackend({ path: bigPath, vocabCap: 12000, maxWords: 20000 }) as SemanticBackend;

            let ranDuringScan = false;
            // wordFor(1) ('aab') has a non-zero vector, so it yields a centroid and
            // the full scan actually runs (wordFor(0) is the zero vector → skipped).
            const p = b.prewarm!([{ words: [wordFor(1)], k: 3 }]);
            // If prewarm yields mid-scan, this immediate runs before it resolves;
            // a fully-synchronous scan would resolve p (microtask) first.
            setImmediate(() => {
                ranDuringScan = true;
            });
            await p;
            expect(ranDuringScan).toBe(true);
        });
    });
});

describe('commonness (file-rank frequency prior)', () => {
    it('ranks earlier (more frequent) words as more common in a frequency-ordered file', () => {
        const freqPath = join(dir, 'freq.vec');
        writeFileSync(freqPath, ['the 1 0 0', 'castle 0.5 0.5 0', 'zyzzyva 0 1 0', ''].join('\n'));
        const b = makeVectorBackend({ path: freqPath }) as SemanticBackend;
        const common = b.commonness!('the');
        const rare = b.commonness!('zyzzyva');
        expect(common).toBe(1); // rank 0 of a frequency-ordered file
        expect(rare).toBeLessThan(common);
        expect(rare).toBeGreaterThan(0);
        expect(b.commonness!('castle')).toBeGreaterThan(rare);
    });

    it('is disabled (neutral 1) for ConceptNet files, whose order is alphabetical', () => {
        const cnPath = join(dir, 'numberbatch.vec');
        writeFileSync(cnPath, ['/c/en/aardvark 1 0 0', '/c/en/zebra 0 1 0', ''].join('\n'));
        const b = makeVectorBackend({ path: cnPath }) as SemanticBackend;
        // Rank would call AARDVARK common and ZEBRA obscure — both must be neutral.
        expect(b.commonness!('aardvark')).toBe(1);
        expect(b.commonness!('zebra')).toBe(1);
    });

    it('is disabled for the bare-token English-only Numberbatch format (alphabetical, no /c/ prefix)', () => {
        const enPath = join(dir, 'numberbatch-en.vec');
        writeFileSync(
            enPath,
            ['4 3', 'aardvark 1 0 0', 'apple 0.5 0.5 0', 'yacht 0.2 0.8 0', 'zebra 0 1 0', ''].join('\n')
        );
        const b = makeVectorBackend({ path: enPath }) as SemanticBackend;
        // No prefix to strip — the sorted token order is the only tell.
        expect(b.commonness!('aardvark')).toBe(1);
        expect(b.commonness!('apple')).toBe(1);
        expect(b.commonness!('zebra')).toBe(1);
    });

    it('memoises nearest() results for repeated queries (same set, any order)', () => {
        const b = makeVectorBackend({ path: vecPath }) as SemanticBackend;
        const first = b.nearest!(['KING', 'MAN'], 3);
        expect(b.nearest!(['MAN', 'KING'], 3)).toBe(first); // cache hit: same array instance
        expect(b.nearest!(['KING', 'MAN'], 2)).not.toBe(first); // different k: distinct entry
    });

    it('defers to the fallback prior for out-of-vocabulary words', () => {
        const freqPath = join(dir, 'freq.vec');
        writeFileSync(freqPath, ['the 1 0 0', 'castle 0.5 0.5 0', ''].join('\n'));
        const fallback: SemanticBackend = {
            id: 'stub',
            relatedness: () => 0,
            commonness: () => 0.42,
        };
        const b = makeVectorBackend({ path: freqPath, fallback }) as SemanticBackend;
        expect(b.commonness!('zebra')).toBe(0.42);
    });
});

describe('proper-noun case signal through the vector backend', () => {
    it('a mixed-case reference clue takes the curated proper reading when it is stronger', () => {
        // WONKA has no vector, and even if it did, embeddings conflate senses —
        // the default fallback chain ends at the proper table, which knows the
        // reference outright.
        const b = makeVectorBackend({ path: vecPath }) as SemanticBackend;
        expect(b.relatedness('Wonka', 'CHOCOLATE')).toBe(1);
    });

    it('prefers the curated fame prior over file rank for reference clues', () => {
        const b = makeVectorBackend({ path: vecPath }) as SemanticBackend;
        expect(b.commonness!('Zelda')).toBe(0.7);
    });
});

describe('getSemanticBackend', () => {
    const prev = process.env.BOT_EMBEDDINGS_PATH;

    afterEach(() => {
        if (prev === undefined) delete process.env.BOT_EMBEDDINGS_PATH;
        else process.env.BOT_EMBEDDINGS_PATH = prev;
        resetSemanticBackendCache();
    });

    it('uses the baked table when no embeddings path is set', () => {
        delete process.env.BOT_EMBEDDINGS_PATH;
        resetSemanticBackendCache();
        expect(getSemanticBackend().id).toBe('table');
    });

    it('uses the vector backend when BOT_EMBEDDINGS_PATH points at a valid file', () => {
        process.env.BOT_EMBEDDINGS_PATH = vecPath;
        resetSemanticBackendCache();
        expect(getSemanticBackend().id).toBe('vectors');
    });

    it('memoises the selection', () => {
        delete process.env.BOT_EMBEDDINGS_PATH;
        resetSemanticBackendCache();
        const first = getSemanticBackend();
        process.env.BOT_EMBEDDINGS_PATH = vecPath; // changed AFTER first resolution
        expect(getSemanticBackend()).toBe(first); // still the memoised table backend
    });

    it('falls back to the table backend when the embeddings file is missing', () => {
        process.env.BOT_EMBEDDINGS_PATH = join(dir, 'missing.vec');
        resetSemanticBackendCache();
        expect(getSemanticBackend().id).toBe('table');
    });
});

describe('makeVectorBackendAsync (N20 non-blocking loader)', () => {
    it('produces the same result as the sync loader', async () => {
        const be = await makeVectorBackendAsync({ path: vecPath });
        expect(be).not.toBeNull();
        const b = be as SemanticBackend;
        expect(b.relatedness('king', 'king')).toBe(1);
        expect(b.relatedness('king', 'queen')).toBeGreaterThan(b.relatedness('king', 'apple'));
        expect(b.vocabulary!()).toContain('KING');
    });

    it('returns null for a missing file', async () => {
        expect(await makeVectorBackendAsync({ path: join(dir, 'nope.vec') })).toBeNull();
    });

    it('yields the event loop while reading (no synchronous block)', async () => {
        // The async loader awaits real fs I/O and a setImmediate yield between
        // chunks, so a setImmediate scheduled right after the call runs before it
        // resolves — a fully-synchronous parse would resolve the microtask first.
        let ranDuringLoad = false;
        const p = makeVectorBackendAsync({ path: vecPath });
        setImmediate(() => {
            ranDuringLoad = true;
        });
        await p;
        expect(ranDuringLoad).toBe(true);
    });
});

describe('warmSemanticBackend (N20 bootstrap warm)', () => {
    const prev = process.env.BOT_EMBEDDINGS_PATH;

    afterEach(() => {
        if (prev === undefined) delete process.env.BOT_EMBEDDINGS_PATH;
        else process.env.BOT_EMBEDDINGS_PATH = prev;
        resetSemanticBackendCache();
    });

    it('serves the table fallback WHILE vectors load, then the vectors once warm', async () => {
        process.env.BOT_EMBEDDINGS_PATH = vecPath;
        resetSemanticBackendCache();

        const warm = warmSemanticBackend();
        // Synchronously, before the warm resolves, a bot that acts must get a
        // working backend — the cheap table, never a blocking vector parse.
        expect(getSemanticBackend().id).toBe('table');

        await warm;
        // Once warmed, the vectors are active.
        expect(getSemanticBackend().id).toBe('vectors');
    });

    it('resolves the table backend eagerly when no embeddings path is set', async () => {
        delete process.env.BOT_EMBEDDINGS_PATH;
        resetSemanticBackendCache();
        await warmSemanticBackend();
        expect(getSemanticBackend().id).toBe('table');
    });

    it('falls back to the table backend when the embeddings file is missing', async () => {
        process.env.BOT_EMBEDDINGS_PATH = join(dir, 'missing-warm.vec');
        resetSemanticBackendCache();
        await warmSemanticBackend();
        expect(getSemanticBackend().id).toBe('table');
    });
});
