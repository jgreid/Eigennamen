/**
 * Tests for the headless harness: per-game runner, scoring, and the tournament.
 */
import type { Entrant, MatchResult } from '../../bots/harness/types';
import { playEngineGame } from '../../bots/harness/playGame';
import { wilsonInterval, computeLeaderboard } from '../../bots/harness/scoring';
import { runTournament, DEFAULT_ENTRANTS } from '../../bots/harness/runMatches';

const ENTRANT_A: Entrant = {
    id: 'A',
    spymaster: { strategyId: 'randomSpymaster', skillPreset: 'intermediate' },
    clicker: { strategyId: 'greedyClicker', skillPreset: 'expert' },
};
const ENTRANT_B: Entrant = {
    id: 'B',
    spymaster: { strategyId: 'randomSpymaster', skillPreset: 'intermediate' },
    clicker: { strategyId: 'randomClicker', skillPreset: 'novice' },
};

describe('playEngineGame', () => {
    it('plays a complete classic game and reports a result', () => {
        const r = playEngineGame({ seed: 'g1', gameMode: 'classic', red: ENTRANT_A, blue: ENTRANT_B });
        expect(['red', 'blue', null]).toContain(r.winner);
        expect(r.reveals).toBeGreaterThan(0);
        expect(r.redEntrant).toBe('A');
        expect(r.blueEntrant).toBe('B');
    });

    it('is deterministic for the same seed + entrants', () => {
        const a = playEngineGame({ seed: 'same', gameMode: 'classic', red: ENTRANT_A, blue: ENTRANT_B });
        const b = playEngineGame({ seed: 'same', gameMode: 'classic', red: ENTRANT_A, blue: ENTRANT_B });
        expect(a).toEqual(b);
    });

    it('runs in duet and match modes', () => {
        const duet = playEngineGame({ seed: 'd', gameMode: 'duet', red: ENTRANT_A, blue: ENTRANT_B });
        expect(duet.greenTotal).toBe(15);
        const match = playEngineGame({ seed: 'm', gameMode: 'match', red: ENTRANT_A, blue: ENTRANT_B });
        expect(match.reveals).toBeGreaterThan(0);
    });
});

describe('wilsonInterval', () => {
    it('returns [0,0] for no games', () => {
        expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 0 });
    });
    it('bounds stay within [0,1] and bracket the point estimate', () => {
        const { low, high } = wilsonInterval(7, 10);
        expect(low).toBeGreaterThanOrEqual(0);
        expect(high).toBeLessThanOrEqual(1);
        expect(low).toBeLessThan(0.7);
        expect(high).toBeGreaterThan(0.7);
    });
});

describe('computeLeaderboard', () => {
    it('ranks a dominant entrant above a weak one', () => {
        const entrants: Entrant[] = [ENTRANT_A, ENTRANT_B];
        // A always beats B
        const results: MatchResult[] = Array.from({ length: 20 }, (_, i) => ({
            seed: `s${i}`,
            gameMode: 'classic',
            redEntrant: 'A',
            blueEntrant: 'B',
            winner: 'red',
            redScore: 9,
            blueScore: 3,
            redTotal: 9,
            blueTotal: 8,
            turns: 4,
            clues: 4,
            reveals: 12,
            assassinHit: false,
            endReason: 'completed',
        }));
        const board = computeLeaderboard(entrants, results);
        expect(board[0]!.id).toBe('A');
        expect(board[0]!.winRate).toBe(1);
        expect(board[0]!.elo).toBeGreaterThan(board[1]!.elo);
        expect(board[1]!.id).toBe('B');
    });

    it('counts a duet completion as a shared win', () => {
        const entrants: Entrant[] = [ENTRANT_A, ENTRANT_B];
        const results: MatchResult[] = [
            {
                seed: 's',
                gameMode: 'duet',
                redEntrant: 'A',
                blueEntrant: 'B',
                winner: 'red',
                redScore: 8,
                blueScore: 7,
                redTotal: 9,
                blueTotal: 9,
                turns: 5,
                clues: 5,
                reveals: 15,
                assassinHit: false,
                endReason: 'completed',
            },
        ];
        const board = computeLeaderboard(entrants, results);
        expect(board.every((s) => s.wins === 1)).toBe(true);
    });

    it('attributes a competitive assassin loss only to the team that revealed it (G4)', () => {
        const entrants: Entrant[] = [ENTRANT_A, ENTRANT_B];
        const results: MatchResult[] = [
            {
                seed: 's',
                gameMode: 'classic',
                redEntrant: 'A',
                blueEntrant: 'B',
                winner: 'blue',
                redScore: 3,
                blueScore: 5,
                redTotal: 9,
                blueTotal: 8,
                turns: 4,
                clues: 4,
                reveals: 10,
                assassinHit: true,
                assassinBy: 'red', // red revealed the assassin
                endReason: 'assassin',
            },
        ];
        const board = computeLeaderboard(entrants, results);
        const a = board.find((s) => s.id === 'A');
        const b = board.find((s) => s.id === 'B');
        expect(a!.assassinHits).toBe(1);
        expect(b!.assassinHits).toBe(0);
    });

    it('shares assassin attribution for duet, and for legacy results with no assassinBy', () => {
        const entrants: Entrant[] = [ENTRANT_A, ENTRANT_B];
        const results: MatchResult[] = [
            {
                seed: 's1',
                gameMode: 'duet',
                redEntrant: 'A',
                blueEntrant: 'B',
                winner: null,
                redScore: 4,
                blueScore: 4,
                redTotal: 9,
                blueTotal: 9,
                turns: 4,
                clues: 4,
                reveals: 9,
                assassinHit: true,
                assassinBy: 'red',
                endReason: 'assassin',
            },
            {
                // legacy classic result: no assassinBy → shared fallback
                seed: 's2',
                gameMode: 'classic',
                redEntrant: 'A',
                blueEntrant: 'B',
                winner: 'blue',
                redScore: 2,
                blueScore: 6,
                redTotal: 9,
                blueTotal: 8,
                turns: 4,
                clues: 4,
                reveals: 9,
                assassinHit: true,
                endReason: 'assassin',
            },
        ];
        const board = computeLeaderboard(entrants, results);
        // duet shared (both +1) + legacy shared (both +1) = 2 each
        expect(board.find((s) => s.id === 'A')!.assassinHits).toBe(2);
        expect(board.find((s) => s.id === 'B')!.assassinHits).toBe(2);
    });
});

describe('runTournament', () => {
    it('plays every pair and produces a full leaderboard', () => {
        const spec = { entrants: DEFAULT_ENTRANTS, gameMode: 'classic' as const, gamesPerPair: 4, baseSeed: 't' };
        const { results, leaderboard } = runTournament(spec);
        const n = DEFAULT_ENTRANTS.length;
        const pairs = (n * (n - 1)) / 2;
        expect(results).toHaveLength(pairs * spec.gamesPerPair);
        expect(leaderboard).toHaveLength(n);
        expect(leaderboard.reduce((s, e) => s + e.games, 0)).toBe(results.length * 2);
    });

    it('is deterministic for the same spec', () => {
        const spec = { entrants: DEFAULT_ENTRANTS, gameMode: 'classic' as const, gamesPerPair: 3, baseSeed: 'det' };
        expect(runTournament(spec).results).toEqual(runTournament(spec).results);
    });
});
