/**
 * Phase 3 tests: the baked association table backend and the semantic spymaster.
 */
import { tableBackend } from '../../bots/semantics/tableBackend';
import { ASSOCIATIONS } from '../../bots/semantics/associations';
import { makeEmbeddingSpymaster, groupBoard, scoreClue, admitClosingTraps } from '../../bots/strategies/spymasters';
import { resolveStyle } from '../../bots/strategies/types';
import { makeGreedyClicker } from '../../bots/strategies/clickers';
import { suggestGuesses } from '../../bots/strategies/advisor';
import { resolveClicker } from '../../bots/strategies/registry';
import { resolveSkill } from '../../bots/presets';
import { makeRng } from '../../bots/rng';
import type { SemanticBackend } from '../../bots/semantics/backend';
import { DEFAULT_WORDS } from '../../shared/gameRules';
import type { BotSpymasterView, BotClickerView, BotContext, SkillParams } from '../../bots/strategies/types';

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

describe('tableBackend case signal (proper-noun references)', () => {
    it('a mixed-case clue reads the proper reference: hits score full, misses go quiet', () => {
        // "Cinderella" = glass slipper + princess + royal ball…
        expect(tableBackend.relatedness('Cinderella', 'GLASS')).toBe(1);
        expect(tableBackend.relatedness('Cinderella', 'PRINCESS')).toBe(1);
        expect(tableBackend.relatedness('Cinderella', 'BALL')).toBe(1);
        // …and deliberately NOT unrelated words: the reference sense excludes
        // the common sense, so a miss is dampened below lexical noise.
        expect(tableBackend.relatedness('Cinderella', 'CAR')).toBeLessThan(0.3);
    });

    it('a lowercase clue explicitly means the common sense — never the reference', () => {
        expect(tableBackend.relatedness('cinderella', 'GLASS')).toBeLessThan(1);
    });

    it('a legacy ALL-CAPS clue carries no signal and takes the best of both readings', () => {
        expect(tableBackend.relatedness('CINDERELLA', 'GLASS')).toBe(1);
        // Common concepts are unaffected by the proper table.
        expect(tableBackend.relatedness('ANIMAL', 'BEAR')).toBe(1);
    });

    it('an unknown reference degrades to the common reading (like a human would)', () => {
        expect(tableBackend.relatedness('Zorblax', 'GLASS')).toBe(tableBackend.relatedness('zorblax', 'GLASS'));
    });

    it('reads canonical all-caps acronyms as the reference ("case matters for each letter")', () => {
        expect(tableBackend.relatedness('NASA', 'SPACE')).toBe(1);
        expect(tableBackend.relatedness('CIA', 'AGENT')).toBe(1);
        expect(tableBackend.relatedness("McDonald's", 'GOLD')).toBe(1); // intercap + apostrophe
        // Explicit lowercase still opts out of the reference reading.
        expect(tableBackend.relatedness('nasa', 'SPACE')).toBeLessThan(1);
    });

    it('exposes fame as the commonness prior — but never judges a lowercase word as a reference', () => {
        expect(tableBackend.commonness!('Cinderella')).toBe(0.9);
        expect(tableBackend.commonness!('Zelda')).toBe(0.7); // deeper cut
        expect(tableBackend.commonness!('zelda')).toBe(1); // common sense, not the reference
        expect(tableBackend.commonness!('ANIMAL')).toBe(1);
    });

    it('vocabulary offers proper references in display case (the emitted signal)', () => {
        const vocab = tableBackend.vocabulary!();
        expect(vocab).toContain('Cinderella');
        expect(vocab).toContain('ANIMAL');
    });
});

describe('spymaster gives proper-noun reference clues with the case signal', () => {
    it('bundles three own cards under one reference and emits it mixed-case', () => {
        // GLASS + PRINCESS + BALL share no common concept, but one vivid scene
        // covers all three — and taking them wins the board.
        const view = spymasterView(
            ['GLASS', 'PRINCESS', 'BALL', 'CAR', 'DOG', 'DEATH'],
            ['red', 'red', 'red', 'blue', 'blue', 'assassin']
        );
        const action = makeEmbeddingSpymaster(resolveSkill('expert', 11), tableBackend).chooseClue(view, ctx(11));
        expect(action).toEqual({ kind: 'clue', word: 'Cinderella', number: 3 });
    });
});

