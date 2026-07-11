/**
 * Pure unit tests for the bot strategy core: clickers, spymaster, registry,
 * presets, seeded RNG, and the lexical semantic backend. No Redis/socket.
 */
import { makeRandomClicker, makeCautiousClicker, makeGreedyClicker } from '../../bots/strategies/clickers';
import { makeRandomSpymaster } from '../../bots/strategies/spymasters';
import { resolveClicker, resolveSpymaster, isStrategyId, strategyLabel } from '../../bots/strategies/registry';
import { resolveSkill, isSkillPreset, SKILL_PRESETS } from '../../bots/presets';
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

describe('temperature sampling (scale-invariant, confidence-scaled)', () => {
    // A backend with fixed clue→word scores and full provenance, so the ONLY
    // stochastic element in the pick is the temperature softmax under test.
    function fixedBackend(scores: Record<string, number>) {
        return {
            id: 'fixed',
            relatedness: (_clue: string, word: string) => scores[word.toUpperCase()] ?? 0,
            hasSignal: () => true,
        };
    }
    // First guess (no stop gates), zero blunder, aggression 0 — pure sampling.
    const skill = { temperature: 0.42, blunderRate: 0, riskAversion: 0.5, seed: 1 };
    function sample(scores: Record<string, number>, runs = 600): Map<string, number> {
        const words = Object.keys(scores);
        const clicker = makeGreedyClicker(skill, fixedBackend(scores));
        const view = clickerView({
            words,
            revealed: words.map(() => false),
            types: words.map(() => null),
            currentClue: { word: 'CLUE', number: 2, team: 'red' },
            guessesUsed: 0,
        });
        const counts = new Map<string, number>();
        for (let seed = 1; seed <= runs; seed++) {
            const action = clicker.chooseGuess(view, { gameMode: 'classic', skill, rng: makeRng(seed) });
            if (action.kind !== 'reveal') throw new Error(`expected reveal, got ${action.kind}`);
            const w = words[action.index] as string;
            counts.set(w, (counts.get(w) ?? 0) + 1);
        }
        return counts;
    }

    it('a WEAK field samples near-argmax instead of a lottery (the gear→HAND assassin regression)', () => {
        // The exact live-play field that put the assassin (HAND, ranked BELOW
        // the argmax) into a near-uniform 3-way lottery under the old
        // absolute-difference softmax: on the Numberbatch cosine scale the
        // differences compress and intermediate temperature went flat, hitting
        // the assassin ~1/3 of the time. Confidence scaling makes a weak field
        // play close to its best hunch.
        const counts = sample({ CHANGE: 0.157, HAND: 0.109, BEAT: 0.105, DATE: 0.05 });
        const total = 600;
        expect((counts.get('CHANGE') ?? 0) / total).toBeGreaterThan(0.7);
        expect((counts.get('HAND') ?? 0) / total).toBeLessThan(0.18);
    });

    it("a STRONG field keeps the preset's tuned exploration (no over-sharpening)", () => {
        // Curated-scale scores (what the presets were tuned on): the fix must
        // not turn intermediate into argmax-only there — a clear second-best
        // still gets picked a meaningful fraction of the time.
        const counts = sample({ APPLE: 0.9, PEAR: 0.6, ROCK: 0.1 });
        const total = 600;
        const second = (counts.get('PEAR') ?? 0) / total;
        expect(second).toBeGreaterThan(0.15);
        expect(second).toBeLessThan(0.45);
    });

    it('sampling depends on RELATIVE scores above the confidence reference (scale invariance)', () => {
        // Same 2:3 relative field at two absolute scales, both at/above the
        // confidence reference — the misread rate must match closely. This is
        // the property whose absence broke the tuning on compressed scales.
        const a = sample({ A: 0.9, B: 0.6 });
        const b = sample({ A: 0.6, B: 0.4 });
        const pa = (a.get('B') ?? 0) / 600;
        const pb = (b.get('B') ?? 0) / 600;
        expect(Math.abs(pa - pb)).toBeLessThan(0.08);
    });

    it('temperature 0 stays pure argmax on any scale', () => {
        const zeroSkill = { temperature: 0, blunderRate: 0, riskAversion: 0.5, seed: 1 };
        const clicker = makeGreedyClicker(zeroSkill, fixedBackend({ LOW: 0.11, LOWER: 0.09 }));
        const view = clickerView({
            words: ['LOW', 'LOWER'],
            revealed: [false, false],
            types: [null, null],
            currentClue: { word: 'CLUE', number: 1, team: 'red' },
        });
        for (let seed = 1; seed <= 20; seed++) {
            const action = clicker.chooseGuess(view, { gameMode: 'classic', skill: zeroSkill, rng: makeRng(seed) });
            expect(action).toEqual({ kind: 'reveal', index: 0 });
        }
    });
});

describe('skill preset ladder (5 monotonic rungs)', () => {
    it('is ordered weakest→strongest with a monotonic knob gradient', () => {
        expect([...SKILL_PRESETS]).toEqual(['novice', 'beginner', 'intermediate', 'advanced', 'expert']);
        const rungs = SKILL_PRESETS.map((p) => resolveSkill(p, 1));
        for (let i = 1; i < rungs.length; i++) {
            // Each step up: strictly-not-worse selection noise + blunders, and
            // strictly-not-lower caution — a smooth, monotonic difficulty ladder.
            expect(rungs[i]!.temperature).toBeLessThanOrEqual(rungs[i - 1]!.temperature);
            expect(rungs[i]!.blunderRate).toBeLessThanOrEqual(rungs[i - 1]!.blunderRate);
            expect(rungs[i]!.riskAversion).toBeGreaterThanOrEqual(rungs[i - 1]!.riskAversion);
        }
        // The two ends anchor the spectrum: novice noisy/reckless, expert exact.
        expect(rungs[0]!.temperature).toBeGreaterThan(rungs[4]!.temperature);
        expect(rungs[4]!.temperature).toBe(0);
        expect(rungs[4]!.blunderRate).toBe(0);
    });
});
