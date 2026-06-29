/**
 * Phase 3 tests: the baked association table backend and the semantic spymaster.
 */
import { tableBackend } from '../../bots/semantics/tableBackend';
import { makeEmbeddingSpymaster } from '../../bots/strategies/spymasters';
import { resolveClicker } from '../../bots/strategies/registry';
import { resolveSkill } from '../../bots/presets';
import { makeRng } from '../../bots/rng';
import type { BotSpymasterView, BotClickerView, BotContext } from '../../bots/strategies/types';

function ctx(seed = 1, preset = 'expert'): BotContext {
    return { gameMode: 'classic', skill: resolveSkill(preset, seed), rng: makeRng(seed) };
}

describe('tableBackend', () => {
    it('scores baked associations as fully related', () => {
        expect(tableBackend.relatedness('ANIMAL', 'BEAR')).toBe(1);
        expect(tableBackend.relatedness('ANIMAL', 'LION')).toBe(1);
        // Symmetric lookup (clue is the key, board word the value).
        expect(tableBackend.relatedness('BEAR', 'ANIMAL')).toBe(1);
    });

    it('exposes a clue vocabulary', () => {
        const vocab = tableBackend.vocabulary?.() ?? [];
        expect(vocab).toContain('ANIMAL');
        expect(vocab.length).toBeGreaterThan(20);
    });

    it('falls back to lexical similarity for unknown pairs', () => {
        // Two words absent from the table still get a (low, non-crashing) score.
        const s = tableBackend.relatedness('ZZQQ', 'WORDLE');
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThan(1);
    });
});

function spymasterView(words: string[], types: ('red' | 'blue' | 'neutral' | 'assassin')[]): BotSpymasterView {
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

describe('embeddingSpymaster', () => {
    it('gives a clue that links its own cards', () => {
        // Own: BEAR, LION (ANIMAL). Opponent: APPLE. Assassin: ALIEN. Neutral: CAR.
        const view = spymasterView(
            ['BEAR', 'LION', 'APPLE', 'ALIEN', 'CAR'],
            ['red', 'red', 'blue', 'assassin', 'neutral']
        );
        const action = makeEmbeddingSpymaster(resolveSkill('expert', 5), tableBackend).chooseClue(view, ctx(5));
        expect(action.kind).toBe('clue');
        if (action.kind === 'clue') {
            // The clue is not on the board and links both own animals.
            expect(view.words).not.toContain(action.word);
            expect(tableBackend.relatedness(action.word, 'BEAR')).toBe(1);
            expect(tableBackend.relatedness(action.word, 'LION')).toBe(1);
            expect(action.number).toBe(2);
        }
    });

    it('never gives a clue that links the assassin', () => {
        // Both animal clues would link the assassin DUCK, so the spymaster must
        // avoid them and clue the food card instead.
        const view = spymasterView(['BEAR', 'APPLE', 'DUCK', 'CAR'], ['red', 'red', 'assassin', 'neutral']);
        const action = makeEmbeddingSpymaster(resolveSkill('expert', 9), tableBackend).chooseClue(view, ctx(9));
        expect(action.kind).toBe('clue');
        if (action.kind === 'clue') {
            expect(tableBackend.relatedness(action.word, 'DUCK')).toBeLessThan(0.5);
        }
    });
});

describe('greedyClicker via registry uses the table backend', () => {
    it('reveals the card the clue links', () => {
        const clicker = resolveClicker('greedyClicker', resolveSkill('expert', 3));
        const view: BotClickerView = {
            role: 'clicker',
            team: 'red',
            gameMode: 'classic',
            words: ['CAR', 'BEAR', 'APPLE'],
            revealed: [false, false, false],
            types: [null, null, null],
            currentTurn: 'red',
            currentClue: { word: 'ANIMAL', number: 1, team: 'red' },
            guessesUsed: 0,
            guessesAllowed: 2,
        };
        const action = clicker.chooseGuess(view, ctx(3));
        expect(action).toEqual({ kind: 'reveal', index: 1 }); // BEAR (ANIMAL-linked)
    });
});
