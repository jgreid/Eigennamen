/**
 * Phase-4 clicker/advisor nuance (docs/BOT_NUANCE_PLAN.md):
 *  4.1 sense enumeration + frame switch (ledger lesson 20 — the uniform-weak
 *      tell: handed "Tinder" with no app cards in sight, read tinder → fire),
 *  4.2 advisor warnings (fixed strings, failure-G discipline),
 *  4.3 within-game clue debt (lessons 9/24/27 — owed frames boost, burned
 *      frames transfer nothing),
 *  4.4 number-conditional rarity (lesson 26 — the singles doctrine).
 */
import { lexicalBackend, type SemanticBackend } from '../../bots/semantics/backend';
import { tableBackend } from '../../bots/semantics/tableBackend';
import { makeCustomMapBackend, type SemanticMap } from '../../bots/semantics/mapBackend';
import { resolveClueFrame } from '../../bots/strategies/clueFrame';
import { makeGreedyClicker } from '../../bots/strategies/clickers';
import { makeEmbeddingSpymaster } from '../../bots/strategies/spymasters';
import { suggestGuesses } from '../../bots/strategies/advisor';
import { makeRng } from '../../bots/rng';
import type {
    BotClickerView,
    BotContext,
    BotSeatMemory,
    BotSpymasterView,
    SkillParams,
} from '../../bots/strategies/types';

const skill = (over: Partial<SkillParams> = {}): SkillParams => ({
    temperature: 0,
    blunderRate: 0,
    riskAversion: 0.6,
    seed: 1,
    ...over,
});
const ctx = (s: SkillParams, memory?: BotSeatMemory): BotContext => ({
    gameMode: 'classic',
    skill: s,
    rng: makeRng(1),
    ...(memory ? { memory } : {}),
});

const clickerView = (words: string[], clue: string, number: number, guessesUsed = 0): BotClickerView => ({
    role: 'clicker',
    team: 'red',
    gameMode: 'classic',
    words,
    revealed: words.map(() => false),
    types: words.map(() => null),
    currentTurn: 'red',
    currentClue: { word: clue, number },
    guessesUsed,
    guessesAllowed: number + 1,
});

// The Tinder-shaped map: the reference sense reaches HEART; the common sense
// (fire) reaches TORCH and LOG.
const TINDER_MAP: SemanticMap = {
    version: 2,
    words: ['TORCH', 'LOG', 'HEART', 'ROSE', 'PIT'],
    concepts: { TINDER: ['TORCH', 'LOG'] },
    proper: { Tinder: { contents: ['HEART'], fame: 0.85 } },
};
const tinderBackend = makeCustomMapBackend([TINDER_MAP], lexicalBackend);

