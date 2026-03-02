// Re-export shared constants so existing `import { BOARD_SIZE } from '@config'` still works
export {
    BOARD_SIZE,
    FIRST_TEAM_CARDS,
    SECOND_TEAM_CARDS,
    NEUTRAL_CARDS,
    ASSASSIN_CARDS,
    GAME_MODES,
    TEAMS,
    ROLES,
    MATCH_TARGET,
    MATCH_WIN_MARGIN,
    ROUND_WIN_BONUS,
    STANDARD_SCORE_CARDS,
    CARD_SCORE_DISTRIBUTION,
    BOARD_VALUE_MIN,
    BOARD_VALUE_MAX,
    ASSASSIN_SCORE_POOL,
    DEFAULT_WORDS,
} from '../shared';
export type { GameMode } from '../shared';

// Game mode configurations
export const GAME_MODE_CONFIG = {
    classic: {
        label: 'Vintage',
        description: 'Classic wordgame',
        cooperative: false,
    },
    duet: {
        label: 'Duet',
        description: '2 player co-op',
        cooperative: true,
    },
    match: {
        label: 'Eigennamen',
        description: 'Multi-round scoring',
        cooperative: false,
    },
} as const;

// Duet mode board configuration
// Each side sees 9 green + 3 assassin + 13 bystander
// Overlaps: 3 green/green, 1 assassin/assassin
// Total unique greens: 15
export const DUET_BOARD_CONFIG = {
    greenOverlap: 3, // Cards green from both perspectives
    greenOnlyA: 6, // Green for A, bystander for B
    greenOnlyB: 6, // Bystander for A, green for B
    assassinOverlap: 1, // Assassin from both perspectives
    assassinOnlyA: 2, // Assassin for A, bystander for B
    assassinOnlyB: 2, // Bystander for A, assassin for B
    bystanderBoth: 5, // Bystander from both perspectives
    timerTokens: 9, // Starting timer tokens
    greenTotal: 15, // Unique greens to find for win
} as const;

// Card types (game-specific, not shared)
export const CARD_TYPES = ['red', 'blue', 'neutral', 'assassin'] as const;

// Room statuses
export const ROOM_STATUS = {
    WAITING: 'waiting',
    PLAYING: 'playing',
    FINISHED: 'finished',
} as const;

// Game service internal constants
export const GAME_INTERNALS = {
    FIRST_TEAM_SEED_OFFSET: 1000, // Seed offset for first team shuffle
    TYPES_SHUFFLE_SEED_OFFSET: 500, // Seed offset for card types shuffle
    CARD_SCORES_SEED_OFFSET: 2000, // Seed offset for card score generation
    LAZY_HISTORY_MULTIPLIER: 1.5, // Multiplier for lazy history threshold
} as const;

// Game history configuration
export const GAME_HISTORY = {
    MAX_ENTRIES: 200, // Maximum history entries per game
} as const;
