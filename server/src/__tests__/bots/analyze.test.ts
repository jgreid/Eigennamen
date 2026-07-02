/**
 * Clue diagnostics harness: the pure yardstick (boardGroupsFor / referenceLead),
 * the aggregation + gap detection, and an end-to-end analyzeGames run.
 */
import {
    boardGroupsFor,
    referenceLead,
    aggregate,
    detectGaps,
    analyzeGames,
    personaEntrants,
    type ClueRecord,
    type ClueDiagnostics,
} from '../../bots/harness/analyze';
import type { GameState, Team } from '../../types';
import type { SemanticBackend } from '../../bots/semantics/backend';

function game(words: string[], types: string[], over: Partial<GameState> = {}): GameState {
    return {
        words,
        types,
        revealed: words.map(() => false),
        gameMode: 'classic',
        ...over,
    } as unknown as GameState;
}

const stub = (rel: Record<string, Record<string, number>>): SemanticBackend => ({
    id: 'stub',
    relatedness: (a: string, b: string) => rel[a]?.[b.toUpperCase()] ?? rel[b]?.[a.toUpperCase()] ?? 0,
    vocabulary: () => Object.keys(rel),
});

describe('boardGroupsFor', () => {
    it('splits the board from the red team’s perspective', () => {
        const g = game(['A', 'B', 'C', 'D', 'E'], ['red', 'blue', 'neutral', 'assassin', 'red']);
        const groups = boardGroupsFor(g, 'red');
        expect(groups.own.sort()).toEqual(['A', 'E']);
        expect(groups.opp).toEqual(['B']);
        expect(groups.neutral).toEqual(['C']);
        expect(groups.assassin).toEqual(['D']);
    });

    it('skips revealed cards', () => {
        const g = game(['A', 'B'], ['red', 'red'], { revealed: [true, false] });
        expect(boardGroupsFor(g, 'red').own).toEqual(['B']);
    });

    it('reads the blue side’s own key in Duet and treats bystanders as neutral', () => {
        // Duet: red key = types, blue key = duetTypes. Blue's greens are 'blue'.
        const g = game(['A', 'B', 'C'], ['red', 'neutral', 'assassin'], {
            gameMode: 'duet',
            duetTypes: ['blue', 'neutral', 'neutral'],
        });
        const groups = boardGroupsFor(g, 'blue');
        expect(groups.own).toEqual(['A']); // blue green
        expect(groups.opp).toEqual([]); // no opponent cards in duet
        expect(groups.neutral.sort()).toEqual(['B', 'C']);
    });
});

