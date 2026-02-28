// Re-export shared constants so existing `import { BOARD_SIZE } from '@config'` still works
export {
    BOARD_SIZE, FIRST_TEAM_CARDS, SECOND_TEAM_CARDS, NEUTRAL_CARDS, ASSASSIN_CARDS,
    GAME_MODES, TEAMS, ROLES,
    MATCH_TARGET, MATCH_WIN_MARGIN, ROUND_WIN_BONUS,
    STANDARD_SCORE_CARDS, CARD_SCORE_DISTRIBUTION,
    BOARD_VALUE_MIN, BOARD_VALUE_MAX, ASSASSIN_SCORE_POOL
} from '../shared';
export type { GameMode } from '../shared';

// Game mode configurations
export const GAME_MODE_CONFIG = {
    classic: {
        label: 'Classic',
        description: 'Standard Eigennamen rules',
        forcedTurnTimer: null,   // Timer is optional, set by host
        minTurnTimer: 30,
        maxTurnTimer: 300,
        cooperative: false
    },
    blitz: {
        label: 'Blitz',
        description: 'Fast-paced 30-second turns',
        forcedTurnTimer: 30,     // Always 30 seconds, cannot be changed
        minTurnTimer: 30,
        maxTurnTimer: 30,
        cooperative: false
    },
    duet: {
        label: 'Duet',
        description: 'Cooperative 2-player mode',
        forcedTurnTimer: null,
        minTurnTimer: 30,
        maxTurnTimer: 300,
        cooperative: true
    },
    match: {
        label: 'Eigennamen',
        description: 'Multi-round match with card scoring',
        forcedTurnTimer: null,
        minTurnTimer: 30,
        maxTurnTimer: 300,
        cooperative: false
    }
} as const;

// Duet mode board configuration
// Each side sees 9 green + 3 assassin + 13 bystander
// Overlaps: 3 green/green, 1 assassin/assassin
// Total unique greens: 15
export const DUET_BOARD_CONFIG = {
    greenOverlap: 3,       // Cards green from both perspectives
    greenOnlyA: 6,         // Green for A, bystander for B
    greenOnlyB: 6,         // Bystander for A, green for B
    assassinOverlap: 1,    // Assassin from both perspectives
    assassinOnlyA: 2,      // Assassin for A, bystander for B
    assassinOnlyB: 2,      // Bystander for A, assassin for B
    bystanderBoth: 5,      // Bystander from both perspectives
    timerTokens: 9,        // Starting timer tokens
    greenTotal: 15         // Unique greens to find for win
} as const;

// Card types (game-specific, not shared)
export const CARD_TYPES = ['red', 'blue', 'neutral', 'assassin'] as const;

// Room statuses
export const ROOM_STATUS = {
    WAITING: 'waiting',
    PLAYING: 'playing',
    FINISHED: 'finished'
} as const;

// Game service internal constants
export const GAME_INTERNALS = {
    FIRST_TEAM_SEED_OFFSET: 1000,      // Seed offset for first team shuffle
    TYPES_SHUFFLE_SEED_OFFSET: 500,    // Seed offset for card types shuffle
    CARD_SCORES_SEED_OFFSET: 2000,     // Seed offset for card score generation
    LAZY_HISTORY_MULTIPLIER: 1.5       // Multiplier for lazy history threshold
} as const;

// Game history configuration
export const GAME_HISTORY = {
    MAX_ENTRIES: 200   // Maximum history entries per game
} as const;

