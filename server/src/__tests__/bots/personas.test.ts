/**
 * Personae: the persona registry, its resolution through resolveSkill, and the
 * style knobs (aggression / defenseBias) actually changing the spymaster's clue.
 */
import { PERSONAS, isPersona, getPersona, resolvePersona } from '../../bots/personas';
import { resolveSkill, isSkillOrPersona } from '../../bots/presets';
import { resolveStyle } from '../../bots/strategies/types';
import { makeEmbeddingSpymaster } from '../../bots/strategies/spymasters';
import { makeRng } from '../../bots/rng';
import type { SemanticBackend } from '../../bots/semantics/backend';
import type { BotSpymasterView, BotContext, SkillParams } from '../../bots/strategies/types';

describe('persona registry', () => {
    it('defines a stable, non-empty roster with unique ids', () => {
        const ids = PERSONAS.map((p) => p.id);
        expect(ids).toEqual(expect.arrayContaining(['strategist', 'sharpshooter', 'guardian', 'daredevil']));
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('every persona carries a label, blurb, tier and skill', () => {
        for (const p of PERSONAS) {
            expect(p.label.length).toBeGreaterThan(0);
            expect(p.blurb.length).toBeGreaterThan(0);
            expect(['novice', 'intermediate', 'expert']).toContain(p.tier);
            expect(typeof p.skill.temperature).toBe('number');
        }
    });

    it('isPersona / getPersona / resolvePersona agree', () => {
        expect(isPersona('strategist')).toBe(true);
        expect(isPersona('not-a-persona')).toBe(false);
        expect(getPersona('guardian')?.label).toBe('The Guardian');
        expect(resolvePersona('daredevil', 42)).toMatchObject({ seed: 42, aggression: 0.95 });
        expect(resolvePersona('nope', 1)).toBeNull();
    });
});

describe('resolveSkill routes personae and presets', () => {
    it('resolves a persona id to full skill+style with the given seed', () => {
        const skill = resolveSkill('guardian', 7);
        expect(skill).toMatchObject({ seed: 7, defenseBias: 2.0 });
        expect(resolveStyle(skill).defenseBias).toBe(2.0);
    });

    it('still resolves a plain difficulty preset to neutral style', () => {
        const skill = resolveSkill('expert', 3);
        const style = resolveStyle(skill);
        expect(style).toEqual({ defenseBias: 1, aggression: 0, assassinCaution: 1, commonnessBias: 1 });
    });

    it('isSkillOrPersona accepts both presets and personae, rejects junk', () => {
        expect(isSkillOrPersona('novice')).toBe(true);
        expect(isSkillOrPersona('maverick')).toBe(true);
        expect(isSkillOrPersona('godlike')).toBe(false);
    });
});

// --- Style knobs change the clue, on a hand-built backend that isolates them. ---

function view(words: string[], types: ('red' | 'blue' | 'neutral' | 'assassin')[]): BotSpymasterView {
    return {
        role: 'spymaster',
        team: 'red',
        gameMode: 'classic',
        words,
        revealed: words.map(() => false),
        types,
        currentTurn: 'red',
    };
}

function stub(rel: Record<string, Record<string, number>>): SemanticBackend {
    return {
        id: 'stub',
        relatedness: (a: string, b: string) => rel[a]?.[b.toUpperCase()] ?? rel[b]?.[a.toUpperCase()] ?? 0,
        vocabulary: () => Object.keys(rel),
    };
}

const ctx = (skill: SkillParams, seed = 1): BotContext => ({ gameMode: 'classic', skill, rng: makeRng(seed) });
const base = (over: Partial<SkillParams>): SkillParams => ({
    temperature: 0,
    blunderRate: 0,
    riskAversion: 0.6,
    seed: 1,
    ...over,
});

describe('aggression stretches the clue number', () => {
    // One clue links two own cards: BRIDGE fits OWNA strongly and OWNB just past
    // the aggressive margin but short of the neutral one. A timid bot clues 1; a
    // bold one shrinks the margin and clues 2.
    const board = view(['OWNA', 'OWNB', 'OPPO', 'NEUT', 'ASSN'], ['red', 'red', 'blue', 'neutral', 'assassin']);
    const backend = stub({ BRIDGE: { OWNA: 0.9, OWNB: 0.7, OPPO: 0.62, NEUT: 0.1, ASSN: 0.0 } });

    it('low aggression gives a small number', () => {
        const action = makeEmbeddingSpymaster(base({ aggression: 0 }), backend).chooseClue(board, ctx(base({})));
        expect(action).toMatchObject({ kind: 'clue', word: 'BRIDGE', number: 1 });
    });

    it('high aggression reaches for the bigger number', () => {
        const skill = base({ aggression: 0.95 });
        const action = makeEmbeddingSpymaster(skill, backend).chooseClue(board, ctx(skill));
        expect(action).toMatchObject({ kind: 'clue', word: 'BRIDGE', number: 2 });
    });
});

describe('defenseBias steers away from arming the opponent', () => {
    // Two single-card clues of near-equal quality: ARMED is a hair clearer but also
    // lights up the opponent's card (OPPO 0.5); CLEAN leaves their board dark.
    // commonnessBias is zeroed so the ambiguity penalty (which also dislikes
    // ARMED's hot halo) stays out of the comparison — this isolates defenseBias.
    const board = view(['OWNA', 'OWNB', 'OPPO', 'NEUT', 'ASSN'], ['red', 'red', 'blue', 'neutral', 'assassin']);
    const backend = stub({
        ARMED: { OWNA: 0.95, OWNB: 0.0, OPPO: 0.5, NEUT: 0.1, ASSN: 0.0 },
        CLEAN: { OWNA: 0.0, OWNB: 0.79, OPPO: 0.0, NEUT: 0.35, ASSN: 0.0 },
    });

    it('without defense bias, takes the marginally clearer (but leaky) clue', () => {
        const skill = base({ defenseBias: 0, commonnessBias: 0 });
        const action = makeEmbeddingSpymaster(skill, backend).chooseClue(board, ctx(skill));
        expect(action).toMatchObject({ kind: 'clue', word: 'ARMED' });
    });

    it('a defensive persona refuses to arm the opponent', () => {
        const skill = base({ defenseBias: 2, commonnessBias: 0 });
        const action = makeEmbeddingSpymaster(skill, backend).chooseClue(board, ctx(skill));
        expect(action).toMatchObject({ kind: 'clue', word: 'CLEAN' });
    });
});
