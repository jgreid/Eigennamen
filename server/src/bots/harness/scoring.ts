/**
 * Scoring for self-play results: per-entrant win rate (with a Wilson 95%
 * interval), Elo, and average margin. Pure and deterministic.
 *
 * In competitive modes (classic/match) the winner is the winning team mapped to
 * its entrant. In duet (cooperative) a 'red' winner means the greens were
 * completed — a co-op success counted for BOTH entrants — and null is a loss;
 * Elo is left unchanged in duet since games are not head-to-head.
 */
import type { Entrant, MatchResult, EntrantStats } from './types';

const ELO_K = 32;
const ELO_START = 1500;
const Z = 1.96;

/** Wilson score interval bounds for `wins` successes out of `n` trials. */
export function wilsonInterval(wins: number, n: number, z: number = Z): { low: number; high: number } {
    if (n === 0) return { low: 0, high: 0 };
    const p = wins / n;
    const z2 = z * z;
    const denom = 1 + z2 / n;
    const centre = p + z2 / (2 * n);
    const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
    return { low: Math.max(0, (centre - margin) / denom), high: Math.min(1, (centre + margin) / denom) };
}

function expectedScore(a: number, b: number): number {
    return 1 / (1 + Math.pow(10, (b - a) / 400));
}

interface Acc {
    games: number;
    wins: number;
    losses: number;
    draws: number;
    marginSum: number;
    assassinHits: number;
    elo: number;
}

export function computeLeaderboard(entrants: Entrant[], results: MatchResult[]): EntrantStats[] {
    const acc = new Map<string, Acc>();
    for (const e of entrants) {
        acc.set(e.id, { games: 0, wins: 0, losses: 0, draws: 0, marginSum: 0, assassinHits: 0, elo: ELO_START });
    }
    const get = (id: string): Acc => {
        let a = acc.get(id);
        if (!a) {
            a = { games: 0, wins: 0, losses: 0, draws: 0, marginSum: 0, assassinHits: 0, elo: ELO_START };
            acc.set(id, a);
        }
        return a;
    };

    for (const r of results) {
        const red = get(r.redEntrant);
        const blue = get(r.blueEntrant);
        red.games++;
        blue.games++;
        red.marginSum += r.redScore - r.blueScore;
        blue.marginSum += r.blueScore - r.redScore;
        if (r.assassinHit) {
            red.assassinHits++;
            blue.assassinHits++;
        }

        const isDuet = r.gameMode === 'duet';
        // Per-entrant scores: 1 win, 0 loss, 0.5 draw (for Elo + tallies).
        let redScore: number;
        if (isDuet) {
            // Cooperative: completion is a shared win.
            const win = r.winner === 'red' ? 1 : 0;
            redScore = win;
            if (win) {
                red.wins++;
                blue.wins++;
            } else {
                red.losses++;
                blue.losses++;
            }
        } else {
            if (r.winner === 'red') {
                redScore = 1;
                red.wins++;
                blue.losses++;
            } else if (r.winner === 'blue') {
                redScore = 0;
                red.losses++;
                blue.wins++;
            } else {
                redScore = 0.5;
                red.draws++;
                blue.draws++;
            }
            // Elo update (head-to-head only).
            const expRed = expectedScore(red.elo, blue.elo);
            red.elo += ELO_K * (redScore - expRed);
            blue.elo += ELO_K * (1 - redScore - (1 - expRed));
        }
    }

    return [...acc.entries()]
        .map(([id, a]): EntrantStats => {
            const winRate = a.games > 0 ? a.wins / a.games : 0;
            const w = wilsonInterval(a.wins, a.games);
            return {
                id,
                games: a.games,
                wins: a.wins,
                losses: a.losses,
                draws: a.draws,
                winRate,
                winRateLow: w.low,
                winRateHigh: w.high,
                elo: Math.round(a.elo),
                avgMargin: a.games > 0 ? a.marginSum / a.games : 0,
                assassinHits: a.assassinHits,
            };
        })
        .sort((x, y) => y.elo - x.elo || y.winRate - x.winRate);
}
