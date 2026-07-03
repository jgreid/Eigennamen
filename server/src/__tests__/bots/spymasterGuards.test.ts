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