describe('4.1 frame switch: the uniform-weak tell flips the sense', () => {
    it('resolveClueFrame switches a proper clue to its common sense when the reference explains nothing', () => {
        expect(resolveClueFrame('Tinder', ['TORCH', 'LOG', 'ROSE'], tinderBackend)).toEqual({
            word: 'tinder',
            switched: true,
        });
        // With the reference's content on the board, the given frame holds.
        expect(resolveClueFrame('Tinder', ['TORCH', 'LOG', 'HEART'], tinderBackend).switched).toBe(false);
        // One strong alternate candidate is coincidence, not a frame.
        expect(resolveClueFrame('Tinder', ['TORCH', 'ROSE'], tinderBackend).switched).toBe(false);
        // Neutral (ALL CAPS) clues are already read both ways — never switch.
        expect(resolveClueFrame('TINDER', ['TORCH', 'LOG', 'ROSE'], tinderBackend).switched).toBe(false);
    });

    it('the clicker guesses under the switched sense (tinder → fire → TORCH)', () => {
        const s = skill();
        const action = makeGreedyClicker(s, tinderBackend).chooseGuess(
            clickerView(['TORCH', 'LOG', 'ROSE', 'PIT'], 'Tinder', 2),
            ctx(s)
        );
        expect(action).toEqual({ kind: 'reveal', index: 0 });
    });

    it('stays in the switched frame mid-clue: one strong leftover is continuation, not coincidence', () => {
        // TORCH was taken under the switched sense; LOG is the only alternate
        // candidate left. The initial min-2 coincidence guard must not
        // un-switch the frame now and strand LOG in the dead reference frame.
        const s = skill();
        const view: BotClickerView = {
            role: 'clicker',
            team: 'red',
            gameMode: 'classic',
            words: ['TORCH', 'LOG', 'ROSE', 'PIT'],
            revealed: [true, false, false, false],
            types: ['red', null, null, null],
            currentTurn: 'red',
            currentClue: { word: 'Tinder', number: 2 },
            guessesUsed: 1,
            guessesAllowed: 3,
        };
        expect(makeGreedyClicker(s, tinderBackend).chooseGuess(view, ctx(s))).toEqual({ kind: 'reveal', index: 1 });
    });

    it('no switch when the given frame delivers (HEART on board)', () => {
        const s = skill();
        const action = makeGreedyClicker(s, tinderBackend).chooseGuess(
            clickerView(['TORCH', 'LOG', 'HEART', 'ROSE'], 'Tinder', 1),
            ctx(s)
        );
        expect(action).toEqual({ kind: 'reveal', index: 2 });
    });

    it('a delivering proper clue is NOT hijacked mid-clue by its weak promised tail (correctness-review finding)', () => {
        // "Fable 2": GLASS (1.0) taken; PRINCESS is the promised second card
        // at 0.32 — a tail the spymaster could legitimately promise (above
        // PROMISE_FLOOR 0.3). PUMPKIN tempts a hijack into the common sense
        // ("fable" → PUMPKIN, 0.6). The mid-clue doubt floor is PROMISE_FLOOR,
        // so 0.32 clears it: no doubt, and PRINCESS (the promise) is taken —
        // not PUMPKIN, a channel the clue's assassin gate never evaluated.
        const hijack: SemanticMap = {
            version: 2,
            words: ['GLASS', 'PRINCESS', 'PUMPKIN', 'DECOY'],
            concepts: { FABLE: [{ word: 'PUMPKIN', weight: 0.6 }] },
            proper: {
                Fable: {
                    contents: [
                        { word: 'GLASS', weight: 1 },
                        { word: 'PRINCESS', weight: 0.32 },
                    ],
                    fame: 0.9,
                },
            },
        };
        const be = makeCustomMapBackend([hijack], lexicalBackend);
        const s = skill();
        const view: BotClickerView = {
            role: 'clicker',
            team: 'red',
            gameMode: 'classic',
            words: ['GLASS', 'PRINCESS', 'PUMPKIN', 'DECOY'],
            revealed: [true, false, false, false],
            types: ['red', null, null, null],
            currentTurn: 'red',
            currentClue: { word: 'Fable', number: 2 },
            guessesUsed: 1,
            guessesAllowed: 3,
        };
        expect(makeGreedyClicker(s, be).chooseGuess(view, ctx(s))).toEqual({ kind: 'reveal', index: 1 });
    });
});

describe('4.2 advisor warnings (fixed strings, masked-view-only discipline)', () => {
    it('frame doubt: suggestions follow the alternate sense and say so', () => {
        const words = ['TORCH', 'LOG', 'ROSE', 'PIT'];
        const suggestions = suggestGuesses(clickerView(words, 'Tinder', 2), tinderBackend, 3);
        expect(suggestions.length).toBeGreaterThanOrEqual(2);
        expect(suggestions.map((s) => s.index).sort()).toEqual([0, 1]);
        for (const s of suggestions) {
            expect(s.warning).toMatch(/other sense/);
            // Failure-G discipline: a warning never names a board word.
            for (const w of words) expect(s.warning!.toUpperCase()).not.toContain(w);
        }
    });

    it('unresolved reference: a known-but-absent reference warns toward type-level readings', () => {
        // "Hooke" is a curated reference, but none of its contents/hypernyms
        // are on this board — the advisor can only offer orthographic noise
        // and must say the reference is unresolved.
        const suggestions = suggestGuesses(clickerView(['HOOD', 'TOOTH', 'HORSE'], 'Hooke', 1), tableBackend, 3);
        expect(suggestions.length).toBeGreaterThanOrEqual(1);
        expect(suggestions[0]!.warning).toMatch(/type-level/);
    });

    it('late stretch: a weak suggestion in the endgame carries the assassin-check warning', () => {
        const map: SemanticMap = {
            version: 2,
            words: ['MIST'],
            concepts: { BLORP: [{ word: 'MIST', weight: 0.3 }] },
        };
        const backend = makeCustomMapBackend([map], lexicalBackend);
        const view = clickerView(['MIST', 'ZZZZ'], 'blorp', 1);
        const late = suggestGuesses(view, backend, 3, undefined, undefined, { ownRemaining: 2 });
        expect(late[0]!.warning).toMatch(/assassin check/);
        const early = suggestGuesses(view, backend, 3, undefined, undefined, { ownRemaining: 7 });
        expect(early[0]!.warning).toBeUndefined();
    });

    it('no warning on a confident, resolved suggestion', () => {
        const suggestions = suggestGuesses(
            clickerView(['TORCH', 'LOG', 'HEART', 'ROSE'], 'Tinder', 1),
            tinderBackend,
            3,
            undefined,
            undefined,
            { ownRemaining: 7 }
        );
        expect(suggestions[0]).toMatchObject({ index: 2 });
        expect(suggestions[0]!.warning).toBeUndefined();
    });
});