describe('referenceLead', () => {
    const g = game(['OWNA', 'OWNB', 'OPPO', 'ASSN'], ['red', 'red', 'blue', 'assassin']);

    it('counts own cards that clear the field by the reference margin', () => {
        const backend = stub({ LINK: { OWNA: 0.9, OWNB: 0.8, OPPO: 0.3, ASSN: 0.1 } });
        const ref = referenceLead('LINK', boardGroupsFor(g, 'red'), backend);
        expect(ref.safeLead).toBe(2);
        expect(ref.clarity).toBeGreaterThan(0);
        expect(ref.assassinArgmax).toBe(false);
    });

    it('flags a board where the assassin is the most related card', () => {
        const backend = stub({ DANGER: { OWNA: 0.2, OWNB: 0.1, OPPO: 0.1, ASSN: 0.9 } });
        const ref = referenceLead('DANGER', boardGroupsFor(g, 'red'), backend);
        expect(ref.safeLead).toBe(0); // nothing leads safely
        expect(ref.assassinArgmax).toBe(true);
    });

    it('reports the halo heat and whether the brightest spillover is lethal', () => {
        // Best non-own is the OPPONENT card (0.3 > assassin 0.1, no neutral on
        // this board) — the clue's misfire loses material, not just a guess.
        const backend = stub({ LINK: { OWNA: 0.9, OWNB: 0.8, OPPO: 0.3, ASSN: 0.1 } });
        const ref = referenceLead('LINK', boardGroupsFor(g, 'red'), backend);
        expect(ref.heat).toBeCloseTo(0.3);
        expect(ref.dangerNext).toBe(true);
    });

    it('does not mark dangerNext when a harmless neutral is the brightest spillover', () => {
        const gn = game(['OWNA', 'NEUT', 'OPPO', 'ASSN'], ['red', 'neutral', 'blue', 'assassin']);
        const backend = stub({ SOFT: { OWNA: 0.9, NEUT: 0.5, OPPO: 0.1, ASSN: 0.05 } });
        const ref = referenceLead('SOFT', boardGroupsFor(gn, 'red'), backend);
        expect(ref.heat).toBeCloseTo(0.5);
        expect(ref.dangerNext).toBe(false);
    });

    it('skips the assassin berth when no assassin remains unrevealed', () => {
        // A safe low-signal card (0.08) clears the reference margin over a cold
        // board; with no assassin left the berth must not demand 0.1 absolute.
        const gn = game(['OWNW', 'OPPW'], ['red', 'blue']);
        const backend = stub({ FAINT: { OWNW: 0.08, OPPW: 0.02 } });
        const ref = referenceLead('FAINT', boardGroupsFor(gn, 'red'), backend);
        expect(ref.safeLead).toBe(1);
    });
});

describe('aggregate + detectGaps', () => {
    const rec = (over: Partial<ClueRecord>): ClueRecord => ({
        entrantId: 'x',
        team: 'red' as Team,
        word: 'W',
        number: 1,
        ownAvailable: 5,
        safeLead: 1,
        clarity: 0.3,
        assassinArgmax: false,
        dangerNext: false,
        heat: 0.2,
        commonness: 1,
        fallback: false,
        ownGained: 1,
        oppGiven: 0,
        neutralHit: 0,
        assassinHit: false,
        reveals: 1,
        endReason: 'exhausted',
        ...over,
    });

    it('computes per-entrant rates and buckets clue numbers', () => {
        const [d] = aggregate([
            rec({ number: 1, ownGained: 1 }),
            rec({ number: 3, ownGained: 3 }),
            rec({ number: 4, ownGained: 2 }),
        ]);
        const diag = d as ClueDiagnostics;
        expect(diag.clues).toBe(3);
        expect(diag.avgNumber).toBeCloseTo(8 / 3);
        expect(diag.numberHistogram).toEqual({ '1': 1, '2': 0, '3': 1, '4+': 1 });
        expect(diag.deliveryRate).toBeCloseTo(6 / 8);
    });

    it('flags a leaky, assassin-prone, weak-coverage entrant', () => {
        const records = Array.from({ length: 10 }, (_, i) =>
            rec({
                oppGiven: 1,
                assassinHit: i < 1, // 10% assassin
                fallback: true, // 100% fallback
                endReason: 'wrongGuess',
            })
        );
        const gaps = detectGaps(aggregate(records)[0] as ClueDiagnostics);
        expect(gaps.join(' ')).toMatch(/leaky/);
        expect(gaps.join(' ')).toMatch(/assassin exposure/);
        expect(gaps.join(' ')).toMatch(/weak coverage/);
    });

    it('does not flag under-cluing when the board’s safe ceiling is itself low', () => {
        // avg number ~1 but ambition ~1 (safeLead also ~1): clueing AT the ceiling.
        const records = Array.from({ length: 10 }, () => rec({ number: 1, safeLead: 1, ownGained: 1 }));
        const gaps = detectGaps(aggregate(records)[0] as ClueDiagnostics);
        expect(gaps.join(' ')).not.toMatch(/under-cluing/);
    });

    it('computes dangerNextRate, robustness and overReachRate', () => {
        const [d] = aggregate([
            rec({ dangerNext: true, heat: 0.4, commonness: 0.8 }),
            rec({ dangerNext: false, heat: 0.2, commonness: 1, ownGained: 1, neutralHit: 1, endReason: 'wrongGuess' }),
        ]);
        const diag = d as ClueDiagnostics;
        expect(diag.dangerNextRate).toBeCloseTo(0.5);
        // Per-record robustness = (commonness + (1 - heat)) / 2: (0.7 + 0.9) / 2.
        expect(diag.robustness).toBeCloseTo(0.8);
        // Only the second record pressed past a banked core and missed.
        expect(diag.overReachRate).toBeCloseTo(0.5);
    });

    it('overreach requires a banked core: a first-guess miss is a misread, not a stretch', () => {
        const [d] = aggregate([
            rec({ ownGained: 0, oppGiven: 1, endReason: 'wrongGuess' }),
            rec({ ownGained: 1, assassinHit: true, endReason: 'assassin' }),
        ]);
        expect((d as ClueDiagnostics).overReachRate).toBeCloseTo(0.5);
    });

    it('overreach catches a press-on that hands the opponent their winning card (endReason gameWon)', () => {
        const [d] = aggregate([rec({ ownGained: 2, oppGiven: 1, reveals: 3, endReason: 'gameWon' })]);
        expect((d as ClueDiagnostics).overReachRate).toBeCloseTo(1);
    });

    it('flags dangerous halos, idiosyncratic clues and over-reach', () => {
        const records = Array.from({ length: 10 }, () =>
            rec({
                dangerNext: true, // 100% lethal spillover
                heat: 0.9, // hot halo …
                commonness: 0.1, // … on a rare clue word → low robustness
                ownGained: 1,
                oppGiven: 1, // pressed past the core and missed
                endReason: 'wrongGuess',
            })
        );
        const gaps = detectGaps(aggregate(records)[0] as ClueDiagnostics);
        expect(gaps.join(' ')).toMatch(/dangerous halos/);
        expect(gaps.join(' ')).toMatch(/idiosyncratic/);
        expect(gaps.join(' ')).toMatch(/over-reach/);
    });

    it('does not flag a robust, safe entrant on the new metrics', () => {
        const records = Array.from({ length: 10 }, () => rec({}));
        const gaps = detectGaps(aggregate(records)[0] as ClueDiagnostics);
        expect(gaps.join(' ')).not.toMatch(/dangerous halos|idiosyncratic|over-reach/);
    });
});

