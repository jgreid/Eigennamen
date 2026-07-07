/**
 * Clue diagnostics harness: the pure yardstick (boardGroupsFor / referenceLead),
 * the aggregation + gap detection, and an end-to-end analyzeGames run.
 */
import {
    boardGroupsFor,
    referenceLead,
    boardBestLead,
    aggregate,
    detectGaps,
    analyzeGames,
    analysisSeeds,
    personaEntrants,
    ENDGAME_OWN_MAX,
    type ClueRecord,
    type ClueDiagnostics,
} from '../../bots/harness/analyze';
import type { GameState, Team } from '../../types';
import type { SemanticBackend } from '../../bots/semantics/backend';
import type { Entrant } from '../../bots/harness/types';
import { playEngineGame } from '../../bots/harness/playGame';

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

    it('reports the halo heat and flags a lethal spillover within the danger berth', () => {
        // Brightest non-own is the OPPONENT (0.75 > assassin 0.1, no neutral) AND
        // it sits only 0.05 behind the weakest led own card (0.8) — within
        // DANGER_BERTH, so a misread loses material. Magnitude-aware dangerNext
        // flags it; a comfortably-cleared danger card would not be (see
        // harness.test.ts).
        const backend = stub({ LINK: { OWNA: 0.9, OWNB: 0.8, OPPO: 0.75, ASSN: 0.1 } });
        const ref = referenceLead('LINK', boardGroupsFor(g, 'red'), backend);
        expect(ref.heat).toBeCloseTo(0.75);
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
        revealedCount: 0,
        safeLead: 1,
        boardBestLead: 2,
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

    it('slices dangerNext into the endgame (≤ ENDGAME_OWN_MAX own left)', () => {
        const [d] = aggregate([
            // Early clues: dangerous but NOT in the endgame slice.
            rec({ ownAvailable: 9, dangerNext: true }),
            rec({ ownAvailable: 7, dangerNext: true }),
            // Endgame clues: one clean, one dangerous.
            rec({ ownAvailable: ENDGAME_OWN_MAX, dangerNext: false }),
            rec({ ownAvailable: 1, dangerNext: true }),
        ]);
        const diag = d as ClueDiagnostics;
        expect(diag.endgameClues).toBe(2);
        expect(diag.dangerNextRateEndgame).toBeCloseTo(0.5);
        expect(diag.dangerNextRate).toBeCloseTo(0.75);
    });

    it('reports 0 endgame danger when no clue was given in the endgame', () => {
        const [d] = aggregate([rec({ ownAvailable: 9 }), rec({ ownAvailable: 5 })]);
        const diag = d as ClueDiagnostics;
        expect(diag.endgameClues).toBe(0);
        expect(diag.dangerNextRateEndgame).toBe(0);
    });

    it('flags endgame danger only past the minimum sample size', () => {
        const dangerous = (n: number): ClueRecord[] =>
            Array.from({ length: n }, () => rec({ ownAvailable: 2, dangerNext: true }));
        // 4 endgame clues, all dangerous — below the sample gate, no flag.
        const few = detectGaps(aggregate(dangerous(4))[0] as ClueDiagnostics);
        expect(few.join(' ')).not.toMatch(/endgame danger/);
        // 5 endgame clues, all dangerous — flagged.
        const enough = detectGaps(aggregate(dangerous(5))[0] as ClueDiagnostics);
        expect(enough.join(' ')).toMatch(/endgame danger/);
    });

    it('pins the endgame-danger rate threshold on both sides (sample gate cleared)', () => {
        const mix = (hot: number, clean: number): ClueRecord[] => [
            ...Array.from({ length: hot }, () => rec({ ownAvailable: 2, dangerNext: true })),
            ...Array.from({ length: clean }, () => rec({ ownAvailable: 2, dangerNext: false })),
        ];
        // 2/6 ≈ 0.33 < 0.35 — clears the sample gate but stays under the rate bar.
        expect(detectGaps(aggregate(mix(2, 4))[0] as ClueDiagnostics).join(' ')).not.toMatch(/endgame danger/);
        // 3/6 = 0.50 > 0.35 — flagged.
        expect(detectGaps(aggregate(mix(3, 3))[0] as ClueDiagnostics).join(' ')).toMatch(/endgame danger/);
    });

    it('pins the selection-gap threshold: healthy utilization on hot boards passes', () => {
        // Hot boards (ceiling 3) with numbers of 2: utilization ≈ 0.67 ≥ 0.55.
        const healthy = aggregate(Array.from({ length: 10 }, () => rec({ number: 2, boardBestLead: 3 })));
        expect((healthy[0] as ClueDiagnostics).gaps.join(' ')).not.toMatch(/selection gap/);
        // Same boards with numbers of 1: utilization ≈ 0.33 < 0.55 — flagged.
        const timid = aggregate(Array.from({ length: 10 }, () => rec({ number: 1, boardBestLead: 3 })));
        expect((timid[0] as ClueDiagnostics).gaps.join(' ')).toMatch(/selection gap/);
    });

    it('computes the board-ceiling utilization and flags a selection gap', () => {
        // Boards offered 3-card lines; the entrant asked for 1s. 10/30 ≈ 0.33.
        const timid = Array.from({ length: 10 }, () => rec({ number: 1, boardBestLead: 3 }));
        const [d] = aggregate(timid);
        const diag = d as ClueDiagnostics;
        expect(diag.avgBoardBestLead).toBeCloseTo(3);
        expect(diag.ceilingUtilization).toBeCloseTo(1 / 3);
        expect(diag.gaps.join(' ')).toMatch(/selection gap/);
    });

    it('does not report a selection gap on cold boards or without a yardstick', () => {
        // Cold boards: ceiling ~1 and numbers ~1 — full utilization.
        const cold = aggregate(Array.from({ length: 10 }, () => rec({ number: 1, boardBestLead: 1 })));
        expect((cold[0] as ClueDiagnostics).gaps.join(' ')).not.toMatch(/selection gap/);
        // No yardstick (backend with no candidate pool): boardBestLead 0 throughout.
        const none = aggregate(Array.from({ length: 10 }, () => rec({ number: 1, boardBestLead: 0 })));
        const diag = none[0] as ClueDiagnostics;
        expect(diag.ceilingUtilization).toBe(0);
        expect(diag.gaps.join(' ')).not.toMatch(/selection gap/);
    });
});

