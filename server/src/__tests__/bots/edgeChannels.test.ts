/**
 * Phase-2 edge channels (docs/BOT_NUANCE_PLAN.md — the keystone widening):
 * the weighted association index, SemanticMap v2 validation and overlay
 * semantics, clueRetrieval, and the misfire-class-D gate — a compound trap
 * intercepts a promised slot, so a collocation-blind spymaster reproduces the
 * live misfire (ENGINE 2 → BOX) and a channel-aware one avoids it, while the
 * greedy clicker with the channel is a faithful stand-in for the human who
 * completes the phrase.
 */
import { clueRetrieval, lexicalBackend, type SemanticBackend } from '../../bots/semantics/backend';
import { buildAssociationIndex, directEdgeMeta, scoreCommonAssociation } from '../../bots/semantics/associationIndex';
import { isSemanticMap, makeCustomMapBackend, type SemanticMap } from '../../bots/semantics/mapBackend';
import { makeEmbeddingSpymaster } from '../../bots/strategies/spymasters';
import { makeGreedyClicker } from '../../bots/strategies/clickers';
import { makeRng } from '../../bots/rng';
import type { BotClickerView, BotContext, BotSpymasterView, SkillParams } from '../../bots/strategies/types';

const skill = (over: Partial<SkillParams> = {}): SkillParams => ({
    temperature: 0,
    blunderRate: 0,
    riskAversion: 0.6,
    seed: 1,
    ...over,
});
const ctx = (s: SkillParams, seed = 1): BotContext => ({ gameMode: 'classic', skill: s, rng: makeRng(seed) });

/** Deep-copy a v2 map with every per-edge channel stripped (weights keep) —
 *  the "before Phase 2" twin of the same curated knowledge. */
function stripChannels(map: SemanticMap): SemanticMap {
    const doc = JSON.parse(JSON.stringify(map)) as SemanticMap;
    for (const edges of Object.values(doc.concepts)) {
        for (const e of edges) {
            if (typeof e !== 'string') {
                delete e.kind;
                delete e.penetration;
                delete e.collocation;
            }
        }
    }
    return doc;
}

describe('buildAssociationIndex (weighted edges)', () => {
    it('loads plain strings as weight-1 edges — v1 tables score exactly as before', () => {
        const index = buildAssociationIndex({ ANIMAL: ['BEAR', 'LION'] });
        expect(scoreCommonAssociation(index, 'ANIMAL', 'BEAR')).toBe(1);
        expect(directEdgeMeta(index, 'BEAR', 'ANIMAL')).toEqual({ weight: 1 });
    });

    it('a weighted direct edge scores its curated weight', () => {
        const index = buildAssociationIndex({ MOTOR: [{ word: 'BOX', weight: 0.3, kind: 'compound' }] });
        expect(scoreCommonAssociation(index, 'MOTOR', 'BOX')).toBe(0.3);
        expect(directEdgeMeta(index, 'MOTOR', 'BOX')).toEqual({
            weight: 0.3,
            kind: 'compound',
            penetration: undefined,
            collocation: undefined,
        });
    });

    it('a weak direct edge never scores below the graded co-membership path', () => {
        // A and B share two concept groups (0.67 co-membership) AND carry a
        // weak 0.4 direct edge: an edge the table KNOWS is at least as related
        // as one it merely infers.
        const index = buildAssociationIndex({
            GROUPX: ['AA', 'BB'],
            GROUPY: ['AA', 'BB'],
            AA: [{ word: 'BB', weight: 0.4 }],
        });
        expect(scoreCommonAssociation(index, 'AA', 'BB')).toBeCloseTo(2 / 3, 5);
    });

    it('duplicate edges merge monotonically: max weight, first-declared kind, max channels', () => {
        const index = buildAssociationIndex({
            KEY: [
                { word: 'WORD', weight: 0.5, kind: 'member', collocation: 0.2 },
                { word: 'WORD', weight: 0.9, collocation: 0.7 },
            ],
        });
        expect(directEdgeMeta(index, 'KEY', 'WORD')).toEqual({
            weight: 0.9,
            kind: 'member',
            penetration: undefined,
            collocation: 0.7,
        });
    });
});

