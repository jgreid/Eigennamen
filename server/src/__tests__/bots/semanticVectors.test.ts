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
import { makeVectorBackend } from '../../bots/semantics/vectorBackend';
import { getSemanticBackend, resetSemanticBackendCache } from '../../bots/semantics/selectBackend';
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
