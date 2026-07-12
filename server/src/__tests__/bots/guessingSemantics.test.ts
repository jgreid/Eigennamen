/**
 * Bot guessing must run on SEMANTIC similarity, not spelling (the
 * "SUNDIAL → INDIA" failure class):
 *  - hasSignal provenance on every backend in the chain (table, map, vectors),
 *  - guessRetrieval damping so a lexical-bigram coincidence never outranks a
 *    genuine semantic read,
 *  - inflection folding so human clues like "ANIMALS 3" retrieve the concepts
 *    the table already knows,
 *  - the greedy clicker banking an uninformed streak after one guess, and the
 *    advisor saying so instead of advising confidently from spelling,
 *  - auto-detection of downloaded embeddings when BOT_EMBEDDINGS_PATH is unset.
 */
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
    clueRetrieval,
    guessRetrieval,
    lexicalBackend,
    LEXICAL_GUESS_DAMP,
    type SemanticBackend,
} from '../../bots/semantics/backend';
import { tableBackend } from '../../bots/semantics/tableBackend';
import { makeCustomMapBackend, type SemanticMap } from '../../bots/semantics/mapBackend';
import { makeVectorBackend } from '../../bots/semantics/vectorBackend';
import {
    detectEmbeddingsPath,
    getSemanticBackend,
    resetSemanticBackendCache,
} from '../../bots/semantics/selectBackend';
import { makeGreedyClicker } from '../../bots/strategies/clickers';
import { suggestGuesses } from '../../bots/strategies/advisor';
import { makeRng } from '../../bots/rng';
import type { BotClickerView, BotContext, SkillParams } from '../../bots/strategies/types';

const skill = (over: Partial<SkillParams> = {}): SkillParams => ({
    temperature: 0,
    blunderRate: 0,
    riskAversion: 0.6,
    seed: 1,
    ...over,
});
const ctx = (s: SkillParams): BotContext => ({ gameMode: 'classic', skill: s, rng: makeRng(1) });

const clickerView = (words: string[], clue: string, number: number, guessesUsed = 0): BotClickerView => ({
    role: 'clicker',
    team: 'red',
    gameMode: 'classic',
    words,
    revealed: words.map(() => false),
    types: words.map(() => null),
    currentTurn: 'red',
    currentClue: { word: clue, number },
    guessesUsed,
    guessesAllowed: number + 1,
});

describe('tableBackend.hasSignal (provenance of relatedness)', () => {
    it('reports semantic provenance for table paths', () => {
        expect(tableBackend.hasSignal?.('ANIMAL', 'BEAR')).toBe(true); // direct edge
        expect(tableBackend.hasSignal?.('BEAR', 'LION')).toBe(true); // co-membership
        expect(tableBackend.hasSignal?.('BEAR', 'BEAR')).toBe(true); // identity
    });

    it('reports NO provenance for lexical-floor coincidences', () => {
        // SUNDIAL/INDIA share bigrams (raw Dice 0.6) but no table knowledge.
        expect(tableBackend.hasSignal?.('SUNDIAL', 'INDIA')).toBe(false);
        expect(tableBackend.relatedness('SUNDIAL', 'INDIA')).toBeGreaterThan(0.5); // the trap this exposes
    });
});

describe('inflection folding (human clues arrive inflected)', () => {
    it('folds plurals and participles to known table forms', () => {
        expect(tableBackend.relatedness('ANIMALS', 'BEAR')).toBe(1);
        expect(tableBackend.relatedness('PLANETS', 'JUPITER')).toBe(1);
        expect(tableBackend.relatedness('SWIMMING', 'POOL')).toBe(1); // doubled consonant
        expect(tableBackend.relatedness('COOKING', 'HONEY')).toBe(1);
        expect(tableBackend.hasSignal?.('ANIMALS', 'BEAR')).toBe(true);
    });

    it('never shadows an exact entry and never folds -SS/-US words', () => {
        // CLOTHES is itself a key: the exact form must keep winning.
        expect(tableBackend.relatedness('CLOTHES', 'SUIT')).toBe(1);
        // GLASS must not fold to GLAS; no crash, no false signal.
        expect(tableBackend.hasSignal?.('GLASS', 'INDIA')).toBe(false);
    });
});