describe('4.3 clue debt: owed frames boost, burned frames transfer nothing', () => {
    // PLAIN and OWED fit the live clue equally; OWED also fits the earlier
    // OLDIE clue. Ties break to the first (lowest-index) candidate, so the
    // debt boost is exactly what moves the pick.
    const map: SemanticMap = {
        version: 2,
        words: ['PLAIN', 'OWED'],
        concepts: {
            CURR: [
                { word: 'PLAIN', weight: 0.6 },
                { word: 'OWED', weight: 0.6 },
            ],
            OLDIE: [{ word: 'OWED', weight: 0.8 }],
        },
    };
    const backend = makeCustomMapBackend([map], lexicalBackend);
    const view = (): BotClickerView => clickerView(['PLAIN', 'OWED'], 'CURR', 2);
    const memory = (entry: Partial<BotSeatMemory['clues'][number]>): BotSeatMemory => ({
        clues: [{ word: 'OLDIE', number: 2, taken: 1, bounced: false, ...entry }],
    });

    it('without memory the tie breaks to the first candidate', () => {
        const s = skill();
        expect(makeGreedyClicker(s, backend).chooseGuess(view(), ctx(s))).toEqual({ kind: 'reveal', index: 0 });
    });

    it('an owed, unbounced frame boosts its leftover candidate', () => {
        const s = skill();
        expect(makeGreedyClicker(s, backend).chooseGuess(view(), ctx(s, memory({})))).toEqual({
            kind: 'reveal',
            index: 1,
        });
    });

    it('a bounced frame is void — no boost', () => {
        const s = skill();
        expect(makeGreedyClicker(s, backend).chooseGuess(view(), ctx(s, memory({ bounced: true })))).toEqual({
            kind: 'reveal',
            index: 0,
        });
    });

    it('a fully delivered frame owes nothing — no boost', () => {
        const s = skill();
        expect(makeGreedyClicker(s, backend).chooseGuess(view(), ctx(s, memory({ taken: 2 })))).toEqual({
            kind: 'reveal',
            index: 0,
        });
    });

    it('the debt boost never jumps a card across the assassin berth (correctness-review finding)', () => {
        // HAMMER (own) leads DANGER by exactly the hard assassin berth floor
        // (0.5 vs 0.4). An owed clue fits DANGER perfectly (0.9) — but the
        // spymaster's gate certified that 0.10 gap without ever seeing the
        // debt boost, so the boost (capped below 0.10) must NOT flip the pick
        // onto the card the gate ruled safe.
        const dbg: SemanticMap = {
            version: 2,
            words: ['HAMMER', 'DANGER'],
            concepts: {
                TOOL: [
                    { word: 'HAMMER', weight: 0.5 },
                    { word: 'DANGER', weight: 0.4 },
                ],
                SEA: [{ word: 'DANGER', weight: 0.9 }],
            },
        };
        const be = makeCustomMapBackend([dbg], lexicalBackend);
        const s = skill();
        const mem: BotSeatMemory = { clues: [{ word: 'SEA', number: 3, taken: 1, bounced: false }] };
        expect(makeGreedyClicker(s, be).chooseGuess(clickerView(['HAMMER', 'DANGER'], 'TOOL', 1), ctx(s, mem))).toEqual(
            { kind: 'reveal', index: 0 }
        );
    });
});