describe('clicker reads the case signal', () => {
    it('a mixed-case clue steers guesses to the reference targets', () => {
        const clicker = makeGreedyClicker(resolveSkill('expert', 12), tableBackend);
        const view: BotClickerView = {
            role: 'clicker',
            team: 'red',
            gameMode: 'classic',
            words: ['BAT', 'NIGHT', 'APPLE', 'CAR'],
            revealed: [false, false, false, false],
            types: [null, null, null, null],
            currentTurn: 'red',
            currentClue: { word: 'Gotham', number: 2, team: 'red' },
            guessesUsed: 0,
            guessesAllowed: 3,
        };
        const action = clicker.chooseGuess(view, ctx(12));
        // Gotham → BAT/NIGHT (the reference), never the fruit.
        expect(action).toEqual({ kind: 'reveal', index: 0 });
    });

    it('the advisor labels reference readings for its human clicker', () => {
        const view: BotClickerView = {
            role: 'clicker',
            team: 'red',
            gameMode: 'classic',
            words: ['BAT', 'NIGHT', 'APPLE', 'CAR'],
            revealed: [false, false, false, false],
            types: [null, null, null, null],
            currentTurn: 'red',
            currentClue: { word: 'Gotham', number: 2, team: 'red' },
            guessesUsed: 0,
            guessesAllowed: 3,
        };
        const out = suggestGuesses(view, tableBackend, 2);
        expect(out.length).toBeGreaterThan(0);
        expect(out[0]!.reason).toContain('the reference');
        expect(out.map((s) => s.index).sort()).toEqual([0, 1]); // BAT + NIGHT
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
    // make it an illegal clue and get filtered before scoring). Boards carry TWO
    // opponent cards so the endgame desperation path (exactly one opponent card
    // left) stays out of tests that aren't about it.
    const OWN2: ['red', 'red', 'blue', 'blue', 'assassin'] = ['red', 'red', 'blue', 'blue', 'assassin'];

    it('plays defense: prefers a clue that does not also point at the opponent', () => {
        // CLEAN and LEAKY both safely cover the two own cards, but LEAKY also
        // relates to the opponent card — a cautious expert avoids arming them.
        const view = spymasterView(['OWNA', 'OWNB', 'OPPO', 'OPPOX', 'ASSN'], OWN2);
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
        const view = spymasterView(['OWNA', 'OWNB', 'OPPO', 'OPPOX', 'ASSN'], OWN2);
        const backend = scoringStub({ SALVAGE: { OWNA: 0.4, OWNB: 0.35, OPPO: 0.3, ASSN: 0.1 } });
        const action = makeEmbeddingSpymaster(resolveSkill('expert', 1), backend).chooseClue(view, ctx(1));
        expect(action).toEqual({ kind: 'clue', word: 'SALVAGE', number: 2 });
    });

    it('temperature 0 (expert) is a deterministic argmax across seeds', () => {
        const view = spymasterView(['OWNA', 'OWNB', 'OPPO', 'OPPOX', 'ASSN'], OWN2);
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
        const view = spymasterView(['OWNA', 'OWNB', 'OPPO', 'OPPOX', 'ASSN'], OWN2);
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

describe('turn economy: endgame urgency and board cohesion', () => {
    it('goes for the win: an all-covering clue beats a clearer partial clue', () => {
        // WINALL covers every remaining own card with modest clarity; SAFE2
        // covers two of three brilliantly. Converting the board this turn beats
        // the clearer partial clue that leaves a card (and a turn) behind.
        const view = spymasterView(
            ['OWNA', 'OWNB', 'OWNC', 'OPPO', 'OPPOX', 'ASSN'],
            ['red', 'red', 'red', 'blue', 'blue', 'assassin']
        );
        const backend = scoringStub({
            WINALL: { OWNA: 0.6, OWNB: 0.55, OWNC: 0.5, OPPO: 0.1, ASSN: 0.05 },
            SAFE2: { OWNA: 0.95, OWNB: 0.9, OWNC: 0.1, OPPO: 0.1, ASSN: 0.05 },
        });
        const action = makeEmbeddingSpymaster(resolveSkill('expert', 3), backend).chooseClue(view, ctx(3));
        expect(action).toEqual({ kind: 'clue', word: 'WINALL', number: 3 });
    });

    it('a board-winning clue may exceed the normal number cap', () => {
        // Five own cards, one clue safely covers them all: the number is the true
        // count (5 > MAX_CLUE_NUMBER 4), which the server accepts (max 9).
        const view = spymasterView(
            ['OWNA', 'OWNB', 'OWNC', 'OWND', 'OWNE', 'OPPO', 'OPPOX', 'ASSN'],
            ['red', 'red', 'red', 'red', 'red', 'blue', 'blue', 'assassin']
        );
        const backend = scoringStub({
            BIGWIN: { OWNA: 0.9, OWNB: 0.85, OWNC: 0.8, OWND: 0.75, OWNE: 0.7, OPPO: 0.1, ASSN: 0.05 },
        });
        const action = makeEmbeddingSpymaster(resolveSkill('expert', 4), backend).chooseClue(view, ctx(4));
        expect(action).toEqual({ kind: 'clue', word: 'BIGWIN', number: 5 });
    });

    it('desperation (opponent one card from winning) relaxes the margin for a bigger number', () => {
        // OWNB sits under the normal expert margin over the hot neutral, so with
        // two opponent cards left the clue is a safe 1 — but with the opponent
        // one card from winning, banking a single forfeits the game, so the
        // margin relaxes and both own cards ride the clue.
        const rels = { OWNA: 0.9, OWNB: 0.5, OPPO: 0.1, NEUT: 0.4, ASSN: 0.05 };
        const calm = spymasterView(
            ['OWNA', 'OWNB', 'OPPO', 'OPPOX', 'NEUT', 'ASSN'],
            ['red', 'red', 'blue', 'blue', 'neutral', 'assassin']
        );
        const desperate = spymasterView(
            ['OWNA', 'OWNB', 'OPPO', 'NEUT', 'ASSN'],
            ['red', 'red', 'blue', 'neutral', 'assassin']
        );
        const backend = scoringStub({ DESP: rels });
        const calmAction = makeEmbeddingSpymaster(resolveSkill('expert', 5), backend).chooseClue(calm, ctx(5));
        const despAction = makeEmbeddingSpymaster(resolveSkill('expert', 5), backend).chooseClue(desperate, ctx(5));
        expect(calmAction).toEqual({ kind: 'clue', word: 'DESP', number: 1 });
        expect(despAction).toEqual({ kind: 'clue', word: 'DESP', number: 2 });
    });

    it('desperation never relaxes the hard assassin floor', () => {
        // Same desperate board, but the second own card hugs the assassin
        // (gap 0.07 < floor 0.1): even with the game on the line it is dropped.
        const view = spymasterView(['OWNA', 'OWNB', 'OPPO', 'ASSN'], ['red', 'red', 'blue', 'assassin']);
        const backend = scoringStub({ HUGGER: { OWNA: 0.9, OWNB: 0.5, OPPO: 0.1, ASSN: 0.43 } });
        const action = makeEmbeddingSpymaster(resolveSkill('expert', 6), backend).chooseClue(view, ctx(6));
        expect(action).toEqual({ kind: 'clue', word: 'HUGGER', number: 1 });
    });

    it('prefers the clue whose leftovers still clue well together (no stranding)', () => {
        // SMART and GREEDY both cover two own cards with identical clarity, but
        // SMART leaves the related pair {CC, DD} (one future clue) while GREEDY
        // leaves the unrelated {BB, DD} (two future single-card turns).
        const view = spymasterView(
            ['AA', 'BB', 'CC', 'DD', 'NEUT', 'ASSN'],
            ['red', 'red', 'red', 'red', 'neutral', 'assassin']
        );
        const backend = scoringStub({
            GREEDY: { AA: 0.9, CC: 0.85, NEUT: 0.05, ASSN: 0.05 },
            SMART: { AA: 0.9, BB: 0.85, NEUT: 0.05, ASSN: 0.05 },
            CC: { DD: 0.6 }, // own-pair relatedness; CC is a board word, so it is never a clue candidate
        });
        const action = makeEmbeddingSpymaster(resolveSkill('expert', 7), backend).chooseClue(view, ctx(7));
        expect(action).toMatchObject({ kind: 'clue', word: 'SMART', number: 2 });
    });

    it('does not overtrim safe low-signal cards when no assassin remains', () => {
        // No assassin on the board: FAINT's cards clear the margin but sit below
        // the 0.1 assassin floor in absolute terms — the berth must not apply,
        // so FAINT survives as a REAL clue. Its number, though, is promise-
        // trimmed to 1 (both cards are absolutely weak — lesson 18: a number
        // never promises a sub-floor tail). The number is the discriminator: a
        // wrongly-applied berth would null the clue and the best-effort fallback
        // would emit FAINT with a board-derived number of 2 instead.
        const view = spymasterView(['OWNA', 'OWNB', 'NEUT'], ['red', 'red', 'neutral']);
        const backend = scoringStub({
            FAINT: { OWNA: 0.09, OWNB: 0.085, NEUT: 0.02 },
        });
        const reckless: SkillParams = {
            temperature: 0,
            blunderRate: 0,
            riskAversion: 0.3,
            seed: 1,
            aggression: 0.95,
            assassinCaution: 0.7,
        };
        const action = makeEmbeddingSpymaster(reckless, backend).chooseClue(view, {
            gameMode: 'classic',
            skill: reckless,
            rng: makeRng(1),
        });
        expect(action).toEqual({ kind: 'clue', word: 'FAINT', number: 1 });
    });
});

describe('hard assassin berth floor (persona-independent)', () => {
    it('a reckless persona still refuses an intended card that hugs the assassin', () => {
        // RISKY's second intended card (OWNB 0.8) sits only 0.07 above the
        // assassin (ASSN 0.73) — outside the soft berth a maximally reckless
        // persona would demand (~0.06) but inside the hard floor (0.1). SAFE
        // covers one card far from everything. Before the floor, recklessness
        // bought RISKY as a 2; now aggression tunes the number, never the gate.
        const view = spymasterView(['OWNA', 'OWNB', 'OPPO', 'ASSN'], ['red', 'red', 'blue', 'assassin']);
        const backend = scoringStub({
            RISKY: { OWNA: 0.95, OWNB: 0.8, OPPO: 0.1, ASSN: 0.73 },
            SAFE: { OWNA: 0.9, OWNB: 0.1, OPPO: 0.1, ASSN: 0.05 },
        });
        const reckless: SkillParams = {
            temperature: 0,
            blunderRate: 0,
            riskAversion: 0.3,
            seed: 1,
            aggression: 0.95,
            assassinCaution: 0.7,
        };
        const action = makeEmbeddingSpymaster(reckless, backend).chooseClue(view, {
            gameMode: 'classic',
            skill: reckless,
            rng: makeRng(1),
        });
        expect(action).toMatchObject({ kind: 'clue', word: 'SAFE' });
    });
});

describe('robustness (anti-idiosyncrasy) scoring', () => {
    it('prefers a cool halo over an equally-clear hot one', () => {
        // HOT and COLD cover the same two own cards with IDENTICAL clarity
        // (weakest-intended minus best-non-own = 0.35 for both), so the old
        // scorer tied and took the first candidate. The ambiguity term now
        // prefers COLD, whose halo is absolutely cooler — a hot halo is one
        // misread from a misfire even when the margin clears.
        const view = spymasterView(['OWNA', 'OWNB', 'NEUT'], ['red', 'red', 'neutral']);
        const backend = scoringStub({
            HOT: { OWNA: 0.95, OWNB: 0.9, NEUT: 0.55 },
            COLD: { OWNA: 0.7, OWNB: 0.65, NEUT: 0.3 },
        });
        const action = makeEmbeddingSpymaster(resolveSkill('expert', 2), backend).chooseClue(view, ctx(2));
        expect(action).toMatchObject({ kind: 'clue', word: 'COLD', number: 2 });
    });

    it('prefers a common clue word over a rare one, all else equal', () => {
        const view = spymasterView(['OWNA', 'NEUT'], ['red', 'neutral']);
        const rels = { OWNA: 0.9, NEUT: 0.1 };
        const backend: SemanticBackend = {
            ...scoringStub({ RARE: rels, COMMON: rels }),
            commonness: (w: string) => (w === 'RARE' ? 0.2 : 1),
        };
        const action = makeEmbeddingSpymaster(resolveSkill('expert', 3), backend).chooseClue(view, ctx(3));
        expect(action).toMatchObject({ kind: 'clue', word: 'COMMON' });
    });
});

describe('pair-centroid bridge candidate generation', () => {
    it('surfaces a clue bridging two own cards from different domains', () => {
        // vocabulary() is empty and nearest() yields TUXEDO ONLY for the exact
        // [PENGUIN, MAESTRO] pair query — the full-own centroid and per-card
        // queries return weak single-card words. Only the pair-centroid pass can
        // surface the 2-card cross-domain bridge, which then wins on coverage.
        const rel: Record<string, Record<string, number>> = {
            TUXEDO: { PENGUIN: 0.85, MAESTRO: 0.8, SNOW: 0.1, APPLE: 0.1, DEATH: 0.05 },
            ICY: { PENGUIN: 0.1, MAESTRO: 0.0, SNOW: 0.7, APPLE: 0.1, DEATH: 0.05 },
        };
        const backend: SemanticBackend = {
            id: 'vec-stub',
            relatedness: (a: string, b: string) => rel[a]?.[b.toUpperCase()] ?? rel[b]?.[a.toUpperCase()] ?? 0,
            vocabulary: () => [],
            nearest: (words: string[]) => {
                if (words.length === 2 && words.includes('PENGUIN') && words.includes('MAESTRO')) {
                    return [{ word: 'TUXEDO', score: 0.85 }];
                }
                return [{ word: 'ICY', score: 0.5 }];
            },
        };
        const view = spymasterView(
            ['PENGUIN', 'MAESTRO', 'SNOW', 'APPLE', 'DEATH'],
            ['red', 'red', 'red', 'blue', 'assassin']
        );
        const action = makeEmbeddingSpymaster(resolveSkill('expert', 4), backend).chooseClue(view, ctx(4));
        expect(action).toEqual({ kind: 'clue', word: 'TUXEDO', number: 2 });
    });
});

describe('match-mode value awareness', () => {
    function matchView(
        words: string[],
        types: ('red' | 'blue' | 'neutral' | 'assassin')[],
        cardScores: number[]
    ): BotSpymasterView {
        return {
            role: 'spymaster',
            team: 'red',
            gameMode: 'match',
            words,
            revealed: words.map(() => false),
            types,
            currentTurn: 'red',
            cardScores,
        };
    }

    it('never clues an own trap (negative-value own card)', () => {
        const view = matchView(['GOODW', 'TRAPW', 'OPPW', 'ASSW'], ['red', 'red', 'blue', 'assassin'], [2, -1, 1, -2]);
        const backend = scoringStub({
            GOODFIT: { GOODW: 0.9, TRAPW: 0.1, OPPW: 0.1, ASSW: 0.1 },
            TRAPFIT: { GOODW: 0.1, TRAPW: 0.9, OPPW: 0.1, ASSW: 0.1 },
        });
        // TRAPFIT's top card is the own trap (reclassified as avoid), so it can't
        // lead safely — the spymaster must clue the +2 card instead.
        const action = makeEmbeddingSpymaster(resolveSkill('expert', 3), backend).chooseClue(view, ctx(3));
        expect(action).toMatchObject({ kind: 'clue', word: 'GOODFIT' });
    });

    it('prefers the clue covering the higher-value own card', () => {
        const view = matchView(['HIGHW', 'LOWW', 'OPPW', 'ASSW'], ['red', 'red', 'blue', 'assassin'], [3, 1, 1, -2]);
        const backend = scoringStub({
            HIGHFIT: { HIGHW: 0.9, LOWW: 0.1, OPPW: 0.1, ASSW: 0.1 },
            LOWFIT: { HIGHW: 0.1, LOWW: 0.9, OPPW: 0.1, ASSW: 0.1 },
        });
        const action = makeEmbeddingSpymaster(resolveSkill('expert', 5), backend).chooseClue(view, ctx(5));
        expect(action).toMatchObject({ kind: 'clue', word: 'HIGHFIT' });
    });

    // groupBoard keeps match traps out of `own` but tracks them in `ownTraps`, and
    // scoreClue reads coversAll off both (G1). The final number cap keys off
    // coversAll (CLUE_NUMBER_MAX vs MAX_CLUE_NUMBER), so this is the load-bearing bit.
    const g1ScoreCtx = { desperate: false, assassinBerthFloor: 0, strandPenalty: () => 0, marginScale: 1 };
    function g1Score(view: BotSpymasterView, clue: string, rel: Record<string, number>) {
        const groups = groupBoard(view);
        const skill = resolveSkill('expert', 1);
        const values = new Map(view.words.map((w, i) => [w, view.cardScores![i] ?? 0]));
        const backend = scoringStub({ [clue]: rel });
        return {
            groups,
            ev: scoreClue(
                clue,
                groups,
                backend,
                skill.riskAversion,
                (w) => values.get(w) ?? 0,
                resolveStyle(skill),
                g1ScoreCtx
            ),
        };
    }

    it('does not treat covering only the non-trap own cards as a board win while an own trap remains (G1)', () => {
        const view = matchView(
            ['A', 'B', 'TRAP', 'OPP', 'ASSN'],
            ['red', 'red', 'red', 'blue', 'assassin'],
            [2, 2, -1, 1, 0]
        );
        const { groups, ev } = g1Score(view, 'COVER', { A: 0.9, B: 0.9, TRAP: 0.1, OPP: 0.1, ASSN: 0.1 });
        // The trap is excluded from the targetable own set but tracked separately.
        expect(groups.own).toEqual(['A', 'B']);
        expect(groups.ownTraps).toEqual(['TRAP']);
        // COVER leads both targetable own cards, but the own trap stays unrevealed,
        // so the round can't end — this is NOT a board-winning clue.
        expect(ev).not.toBeNull();
        expect(ev!.coversAll).toBe(false);
    });

    it('still treats covering all own cards as a board win when no own trap remains (G1 control)', () => {
        const view = matchView(['A', 'B', 'OPP', 'ASSN'], ['red', 'red', 'blue', 'assassin'], [2, 2, 1, 0]);
        const { groups, ev } = g1Score(view, 'COVER', { A: 0.9, B: 0.9, OPP: 0.1, ASSN: 0.1 });
        expect(groups.ownTraps).toEqual([]);
        expect(ev).not.toBeNull();
        expect(ev!.coversAll).toBe(true);
    });

    // G1 remainder: traps re-enter targeting so a winnable round can be CLOSED.
    describe('admitClosingTraps (endgame trap targeting)', () => {
        const view = matchView(['A', 'TRAP', 'OPP', 'ASSN'], ['red', 'red', 'blue', 'assassin'], [2, -1, 1, 0]);
        const valueOf = (w: string) => ({ A: 2, TRAP: -1, OPP: 1, ASSN: 0 })[w] ?? 0;

        it('re-admits a trap when the round-win bonus outweighs its cost', () => {
            const groups = groupBoard(view); // own:[A], ownTraps:[TRAP]
            admitClosingTraps(groups, true, valueOf); // bonus 7 > trap cost 1
            expect(groups.own.sort()).toEqual(['A', 'TRAP']);
            expect(groups.ownTraps).toEqual([]);
            expect(groups.neutral).not.toContain('TRAP');
        });

        it('re-admits when the only own cards left are traps', () => {
            const trapOnly = matchView(['TRAP', 'OPP', 'ASSN'], ['red', 'blue', 'assassin'], [-1, 1, 0]);
            const groups = groupBoard(trapOnly); // own:[], ownTraps:[TRAP]
            expect(groups.own).toEqual([]);
            admitClosingTraps(groups, true, (w) => (w === 'TRAP' ? -1 : 0));
            expect(groups.own).toEqual(['TRAP']);
            expect(groups.ownTraps).toEqual([]);
        });

        it('does NOT re-admit when non-trap own cards remain and the cost exceeds the bonus', () => {
            const costly = matchView(['A', 'TRAP', 'OPP', 'ASSN'], ['red', 'red', 'blue', 'assassin'], [2, -8, 1, 0]);
            const groups = groupBoard(costly);
            admitClosingTraps(groups, true, (w) => (w === 'TRAP' ? -8 : w === 'A' ? 2 : 0)); // cost 8 > bonus 7
            expect(groups.own).toEqual(['A']);
            expect(groups.ownTraps).toEqual(['TRAP']);
        });

        it('is a no-op outside match mode', () => {
            const groups = groupBoard(view);
            const before = { own: [...groups.own], ownTraps: [...groups.ownTraps] };
            admitClosingTraps(groups, false, valueOf);
            expect(groups.own).toEqual(before.own);
            expect(groups.ownTraps).toEqual(before.ownTraps);
        });

        it('lets the spymaster clue toward the trap so a trap-only round can be finished', () => {
            const trapOnly = matchView(['TRAPW', 'OPPW', 'ASSW'], ['red', 'blue', 'assassin'], [-1, 1, -2]);
            const backend = scoringStub({
                TRAPFIT: { TRAPW: 0.9, OPPW: 0.1, ASSW: 0.1 },
            });
            const action = makeEmbeddingSpymaster(resolveSkill('expert', 3), backend).chooseClue(trapOnly, ctx(3));
            // Without re-admission the only own card (a trap) is untargetable and the
            // bot falls back to a placeholder; with it, the bot clues toward the trap.
            expect(action).toMatchObject({ kind: 'clue', word: 'TRAPFIT' });
        });

        // Case (b): a non-trap own card remains AND the round-win bonus outweighs the
        // trap cost. With a nearest()-generating backend, candidates must be generated
        // FROM the admitted trap for the bot to actually close the round — the trap
        // has to be in the own set BEFORE candidate generation, not merely re-scored
        // after. A nearest() stub keys candidates on which cards are queried:
        // querying MONKEY alone yields SOLO (covers one own); the trap PIRATE (or the
        // MONKEY+PIRATE centroid) yields BRIDGE (covers both, closing the round).
        it('generates a trap-bridging clue to close a winnable round (case b, nearest backend)', () => {
            const nearestStub = (
                rel: Record<string, Record<string, number>>,
                near: Record<string, string[]>
            ): SemanticBackend => ({
                id: 'nearstub',
                relatedness: (a: string, b: string) => rel[a]?.[b.toUpperCase()] ?? rel[b]?.[a.toUpperCase()] ?? 0,
                nearest: (words: string[], k: number) =>
                    (near[[...words].sort().join('+')] ?? []).slice(0, k).map((word) => ({ word, score: 1 })),
            });
            const view = matchView(
                ['MONKEY', 'PIRATE', 'OPERA', 'VENOM'],
                ['red', 'red', 'blue', 'assassin'],
                [2, -1, 1, -2]
            );
            const backend = nearestStub(
                {
                    BRIDGE: { MONKEY: 0.9, PIRATE: 0.9, OPERA: 0.1, VENOM: 0.1 },
                    SOLO: { MONKEY: 0.9, PIRATE: 0.1, OPERA: 0.1, VENOM: 0.1 },
                },
                { MONKEY: ['SOLO'], PIRATE: ['BRIDGE'], 'MONKEY+PIRATE': ['BRIDGE'] }
            );
            const action = makeEmbeddingSpymaster(resolveSkill('expert', 5), backend).chooseClue(view, ctx(5));
            // Pre-fix ordering generated candidates from MONKEY only (-> SOLO) and
            // could not cover the trap; the reorder surfaces BRIDGE and closes the round.
            expect(action).toMatchObject({ kind: 'clue', word: 'BRIDGE' });
        });
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

    it('emits a generated reference clue in its house-rule display case (G2)', () => {
        // nearest() yields a proper-reference key NORMALIZED (all-caps "VADER");
        // displayCase restores its canonical case so it goes out as the reference,
        // not a legacy all-caps token that reads as the common sense.
        const rel: Record<string, Record<string, number>> = {
            VADER: { SABER: 0.9, EMPIRE: 0.85, APPLE: 0.1, CAR: 0.1, DEATH: 0.1 },
        };
        const backend: SemanticBackend = {
            id: 'vec-stub',
            relatedness: (a: string, b: string) => rel[a]?.[b.toUpperCase()] ?? rel[b]?.[a.toUpperCase()] ?? 0,
            vocabulary: () => [],
            nearest: () => [{ word: 'VADER', score: 0.9 }],
            displayCase: (w: string) => (w.toUpperCase() === 'VADER' ? 'Vader' : w),
        };
        const view = spymasterView(
            ['SABER', 'EMPIRE', 'APPLE', 'CAR', 'DEATH'],
            ['red', 'red', 'blue', 'neutral', 'assassin']
        );
        const action = makeEmbeddingSpymaster(resolveSkill('expert', 7), backend).chooseClue(view, ctx(7));
        expect(action).toMatchObject({ kind: 'clue', word: 'Vader' });
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

describe('greedyClicker core+stretch discipline', () => {
    // One own card already taken this clue (revealed + unmasked as ours), two
    // cards left. The clue promised 3, so the old clicker always pressed on.
    const cliffView = (words: string[], scoresTaken: boolean, over: Partial<BotClickerView> = {}): BotClickerView => ({
        role: 'clicker',
        team: 'red',
        gameMode: 'classic',
        words,
        revealed: [scoresTaken, false, false],
        types: [scoresTaken ? 'red' : null, null, null],
        currentTurn: 'red',
        currentClue: { word: 'CLUE', number: 3, team: 'red' },
        guessesUsed: scoresTaken ? 1 : 0,
        guessesAllowed: 4,
        ...over,
    });

    it('banks the turn when the remaining field is a weak, undifferentiated blob', () => {
        // Took a 0.9 fit; what's left is 0.20/0.18 — steep below the take, weak in
        // absolute terms, and blurred into each other. A guess here is a coin-flip
        // the clue never promised, even though the clue number says continue.
        const backend = scoringStub({ CLUE: { TAKEN: 0.9, NOISEA: 0.2, NOISEB: 0.18 } });
        const clicker = makeGreedyClicker(resolveSkill('expert', 1), backend);
        const action = clicker.chooseGuess(cliffView(['TAKEN', 'NOISEA', 'NOISEB'], true), ctx(1));
        expect(action).toEqual({ kind: 'endTurn' });
    });

    it('presses on when the next card clearly separates from the field', () => {
        // 0.25 is far below the 0.9 take, but it stands clear of the 0.1 field by
        // more than any spymaster margin — exactly what an intended card looks
        // like on a cold board, so the cliff must not eat it.
        const backend = scoringStub({ CLUE: { TAKEN: 0.9, SEPAR: 0.25, NOISEB: 0.1 } });
        const clicker = makeGreedyClicker(resolveSkill('expert', 1), backend);
        const action = clicker.chooseGuess(cliffView(['TAKEN', 'SEPAR', 'NOISEB'], true), ctx(1));
        expect(action).toEqual({ kind: 'reveal', index: 1 });
    });

    it('presses on for an absolutely-strong card even after a steep drop', () => {
        // A direct-hit 1.0 followed by a 0.5 association: a >50% relative drop,
        // but 0.5 is a real signal (e.g. table co-membership) the clue promised.
        const backend = scoringStub({ CLUE: { TAKEN: 1.0, SOLID: 0.5, NOISEB: 0.45 } });
        const clicker = makeGreedyClicker(resolveSkill('expert', 1), backend);
        const action = clicker.chooseGuess(cliffView(['TAKEN', 'SOLID', 'NOISEB'], true), ctx(1));
        expect(action).toEqual({ kind: 'reveal', index: 1 });
    });
});

describe('greedyClicker disciplined bonus guess ("+1")', () => {
    const bonusView = (over: Partial<BotClickerView> = {}): BotClickerView => ({
        role: 'clicker',
        team: 'red',
        gameMode: 'classic',
        words: ['TAKEN', 'HOT', 'MEH'],
        revealed: [true, false, false],
        types: ['red', null, null],
        currentTurn: 'red',
        currentClue: { word: 'CLUE', number: 1, team: 'red' },
        guessesUsed: 1, // the intended guess landed; the engine allows one more
        guessesAllowed: 2,
        ...over,
    });
    const aggressive: SkillParams = { temperature: 0, blunderRate: 0, riskAversion: 0.3, seed: 1, aggression: 0.9 };
    const actx = (seed = 1): BotContext => ({ gameMode: 'classic', skill: aggressive, rng: makeRng(seed) });

    it('an aggressive persona takes the bonus when the top leftover is tighter than the core', () => {
        const backend = scoringStub({ CLUE: { TAKEN: 1.0, HOT: 0.9, MEH: 0.3 } });
        const action = makeGreedyClicker(aggressive, backend).chooseGuess(bonusView(), actx());
        expect(action).toEqual({ kind: 'reveal', index: 1 });
    });

    it('a plain preset (no aggression) never spends the bonus', () => {
        const backend = scoringStub({ CLUE: { TAKEN: 1.0, HOT: 0.9, MEH: 0.3 } });
        const action = makeGreedyClicker(resolveSkill('expert', 1), backend).chooseGuess(bonusView(), ctx(1));
        expect(action).toEqual({ kind: 'endTurn' });
    });

    it('declines the bonus when the field is tight (merely plausible, not clear)', () => {
        const backend = scoringStub({ CLUE: { TAKEN: 1.0, HOT: 0.9, MEH: 0.75 } });
        const action = makeGreedyClicker(aggressive, backend).chooseGuess(bonusView(), actx());
        expect(action).toEqual({ kind: 'endTurn' });
    });

    it('declines the bonus when the top leftover is below the floor', () => {
        const backend = scoringStub({ CLUE: { TAKEN: 1.0, HOT: 0.5, MEH: 0.1 } });
        const action = makeGreedyClicker(aggressive, backend).chooseGuess(bonusView(), actx());
        expect(action).toEqual({ kind: 'endTurn' });
    });

    it('respects the engine budget: no reveal once guessesAllowed is spent', () => {
        const backend = scoringStub({ CLUE: { TAKEN: 1.0, HOT: 0.9, MEH: 0.3 } });
        const view = bonusView({ guessesUsed: 2 });
        const action = makeGreedyClicker(aggressive, backend).chooseGuess(view, actx());
        expect(action).toEqual({ kind: 'endTurn' });
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
