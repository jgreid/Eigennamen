/**
 * Phase-3 reference-clue safety (docs/BOT_NUANCE_PLAN.md, ledger lessons
 * 7/10/19): exhaustive weighted reference contents (a title clue collides
 * with its own board-resident contents — Thunderball's POOL and CASINO),
 * brand/product tiers (Tinder's GOLD), rival referents whose contents pull
 * guesses scaled by rival fame (Apollo Creed's FIGHTER), and type-level
 * hypernym readings scored below contents (Thunderball IS a novel — the
 * exemplar asymmetry).
 */
import { tableBackend } from '../../bots/semantics/tableBackend';
import { lexicalBackend } from '../../bots/semantics/backend';
import { makeCustomMapBackend, type SemanticMap } from '../../bots/semantics/mapBackend';
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

type CardType = 'red' | 'blue' | 'neutral' | 'assassin';

const spymasterView = (words: string[], types: CardType[]): BotSpymasterView => ({
    role: 'spymaster',
    team: 'red',
    gameMode: 'classic',
    words,
    revealed: words.map(() => false),
    types,
    currentTurn: 'red',
});

const clickerView = (words: string[], clue: string, number: number): BotClickerView => ({
    role: 'clicker',
    team: 'red',
    gameMode: 'classic',
    words,
    revealed: words.map(() => false),
    types: words.map(() => null),
    currentTurn: 'red',
    currentClue: { word: clue, number },
    guessesUsed: 0,
    guessesAllowed: number + 1,
});

describe('reference readings in the baked table (weighted contents, hypernyms, rivals)', () => {
    it('a title clue reaches its scene contents at their curated weights', () => {
        expect(tableBackend.relatedness('Thunderball', 'POOL')).toBe(0.7);
        expect(tableBackend.relatedness('Thunderball', 'CASINO')).toBe(0.7);
        expect(tableBackend.relatedness('Thunderball', 'SHARK')).toBe(0.6);
    });

    it('a brand clue reaches its product tier (the Tinder Gold edge)', () => {
        expect(tableBackend.relatedness('Tinder', 'GOLD')).toBe(0.5);
        expect(tableBackend.relatedness('Tinder', 'MATCH')).toBe(1);
        expect(tableBackend.relatedness('Tinder', 'DATE')).toBe(1);
    });

    it('hypernym readings score below contents and above noise (exemplar asymmetry)', () => {
        expect(tableBackend.relatedness('Thunderball', 'NOVEL')).toBe(0.55);
        expect(tableBackend.relatedness('Hooke', 'SCIENTIST')).toBe(0.55);
        expect(tableBackend.relatedness('Hooke', 'SPRING')).toBe(1);
        // A known reference still excludes everything it does not reach.
        expect(tableBackend.relatedness('Thunderball', 'KETCHUP')).toBeLessThan(0.3);
    });

    it('rival referents pull their contents scaled by the rival fame', () => {
        expect(tableBackend.relatedness('Apollo', 'FIGHTER')).toBeCloseTo(0.6, 5); // Apollo Creed
        expect(tableBackend.relatedness('Apollo', 'RING')).toBeCloseTo(0.6, 5);
        expect(tableBackend.relatedness('Apollo', 'MOON')).toBe(1); // the program still owns its contents
        expect(tableBackend.relatedness('Zelda', 'NOVEL')).toBeCloseTo(0.3, 5); // Zelda Fitzgerald
    });

    it('the legacy-neutral (ALL CAPS) reading sees rivals and hypernyms too', () => {
        expect(tableBackend.relatedness('APOLLO', 'FIGHTER')).toBeCloseTo(0.6, 5);
        expect(tableBackend.relatedness('THUNDERBALL', 'NOVEL')).toBeCloseTo(0.55, 5);
    });

    it('the deep-cut fame calibration is wired (Hooke)', () => {
        expect(tableBackend.commonness!('Hooke')).toBe(0.35);
    });
});

describe('the Thunderball gate: a title clue collides with its board-resident contents', () => {
    // 'THUNDERBALL' contains none of these words, so the clue is legal on
    // both boards — what changes is only which side of the key its contents
    // sit on.
    const words = ['NOVEL', 'CASINO', 'POOL', 'HORSE', 'TOOTH'];

    it('rejects the title clue when a content card belongs to the opponent', () => {
        // POOL is blue: Thunderball's own content edge (0.7) sits in the
        // non-own field, so neither CASINO (0.7) nor NOVEL (0.55) clears the
        // margin over it — the clue that beached the round-2 board dies at
        // scoring time.
        const s = skill();
        const action = makeEmbeddingSpymaster(s, tableBackend).chooseClue(
            spymasterView(words, ['red', 'red', 'blue', 'blue', 'neutral']),
            ctx(s)
        );
        expect(action.kind).toBe('clue');
        expect((action as { word: string }).word).not.toBe('Thunderball');
    });

    it('embraces the same clue when the contents are all its own (positive control)', () => {
        // Same board, but NOVEL + CASINO + POOL are all red: covering every
        // own card wins the board, and only Thunderball reaches all three.
        const s = skill();
        const action = makeEmbeddingSpymaster(s, tableBackend).chooseClue(
            spymasterView(words, ['red', 'red', 'red', 'blue', 'neutral']),
            ctx(s)
        );
        expect(action).toMatchObject({ kind: 'clue', word: 'Thunderball', number: 3 });
    });
});