describe('4.4 number-conditional rarity: the singles doctrine', () => {
    const spymasterView = (words: string[], types: ('red' | 'blue' | 'neutral' | 'assassin')[]): BotSpymasterView => ({
        role: 'spymaster',
        team: 'red',
        gameMode: 'classic',
        words,
        revealed: words.map(() => false),
        types,
        currentTurn: 'red',
    });

    // RAREKEY is a deep-cut near-definitional clue (cold halo); COMKEY is the
    // household word trailing a lateral onto a neutral card.
    const map: SemanticMap = {
        version: 2,
        words: ['TARGETA', 'TARGETB', 'LATERAL', 'OPPOX'],
        concepts: {
            RAREKEY: [
                { word: 'TARGETA', weight: 0.9 },
                { word: 'TARGETB', weight: 0.85 },
            ],
            COMKEY: [
                { word: 'TARGETA', weight: 0.95 },
                { word: 'TARGETB', weight: 0.9 },
                { word: 'LATERAL', weight: 0.3 },
            ],
        },
        commonness: { RAREKEY: 0.1, COMKEY: 1 },
    };
    const backend = makeCustomMapBackend([map], lexicalBackend);

    it('at N=1 the rare, narrow clue beats the common one trailing a lateral', () => {
        const s = skill();
        const action = makeEmbeddingSpymaster(s, backend).chooseClue(
            spymasterView(['TARGETA', 'OPPOX', 'LATERAL'], ['red', 'blue', 'neutral']),
            ctx(s)
        );
        expect(action).toMatchObject({ kind: 'clue', word: 'RAREKEY', number: 1 });
    });

    it('on a breadth clue (N=2) the full rarity tax keeps the common clue on top', () => {
        const s = skill();
        const action = makeEmbeddingSpymaster(s, backend).chooseClue(
            spymasterView(['TARGETA', 'TARGETB', 'OPPOX', 'LATERAL'], ['red', 'red', 'blue', 'neutral']),
            ctx(s)
        );
        expect(action).toMatchObject({ kind: 'clue', word: 'COMKEY', number: 2 });
    });
});

describe('clicker plausibility guard (no suicidal picks)', () => {
    // One card matches the clue; the other three are clue-unrelated — the assassin
    // analog. clueRetrieval on this backend is bare relatedness (no collocation).
    const stub = (rel: Record<string, number>): SemanticBackend => ({
        id: 'plausible-stub',
        relatedness: (a: string, b: string) => rel[a.toUpperCase()] ?? rel[b.toUpperCase()] ?? 0,
    });

    it('a max-noise, blunder-prone clicker never reveals a clue-unrelated card', () => {
        const be = stub({ GOOD: 0.9, BAD1: 0, BAD2: 0, BAD3: 0 });
        // Cranked-up noise: high temperature + a 90% blunder rate + low caution.
        // Pre-guard, a blunder was a UNIFORM random pick (¾ of the time a BAD card,
        // i.e. the assassin); the plausibility guard restricts every pick to cards
        // that actually match the clue, so it only ever takes GOOD.
        const s = skill({ temperature: 2.0, blunderRate: 0.9, riskAversion: 0.1 });
        const clicker = makeGreedyClicker(s, be);
        for (let seed = 0; seed < 200; seed++) {
            const view = clickerView(['GOOD', 'BAD1', 'BAD2', 'BAD3'], 'X', 1);
            const action = clicker.chooseGuess(view, {
                gameMode: 'classic',
                skill: { ...s, seed },
                rng: makeRng(seed),
            });
            expect(action).toEqual({ kind: 'reveal', index: 0 });
        }
    });
});