describe('analyzeGames end-to-end', () => {
    it('produces well-formed records and diagnostics for the persona roster', () => {
        const { records, diagnostics } = analyzeGames({
            entrants: personaEntrants().slice(0, 3),
            gameMode: 'classic',
            gamesPerPair: 3,
            baseSeed: 'test',
        });

        expect(records.length).toBeGreaterThan(0);
        for (const r of records) {
            expect(r.number).toBeGreaterThanOrEqual(1);
            expect(r.ownGained).toBeLessThanOrEqual(r.reveals);
            expect(r.reveals).toBeGreaterThanOrEqual(0);
            expect(r.ownGained + r.oppGiven + r.neutralHit + (r.assassinHit ? 1 : 0)).toBeLessThanOrEqual(r.reveals);
        }
        // Every entrant that gave a clue appears in the diagnostics.
        const withClues = new Set(records.map((r) => r.entrantId));
        for (const d of diagnostics) expect(withClues.has(d.entrantId)).toBe(true);
    });

    it('is deterministic for a fixed seed', () => {
        const spec = {
            entrants: personaEntrants().slice(0, 2),
            gameMode: 'classic' as const,
            gamesPerPair: 2,
            baseSeed: 'repro',
        };
        const a = analyzeGames(spec);
        const b = analyzeGames(spec);
        expect(a.records.length).toBe(b.records.length);
        expect(a.diagnostics).toEqual(b.diagnostics);
    });
});
