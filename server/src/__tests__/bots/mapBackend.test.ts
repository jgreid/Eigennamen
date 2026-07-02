/**
 * Custom semantic-map overlays: the document validator/loader, the overlay
 * backend's case-signal semantics and fallback chain, selectBackend wiring,
 * and the end-to-end payoff — bots on a PREPARED custom word list clue like
 * they do on the default list instead of degrading to the lexical floor.
 */
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
    isSemanticMap,
    loadSemanticMaps,
    makeCustomMapBackend,
    type SemanticMap,
} from '../../bots/semantics/mapBackend';
import { tableBackend } from '../../bots/semantics/tableBackend';
import { getSemanticBackend, resetSemanticBackendCache } from '../../bots/semantics/selectBackend';
import { analyzeGames } from '../../bots/harness/analyze';
import type { Entrant } from '../../bots/harness/types';

const CUSTOM_WORDS = [
    'NEBULA',
    'QUANTUM',
    'PARADOX',
    'CRIMSON',
    'EMBER',
    'VELVET',
    'RIBBON',
    'LANTERN',
    'THUNDER',
    'ZEPHYR',
    'WHISPER',
    'COMPASS',
    'HARBOR',
    'GLACIER',
    'CANYON',
    'MEADOW',
    'ORCHID',
    'SPROUT',
    'WALNUT',
    'KETTLE',
    'BISCUIT',
    'DOMINO',
    'JIGSAW',
    'TROPHY',
    'FALCON',
    'SADDLE',
    'GADGET',
    'MARBLE',
    'PEBBLE',
    'WHISK',
];

/** A hand-written map over CUSTOM_WORDS, the shape `npm run bots:map` emits. */
const CUSTOM_MAP: SemanticMap = {
    version: 1,
    words: CUSTOM_WORDS,
    concepts: {
        SCIENCE: ['QUANTUM', 'PARADOX', 'NEBULA'],
        RED: ['CRIMSON', 'EMBER'],
        FABRIC: ['VELVET', 'RIBBON'],
        STORM: ['THUNDER', 'ZEPHYR'],
        SOFT: ['WHISPER', 'VELVET'],
        NAVIGATE: ['COMPASS', 'HARBOR'],
        NATURE: ['GLACIER', 'CANYON', 'MEADOW', 'ORCHID'],
        GARDEN: ['ORCHID', 'MEADOW', 'SPROUT'],
        KITCHEN: ['KETTLE', 'BISCUIT', 'WALNUT', 'WHISK'],
        TABLETOP: ['DOMINO', 'JIGSAW'],
        PRIZE: ['TROPHY'],
        BIRD: ['FALCON'],
        WEST: ['SADDLE', 'CANYON'],
        TOOL: ['GADGET', 'COMPASS', 'LANTERN'],
        STONE: ['MARBLE', 'PEBBLE', 'GLACIER'],
    },
    proper: {
        Aladdin: ['LANTERN', 'CANYON'],
        NASCAR: ['TROPHY', 'THUNDER'],
    },
    commonness: {
        SCIENCE: 1,
        Aladdin: 0.9,
        NASCAR: 0.75,
    },
};

describe('isSemanticMap', () => {
    it('accepts a well-formed v1 document and rejects malformed ones', () => {
        expect(isSemanticMap(CUSTOM_MAP)).toBe(true);
        expect(isSemanticMap(null)).toBe(false);
        expect(isSemanticMap({ version: 2, words: [], concepts: {} })).toBe(false);
        expect(isSemanticMap({ version: 1, words: ['A'], concepts: { X: 'not-an-array' } })).toBe(false);
        expect(isSemanticMap({ version: 1, words: ['A'], concepts: {}, commonness: { X: 2 } })).toBe(false);
    });
});