describe('2.11 endgame stretch discipline (lesson 11 — the guesser-side berth ramp)', () => {
    // Synthetic backend: one moderately-warm card blurred into a lukewarm field
    // (the endgame no-information state), plus a strong-clear configuration.
    const weakBlurred: SemanticBackend = {
        id: 'weak-blurred',
        relatedness: (a, b) => (b === 'ALPHA' ? 0.3 : b === 'BRAVO' ? 0.26 : 0.1),
    };
    const strongClear: SemanticBackend = {
        id: 'strong-clear',
        relatedness: (a, b) => (b === 'ALPHA' ? 0.8 : 0.15),
    };
    const midClue = (ownRemaining: number): BotClickerView => ({
        ...clickerView(['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA'], 'HUNCH', 3, 1),
        ownRemaining,
    });

    it('banks a weak, blurred stretch in the endgame that it would take early-game', () => {
        const s = skill();
        expect(makeGreedyClicker(s, weakBlurred).chooseGuess(midClue(6), ctx(s))).toEqual({
            kind: 'reveal',
            index: 0,
        });
        // ownRemaining 3 with 2 grant left: endgame discipline applies but the
        // clue can NOT finish the board, so the pressure override stays out of
        // the way. (ownRemaining 2 here is WIN IN REACH — the grant covers
        // everything left — and is deliberately pressed instead; see below.)
        expect(makeGreedyClicker(s, weakBlurred).chooseGuess(midClue(3), ctx(s))).toEqual({ kind: 'endTurn' });
    });

    it('presses the same weak, blurred field when the grant covers every remaining card (win in reach)', () => {
        // Identical board and scores as the banked case above — the ONLY
        // difference is ownRemaining 2 vs 3: with 2 cards left and 2 promised
        // guesses remaining, banking is the play that loses the game
        // (live-play finding), so the caution gate yields to the argmax read.
        const s = skill();
        expect(makeGreedyClicker(s, weakBlurred).chooseGuess(midClue(2), ctx(s))).toEqual({
            kind: 'reveal',
            index: 0,
        });
    });

    it('still takes a strong, clear read in the endgame', () => {
        // ownRemaining 3 keeps this on the discipline path (not pressure), so
        // it proves the STRONG read itself clears the stretch gate.
        const s = skill();
        expect(makeGreedyClicker(s, strongClear).chooseGuess(midClue(3), ctx(s))).toEqual({
            kind: 'reveal',
            index: 0,
        });
    });

    it('never banks the forced first guess, and synthetic views without ownRemaining are untouched', () => {
        const s = skill();
        const firstGuess: BotClickerView = {
            ...clickerView(['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA'], 'HUNCH', 3, 0),
            ownRemaining: 1,
        };
        expect(makeGreedyClicker(s, weakBlurred).chooseGuess(firstGuess, ctx(s)).kind).toBe('reveal');
        // No ownRemaining -> no endgame tightening (pre-2.11 behaviour).
        const legacy = clickerView(['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA'], 'HUNCH', 3, 1);
        expect(makeGreedyClicker(s, weakBlurred).chooseGuess(legacy, ctx(s)).kind).toBe('reveal');
    });

    it('raises the number+1 bonus floor in the endgame', () => {
        // Top leftover at 0.65 clears the bold persona's normal floor (0.6) and
        // the field gap, but not the endgame floor (0.75).
        const bonusBackend: SemanticBackend = {
            id: 'bonus',
            relatedness: (a, b) => (b === 'ALPHA' ? 0.65 : 0.1),
        };
        const s = skill({ aggression: 1 });
        const spent = (ownRemaining: number): BotClickerView => ({
            ...clickerView(['ALPHA', 'BRAVO', 'CHARLIE'], 'HUNCH', 1, 1),
            ownRemaining,
        });
        expect(makeGreedyClicker(s, bonusBackend).chooseGuess(spent(6), ctx(s))).toEqual({
            kind: 'reveal',
            index: 0,
        });
        expect(makeGreedyClicker(s, bonusBackend).chooseGuess(spent(2), ctx(s))).toEqual({ kind: 'endTurn' });
    });
});