// Default word list (same as client)
export const DEFAULT_WORDS = [
    'AFRICA', 'AGENT', 'AIR', 'ALIEN', 'ALPS', 'AMAZON', 'AMBULANCE', 'AMERICA',
    'ANGEL', 'ANTARCTICA', 'APPLE', 'ARM', 'ATLANTIS', 'AUSTRALIA', 'AZTEC',
    'BACK', 'BALL', 'BAND', 'BANK', 'BAR', 'BARK', 'BAT', 'BATTERY', 'BEACH',
    'BEAR', 'BEAT', 'BED', 'BEIJING', 'BELL', 'BELT', 'BERLIN', 'BERMUDA',
    'BERRY', 'BILL', 'BLOCK', 'BOARD', 'BOLT', 'BOMB', 'BOND', 'BOOM', 'BOOT',
    'BOTTLE', 'BOW', 'BOX', 'BRIDGE', 'BRUSH', 'BUCK', 'BUFFALO', 'BUG',
    'BUGLE', 'BUTTON', 'CALF', 'CANADA', 'CAP', 'CAPITAL', 'CAR', 'CARD',
    'CARROT', 'CASINO', 'CAST', 'CAT', 'CELL', 'CENTAUR', 'CENTER', 'CHAIR',
    'CHANGE', 'CHARGE', 'CHECK', 'CHEST', 'CHICK', 'CHINA', 'CHOCOLATE',
    'CHURCH', 'CIRCLE', 'CLIFF', 'CLOAK', 'CLUB', 'CODE', 'COLD', 'COMIC',
    'COMPOUND', 'CONCERT', 'CONDUCTOR', 'CONTRACT', 'COOK', 'COPPER', 'COTTON',
    'COURT', 'COVER', 'CRANE', 'CRASH', 'CRICKET', 'CROSS', 'CROWN', 'CYCLE',
    'CZECH', 'DANCE', 'DATE', 'DAY', 'DEATH', 'DECK', 'DEGREE', 'DIAMOND',
    'DICE', 'DINOSAUR', 'DISEASE', 'DOCTOR', 'DOG', 'DRAFT', 'DRAGON', 'DRESS',
    'DRILL', 'DROP', 'DUCK', 'DWARF', 'EAGLE', 'EGYPT', 'EMBASSY', 'ENGINE',
    'ENGLAND', 'EUROPE', 'EYE', 'FACE', 'FAIR', 'FALL', 'FAN', 'FENCE', 'FIELD',
    'FIGHTER', 'FIGURE', 'FILE', 'FILM', 'FIRE', 'FISH', 'FLUTE', 'FLY',
    'FOOT', 'FORCE', 'FOREST', 'FORK', 'FRANCE', 'GAME', 'GAS', 'GENIUS',
    'GERMANY', 'GHOST', 'GIANT', 'GLASS', 'GLOVE', 'GOLD', 'GRACE', 'GRASS',
    'GREECE', 'GREEN', 'GROUND', 'HAM', 'HAND', 'HAWK', 'HEAD', 'HEART',
    'HELICOPTER', 'HIMALAYAS', 'HOLE', 'HOLLYWOOD', 'HONEY', 'HOOD', 'HOOK',
    'HORN', 'HORSE', 'HOSPITAL', 'HOTEL', 'ICE', 'ICE CREAM', 'INDIA', 'IRON',
    'IVORY', 'JACK', 'JAM', 'JET', 'JUPITER', 'KANGAROO', 'KETCHUP', 'KEY',
    'KID', 'KING', 'KIWI', 'KNIFE', 'KNIGHT', 'LAB', 'LAP', 'LASER', 'LAWYER',
    'LEAD', 'LEMON', 'LEPRECHAUN', 'LIFE', 'LIGHT', 'LIMOUSINE', 'LINE', 'LINK',
    'LION', 'LITTER', 'LOCH NESS', 'LOCK', 'LOG', 'LONDON', 'LUCK', 'MAIL',
    'MAMMOTH', 'MAPLE', 'MARBLE', 'MARCH', 'MASS', 'MATCH', 'MERCURY', 'MEXICO',
    'MICROSCOPE', 'MILLIONAIRE', 'MINE', 'MINT', 'MISSILE', 'MODEL', 'MOLE',
    'MOON', 'MOSCOW', 'MOUNT', 'MOUSE', 'MOUTH', 'MUG', 'NAIL', 'NEEDLE',
    'NET', 'NEW YORK', 'NIGHT', 'NINJA', 'NOTE', 'NOVEL', 'NURSE', 'NUT',
    'OCTOPUS', 'OIL', 'OLIVE', 'OLYMPUS', 'OPERA', 'ORANGE', 'ORGAN', 'PALM',
    'PAN', 'PANDA', 'PAPER', 'PARACHUTE', 'PARK', 'PART', 'PASS', 'PASTE',
    'PENGUIN', 'PHOENIX', 'PIANO', 'PIE', 'PILOT', 'PIN', 'PIPE', 'PIRATE',
    'PISTOL', 'PIT', 'PITCH', 'PLANE', 'PLASTIC', 'PLATE', 'PLATYPUS',
    'PLAY', 'PLOT', 'POINT', 'POISON', 'POLE', 'POLICE', 'POOL', 'PORT',
    'POST', 'POUND', 'PRESS', 'PRINCESS', 'PUMPKIN', 'PUPIL', 'PYRAMID',
    'QUEEN', 'RABBIT', 'RACKET', 'RAY', 'REVOLUTION', 'RING', 'ROBIN', 'ROBOT',
    'ROCK', 'ROME', 'ROOT', 'ROSE', 'ROULETTE', 'ROUND', 'ROW', 'RULER',
    'SATELLITE', 'SATURN', 'SCALE', 'SCHOOL', 'SCIENTIST', 'SCORPION', 'SCREEN',
    'SCUBA DIVER', 'SEAL', 'SERVER', 'SHADOW', 'SHAKESPEARE', 'SHARK', 'SHIP',
    'SHOE', 'SHOP', 'SHOT', 'SHOULDER', 'SILK', 'SINK', 'SKYSCRAPER', 'SLIP',
    'SLUG', 'SMUGGLER', 'SNOW', 'SNOWMAN', 'SOCK', 'SOLDIER', 'SOUL', 'SOUND',
    'SPACE', 'SPELL', 'SPIDER', 'SPIKE', 'SPINE', 'SPOT', 'SPRING', 'SPY',
    'SQUARE', 'STADIUM', 'STAFF', 'STAR', 'STATE', 'STICK', 'STOCK', 'STRAW',
    'STREAM', 'STRIKE', 'STRING', 'SUB', 'SUIT', 'SUPERHERO', 'SWING', 'SWITCH',
    'TABLE', 'TABLET', 'TAG', 'TAIL', 'TAP', 'TEACHER', 'TELESCOPE', 'TEMPLE',
    'THIEF', 'THUMB', 'TICK', 'TIE', 'TIME', 'TOKYO', 'TOOTH', 'TORCH', 'TOWER',
    'TRACK', 'TRAIN', 'TRIANGLE', 'TRIP', 'TRUNK', 'TUBE', 'TURKEY', 'UNDERTAKER',
    'UNICORN', 'VACUUM', 'VAN', 'VET', 'VOLCANO', 'WALL', 'WAR', 'WASHER',
    'WASHINGTON', 'WATCH', 'WATER', 'WAVE', 'WEB', 'WELL', 'WHALE', 'WHIP',
    'WIND', 'WITCH', 'WORM', 'YARD'
] as const;