describe('guessRetrieval (guesser-side ranking)', () => {
    it('keeps semantically-backed scores intact and damps lexical noise', () => {
        expect(guessRetrieval(tableBackend, 'ANIMAL', 'BEAR')).toBe(1);
        const raw = clueRetrieval(tableBackend, 'SUNDIAL', 'INDIA');
        expect(guessRetrieval(tableBackend, 'SUNDIAL', 'INDIA')).toBeCloseTo(raw * LEXICAL_GUESS_DAMP, 10);
    });

    it('a damped spelling coincidence never outranks a real semantic read', () => {
        // Raw ranking has INDIA (0.60 lexical) above LION (0.5 co-membership with
        // clue BEAR is a different pair) — craft the exact conflict: clue SUNDIAL
        // scores INDIA 0.6 raw; TIME is in SUNDIAL's... use a synthetic backend
        // for a clean pin instead of depending on table contents.
        const synthetic: SemanticBackend = {
            id: 'synthetic',
            relatedness: (a, b) => (b === 'REAL' ? 0.5 : b === 'JUNK' ? 0.62 : 0),
            hasSignal: (a, b) => b === 'REAL',
        };
        expect(guessRetrieval(synthetic, 'CLUE', 'REAL')).toBe(0.5);
        expect(guessRetrieval(synthetic, 'CLUE', 'JUNK')).toBeCloseTo(0.62 * LEXICAL_GUESS_DAMP, 10);

        const s = skill();
        const action = makeGreedyClicker(s, synthetic).chooseGuess(clickerView(['JUNK', 'REAL'], 'CLUE', 2), ctx(s));
        expect(action).toEqual({ kind: 'reveal', index: 1 });
    });

    it('backends without hasSignal are never damped (provenance unknown)', () => {
        const raw = clueRetrieval(lexicalBackend, 'SUNDIAL', 'INDIA');
        expect(guessRetrieval(lexicalBackend, 'SUNDIAL', 'INDIA')).toBe(raw);
    });
});

describe('greedy clicker: an uninformed decision banks after one guess', () => {
    // A board where the clue means nothing to the table: every score is bigram noise.
    const board = ['INDIA', 'UNDERTAKER', 'GLASS', 'PART'];

    it('still takes the forced first guess (least-bad pick)', () => {
        const s = skill();
        const action = makeGreedyClicker(s, tableBackend).chooseGuess(clickerView(board, 'SUNDIAL', 3), ctx(s));
        expect(action.kind).toBe('reveal');
    });

    it('banks the turn instead of chasing a spelling streak', () => {
        const s = skill();
        const action = makeGreedyClicker(s, tableBackend).chooseGuess(clickerView(board, 'SUNDIAL', 3, 1), ctx(s));
        expect(action).toEqual({ kind: 'endTurn' });
    });

    it('an informed clue keeps its full multi-guess delivery', () => {
        const s = skill();
        const view = clickerView(['BEAR', 'LION', 'INDIA', 'GLASS'], 'ANIMAL', 2, 1);
        expect(makeGreedyClicker(s, tableBackend).chooseGuess(view, ctx(s)).kind).toBe('reveal');
    });

    it('a blunder cannot extend an uninformed streak', () => {
        const s = skill({ blunderRate: 1 });
        const action = makeGreedyClicker(s, tableBackend).chooseGuess(clickerView(board, 'SUNDIAL', 3, 1), ctx(s));
        expect(action).toEqual({ kind: 'endTurn' });
    });
});

