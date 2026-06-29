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