describe('boardBestLead', () => {
    const g = game(['OWNA', 'OWNB', 'OPPO', 'ASSN'], ['red', 'red', 'blue', 'assassin']);

    it('returns the best safeLead any candidate reaches', () => {
        const backend = stub({
            WEAK: { OWNA: 0.4, OWNB: 0.1, OPPO: 0.1, ASSN: 0.0 },
            STRONG: { OWNA: 0.9, OWNB: 0.8, OPPO: 0.1, ASSN: 0.0 },
        });
        expect(boardBestLead(boardGroupsFor(g, 'red'), backend)).toBe(2);
    });

    it('excludes candidates that are illegal for the board (board words)', () => {
        // OWNA itself relates perfectly to both own cards but IS a board word,
        // so the ceiling must come from the legal candidate only.
        const backend = stub({
            OWNA: { OWNA: 1, OWNB: 1, OPPO: 0.0, ASSN: 0.0 },
            SINGLE: { OWNA: 0.9, OWNB: 0.0, OPPO: 0.0, ASSN: 0.0 },
        });
        expect(boardBestLead(boardGroupsFor(g, 'red'), backend)).toBe(1);
    });

    it('returns 0 when the backend offers no candidate pool', () => {
        const bare = { id: 'bare', relatedness: () => 0.5 };
        expect(boardBestLead(boardGroupsFor(g, 'red'), bare)).toBe(0);
    });

    it('judges legality against the FULL board: a revealed cluster-mate is still illegal', () => {
        // NAIL was an own card, already found. It relates perfectly to the two
        // remaining own cards — but a real spymaster may never clue a board
        // word, revealed or not (the server checks the full 25). Admitting it
        // would inflate the ceiling on every post-reveal record.
        const gr = game(['NAIL', 'HAMMER', 'SCREW', 'OPPO', 'ASSN'], ['red', 'red', 'red', 'blue', 'assassin'], {
            revealed: [true, false, false, false, false],
        });
        const backend = stub({
            NAIL: { HAMMER: 1, SCREW: 1, OPPO: 0.0, ASSN: 0.0 },
            TOOL: { HAMMER: 0.9, SCREW: 0.0, OPPO: 0.0, ASSN: 0.0 },
        });
        const groups = boardGroupsFor(gr, 'red');
        // With the full word list, NAIL is excluded and TOOL's 1-lead is the true ceiling.
        expect(boardBestLead(groups, backend, gr.words as string[])).toBe(1);
        // The unrevealed-only fallback (no game at hand) would wrongly admit NAIL.
        expect(boardBestLead(groups, backend)).toBe(2);
    });

    it('excludes candidates the spymaster’s board-safety filter would reject (G3)', () => {
        // REVOLUCION is legal (a non-substring of REVOLUTION) but an orthographic
        // near-duplicate the real generator drops via makeBoardSafetyCheck — a
        // guesser reads it straight back to the board word. The ceiling must come
        // from the clean candidate, not the cognate the player can never give.
        const gg = game(['REVOLUTION', 'UPRISING', 'OPPO', 'ASSN'], ['red', 'red', 'blue', 'assassin']);
        const backend = stub({
            REVOLUCION: { REVOLUTION: 0.9, UPRISING: 0.8, OPPO: 0.1, ASSN: 0.0 }, // safeLead 2, but a cognate
            REBELLION: { REVOLUTION: 0.9, UPRISING: 0.1, OPPO: 0.2, ASSN: 0.0 }, // safeLead 1, clean
        });
        // Without the board-safety filter this would report the cognate's 2.
        expect(boardBestLead(boardGroupsFor(gg, 'red'), backend)).toBe(1);
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

    it('derives the board seed from the board index only, never the pairing', () => {
        const a = analysisSeeds('base', 0, 1, 3);
        const b = analysisSeeds('base', 2, 5, 3);
        expect(a.boardSeed).toBe(b.boardSeed); // same game index ⇒ same board
        expect(a.seed).not.toBe(b.seed); // decisions still vary by pairing
        // Consecutive game indices share a board: the color swap alternates on
        // g % 2, so each pair plays every board once per color — board identity
        // must never couple to roster position.
        expect(analysisSeeds('base', 0, 1, 2).boardSeed).toBe(a.boardSeed);
        expect(analysisSeeds('base', 0, 1, 2).seed).not.toBe(a.seed);
        expect(analysisSeeds('base', 0, 1, 4).boardSeed).not.toBe(a.boardSeed);
    });

    it('boardSeed pins the board words independently of the decision seed', () => {
        const [a, b] = personaEntrants();
        const boardWords = (seed: string, boardSeed: string): string[] => {
            let words: string[] = [];
            playEngineGame({
                seed,
                boardSeed,
                gameMode: 'classic',
                red: a as Entrant,
                blue: b as Entrant,
                onEvent: (_ev, game) => {
                    if (words.length === 0) words = [...(game.words as string[])];
                },
            });
            return words;
        };
        const w1 = boardWords('decisions-1', 'board-X');
        const w2 = boardWords('decisions-2', 'board-X');
        const w3 = boardWords('decisions-1', 'board-Y');
        expect(w1).toEqual(w2); // same boardSeed ⇒ same board, decisions differ
        expect(w1).not.toEqual(w3); // different boardSeed ⇒ different board
    });

    it('gives every entrant pairing the same board at the same game index', () => {
        const [a, b, c] = personaEntrants();
        const run = (pair: [Entrant, Entrant]): ClueRecord =>
            analyzeGames({
                entrants: pair,
                gameMode: 'classic',
                gamesPerPair: 1,
                baseSeed: 'shared-board',
            }).records[0] as ClueRecord;
        // The FIRST clue of game 0 is given on the untouched board, so its
        // board-derived fields must match across different pairings.
        const r1 = run([a as Entrant, b as Entrant]);
        const r2 = run([a as Entrant, c as Entrant]);
        expect(r1.boardBestLead).toBe(r2.boardBestLead);
        expect(r1.ownAvailable).toBe(r2.ownAvailable);
    });
});