describe('isSemanticMap (v2)', () => {
    const v2 = (over: Partial<SemanticMap>): unknown => ({
        version: 2,
        words: ['GAS', 'BOX'],
        concepts: {},
        ...over,
    });

    it('accepts weighted edges, plain strings, and structured proper entries with rivals', () => {
        expect(
            isSemanticMap(
                v2({
                    concepts: { MOTOR: ['GAS', { word: 'BOX', weight: 0.3, kind: 'compound', collocation: 0.8 }] },
                    proper: {
                        Cinderella: {
                            contents: [{ word: 'BOX', weight: 0.8 }],
                            fame: 0.95,
                            rivals: [{ referent: 'Cendrillon', fame: 0.2, contents: ['GAS'] }],
                        },
                        NASCAR: ['GAS'],
                    },
                })
            )
        ).toBe(true);
    });

    it('rejects malformed v2 documents', () => {
        expect(isSemanticMap(v2({ concepts: { X: [{ word: 'GAS', weight: 1.5 }] } }))).toBe(false);
        expect(isSemanticMap(v2({ concepts: { X: [{ word: 'GAS', weight: 0 }] } }))).toBe(false);
        expect(isSemanticMap(v2({ concepts: { X: [{ word: 'GAS', kind: 'vibes' }] } }))).toBe(false);
        expect(isSemanticMap(v2({ concepts: { X: [{ weight: 0.5 }] } }))).toBe(false);
        expect(isSemanticMap(v2({ proper: { Ref: { fame: 0.5 } } }))).toBe(false);
        expect(isSemanticMap(v2({ proper: { Ref: { contents: ['GAS'], rivals: [{ contents: [] }] } } }))).toBe(false);
    });
});

// A small v2 map exercising every channel. Fallback is the lexical backend so
// the tests stay hermetic (no baked-table knowledge involved).
const V2_MAP: SemanticMap = {
    version: 2,
    words: ['GAS', 'CAR', 'BOX', 'SPRING', 'SLIPPER', 'PUMPKIN'],
    concepts: {
        MOTOR: [
            { word: 'GAS', weight: 0.9, kind: 'function' },
            { word: 'CAR', weight: 0.7, kind: 'member' },
            { word: 'BOX', weight: 0.3, kind: 'compound', collocation: 0.8 },
        ],
        ELASTIC: [{ word: 'SPRING', weight: 0.9, kind: 'attribute', penetration: 0.25 }],
    },
    proper: {
        Cinderella: {
            contents: [
                { word: 'SLIPPER', weight: 1 },
                { word: 'PUMPKIN', weight: 0.8 },
            ],
            fame: 0.95,
        },
    },
};

describe('v2 overlay backend semantics', () => {
    const backend = makeCustomMapBackend([V2_MAP], lexicalBackend);

    it('weighted direct edges score their curated weight', () => {
        expect(backend.relatedness('MOTOR', 'GAS')).toBe(0.9);
        expect(backend.relatedness('MOTOR', 'BOX')).toBe(0.3);
    });

    it('structured proper entries: weighted contents, fame as commonness, case exclusion', () => {
        expect(backend.relatedness('Cinderella', 'SLIPPER')).toBe(1);
        expect(backend.relatedness('Cinderella', 'PUMPKIN')).toBe(0.8);
        expect(backend.commonness!('Cinderella')).toBe(0.95);
        // The reference sense excludes the rest of the board.
        expect(backend.relatedness('Cinderella', 'GAS')).toBeLessThan(0.5);
    });

    it('edgeInfo reports the direct edge channels and honours case routing', () => {
        expect(backend.edgeInfo!('MOTOR', 'GAS')).toEqual({ strength: 0.9, kind: 'function', penetration: undefined });
        expect(backend.edgeInfo!('ELASTIC', 'SPRING')).toEqual({
            strength: 0.9,
            kind: 'attribute',
            penetration: 0.25,
        });
        expect(backend.edgeInfo!('Cinderella', 'SLIPPER')).toEqual({
            strength: 1,
            kind: undefined,
            penetration: undefined,
        });
        // A lowercase clue is the common sense: the proper edge must not leak.
        expect(backend.edgeInfo!('cinderella', 'SLIPPER')).toBeNull();
        expect(backend.edgeInfo!('MOTOR', 'SPRING')).toBeNull();
    });

    it('collocation is order-symmetric, case-independent, and falls through the chain', () => {
        expect(backend.collocation!('MOTOR', 'BOX')).toBe(0.8);
        expect(backend.collocation!('BOX', 'MOTOR')).toBe(0.8);
        expect(backend.collocation!('motor', 'BOX')).toBe(0.8);
        expect(backend.collocation!('MOTOR', 'GAS')).toBe(0);

        const phraseFallback: SemanticBackend = {
            id: 'phrase-stub',
            relatedness: () => 0,
            collocation: () => 0.66,
        };
        const chained = makeCustomMapBackend([V2_MAP], phraseFallback);
        expect(chained.collocation!('MOTOR', 'GAS')).toBe(0.66);
        expect(chained.collocation!('MOTOR', 'BOX')).toBe(0.8);
    });

    it('a v1 map and a v2 map merge into one overlay', () => {
        const v1: SemanticMap = { version: 1, words: ['BEAR'], concepts: { WILD: ['BEAR'] } };
        const merged = makeCustomMapBackend([v1, V2_MAP], lexicalBackend);
        expect(merged.relatedness('WILD', 'BEAR')).toBe(1);
        expect(merged.relatedness('MOTOR', 'GAS')).toBe(0.9);
    });
});

