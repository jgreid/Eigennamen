/**
 * Offline human-association eval (ledger 2.7): format auto-detection for the
 * supported norms files, the tie-aware Spearman, and the board-shaped
 * retrieval metric — pinned so the eval itself stays trustworthy.
 */
import { parseNorms, spearman, evaluateBackend } from '../../bots/harness/evalAssociations';
import { tableBackend } from '../../bots/semantics/tableBackend';
import { lexicalBackend } from '../../bots/semantics/backend';

describe('parseNorms format auto-detection', () => {
    it('parses a SWOW-style strength file (TSV, R1.Strength)', () => {
        const text = ['cue\tresponse\tR1\tN\tR1.Strength', 'dog\tcat\t30\t100\t0.30', 'dog\tbone\t12\t100\t0.12'].join(
            '\n'
        );
        expect(parseNorms(text)).toEqual([
            { cue: 'DOG', response: 'CAT', strength: 0.3 },
            { cue: 'DOG', response: 'BONE', strength: 0.12 },
        ]);
    });

    it('parses a USF-style appendix file (CSV, CUE/TARGET/FSG)', () => {
        const text = [
            'CUE, TARGET, NORMED?, #G, #P, FSG, BSG',
            'OCEAN, WAVE, YES, 143, 40, 0.28, 0.10',
            'OCEAN, WATER, YES, 143, 60, 0.42, 0.05',
        ].join('\n');
        expect(parseNorms(text)).toEqual([
            { cue: 'OCEAN', response: 'WAVE', strength: 0.28 },
            { cue: 'OCEAN', response: 'WATER', strength: 0.42 },
        ]);
    });

    it('parses a generic CSV and skips malformed/phrase/self rows', () => {
        const text = [
            'cue,response,strength',
            'winter,snow,0.5',
            'winter,winter,0.9', // self pair — skipped
            'new york,city,0.4', // multi-word cue — skipped
            'winter,cold,not-a-number', // bad strength — skipped
            'winter,ice,1.5', // out of (0,1] — skipped
        ].join('\n');
        expect(parseNorms(text)).toEqual([{ cue: 'WINTER', response: 'SNOW', strength: 0.5 }]);
    });

    it('returns [] when required columns are missing', () => {
        expect(parseNorms('a,b,c\n1,2,3')).toEqual([]);
        expect(parseNorms('')).toEqual([]);
    });
});

describe('spearman', () => {
    it('is 1 for a monotone relationship and -1 for a reversed one', () => {
        expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 10);
        expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1, 10);
    });

    it('handles ties via average ranks and short input safely', () => {
        const r = spearman([1, 1, 2, 3], [5, 5, 7, 9]);
        expect(r).toBeGreaterThan(0.9);
        expect(spearman([1, 2], [2, 1])).toBe(0); // n < 3 → no signal claimed
    });
});

describe('evaluateBackend (board-shaped retrieval)', () => {
    // Norms whose responses are DEFAULT_WORDS: the table KNOWS these edges
    // (ANIMAL group, OCEAN group), so it must beat lexical on retrieval.
    const norms = parseNorms(
        [
            'cue,response,strength',
            'animal,bear,0.30',
            'animal,lion,0.25',
            'ocean,whale,0.30',
            'ocean,shark,0.22',
            'swim,pool,0.28',
            'planet,moon,0.35',
        ].join('\n')
    );

    it('scores the table backend far above lexical on known associations', () => {
        const table = evaluateBackend('table', tableBackend, norms, { seed: 't', distractors: 24 });
        const lexical = evaluateBackend('lexical', lexicalBackend, norms, { seed: 't', distractors: 24 });
        expect(table.cues).toBe(4); // one trial per distinct cue
        expect(table.top1).toBe(1); // every human top response found
        expect(table.top1).toBeGreaterThan(lexical.top1);
        expect(table.mrr).toBeGreaterThanOrEqual(lexical.mrr);
    });

    it('is deterministic for a fixed seed', () => {
        const a = evaluateBackend('table', tableBackend, norms, { seed: 'x' });
        const b = evaluateBackend('table', tableBackend, norms, { seed: 'x' });
        expect(a).toEqual(b);
    });

    it('drops pairs whose response is not in the vocabulary', () => {
        const out = evaluateBackend(
            'table',
            tableBackend,
            parseNorms(['cue,response,strength', 'animal,zebra,0.3'].join('\n')),
            { vocabulary: ['BEAR'] }
        );
        expect(out.pairs).toBe(0);
        expect(out.cues).toBe(0);
    });
});