describe('loadSemanticMaps', () => {
    let dir: string;
    beforeAll(() => {
        dir = mkdtempSync(join(tmpdir(), 'eig-maps-'));
        writeFileSync(join(dir, 'good.json'), JSON.stringify(CUSTOM_MAP));
        writeFileSync(join(dir, 'bad-shape.json'), JSON.stringify({ version: 99 }));
        writeFileSync(join(dir, 'not-json.json'), '{oops');
        writeFileSync(join(dir, 'ignored.txt'), 'not a map');
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('loads valid maps and skips invalid ones without throwing', () => {
        const maps = loadSemanticMaps(dir);
        expect(maps).toHaveLength(1);
        expect(maps[0]!.words).toContain('NEBULA');
    });

    it('returns [] for a missing directory', () => {
        expect(loadSemanticMaps(join(dir, 'nope'))).toEqual([]);
    });
});

describe('makeCustomMapBackend', () => {
    const backend = makeCustomMapBackend([CUSTOM_MAP], tableBackend);

    it('scores map concepts like the baked table scores its own', () => {
        expect(backend.relatedness('SCIENCE', 'QUANTUM')).toBe(1);
        // Co-membership: GLACIER and CANYON share NATURE (and GLACIER/MEADOW too).
        expect(backend.relatedness('GLACIER', 'CANYON')).toBeGreaterThanOrEqual(0.5);
        expect(backend.relatedness('GLACIER', 'CANYON')).toBeLessThan(1);
    });

    it('honours the case convention for map references', () => {
        expect(backend.relatedness('Aladdin', 'LANTERN')).toBe(1); // magic lamp
        expect(backend.relatedness('Aladdin', 'KETTLE')).toBeLessThan(0.5); // reference excludes the rest
        // Canonical all-caps reference key from the map itself.
        expect(backend.relatedness('NASCAR', 'TROPHY')).toBe(1);
    });

    it('falls through to the baked table for pairs the maps do not know', () => {
        // Default-table knowledge must survive the overlay (combined lists).
        expect(backend.relatedness('ANIMAL', 'BEAR')).toBe(1);
        expect(backend.relatedness('Cinderella', 'GLASS')).toBe(1);
    });

    it('merges vocabulary and commonness across the chain', () => {
        const vocab = backend.vocabulary!();
        expect(vocab).toContain('SCIENCE'); // map concept
        expect(vocab).toContain('Aladdin'); // map reference, display case
        expect(vocab).toContain('ANIMAL'); // baked table concept
        expect(backend.commonness!('NASCAR')).toBe(0.75);
        expect(backend.commonness!('Zelda')).toBe(0.7); // baked fame via fallback
        expect(backend.commonness!('SCIENCE')).toBe(1);
    });
});

describe('selectBackend chain with BOT_SEMANTIC_MAPS_DIR', () => {
    const prev = process.env.BOT_SEMANTIC_MAPS_DIR;
    let dir: string;

    beforeAll(() => {
        dir = mkdtempSync(join(tmpdir(), 'eig-maps-sel-'));
        writeFileSync(join(dir, 'custom.json'), JSON.stringify(CUSTOM_MAP));
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));
    afterEach(() => {
        if (prev === undefined) delete process.env.BOT_SEMANTIC_MAPS_DIR;
        else process.env.BOT_SEMANTIC_MAPS_DIR = prev;
        resetSemanticBackendCache();
    });

    it('overlays the maps when the directory has any', () => {
        process.env.BOT_SEMANTIC_MAPS_DIR = dir;
        resetSemanticBackendCache();
        const backend = getSemanticBackend();
        expect(backend.id).toBe('custom-map');
        expect(backend.relatedness('SCIENCE', 'QUANTUM')).toBe(1);
    });

    it('stays on the baked table when the directory is empty/missing', () => {
        process.env.BOT_SEMANTIC_MAPS_DIR = join(dir, 'empty-subdir');
        mkdirSync(join(dir, 'empty-subdir'), { recursive: true });
        resetSemanticBackendCache();
        expect(getSemanticBackend().id).toBe('table');
    });
});

describe('end to end: a prepared custom list plays at table quality', () => {
    const prev = process.env.BOT_SEMANTIC_MAPS_DIR;
    let dir: string;

    beforeAll(() => {
        dir = mkdtempSync(join(tmpdir(), 'eig-maps-e2e-'));
        writeFileSync(join(dir, 'custom.json'), JSON.stringify(CUSTOM_MAP));
    });
    afterAll(() => {
        rmSync(dir, { recursive: true, force: true });
        if (prev === undefined) delete process.env.BOT_SEMANTIC_MAPS_DIR;
        else process.env.BOT_SEMANTIC_MAPS_DIR = prev;
        resetSemanticBackendCache();
    });

    const entrants: Entrant[] = [
        {
            id: 'alpha',
            spymaster: { strategyId: 'embeddingSpymaster', skillPreset: 'expert' },
            clicker: { strategyId: 'greedyClicker', skillPreset: 'expert' },
        },
        {
            id: 'beta',
            spymaster: { strategyId: 'embeddingSpymaster', skillPreset: 'strategist' },
            clicker: { strategyId: 'greedyClicker', skillPreset: 'expert' },
        },
    ];

    function run(): { avgNumber: number; deliveryRate: number } {
        const { diagnostics } = analyzeGames({
            entrants,
            gameMode: 'classic',
            gamesPerPair: 4,
            baseSeed: 'mapvalue',
            words: CUSTOM_WORDS,
        });
        const clues = diagnostics.reduce((s, d) => s + d.clues, 0);
        return {
            avgNumber: diagnostics.reduce((s, d) => s + d.avgNumber * d.clues, 0) / clues,
            deliveryRate: diagnostics.reduce((s, d) => s + d.deliveryRate * d.clues, 0) / clues,
        };
    }

    it('a semantic map raises clue numbers vs the lexical floor on the same list', () => {
        delete process.env.BOT_SEMANTIC_MAPS_DIR;
        process.env.BOT_SEMANTIC_MAPS_DIR = join(dir, 'does-not-exist');
        resetSemanticBackendCache();
        const unmapped = run();

        process.env.BOT_SEMANTIC_MAPS_DIR = dir;
        resetSemanticBackendCache();
        const mapped = run();

        // The whole point of preparing the list in advance: real multi-card
        // clues instead of orthographic scraps.
        expect(mapped.avgNumber).toBeGreaterThan(unmapped.avgNumber);
        expect(mapped.deliveryRate).toBeGreaterThan(0.6);
    });
});
