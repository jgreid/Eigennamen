/**
 * Phase 3 tests: the baked association table backend and the semantic spymaster.
 */
import { tableBackend } from '../../bots/semantics/tableBackend';
import { ASSOCIATIONS } from '../../bots/semantics/associations';
import { makeEmbeddingSpymaster } from '../../bots/strategies/spymasters';
import { makeGreedyClicker } from '../../bots/strategies/clickers';
import { suggestGuesses } from '../../bots/strategies/advisor';
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

    it('grades two board words by shared concept groups (human-clue interpretation)', () => {
        // Neither BEAR nor LION is a table key, but they co-occur in ANIMAL /
        // MAMMAL / WILD, so a clicker interpreting a human clue like BEAR should
        // relate LION strongly — well above lexical noise, but below a direct hit.
        const s = tableBackend.relatedness('BEAR', 'LION');
        expect(s).toBeGreaterThan(0.5);
        expect(s).toBeLessThan(1);
    });

    it('ranks more shared concepts above fewer', () => {
        const strong = tableBackend.relatedness('BEAR', 'LION'); // ANIMAL, MAMMAL, WILD
        const weak = tableBackend.relatedness('BEAR', 'DUCK'); // ANIMAL only
        expect(strong).toBeGreaterThan(weak);
        expect(weak).toBeGreaterThan(0); // still a real signal, not lexical zero
    });

    it('keeps direct clue→word entries at a perfect score', () => {
        // Co-membership grading must never demote the intended clue signal.
        expect(tableBackend.relatedness('ANIMAL', 'BEAR')).toBe(1);
        expect(tableBackend.relatedness('OCEAN', 'WHALE')).toBe(1);
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

/** Stub backend: hand-set relatedness + a fixed vocabulary, for precise scoring. */
function scoringStub(rel: Record<string, Record<string, number>>): SemanticBackend {
    return {
        id: 'stub',
        relatedness: (a: string, b: string) => rel[a]?.[b.toUpperCase()] ?? rel[b]?.[a.toUpperCase()] ?? 0,
        vocabulary: () => Object.keys(rel),
    };
}

describe('spymaster multi-factor scoring', () => {
    // Board words chosen so no candidate clue is a substring of one (which would
    // make it an illegal clue and get filtered before scoring).
    const OWN2: ['red', 'red', 'blue', 'assassin'] = ['red', 'red', 'blue', 'assassin'];

    it('plays defense: prefers a clue that does not also point at the opponent', () => {
        // CLEAN and LEAKY both safely cover the two own cards, but LEAKY also
        // relates to the opponent card — a cautious expert avoids arming them.
        const view = spymasterView(['OWNA', 'OWNB', 'OPPO', 'ASSN'], OWN2);
        const backend = scoringStub({
            CLEAN: { OWNA: 0.9, OWNB: 0.85, OPPO: 0.1, ASSN: 0.1 },
            LEAKY: { OWNA: 0.9, OWNB: 0.85, OPPO: 0.6, ASSN: 0.1 },
        });
        const action = makeEmbeddingSpymaster(resolveSkill('expert', 2), backend).chooseClue(view, ctx(2));
        expect(action).toMatchObject({ kind: 'clue', word: 'CLEAN' });
    });

    it('grades assassin proximity: prefers the clue that stays further from the assassin', () => {
        const view = spymasterView(['OWNX', 'NEUT', 'ASSN'], ['red', 'neutral', 'assassin']);
        const backend = scoringStub({
            FARAWAY: { OWNX: 0.9, NEUT: 0.1, ASSN: 0.1 },
            NEARBY: { OWNX: 0.9, NEUT: 0.1, ASSN: 0.5 },
        });
        const action = makeEmbeddingSpymaster(resolveSkill('expert', 4), backend).chooseClue(view, ctx(4));
        expect(action).toMatchObject({ kind: 'clue', word: 'FARAWAY' });
    });

    it('salvages a real number from the best-effort path (no more constant 1)', () => {
        // No clue clears the safety margin (so scoring returns no candidate), but
        // the salvage clue still out-ranks the danger cards on TWO own cards.
        const view = spymasterView(['OWNA', 'OWNB', 'OPPO', 'ASSN'], OWN2);
        const backend = scoringStub({ SALVAGE: { OWNA: 0.4, OWNB: 0.35, OPPO: 0.3, ASSN: 0.1 } });
        const action = makeEmbeddingSpymaster(resolveSkill('expert', 1), backend).chooseClue(view, ctx(1));
        expect(action).toEqual({ kind: 'clue', word: 'SALVAGE', number: 2 });
    });

    it('temperature 0 (expert) is a deterministic argmax across seeds', () => {
        const view = spymasterView(['OWNA', 'OWNB', 'OPPO', 'ASSN'], OWN2);
        const backend = scoringStub({
            STRONG: { OWNA: 0.95, OWNB: 0.9, OPPO: 0.1, ASSN: 0.1 },
            WEAKER: { OWNA: 0.7, OWNB: 0.1, OPPO: 0.1, ASSN: 0.1 },
        });
        const w1 = makeEmbeddingSpymaster(resolveSkill('expert', 1), backend).chooseClue(view, ctx(1));
        const w2 = makeEmbeddingSpymaster(resolveSkill('expert', 99), backend).chooseClue(view, ctx(99, 'expert'));
        expect(w1).toMatchObject({ word: 'STRONG' });
        expect(w2).toMatchObject({ word: 'STRONG' });
    });

    it('high temperature (novice) explores real alternatives, not only the argmax', () => {
        // Three equally-good clues: a novice's softmax + blunder should not always
        // land on the same one.
        const view = spymasterView(['OWNA', 'OWNB', 'OPPO', 'ASSN'], OWN2);
        const eq = { OWNA: 0.9, OWNB: 0.85, OPPO: 0.1, ASSN: 0.1 };
        const backend = scoringStub({ ONE: eq, TWO: eq, THREE: eq });
        const chosen = new Set<string>();
        for (let s = 0; s < 24; s++) {
            const a = makeEmbeddingSpymaster(resolveSkill('novice', s), backend).chooseClue(view, ctx(s, 'novice'));
            if (a.kind === 'clue') chosen.add(a.word);
        }
        expect(chosen.size).toBeGreaterThan(1);
    });
});

describe('embeddingSpymaster generates board-specific clues via nearest()', () => {
    it('clues a word produced by nearest(), not limited to a fixed vocabulary', () => {
        // vocabulary() is empty, so ONLY nearest() can supply candidates — proving
        // the spymaster generates clues from the board rather than scanning a list.
        // PREDATOR covers both own animals cleanly; MAMMAL also relates to the
        // opponent card, so the defensive penalty should make PREDATOR win.
        const rel: Record<string, Record<string, number>> = {
            PREDATOR: { LION: 0.9, BEAR: 0.85, APPLE: 0.1, CAR: 0.1, DEATH: 0.1 },
            MAMMAL: { LION: 0.9, BEAR: 0.85, APPLE: 0.6, CAR: 0.1, DEATH: 0.1 },
        };
        const backend: SemanticBackend = {
            id: 'vec-stub',
            relatedness: (a: string, b: string) => rel[a]?.[b.toUpperCase()] ?? rel[b]?.[a.toUpperCase()] ?? 0,
            vocabulary: () => [],
            nearest: () => [
                { word: 'PREDATOR', score: 0.9 },
                { word: 'MAMMAL', score: 0.85 },
            ],
        };
        const view = spymasterView(
            ['LION', 'BEAR', 'APPLE', 'CAR', 'DEATH'],
            ['red', 'red', 'blue', 'neutral', 'assassin']
        );
        const action = makeEmbeddingSpymaster(resolveSkill('expert', 7), backend).chooseClue(view, ctx(7));
        expect(action).toEqual({ kind: 'clue', word: 'PREDATOR', number: 2 });
    });
});

describe('advisor suggestGuesses', () => {
    const view = (overrides: Partial<BotClickerView> = {}): BotClickerView => ({
        role: 'clicker',
        team: 'red',
        gameMode: 'classic',
        words: ['BEAR', 'LION', 'APPLE', 'CAR'],
        revealed: [false, false, false, false],
        types: [null, null, null, null],
        currentTurn: 'red',
        currentClue: { word: 'ANIMAL', number: 2, team: 'red' },
        guessesUsed: 0,
        guessesAllowed: 0,
        ...overrides,
    });

    it('ranks the clue-fitting cards, bounded by the clue number', () => {
        const out = suggestGuesses(view(), tableBackend, 3);
        // ANIMAL fits BEAR and LION (indices 0,1); number 2 caps the list at 2.
        expect(out.length).toBe(2);
        expect(out.map((s) => s.index).sort()).toEqual([0, 1]);
        expect(out.every((s) => s.confidence > 0 && s.confidence <= 1)).toBe(true);
        expect(out[0]!.reason).toContain('ANIMAL');
    });

    it('returns nothing when there is no active clue', () => {
        expect(suggestGuesses(view({ currentClue: null }), tableBackend)).toEqual([]);
    });

    it('skips already-revealed cards', () => {
        const out = suggestGuesses(view({ revealed: [true, false, false, false] }), tableBackend, 3);
        expect(out.map((s) => s.index)).not.toContain(0); // BEAR already revealed
        expect(out.map((s) => s.index)).toContain(1); // LION still suggestable
    });

    it('honours skill: expert is deterministic + confident, novice hedges + varies', () => {
        // Three equally-fitting animals (BEAR/LION/HORSE), clue number 2 → pick 2.
        const animalView = (): BotClickerView =>
            view({ words: ['BEAR', 'LION', 'HORSE', 'APPLE'], revealed: [false, false, false, false] });

        const expertSkill = resolveSkill('expert', 1);
        const a = suggestGuesses(animalView(), tableBackend, 3, expertSkill, makeRng(1));
        const b = suggestGuesses(animalView(), tableBackend, 3, expertSkill, makeRng(2));
        expect(a).toEqual(b); // temperature 0 → deterministic regardless of rng
        expect(a.length).toBe(2);
        expect(a.every((s) => s.confidence === 1)).toBe(true); // full confidence

        const noviceSets = new Set<string>();
        for (let s = 0; s < 24; s++) {
            const out = suggestGuesses(animalView(), tableBackend, 3, resolveSkill('novice', s), makeRng(s));
            noviceSets.add(
                out
                    .map((x) => x.index)
                    .sort()
                    .join(',')
            );
            expect(out.every((x) => x.confidence < 1)).toBe(true); // dampened confidence
        }
        expect(noviceSets.size).toBeGreaterThan(1); // samples among plausible cards
    });
});

describe('greedyClicker temperature scales guess accuracy', () => {
    const backend = scoringStub({ CLUE: { GOOD: 0.9, MEH: 0.5, BAD: 0.4 } });
    const view = (): BotClickerView => ({
        role: 'clicker',
        team: 'red',
        gameMode: 'classic',
        words: ['GOOD', 'MEH', 'BAD'],
        revealed: [false, false, false],
        types: [null, null, null],
        currentTurn: 'red',
        currentClue: { word: 'CLUE', number: 3, team: 'red' },
        guessesUsed: 0,
        guessesAllowed: 3,
    });

    it('expert (temperature 0) always takes the best-fitting card', () => {
        const clicker = makeGreedyClicker(resolveSkill('expert', 1), backend);
        for (let s = 0; s < 10; s++) {
            expect(clicker.chooseGuess(view(), ctx(s, 'expert'))).toEqual({ kind: 'reveal', index: 0 });
        }
    });

    it('novice sometimes takes a plausible-but-wrong card', () => {
        const chosen = new Set<number>();
        for (let s = 0; s < 24; s++) {
            const a = makeGreedyClicker(resolveSkill('novice', s), backend).chooseGuess(view(), ctx(s, 'novice'));
            if (a.kind === 'reveal') chosen.add(a.index);
        }
        expect(chosen.size).toBeGreaterThan(1);
    });
});