describe('clueRetrieval', () => {
    it('is bare relatedness for channel-less backends and max(rel, collocation) otherwise', () => {
        expect(clueRetrieval(lexicalBackend, 'MOTOR', 'BOX')).toBe(lexicalBackend.relatedness('MOTOR', 'BOX'));
        const backend = makeCustomMapBackend([V2_MAP], lexicalBackend);
        expect(clueRetrieval(backend, 'MOTOR', 'BOX')).toBe(0.8); // phrase beats the weak edge
        expect(clueRetrieval(backend, 'MOTOR', 'GAS')).toBe(0.9);
    });
});

// ---------------------------------------------------------------------------
// The Phase-2 gate: misfire class D (member-beats-compound) reproduces with a
// collocation-blind spymaster and disappears with a channel-aware one.
// ---------------------------------------------------------------------------

// Board: OWNA/OWNB are red; TRAP and OPPO are blue. LINKY covers both own
// cards on associations alone — but LINKY+TRAP is a common phrase (the ENGINE
// BOX pattern), so a human guesser reaches TRAP before OWNB.
const TRAP_MAP: SemanticMap = {
    version: 2,
    words: ['OWNA', 'OWNB', 'TRAP', 'OPPO'],
    concepts: {
        LINKY: [
            { word: 'OWNA', weight: 0.9, kind: 'member' },
            { word: 'OWNB', weight: 0.5, kind: 'member' },
            { word: 'TRAP', weight: 0.3, kind: 'compound', collocation: 0.85 },
        ],
        SOLO: [{ word: 'OWNA', weight: 0.8, kind: 'member' }],
    },
};

const TRAP_WORDS = ['OWNA', 'OWNB', 'TRAP', 'OPPO'];
const TRAP_TYPES: ('red' | 'blue' | 'neutral' | 'assassin')[] = ['red', 'red', 'blue', 'blue'];

const spymasterView = (): BotSpymasterView => ({
    role: 'spymaster',
    team: 'red',
    gameMode: 'classic',
    words: TRAP_WORDS,
    revealed: TRAP_WORDS.map(() => false),
    types: TRAP_TYPES,
    currentTurn: 'red',
});

