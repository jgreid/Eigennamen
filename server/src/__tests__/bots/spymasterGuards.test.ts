/**
 * Phase-1 spymaster safety guards (docs/BOT_NUANCE_PLAN.md):
 *  - PROMISE_FLOOR: the clue number never promises an absolutely-weak tail card
 *    (ledger lesson 18 — the number is a promise, and excess promise is spent
 *    fishing in the clue's residual halo).
 *  - Give-time assassin re-gate: passesAssassinGate is a replayable invariant
 *    on the selected clue (ledger failure E).
 *  - Endgame berth widening: the hard assassin floor ramps up one-way as own
 *    cards dwindle (ledger lessons 11/18).
 */
import { makeEmbeddingSpymaster, passesAssassinGate } from '../../bots/strategies/spymasters';
import { makeRng } from '../../bots/rng';
import type { SemanticBackend } from '../../bots/semantics/backend';
import type { BotSpymasterView, BotContext, SkillParams } from '../../bots/strategies/types';

function view(
    words: string[],
    types: ('red' | 'blue' | 'neutral' | 'assassin')[],
    revealed?: boolean[]
): BotSpymasterView {
    return {
        role: 'spymaster',
        team: 'red',
        gameMode: 'classic',
        words,
        revealed: revealed ?? words.map(() => false),
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

describe('PROMISE_FLOOR trims absolutely-weak tail promises', () => {
    it('drops a margin-clearing but weak third card from the number', () => {
        // OWNC (0.2) clears the safety margin over a stone-cold non-own field,
        // so the pre-floor lead is 3 — but 0.2 is below the promise floor: a
        // number of 3 would send the clicker fishing in the residual halo.
        const board = view(
            ['OWNA', 'OWNB', 'OWNC', 'OPPO', 'OPPOX', 'NEUT'],
            ['red', 'red', 'red', 'blue', 'blue', 'neutral']
        );
        const backend = stub({ LINK: { OWNA: 0.9, OWNB: 0.8, OWNC: 0.2, OPPO: 0.02, NEUT: 0.02 } });
        const skill = base({});
        const action = makeEmbeddingSpymaster(skill, backend).chooseClue(board, ctx(skill));
        expect(action).toMatchObject({ kind: 'clue', word: 'LINK', number: 2 });
    });

    it('keeps strong tails: three genuinely bright cards still clue as 3', () => {
        const board = view(
            ['OWNA', 'OWNB', 'OWNC', 'OPPO', 'OPPOX', 'NEUT'],
            ['red', 'red', 'red', 'blue', 'blue', 'neutral']
        );
        const backend = stub({ LINK: { OWNA: 0.9, OWNB: 0.8, OWNC: 0.7, OPPO: 0.02, NEUT: 0.02 } });
        const skill = base({});
        const action = makeEmbeddingSpymaster(skill, backend).chooseClue(board, ctx(skill));
        expect(action).toMatchObject({ kind: 'clue', word: 'LINK', number: 3 });
    });

    it('a trimmed full-board lead loses win status and re-enters the normal cap', () => {
        // Six own cards all clear the margin (a full-board lead, which would
        // normally ride the win-clue exemption past MAX_CLUE_NUMBER), but the
        // tail card is below the promise floor: the trim to 5 revokes coversAll,
        // so the number re-enters the normal cap of 4 instead of promising 5.
        const board = view(
            ['OWNA', 'OWNB', 'OWNC', 'OWND', 'OWNE', 'OWNF', 'OPPO', 'OPPOX', 'NEUT'],
            ['red', 'red', 'red', 'red', 'red', 'red', 'blue', 'blue', 'neutral']
        );
        const backend = stub({
            LINK: { OWNA: 0.9, OWNB: 0.85, OWNC: 0.8, OWND: 0.75, OWNE: 0.7, OWNF: 0.2, OPPO: 0.02, NEUT: 0.02 },
        });
        const skill = base({});
        const action = makeEmbeddingSpymaster(skill, backend).chooseClue(board, ctx(skill));
        expect(action).toMatchObject({ kind: 'clue', word: 'LINK', number: 4 });
    });

    it('never trims below 1: a cold-board single stays a playable clue', () => {
        // The only viable link is faint (0.2) but it clears the margin on a cold
        // board — a single is always promiseable (the guess is the argmax), so
        // this must stay a real clue with number 1, not a best-effort fallback.
        const board = view(['OWNA', 'OPPO', 'OPPOX', 'NEUT'], ['red', 'blue', 'blue', 'neutral']);
        const backend = stub({ FAINT: { OWNA: 0.2, OPPO: 0.02, NEUT: 0.02 } });
        const skill = base({});
        const action = makeEmbeddingSpymaster(skill, backend).chooseClue(board, ctx(skill));
        expect(action).toMatchObject({ kind: 'clue', word: 'FAINT', number: 1 });
    });
});

describe('PROMISE_FLOOR scales to the backend relatedness range', () => {
    // A dense vector backend's cosine scale is compressed: a genuinely-related own
    // pair sits ~0.22 and the strongest own card only ~0.33. A flat 0.3 floor would
    // trim ~84% of safe multi-card clues on such a backend purely on scale, not on
    // gettability (Numberbatch red-team, Step 4). The floor is therefore scaled to
    // the board's own strongest pull, clamped so it can only ever RELAX (never
    // exceed 0.3) and never drop below the noise guard. The relaxation is keyed on
    // the backend exposing nearest() (a dense generative model); a stub therefore
    // carries an (empty) nearest() so the candidate pool falls back to vocabulary()
    // while the backend still reads as dense.
    const dense = (rel: Record<string, Record<string, number>>): SemanticBackend => ({
        ...stub(rel),
        nearest: () => [],
    });
    it('promises a safe second card that sits below the flat floor but above the scaled floor', () => {
        // Compressed board: best own 0.34, second 0.23 — the second clears the cold
        // field by the safety margin AND clears the scaled floor (0.34 * 0.6 ≈ 0.20),
        // so it is a real second card. Under a flat 0.3 floor it would be trimmed to 1.
        const board = view(['OWNA', 'OWNB', 'OPPO', 'OPPOX', 'NEUT'], ['red', 'red', 'blue', 'blue', 'neutral']);
        const backend = dense({ LINK: { OWNA: 0.34, OWNB: 0.23, OPPO: 0.02, NEUT: 0.02 } });
        const skill = base({});
        const action = makeEmbeddingSpymaster(skill, backend).chooseClue(board, ctx(skill));
        expect(action).toMatchObject({ kind: 'clue', word: 'LINK', number: 2 });
    });

    it('still trims a tail below the scaled floor (the floor relaxes, it does not vanish)', () => {
        // Same compressed best card (0.34 → scaled floor ≈ 0.20), but the second
        // card (0.16) clears the field margin yet sits below the scaled floor: it is
        // a noise-level tail the clicker would not chase, so the number trims to 1.
        const board = view(['OWNA', 'OWNB', 'OPPO', 'OPPOX', 'NEUT'], ['red', 'red', 'blue', 'blue', 'neutral']);
        const backend = dense({ LINK: { OWNA: 0.34, OWNB: 0.16, OPPO: 0.02, NEUT: 0.02 } });
        const skill = base({});
        const action = makeEmbeddingSpymaster(skill, backend).chooseClue(board, ctx(skill));
        expect(action).toMatchObject({ kind: 'clue', word: 'LINK', number: 1 });
    });

    it('leaves the non-dense (curated table) floor at 0.3: a 0.25 tail is still trimmed', () => {
        // The same compressed-looking board on a backend WITHOUT nearest() (the
        // curated table / maps / lexical) keeps the absolute 0.3 floor: a 0.25 second
        // card is trimmed to 1 exactly as before, so the discrete-weight backends are
        // untouched by the compressed-scale relaxation.
        const board = view(['OWNA', 'OWNB', 'OPPO', 'OPPOX', 'NEUT'], ['red', 'red', 'blue', 'blue', 'neutral']);
        const backend = stub({ LINK: { OWNA: 0.34, OWNB: 0.25, OPPO: 0.02, NEUT: 0.02 } });
        const skill = base({});
        const action = makeEmbeddingSpymaster(skill, backend).chooseClue(board, ctx(skill));
        expect(action).toMatchObject({ kind: 'clue', word: 'LINK', number: 1 });
    });
});

describe('lexical-floor own pull is damped in target selection (ledger 2.29, spymaster half)', () => {
    it('never promises a card whose only pull is the lexical bigram floor', () => {
        // TRAP's 0.5 pull toward LINK carries no semantic provenance (hasSignal
        // false — a spelling coincidence like justICE→ICE CREAM, whose raw Dice
        // beats genuine relatedness on a compressed vector scale). The own pull
        // is a prediction of the guesser, and the guesser damps exactly this —
        // so the clue must promise only the genuinely-known OWNA. Before the
        // fix, TRAP's raw 0.5 cleared both the margin and the promise floor and
        // the spymaster emitted a 2 the clicker could never deliver.
        // Two opponent cards, so the desperation exemption (opponent at match
        // point keeps its full number) stays out of the way — as in the
        // PROMISE_FLOOR tests above.
        const board = view(['OWNA', 'TRAP', 'OPPO', 'OPPOX', 'NEUT'], ['red', 'red', 'blue', 'blue', 'neutral']);
        const rel: Record<string, Record<string, number>> = {
            LINK: { OWNA: 0.9, TRAP: 0.5, OPPO: 0.02, OPPOX: 0.02, NEUT: 0.02 },
        };
        const backend: SemanticBackend = {
            id: 'stub-signal',
            relatedness: (a: string, b: string) => rel[a]?.[b.toUpperCase()] ?? rel[b]?.[a.toUpperCase()] ?? 0,
            vocabulary: () => ['LINK'],
            hasSignal: (a: string, b: string) => {
                const pair = [a.toUpperCase(), b.toUpperCase()].sort().join('|');
                return pair !== 'LINK|TRAP'; // this one pull is lexical-floor only
            },
        };
        const skill = base({});
        const action = makeEmbeddingSpymaster(skill, backend).chooseClue(board, ctx(skill));
        expect(action).toMatchObject({ kind: 'clue', word: 'LINK', number: 1 });
    });
});

describe('guesser-competence margin (the team clicker sizes coverage)', () => {
    // Own OWNA(0.6) and OWNB(0.35) over a cold field whose brightest non-own is a
    // neutral at 0.25 — OWNB clears the field by 0.10. The full (human/unknown-
    // guesser) safety margin (~0.11 for this skill) rejects OWNB, so the clue can
    // only promise 1; a known argmax bot guesser (temperature 0) halves the margin
    // to ~0.055, OWNB now clears it, and the same clue safely promises 2. No
    // assassin on the board, so only the field margin is in play.
    // Two opponents so the board is NOT desperate (one opponent left shrinks the
    // margin for a last-stand and would mask the guesser-competence effect).
    const board = view(['OWNA', 'OWNB', 'OPPO', 'OPP2', 'NEUT'], ['red', 'red', 'blue', 'blue', 'neutral']);
    const backend = stub({ LINK: { OWNA: 0.6, OWNB: 0.35, OPPO: 0.1, OPP2: 0.1, NEUT: 0.25 } });
    const skill = base({});
    const withGuesser = (t: number | undefined): BotContext => ({
        gameMode: 'classic',
        skill,
        rng: makeRng(1),
        guesserTemperature: t,
    });

    it('keeps the full margin for an unknown/human guesser (promises 1)', () => {
        const action = makeEmbeddingSpymaster(skill, backend).chooseClue(board, withGuesser(undefined));
        expect(action).toMatchObject({ kind: 'clue', word: 'LINK', number: 1 });
    });

    it('narrows the margin for a known argmax bot guesser (promises 2)', () => {
        const action = makeEmbeddingSpymaster(skill, backend).chooseClue(board, withGuesser(0));
        expect(action).toMatchObject({ kind: 'clue', word: 'LINK', number: 2 });
    });

    it('keeps the full margin for a noisy bot guesser (promises 1)', () => {
        // temperature 0.6 is past GUESSER_TEMP_REF, so the margin stays full width.
        const action = makeEmbeddingSpymaster(skill, backend).chooseClue(board, withGuesser(0.6));
        expect(action).toMatchObject({ kind: 'clue', word: 'LINK', number: 1 });
    });
});

describe('passesAssassinGate (give-time re-gate invariant)', () => {
    it('passes when the weakest promised card clears the assassin by the berth', () => {
        expect(passesAssassinGate({ weakestIntended: 0.5, maxAss: 0.3, berth: 0.2 })).toBe(true);
        expect(passesAssassinGate({ weakestIntended: 0.5, maxAss: 0.35, berth: 0.2 })).toBe(false);
    });

    it('is trivially true with no assassin left (berth and maxAss both 0)', () => {
        expect(passesAssassinGate({ weakestIntended: 0.05, maxAss: 0, berth: 0 })).toBe(true);
    });
});

describe('endgame berth widening (one-way assassin discipline)', () => {
    // The soft berth is zeroed (riskAversion 0, assassinCaution 0) so the HARD
    // floor is the only wall. LINK clears the assassin by 0.14–0.15 — above the
    // fresh-board floor (0.1), below the widened late-game floor — while SAFE
    // stays far from the assassin and remains valid in both phases. Early, LINK
    // wins on coverage; late, the ramp disqualifies LINK and SAFE takes over.
    const words = ['OWNA', 'OWNB', 'OWNC', 'OWND', 'OWNE', 'OPPO', 'OPPOX', 'ASSN'];
    const types: ('red' | 'blue' | 'neutral' | 'assassin')[] = [
        'red',
        'red',
        'red',
        'red',
        'red',
        'blue',
        'blue',
        'assassin',
    ];
    const backend = stub({
        LINK: { OWNA: 0.45, OWNB: 0.44, ASSN: 0.3, OPPO: 0.02 },
        SAFE: { OWNB: 0.4, ASSN: 0.0, OPPO: 0.02 },
    });
    const skill = base({ riskAversion: 0, assassinCaution: 0, commonnessBias: 0 });

    it('accepts the tighter clue on a fresh board (floor at its base value)', () => {
        const action = makeEmbeddingSpymaster(skill, backend).chooseClue(view(words, types), ctx(skill));
        expect(action).toMatchObject({ kind: 'clue', word: 'LINK', number: 2 });
    });

    it('rejects the same assassin margin late and switches to the safe clue', () => {
        // OWNC/OWND/OWNE found ⇒ 3 of 5 cleared ⇒ floor = 0.1 × 1.6 = 0.16.
        // Both of LINK's still-live cards (OWNA 0.15, OWNB 0.14 over the
        // assassin) fail the widened floor — LINK, otherwise the winning
        // 2-clue at the fresh-board floor, is eliminated and SAFE (0.4 clear
        // of the assassin) takes over.
        const revealed = [false, false, true, true, true, false, false, false];
        const action = makeEmbeddingSpymaster(skill, backend).chooseClue(view(words, types, revealed), ctx(skill));
        expect(action).toMatchObject({ kind: 'clue', word: 'SAFE', number: 1 });
    });

    it('retries at the base floor before degrading to the berth-free fallback', () => {
        // Late game, and the ONLY candidate fails the ramped floor while still
        // clearing the classic one: the spymaster must re-admit it at the base
        // floor rather than cascade into pickBestEffort, which applies no berth
        // at all. Discriminator: the real clue's margin logic yields number 1
        // (SOLO's second card misses the safety margin), while the best-effort
        // fallback's board-derived number would be 2 (both own cards out-rank
        // the assassin) — so the number tells us which path emitted the clue.
        const soloWords = ['OWNA', 'OWNB', 'OWNC', 'OWND', 'OWNE', 'OPPO', 'OPPOX', 'ASSN'];
        const soloTypes: ('red' | 'blue' | 'neutral' | 'assassin')[] = [
            'red',
            'red',
            'red',
            'red',
            'red',
            'blue',
            'blue',
            'assassin',
        ];
        const soloBackend = stub({ SOLO: { OWNA: 0.45, OWNB: 0.34, ASSN: 0.3, OPPO: 0.02 } });
        // OWNC/OWND/OWNE found ⇒ floor 0.16; SOLO's best gap is 0.15.
        const revealed = [false, false, true, true, true, false, false, false];
        const action = makeEmbeddingSpymaster(skill, soloBackend).chooseClue(
            view(soloWords, soloTypes, revealed),
            ctx(skill)
        );
        expect(action).toMatchObject({ kind: 'clue', word: 'SOLO', number: 1 });
    });
});

describe('no-repeat clue rule (burned frames)', () => {
    // Two viable clues; LINK strictly outranks PAIR, so temperature-0 selection
    // takes LINK unless the no-repeat rule burns it.
    const words = ['OWNA', 'OWNB', 'OPPO', 'OPPOX', 'NEUT'];
    const types: ('red' | 'blue' | 'neutral' | 'assassin')[] = ['red', 'red', 'blue', 'blue', 'neutral'];
    const backend = stub({
        LINK: { OWNA: 0.9, OWNB: 0.8, OPPO: 0.02, NEUT: 0.02 },
        PAIR: { OWNA: 0.7, OWNB: 0.6, OPPO: 0.02, NEUT: 0.02 },
    });
    const skill = base({});
    const withMemory = (taken: number, bounced: boolean): BotContext => ({
        ...ctx(skill),
        memory: { clues: [{ word: 'LINK', number: 2, taken, bounced }] },
    });

    it('prefers the best clue when no frame burned it', () => {
        const action = makeEmbeddingSpymaster(skill, backend).chooseClue(view(words, types), ctx(skill));
        expect(action).toMatchObject({ kind: 'clue', word: 'LINK' });
    });

    it('never repeats a clue whose frame BOUNCED (a guess under it missed)', () => {
        const action = makeEmbeddingSpymaster(skill, backend).chooseClue(view(words, types), withMemory(0, true));
        expect(action).toMatchObject({ kind: 'clue', word: 'PAIR' });
    });

    it('never repeats a clue whose frame UNDERSHOT (promised more than it delivered)', () => {
        const action = makeEmbeddingSpymaster(skill, backend).chooseClue(view(words, types), withMemory(1, false));
        expect(action).toMatchObject({ kind: 'clue', word: 'PAIR' });
    });

    it('may repeat a clue whose frame FULLY delivered (the "more of the same" tactic)', () => {
        const action = makeEmbeddingSpymaster(skill, backend).chooseClue(view(words, types), withMemory(2, false));
        expect(action).toMatchObject({ kind: 'clue', word: 'LINK' });
    });

    it('a burned candidate pool falls through to a FRESH builtin, not the repeat', () => {
        // The backend knows only LINK, and LINK's frame failed: the spymaster
        // must reach into the abstract builtin vocabulary rather than re-give
        // the word the guesser already failed to read.
        const only = stub({ LINK: { OWNA: 0.9, OWNB: 0.8, OPPO: 0.02, NEUT: 0.02 } });
        const action = makeEmbeddingSpymaster(skill, only).chooseClue(view(words, types), withMemory(0, true));
        expect(action.kind).toBe('clue');
        if (action.kind === 'clue') expect(action.word).not.toBe('LINK');
    });
});

describe('redundancy discount (prefer cluing words no frame has indicated)', () => {
    // Four own cards. RECLUE re-covers the two cards the owed OLD frame already
    // points at, and outranks FRESH on raw relatedness — so temperature-0
    // selection takes RECLUE unless the redundancy discount steers to FRESH.
    const words = ['OWNA', 'OWNB', 'OWNC', 'OWND', 'OPPO', 'NEUT'];
    const types: ('red' | 'blue' | 'neutral' | 'assassin')[] = ['red', 'red', 'red', 'red', 'blue', 'neutral'];
    const backend = stub({
        OLD: { OWNA: 0.8, OWNB: 0.7, OPPO: 0.02, NEUT: 0.02 },
        RECLUE: { OWNA: 0.9, OWNB: 0.8, OPPO: 0.02, NEUT: 0.02 },
        FRESH: { OWNC: 0.8, OWND: 0.7, OPPO: 0.02, NEUT: 0.02 },
    });
    const skill = base({});
    const withFrame = (taken: number, bounced: boolean): BotContext => ({
        ...ctx(skill),
        memory: { clues: [{ word: 'OLD', number: 2, taken, bounced }] },
    });

    it('without memory, the raw-strongest clue wins', () => {
        const action = makeEmbeddingSpymaster(skill, backend).chooseClue(view(words, types), ctx(skill));
        expect(action).toMatchObject({ kind: 'clue', word: 'RECLUE' });
    });

    it('an OWED frame steers the next clue to fresh targets', () => {
        // OLD 2 promised OWNA/OWNB and delivered neither (banked turn): those
        // cards are already in the guesser's head, so the turn is better spent
        // on OWNC/OWND even though RECLUE scores higher raw.
        const action = makeEmbeddingSpymaster(skill, backend).chooseClue(view(words, types), withFrame(0, false));
        expect(action).toMatchObject({ kind: 'clue', word: 'FRESH' });
    });

    it('a BOUNCED frame is void — its targets need fresh cluing, no discount', () => {
        // A guess under OLD hit a non-own card: the frame burned, its promises
        // transfer nothing (same rule as the clicker's debt boost), so
        // re-covering OWNA/OWNB with a NEW word is the right play again.
        const action = makeEmbeddingSpymaster(skill, backend).chooseClue(view(words, types), withFrame(0, true));
        expect(action).toMatchObject({ kind: 'clue', word: 'RECLUE' });
    });

    it('a DELIVERED frame leaves nothing owed — no discount', () => {
        const action = makeEmbeddingSpymaster(skill, backend).chooseClue(view(words, types), withFrame(2, false));
        expect(action).toMatchObject({ kind: 'clue', word: 'RECLUE' });
    });

    it('a decisively better covered-only clue can still win (the "very good reason")', () => {
        // FRESH is barely viable here (weak margins); RECLUE covers three owed
        // cards cleanly. The discount is a preference, not a ban — the clearly
        // superior play survives it.
        const wideBackend = stub({
            OLD: { OWNA: 0.8, OWNB: 0.75, OWNC: 0.7, OPPO: 0.02, NEUT: 0.02 },
            RECLUE: { OWNA: 0.9, OWNB: 0.85, OWNC: 0.8, OPPO: 0.02, NEUT: 0.02 },
            FRESH: { OWND: 0.25, OPPO: 0.15, NEUT: 0.1 },
        });
        const action = makeEmbeddingSpymaster(skill, wideBackend).chooseClue(view(words, types), {
            ...ctx(skill),
            memory: { clues: [{ word: 'OLD', number: 3, taken: 0, bounced: false }] },
        });
        expect(action).toMatchObject({ kind: 'clue', word: 'RECLUE' });
    });
});
