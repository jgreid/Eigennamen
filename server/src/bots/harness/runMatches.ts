/**
 * Headless self-play tournament runner.
 *
 * `runTournament` is a pure function (round-robin over entrants, deterministic
 * by seed) used by tests. The CLI (`npm run bots:train`) runs a default or
 * config-file tournament and writes an append-only NDJSON corpus + a
 * leaderboard.json under src/bots/results/.
 *
 * Note: single-process today. Because each game is independent and pure, this
 * is trivially shardable across worker_threads — left as a follow-up so the
 * deterministic core stays simple and testable.
 */
import type { GameMode } from '../../types';
import type { Entrant, MatchResult, EntrantStats, TournamentSpec } from './types';

import { playEngineGame } from './playGame';
import { computeLeaderboard } from './scoring';

export interface TournamentOutput {
    results: MatchResult[];
    leaderboard: EntrantStats[];
}

/** Round-robin: every unordered pair plays `gamesPerPair` games, alternating colors. */
export function runTournament(spec: TournamentSpec): TournamentOutput {
    const { entrants, gameMode, gamesPerPair, baseSeed, words } = spec;
    const results: MatchResult[] = [];

    for (let i = 0; i < entrants.length; i++) {
        for (let j = i + 1; j < entrants.length; j++) {
            for (let g = 0; g < gamesPerPair; g++) {
                const swap = g % 2 === 1; // alternate who plays red for fairness
                const red = (swap ? entrants[j] : entrants[i]) as Entrant;
                const blue = (swap ? entrants[i] : entrants[j]) as Entrant;
                const seed = `${baseSeed}:${i}-${j}:${g}`;
                results.push(playEngineGame({ seed, gameMode, red, blue, words }));
            }
        }
    }

    return { results, leaderboard: computeLeaderboard(entrants, results) };
}

/** A small default roster (spymasters are non-semantic in Phase 1/2, so clicker
 *  strategy is what differs; Phase 3 semantic spymasters add the rest). */
export const DEFAULT_ENTRANTS: Entrant[] = [
    {
        id: 'random',
        spymaster: { strategyId: 'randomSpymaster', skillPreset: 'intermediate' },
        clicker: { strategyId: 'randomClicker', skillPreset: 'intermediate' },
    },
    {
        id: 'cautious',
        spymaster: { strategyId: 'randomSpymaster', skillPreset: 'intermediate' },
        clicker: { strategyId: 'cautiousClicker', skillPreset: 'expert' },
    },
    {
        id: 'greedy',
        spymaster: { strategyId: 'randomSpymaster', skillPreset: 'intermediate' },
        clicker: { strategyId: 'greedyClicker', skillPreset: 'expert' },
    },
    {
        // Full semantic pipeline: table-backed spymaster + table-backed clicker.
        id: 'semantic',
        spymaster: { strategyId: 'embeddingSpymaster', skillPreset: 'expert' },
        clicker: { strategyId: 'greedyClicker', skillPreset: 'expert' },
    },
];

/* istanbul ignore next -- CLI entry, exercised manually via `npm run bots:train` */
async function main(): Promise<void> {
    const fs = await import('fs');
    const path = await import('path');

    const argv = process.argv.slice(2);
    const arg = (flag: string, def: string): string => {
        const i = argv.indexOf(flag);
        return i >= 0 && argv[i + 1] ? (argv[i + 1] as string) : def;
    };

    let spec: TournamentSpec;
    const configPath = arg('--config', '');
    if (configPath) {
        spec = JSON.parse(fs.readFileSync(configPath, 'utf8')) as TournamentSpec;
    } else {
        spec = {
            entrants: DEFAULT_ENTRANTS,
            gameMode: arg('--mode', 'classic') as GameMode,
            gamesPerPair: parseInt(arg('--games', '100'), 10),
            baseSeed: arg('--seed', 'train'),
        };
    }

    const { results, leaderboard } = runTournament(spec);

    const outDir = path.resolve(__dirname, '..', 'results');
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const ndjsonPath = path.join(outDir, `run-${stamp}.ndjson`);
    fs.writeFileSync(ndjsonPath, results.map((r) => JSON.stringify(r)).join('\n') + '\n');
    fs.writeFileSync(path.join(outDir, 'leaderboard.json'), JSON.stringify(leaderboard, null, 2));

    // eslint-disable-next-line no-console
    console.log(`\n${spec.gameMode} — ${results.length} games (${spec.entrants.length} entrants)\n`);
    // eslint-disable-next-line no-console
    console.table(
        leaderboard.map((s) => ({
            entrant: s.id,
            elo: s.elo,
            winRate: `${(s.winRate * 100).toFixed(1)}%`,
            ci: `${(s.winRateLow * 100).toFixed(0)}-${(s.winRateHigh * 100).toFixed(0)}%`,
            games: s.games,
            avgMargin: s.avgMargin.toFixed(2),
        }))
    );
    // eslint-disable-next-line no-console
    console.log(`\nCorpus: ${ndjsonPath}`);
}

/* istanbul ignore next */
if (require.main === module) {
    main().catch((err) => {
        // eslint-disable-next-line no-console
        console.error(err);
        process.exit(1);
    });
}
