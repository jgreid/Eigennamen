/**
 * Types for the headless self-play harness.
 */
import type { Team, GameMode } from '../../types';

/** A bot seat config: which strategy + skill plays this role. */
export interface SeatSpec {
    strategyId: string;
    skillPreset: string;
}

/** A tournament entrant = a full team (spymaster + clicker). */
export interface Entrant {
    id: string;
    spymaster: SeatSpec;
    clicker: SeatSpec;
}

/** One game's outcome — the unit appended to the NDJSON corpus. */
export interface MatchResult {
    seed: string;
    gameMode: GameMode;
    redEntrant: string;
    blueEntrant: string;
    winner: Team | null;
    redScore: number;
    blueScore: number;
    redTotal: number;
    blueTotal: number;
    turns: number;
    clues: number;
    reveals: number;
    assassinHit: boolean;
    endReason: string | null;
    // Duet (cooperative) fields, when applicable.
    greenFound?: number;
    greenTotal?: number;
    timerTokens?: number;
}

/** A tournament definition. */
export interface TournamentSpec {
    entrants: Entrant[];
    gameMode: GameMode;
    /** Games per UNORDERED entrant pair; colors alternate (g % 2) for fairness,
     *  so this is the total games each pair plays, not a per-direction count. */
    gamesPerPair: number;
    baseSeed: string;
    /** Optional custom word pool (defaults to the standard set). */
    words?: string[];
}

/** Aggregate per-entrant stats produced by scoring. */
export interface EntrantStats {
    id: string;
    games: number;
    wins: number;
    losses: number;
    draws: number;
    winRate: number;
    /** Wilson 95% lower/upper bounds on win rate. */
    winRateLow: number;
    winRateHigh: number;
    elo: number;
    /** Mean card score margin (redScore-blueScore from this entrant's perspective). */
    avgMargin: number;
    assassinHits: number;
}
