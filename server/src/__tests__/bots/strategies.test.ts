/**
 * Pure unit tests for the bot strategy core: clickers, spymaster, registry,
 * presets, seeded RNG, and the lexical semantic backend. No Redis/socket.
 */
import { makeRandomClicker, makeCautiousClicker, makeGreedyClicker } from '../../bots/strategies/clickers';
import { makeRandomSpymaster } from '../../bots/strategies/spymasters';
import { resolveClicker, resolveSpymaster, isStrategyId, strategyLabel } from '../../bots/strategies/registry';
import { resolveSkill, isSkillPreset } from '../../bots/presets';
import { makeRng } from '../../bots/rng';
import { lexicalBackend } from '../../bots/semantics/backend';
import type { BotClickerView, BotSpymasterView, BotContext } from '../../bots/strategies/types';

function ctx(seed = 1, preset = 'intermediate'): BotContext {
    return { gameMode: 'classic', skill: resolveSkill(preset, seed), rng: makeRng(seed) };
}

function clickerView(overrides: Partial<BotClickerView> = {}): BotClickerView {
    return {
        role: 'clicker',
        team: 'red',
        gameMode: 'classic',
        words: ['APPLE', 'RIVER', 'TIGER', 'MOUNTAIN'],
        revealed: [false, false, false, false],
        types: [null, null, null, null],
        currentTurn: 'red',
        currentClue: { word: 'FRUIT', number: 2, team: 'red' },
        guessesUsed: 0,
        guessesAllowed: 3,
        ...overrides,
    };
}

function spymasterView(overrides: Partial<BotSpymasterView> = {}): BotSpymasterView {
    return {
        role: 'spymaster',
        team: 'red',
        gameMode: 'classic',
        words: ['APPLE', 'RIVER', 'TIGER', 'MOUNTAIN'],
        revealed: [false, false, false, false],
        types: ['red', 'red', 'blue', 'neutral'],
        currentTurn: 'red',
        ...overrides,
    };
}

describe('makeRng', () => {
    it('is deterministic for the same seed', () => {
        const a = makeRng(42);
        const b = makeRng(42);
        expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
    });

    it('int(n) stays within [0, n)', () => {
        const r = makeRng(7);
        for (let i = 0; i < 50; i++) {
            const v = r.int(4);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(4);
        }
    });
});

describe('lexicalBackend', () => {
    it('scores identical words as 1', () => {
        expect(lexicalBackend.relatedness('RIVER', 'RIVER')).toBeCloseTo(1);
    });
    it('scores an overlapping word higher than an unrelated one', () => {
        const overlap = lexicalBackend.relatedness('RIVERBANK', 'RIVER');
        const unrelated = lexicalBackend.relatedness('RIVERBANK', 'MOUNTAIN');
        expect(overlap).toBeGreaterThan(unrelated);
    });
    it('handles empty input', () => {
        expect(lexicalBackend.relatedness('', 'RIVER')).toBe(0);
    });
});

describe('randomClicker', () => {
    it('reveals a legal unrevealed index', () => {
        const action = makeRandomClicker(resolveSkill('intermediate', 1)).chooseGuess(clickerView(), ctx(1));
        expect(action.kind).toBe('reveal');
        if (action.kind === 'reveal') expect(action.index).toBeGreaterThanOrEqual(0);
    });

    it('ends the turn when nothing is left to reveal', () => {
        const view = clickerView({ revealed: [true, true, true, true] });
        const action = makeRandomClicker(resolveSkill('intermediate', 1)).chooseGuess(view, ctx(1));
        expect(action.kind).toBe('endTurn');
    });

    it('is deterministic for the same seed', () => {
        const a = makeRandomClicker(resolveSkill('intermediate', 9)).chooseGuess(clickerView(), ctx(9));
        const b = makeRandomClicker(resolveSkill('intermediate', 9)).chooseGuess(clickerView(), ctx(9));
        expect(a).toEqual(b);
    });
});

describe('cautiousClicker', () => {
    it('stops once the clue count is reached', () => {
        const view = clickerView({ guessesUsed: 2, currentClue: { word: 'FRUIT', number: 2, team: 'red' } });
        const action = makeCautiousClicker(resolveSkill('expert', 1)).chooseGuess(view, ctx(1, 'expert'));
        expect(action.kind).toBe('endTurn');
    });

    it('reveals while under the clue count', () => {
        const view = clickerView({ guessesUsed: 0, currentClue: { word: 'FRUIT', number: 2, team: 'red' } });
        const action = makeCautiousClicker(resolveSkill('expert', 1)).chooseGuess(view, ctx(1, 'expert'));
        expect(action.kind).toBe('reveal');
    });
});

describe('greedyClicker', () => {
    it('picks the card most lexically related to the clue word', () => {
        const view = clickerView({
            words: ['MOUNTAIN', 'RIVER', 'TIGER', 'APPLE'],
            currentClue: { word: 'RIVERBANK', number: 2, team: 'red' },
        });
        // expert preset => no blunder, pure argmax
        const action = makeGreedyClicker(resolveSkill('expert', 3)).chooseGuess(view, ctx(3, 'expert'));
        expect(action).toEqual({ kind: 'reveal', index: 1 }); // RIVER
    });

    it('ends the turn after the clue count', () => {
        const view = clickerView({ guessesUsed: 2, currentClue: { word: 'FRUIT', number: 2, team: 'red' } });
        const action = makeGreedyClicker(resolveSkill('expert', 1)).chooseGuess(view, ctx(1, 'expert'));
        expect(action.kind).toBe('endTurn');
    });
});

describe('randomSpymaster', () => {
    it('produces a legal clue word (not on the board) and a number in [1,3]', () => {
        const view = spymasterView();
        const action = makeRandomSpymaster(resolveSkill('intermediate', 1)).chooseClue(view, ctx(1));
        expect(action.kind).toBe('clue');
        if (action.kind === 'clue') {
            expect(view.words).not.toContain(action.word);
            expect(action.number).toBeGreaterThanOrEqual(1);
            expect(action.number).toBeLessThanOrEqual(3);
        }
    });
});

describe('registry & presets', () => {
    it('resolves a clicker strategy by id', () => {
        expect(resolveClicker('greedyClicker', resolveSkill('expert', 1)).strategyId).toBe('greedyClicker');
    });

    it('falls back to randomSpymaster when a clicker id lands in a spymaster seat', () => {
        expect(resolveSpymaster('greedyClicker', resolveSkill('expert', 1)).strategyId).toBe('randomSpymaster');
    });

    it('falls back to randomClicker for an unknown id', () => {
        expect(resolveClicker('does-not-exist', resolveSkill('expert', 1)).strategyId).toBe('randomClicker');
    });

    it('validates strategy ids and skill presets', () => {
        expect(isStrategyId('greedyClicker')).toBe(true);
        expect(isStrategyId('nope')).toBe(false);
        expect(isSkillPreset('expert')).toBe(true);
        expect(isSkillPreset('nope')).toBe(false);
    });

    it('exposes labels and an expert preset with no exploration', () => {
        expect(strategyLabel('greedyClicker')).toBe('Greedy');
        const expert = resolveSkill('expert', 5);
        expect(expert.temperature).toBe(0);
        expect(expert.blunderRate).toBe(0);
        expect(expert.seed).toBe(5);
    });
});
