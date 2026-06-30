/**
 * Self-play benchmark guarding bot decision quality.
 *
 * The semantic pair (margin-aware embeddingSpymaster + greedyClicker) must
 * decisively beat the random baseline — not just on the built-in word list the
 * offline association table covers, but ALSO on a custom word list it does not
 * (pure lexical fallback, no embeddings). The second case is the one that bit
 * real games: before the margin-aware rewrite the "smart" bot was a coin-flip
 * vs random on uncovered words (~55%). runTournament is deterministic (seeded),
 * so these thresholds are stable, not flaky.
 */
import { runTournament } from '../../bots/harness/runMatches';
import type { Entrant, EntrantStats } from '../../bots/harness/types';

const SEMANTIC: Entrant = {
    id: 'semantic',
    spymaster: { strategyId: 'embeddingSpymaster', skillPreset: 'expert' },
    clicker: { strategyId: 'greedyClicker', skillPreset: 'expert' },
};
const RANDOM: Entrant = {
    id: 'random',
    spymaster: { strategyId: 'randomSpymaster', skillPreset: 'intermediate' },
    clicker: { strategyId: 'randomClicker', skillPreset: 'intermediate' },
};

// Obscure words deliberately NOT in the default board list, so the baked
// association table can't cover them and the backend degrades to lexical only.
const UNCOVERED_WORDS = [
    'GADGET',
    'NEBULA',
    'CRIMSON',
    'VELVET',
    'QUANTUM',
    'PARADOX',
    'LANTERN',
    'MARBLE',
    'THUNDER',
    'WHISPER',
    'COMPASS',
    'EMBER',
    'GLACIER',
    'ORCHID',
    'PYRAMID',
    'SADDLE',
    'TROPHY',
    'WALNUT',
    'ZEPHYR',
    'BISCUIT',
    'CANYON',
    'DOMINO',
    'FALCON',
    'HARBOR',
    'JIGSAW',
    'KETTLE',
    'MEADOW',
    'PEBBLE',
    'RIBBON',
    'SPROUT',
];

function semanticVsRandom(words?: string[]): { semantic: EntrantStats; random: EntrantStats } {
    const { leaderboard } = runTournament({
        entrants: [SEMANTIC, RANDOM],
        gameMode: 'classic',
        gamesPerPair: 40, // 40 deterministic games, alternating colors
        baseSeed: 'benchmark',
        ...(words ? { words } : {}),
    });
    const semantic = leaderboard.find((e) => e.id === 'semantic') as EntrantStats;
    const random = leaderboard.find((e) => e.id === 'random') as EntrantStats;
    return { semantic, random };
}

describe('bot self-play benchmark: semantic >> random', () => {
    it('wins decisively on the built-in (table-covered) word list', () => {
        const { semantic, random } = semanticVsRandom();
        expect(semantic.winRate).toBeGreaterThan(0.8);
        expect(semantic.winRate).toBeGreaterThan(random.winRate + 0.5);
        expect(semantic.avgMargin).toBeGreaterThan(1);
    });

    it('wins decisively on a custom, table-uncovered word list (lexical fallback)', () => {
        // This is the regression that mattered: the old spymaster was ~coin-flip here.
        const { semantic, random } = semanticVsRandom(UNCOVERED_WORDS);
        expect(semantic.winRate).toBeGreaterThan(0.8);
        expect(semantic.winRate).toBeGreaterThan(random.winRate + 0.5);
        expect(semantic.avgMargin).toBeGreaterThan(1);
    });
});