describe('the Tinder gate: the number never extends into the brand tier', () => {
    it('the baked Tinder entry clues its real core with the tier in the enemy field', () => {
        const words = ['DATE', 'MATCH', 'GOLD', 'HORSE', 'TOOTH'];
        const s = skill();
        const action = makeEmbeddingSpymaster(s, tableBackend).chooseClue(
            spymasterView(words, ['red', 'red', 'blue', 'blue', 'neutral']),
            ctx(s)
        );
        expect(action).toMatchObject({ kind: 'clue', word: 'Tinder', number: 2 });
    });

    it('a brand-tier edge caps the number below the tier word (before/after)', () => {
        // Round 3's failure in miniature: three own cards where the third is
        // weaker than the brand tier sitting blue. Without the tier edge the
        // number rides to 3; with it, the tier bounds the margin and the
        // number stops at the core — the promise never extends into GOLD's
        // slot of the guesser's ranking.
        const reference = (withTier: boolean): SemanticMap => ({
            version: 2,
            words: ['AAA', 'BBB', 'CCC', 'DDD'],
            concepts: {},
            proper: {
                Zapp: {
                    contents: [
                        { word: 'AAA', weight: 1 },
                        { word: 'BBB', weight: 1 },
                        { word: 'CCC', weight: 0.45 },
                        ...(withTier ? [{ word: 'DDD', weight: 0.5 }] : []),
                    ],
                    fame: 0.9,
                },
            },
        });
        const words = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE'];
        const types: CardType[] = ['red', 'red', 'red', 'blue', 'neutral'];
        const s = skill();

        const blind = makeEmbeddingSpymaster(s, makeCustomMapBackend([reference(false)], lexicalBackend));
        expect(blind.chooseClue(spymasterView(words, types), ctx(s))).toMatchObject({
            kind: 'clue',
            word: 'Zapp',
            number: 3,
        });

        const aware = makeEmbeddingSpymaster(s, makeCustomMapBackend([reference(true)], lexicalBackend));
        expect(aware.chooseClue(spymasterView(words, types), ctx(s))).toMatchObject({
            kind: 'clue',
            word: 'Zapp',
            number: 2,
        });
    });
});

describe('guesser-side payoff: the clicker resolves rivals and type-level readings', () => {
    it('resolves a reference to its rival when the intended contents are absent', () => {
        // No MOON/SPACE/GREECE on the board: a guesser handed "Apollo" lands
        // on Apollo Creed and clicks FIGHTER.
        const s = skill();
        const action = makeGreedyClicker(s, tableBackend).chooseGuess(
            clickerView(['FIGHTER', 'TOOTH', 'HORSE'], 'Apollo', 1),
            ctx(s)
        );
        expect(action).toEqual({ kind: 'reveal', index: 0 });
    });

    it('reaches the type-level reading of a title clue (2.13: hypernym candidates)', () => {
        const s = skill();
        const action = makeGreedyClicker(s, tableBackend).chooseGuess(
            clickerView(['NOVEL', 'TOOTH', 'HORSE'], 'Thunderball', 1),
            ctx(s)
        );
        expect(action).toEqual({ kind: 'reveal', index: 0 });
    });
});

describe('v2 map rivals (the bots:map sweep lands in the overlay)', () => {
    const MAP: SemanticMap = {
        version: 2,
        words: ['COMET', 'FIGHTER'],
        concepts: {},
        proper: {
            Nova: {
                contents: ['COMET'],
                fame: 0.8,
                rivals: [{ referent: 'Chevy Nova', fame: 0.5, contents: [{ word: 'FIGHTER', weight: 0.8 }] }],
            },
        },
    };
    const backend = makeCustomMapBackend([MAP], lexicalBackend);

    it('rival contents pull at weight × rival fame; own contents stay authoritative', () => {
        expect(backend.relatedness('Nova', 'COMET')).toBe(1);
        expect(backend.relatedness('Nova', 'FIGHTER')).toBeCloseTo(0.4, 5);
        // Neutral (ALL CAPS) reading sees the rival pull too.
        expect(backend.relatedness('NOVA', 'FIGHTER')).toBeCloseTo(0.4, 5);
        // The reference still excludes everything neither referent reaches.
        expect(backend.relatedness('Nova', 'TOOTH')).toBeLessThan(0.3);
    });
});