describe('misfire class D: member-beats-compound (the Phase-2 gate)', () => {
    const blind = makeCustomMapBackend([stripChannels(TRAP_MAP)], lexicalBackend);
    const aware = makeCustomMapBackend([TRAP_MAP], lexicalBackend);

    it('BEFORE: a collocation-blind spymaster promises 2 straight into the trap', () => {
        const s = skill();
        const action = makeEmbeddingSpymaster(s, blind).chooseClue(spymasterView(), ctx(s));
        expect(action).toMatchObject({ kind: 'clue', word: 'LINKY', number: 2 });
    });

    it('the channel-aware clicker (the human stand-in) completes the phrase and misfires', () => {
        const s = skill();
        const clicker = makeGreedyClicker(s, aware);
        const view = (revealed: boolean[], guessesUsed: number): BotClickerView => ({
            role: 'clicker',
            team: 'red',
            gameMode: 'classic',
            words: TRAP_WORDS,
            revealed,
            types: revealed.map((r, i) => (r ? TRAP_TYPES[i]! : null)),
            currentTurn: 'red',
            currentClue: { word: 'LINKY', number: 2 },
            guessesUsed,
            guessesAllowed: 3,
        });
        // First guess: the strongest own card.
        expect(clicker.chooseGuess(view([false, false, false, false], 0), ctx(s))).toEqual({
            kind: 'reveal',
            index: 0,
        });
        // Second guess: the phrase completion (retrieval 0.85) outranks the
        // intended second card (0.5) — the promised slot is intercepted.
        expect(clicker.chooseGuess(view([true, false, false, false], 1), ctx(s))).toEqual({
            kind: 'reveal',
            index: 2,
        });
    });

    it('AFTER: the channel-aware spymaster sees the interception and downgrades to the safe single', () => {
        // With the phrase channel, TRAP's effective retrieval (0.85) enters
        // the non-own field: OWNA (0.9) no longer clears it by the safety
        // margin, LINKY dies, and the safe SOLO single is chosen instead.
        const s = skill();
        const action = makeEmbeddingSpymaster(s, aware).chooseClue(spymasterView(), ctx(s));
        expect(action).toMatchObject({ kind: 'clue', word: 'SOLO', number: 1 });
    });
});

describe('fame-of-fact and concreteness channels in clue scoring', () => {
    const boardView = (): BotSpymasterView => ({
        role: 'spymaster',
        team: 'red',
        gameMode: 'classic',
        words: ['OWNA', 'OWNB', 'OPPO'],
        revealed: [false, false, false],
        types: ['red', 'red', 'blue'],
        currentTurn: 'red',
    });

    it('a low-penetration deep cut loses to a folk clue the whole table retrieves', () => {
        // DEEPCUT edges are stronger (higher clarity wins without channels),
        // but only a fifth of guessers retrieve them at table speed.
        const map: SemanticMap = {
            version: 2,
            words: ['OWNA', 'OWNB', 'OPPO'],
            concepts: {
                DEEPCUT: [
                    { word: 'OWNA', weight: 0.9, penetration: 0.2 },
                    { word: 'OWNB', weight: 0.85, penetration: 0.2 },
                ],
                FOLKSY: [
                    { word: 'OWNA', weight: 0.8 },
                    { word: 'OWNB', weight: 0.75 },
                ],
            },
        };
        const s = skill();
        const before = makeEmbeddingSpymaster(s, makeCustomMapBackend([stripChannels(map)], lexicalBackend));
        expect(before.chooseClue(boardView(), ctx(s))).toMatchObject({ kind: 'clue', word: 'DEEPCUT', number: 2 });
        const after = makeEmbeddingSpymaster(s, makeCustomMapBackend([map], lexicalBackend));
        expect(after.chooseClue(boardView(), ctx(s))).toMatchObject({ kind: 'clue', word: 'FOLKSY', number: 2 });
    });

    it('abstract retrieval paths (attribute edges) pay the concreteness gradient', () => {
        const map: SemanticMap = {
            version: 2,
            words: ['OWNA', 'OWNB', 'OPPO'],
            concepts: {
                VIBES: [
                    { word: 'OWNA', weight: 0.9, kind: 'attribute' },
                    { word: 'OWNB', weight: 0.85, kind: 'attribute' },
                ],
                THINGS: [
                    { word: 'OWNA', weight: 0.8, kind: 'content' },
                    { word: 'OWNB', weight: 0.75, kind: 'content' },
                ],
            },
        };
        const s = skill();
        const before = makeEmbeddingSpymaster(s, makeCustomMapBackend([stripChannels(map)], lexicalBackend));
        expect(before.chooseClue(boardView(), ctx(s))).toMatchObject({ kind: 'clue', word: 'VIBES', number: 2 });
        const after = makeEmbeddingSpymaster(s, makeCustomMapBackend([map], lexicalBackend));
        expect(after.chooseClue(boardView(), ctx(s))).toMatchObject({ kind: 'clue', word: 'THINGS', number: 2 });
    });
});