describe('advisor: says when its picks are spelling-only', () => {
    it('attaches the unknown-clue warning and damped confidence', () => {
        const out = suggestGuesses(clickerView(['INDIA', 'UNDERTAKER', 'GLASS'], 'SUNDIAL', 2), tableBackend);
        expect(out.length).toBeGreaterThan(0);
        for (const s of out) {
            expect(s.warning).toMatch(/outside the bot vocabulary/);
            expect(s.confidence).toBeLessThanOrEqual(LEXICAL_GUESS_DAMP);
        }
    });

    it('an informed clue carries no unknown-clue warning', () => {
        const out = suggestGuesses(clickerView(['BEAR', 'LION', 'GLASS'], 'ANIMAL', 2), tableBackend);
        expect(out.length).toBeGreaterThan(0);
        expect(out[0]?.warning).toBeUndefined();
        expect(out[0]?.confidence).toBe(1);
    });
});

describe('map + vector backends: hasSignal follows the chain', () => {
    const MAP: SemanticMap = {
        version: 2,
        words: ['TORCH', 'LOG', 'HEART'],
        concepts: { TINDER: ['TORCH', 'LOG'] },
        proper: { Tinder: { contents: ['HEART'], fame: 0.85 } },
    };

    it('map overlay: own edges signal; unknown pairs defer to the fallback', () => {
        const overTable = makeCustomMapBackend([MAP], tableBackend);
        expect(overTable.hasSignal?.('TINDER', 'TORCH')).toBe(true);
        expect(overTable.hasSignal?.('Tinder', 'HEART')).toBe(true);
        expect(overTable.hasSignal?.('ANIMAL', 'BEAR')).toBe(true); // via fallback
        expect(overTable.hasSignal?.('SUNDIAL', 'INDIA')).toBe(false);

        const overLexical = makeCustomMapBackend([MAP], lexicalBackend);
        // A lexical fallback has no provenance to contribute.
        expect(overLexical.hasSignal?.('ANIMAL', 'BEAR')).toBe(false);
    });

    it('vectors: an in-vocabulary pair signals; OOV defers to the fallback', () => {
        const dir = mkdtempSync(join(tmpdir(), 'eig-sig-'));
        try {
            const vecPath = join(dir, 'v.vec');
            writeFileSync(vecPath, ['3 3', 'king 1 1 0', 'queen 1 0.9 0.1', 'apple 0 0.1 1', ''].join('\n'));
            const vb = makeVectorBackend({ path: vecPath, fallback: tableBackend }) as SemanticBackend;
            expect(vb.hasSignal?.('KING', 'APPLE')).toBe(true); // weakly related, but KNOWN
            expect(vb.hasSignal?.('ANIMAL', 'BEAR')).toBe(true); // OOV → table signal
            expect(vb.hasSignal?.('SUNDIAL', 'INDIA')).toBe(false); // OOV → lexical floor
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('tier composition: curated signal is never shadowed by cosine', () => {
    // Orthogonal vectors for pairs the curated layers KNOW, plus a lexical
    // lookalike pair the curated layers don't — pinning that the max is gated
    // on real provenance, not on the bigram floor.
    const write = (dir: string): string => {
        const vecPath = join(dir, 'v.vec');
        writeFileSync(
            vecPath,
            [
                '6 3',
                'animal 1 0 0',
                'bear 0 1 0',
                'sundial 1 0 0',
                'india 0 1 0',
                'tentacle 1 0 0',
                'octopus 0 1 0',
                '',
            ].join('\n')
        );
        return vecPath;
    };

    it('a curated table edge wins over a weak cosine for in-vocabulary words', () => {
        const dir = mkdtempSync(join(tmpdir(), 'eig-comp-'));
        try {
            const vb = makeVectorBackend({ path: write(dir), fallback: tableBackend }) as SemanticBackend;
            // Cosine is 0 (orthogonal), but the table KNOWS ANIMAL→BEAR.
            expect(vb.relatedness('ANIMAL', 'BEAR')).toBe(1);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('a curated map edge under vectors wins the same way', () => {
        const dir = mkdtempSync(join(tmpdir(), 'eig-comp-'));
        try {
            const map: SemanticMap = {
                version: 2,
                words: ['OCTOPUS'],
                concepts: { TENTACLE: ['OCTOPUS'] },
            };
            const fallback = makeCustomMapBackend([map], tableBackend);
            const vb = makeVectorBackend({ path: write(dir), fallback }) as SemanticBackend;
            expect(vb.relatedness('TENTACLE', 'OCTOPUS')).toBe(1);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('the lexical bigram floor never overrides a genuine cosine', () => {
        const dir = mkdtempSync(join(tmpdir(), 'eig-comp-'));
        try {
            const vb = makeVectorBackend({ path: write(dir), fallback: tableBackend }) as SemanticBackend;
            // SUNDIAL/INDIA: raw bigram overlap is ~0.6, but the table has NO
            // signal for the pair — the (orthogonal) cosine must stand.
            expect(vb.relatedness('SUNDIAL', 'INDIA')).toBe(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('embeddings auto-detection', () => {
    it('finds the most specific asset at the well-known locations', () => {
        const dir = mkdtempSync(join(tmpdir(), 'eig-auto-'));
        try {
            expect(detectEmbeddingsPath(dir)).toBeNull();
            mkdirSync(join(dir, 'src', 'bots', 'data'), { recursive: true });
            writeFileSync(join(dir, 'src', 'bots', 'data', 'glove.6B.100d.vec'), 'x 1 2 3\n');
            expect(detectEmbeddingsPath(dir)).toBe(join(dir, 'src', 'bots', 'data', 'glove.6B.100d.vec'));
            // The distilled board artifact outranks a raw model download.
            writeFileSync(join(dir, 'src', 'bots', 'data', 'board-vectors.vec'), 'x 1 2 3\n');
            expect(detectEmbeddingsPath(dir)).toBe(join(dir, 'src', 'bots', 'data', 'board-vectors.vec'));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('BOT_EMBEDDINGS_PATH=off explicitly disables embeddings', () => {
        const prev = process.env.BOT_EMBEDDINGS_PATH;
        try {
            process.env.BOT_EMBEDDINGS_PATH = 'off';
            resetSemanticBackendCache();
            expect(getSemanticBackend().id).toBe('table');
        } finally {
            if (prev === undefined) delete process.env.BOT_EMBEDDINGS_PATH;
            else process.env.BOT_EMBEDDINGS_PATH = prev;
            resetSemanticBackendCache();
        }
    });
});

describe('advisor sampling is scale-invariant (compressed vector scores)', () => {
    // Compressed-scale field (vector-backend regime): the best read at 0.30,
    // alternatives at 0.10-0.14. The old absolute-delta softmax went near-flat
    // here, so a sampled advisor could push its BEST suggestion off the list a
    // human sees. With the shared confidence-scaled weighting, the top read
    // survives sampling essentially always.
    const compressed: SemanticBackend = {
        id: 'compressed',
        relatedness: (_a, b) =>
            b === 'BEST' ? 0.3 : b === 'OKAY' ? 0.14 : b === 'MEH' ? 0.12 : b === 'ALSO' ? 0.11 : 0.1,
        hasSignal: () => true,
    };
    it('keeps the top suggestion in the sampled list at advisor temperature', () => {
        const words = ['BEST', 'OKAY', 'MEH', 'ALSO', 'MORE'];
        const s = skill({ temperature: 0.42 });
        let included = 0;
        const runs = 200;
        for (let seed = 1; seed <= runs; seed++) {
            const out = suggestGuesses(clickerView(words, 'CLUE', 3), compressed, 3, s, makeRng(seed));
            if (out.some((g) => g.index === 0)) included++;
        }
        expect(included / runs).toBeGreaterThan(0.9);
    });
});
