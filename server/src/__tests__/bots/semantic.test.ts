/**
 * Phase 3 tests: the baked association table backend and the semantic spymaster.
 */
import { tableBackend } from '../../bots/semantics/tableBackend';
import { ASSOCIATIONS } from '../../bots/semantics/associations';
import { makeEmbeddingSpymaster } from '../../bots/strategies/spymasters';
import { resolveClicker } from '../../bots/strategies/registry';
import { resolveSkill } from '../../bots/presets';
import { makeRng } from '../../bots/rng';
import type { SemanticBackend } from '../../bots/semantics/backend';
import { DEFAULT_WORDS } from '../../shared/gameRules';
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

describe('embeddingSpymaster best-effort fallback is assassin-safe', () => {
    // A stub backend with a fixed vocabulary and hand-set relatedness lets us force
    // the best-effort path (no clue clears the safety margin) and verify the
    // fallback never knowingly hands the clicker the assassin (instant loss).
    function stub(rel: Record<string, Record<string, number>>): SemanticBackend {
        return {
            id: 'stub',
            relatedness: (a: string, b: string) => rel[a]?.[b.toUpperCase()] ?? rel[b]?.[a.toUpperCase()] ?? 0,
            vocabulary: () => Object.keys(rel),
        };
    }
    const view = spymasterView(['OWN', 'OPP', 'NEU', 'ASS'], ['red', 'blue', 'neutral', 'assassin']);

    it('prefers an assassin-safe clue over an assassin-linked one', () => {
        // Neither clue clears the margin (so evaluateClue returns null for both),
        // forcing best-effort. DANGER makes the assassin the clicker's top card.
        const backend = stub({
            SAFE: { OWN: 0.4, OPP: 0.4, NEU: 0.1, ASS: 0.1 },
            DANGER: { OWN: 0.4, OPP: 0.1, NEU: 0.1, ASS: 0.9 },
        });
        const action = makeEmbeddingSpymaster(resolveSkill('expert', 1), backend).chooseClue(view, ctx(1));
        expect(action).toMatchObject({ kind: 'clue', word: 'SAFE' });
    });

    it('when every clue is assassin-linked, deterministically picks the least dangerous', () => {
        // Regression for the old random placeholder, which could pick WORST and
        // reveal the assassin on guess 1.
        const backend = stub({
            MILD: { OWN: 0.5, OPP: 0.1, NEU: 0.1, ASS: 0.55 },
            WORST: { OWN: 0.1, OPP: 0.1, NEU: 0.1, ASS: 0.95 },
        });
        const action = makeEmbeddingSpymaster(resolveSkill('expert', 1), backend).chooseClue(view, ctx(1));
        expect(action).toMatchObject({ kind: 'clue', word: 'MILD' });
    });
});

describe('baked association table coverage', () => {
    it('covers most of the default board words (so default games get real clues)', () => {
        // Every table target is a board word by construction; this guards that the
        // generator still covers the bulk of the default list. Uncovered words fall
        // to lexical similarity, which is much weaker — so a regression here would
        // quietly degrade offline bot play on the standard board.
        const targets = new Set<string>();
        for (const words of Object.values(ASSOCIATIONS)) {
            for (const w of words) targets.add(w.toUpperCase());
        }
        const covered = DEFAULT_WORDS.filter((w) => targets.has(w.toUpperCase())).length;
        expect(covered / DEFAULT_WORDS.length).toBeGreaterThan(0.8);
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