describe('debt PICKUP: the +1 bonus works outstanding clues (live-play finding)', () => {
    // CURR reaches only TAKEN (already revealed); the earlier, under-delivered
    // OLDIE clue reaches LEFTOVER at real-target strength. FILLER fits nothing.
    const map: SemanticMap = {
        version: 2,
        words: ['TAKEN', 'LEFTOVER', 'FILLER'],
        concepts: {
            CURR: [{ word: 'TAKEN', weight: 0.9 }],
            OLDIE: [{ word: 'LEFTOVER', weight: 0.8 }],
        },
    };
    const backend = makeCustomMapBackend([map], lexicalBackend);
    // Clue CURR 1, one guess spent (TAKEN revealed own) — the +1 is live.
    const spentView = (): BotClickerView => ({
        ...clickerView(['TAKEN', 'LEFTOVER', 'FILLER'], 'CURR', 1, 1),
        revealed: [true, false, false],
        types: ['red', null, null],
    });
    const owed = (over: Partial<BotSeatMemory['clues'][number]> = {}): BotSeatMemory => ({
        clues: [{ word: 'OLDIE', number: 2, taken: 0, bounced: false, ...over }],
    });

    it('spends the +1 on the owed leftover — scored against the OWED clue, not the current one', () => {
        const s = skill(); // aggression-less persona: the normal bonus never fires
        expect(makeGreedyClicker(s, backend).chooseGuess(spentView(), ctx(s, owed()))).toEqual({
            kind: 'reveal',
            index: 1,
        });
    });

    it('without memory the same position banks (previous behavior preserved)', () => {
        const s = skill();
        expect(makeGreedyClicker(s, backend).chooseGuess(spentView(), ctx(s))).toEqual({ kind: 'endTurn' });
    });

    it('a bounced or delivered frame transfers no pickup', () => {
        const s = skill();
        expect(makeGreedyClicker(s, backend).chooseGuess(spentView(), ctx(s, owed({ bounced: true })))).toEqual({
            kind: 'endTurn',
        });
        expect(makeGreedyClicker(s, backend).chooseGuess(spentView(), ctx(s, owed({ taken: 2 })))).toEqual({
            kind: 'endTurn',
        });
    });

    it('a weak owed fit (below the real-target bar) banks instead', () => {
        const weakMap: SemanticMap = {
            version: 2,
            words: ['TAKEN', 'LEFTOVER', 'FILLER'],
            concepts: {
                CURR: [{ word: 'TAKEN', weight: 0.9 }],
                OLDIE: [{ word: 'LEFTOVER', weight: 0.3 }], // under DEBT_FIT_BAR
            },
        };
        const weak = makeCustomMapBackend([weakMap], lexicalBackend);
        const s = skill();
        expect(makeGreedyClicker(s, weak).chooseGuess(spentView(), ctx(s, owed()))).toEqual({ kind: 'endTurn' });
    });
});

describe('anti-clue (0) and unlimited (U/-1) semantics', () => {
    // AVOIDME points hard at BADCARD; the earlier OLDIE clue owes LEFTOVER.
    const map: SemanticMap = {
        version: 2,
        words: ['BADCARD', 'LEFTOVER', 'FILLER'],
        concepts: {
            AVOIDME: [{ word: 'BADCARD', weight: 0.9 }],
            OLDIE: [{ word: 'LEFTOVER', weight: 0.8 }],
        },
    };
    const backend = makeCustomMapBackend([map], lexicalBackend);
    const antiView = (): BotClickerView => ({
        ...clickerView(['BADCARD', 'LEFTOVER', 'FILLER'], 'AVOIDME', 0),
        guessesAllowed: 0, // the unlimited sentinel both 0 and -1 map to
    });
    const owed = (): BotSeatMemory => ({
        clues: [{ word: 'OLDIE', number: 2, taken: 0, bounced: false }],
    });

    it('never guesses the anti-match; works the owed leftover instead', () => {
        const s = skill();
        expect(makeGreedyClicker(s, backend).chooseGuess(antiView(), ctx(s, owed()))).toEqual({
            kind: 'reveal',
            index: 1,
        });
    });

    it('with nothing owed it banks rather than blind-guessing', () => {
        const s = skill();
        expect(makeGreedyClicker(s, backend).chooseGuess(antiView(), ctx(s))).toEqual({ kind: 'endTurn' });
    });

    it('a debt card that also matches the anti-word stays off-limits', () => {
        const overlap: SemanticMap = {
            version: 2,
            words: ['BOTH', 'FILLER'],
            concepts: {
                AVOIDME: [{ word: 'BOTH', weight: 0.9 }],
                OLDIE: [{ word: 'BOTH', weight: 0.8 }],
            },
        };
        const b = makeCustomMapBackend([overlap], lexicalBackend);
        const v: BotClickerView = {
            ...clickerView(['BOTH', 'FILLER'], 'AVOIDME', 0),
            guessesAllowed: 0,
        };
        const s = skill();
        expect(makeGreedyClicker(s, b).chooseGuess(v, ctx(s, owed()))).toEqual({ kind: 'endTurn' });
    });

    it('the advisor stays silent on an anti-clue (no anti-advice)', () => {
        const v = antiView();
        expect(suggestGuesses(v, backend, 3)).toEqual([]);
    });

    it('an unlimited (U/-1) clue guesses matches positively with no count cap', () => {
        const uView: BotClickerView = {
            ...clickerView(['BADCARD', 'LEFTOVER', 'FILLER'], 'AVOIDME', -1),
            guessesAllowed: 0,
        };
        const s = skill();
        // U is a positive clue: argmax match (BADCARD here) is the right pick.
        expect(makeGreedyClicker(s, backend).chooseGuess(uView, ctx(s))).toEqual({ kind: 'reveal', index: 0 });
    });
});
