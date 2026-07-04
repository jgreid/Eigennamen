/**
 * Shared Game Rule Constants
 *
 * Single source of truth for game rules used by both frontend and backend.
 * This module MUST remain environment-agnostic — no Node.js or browser APIs.
 */

// Board layout
export const BOARD_SIZE = 25;
export const FIRST_TEAM_CARDS = 9;
export const SECOND_TEAM_CARDS = 8;
export const NEUTRAL_CARDS = 7;
export const ASSASSIN_CARDS = 1;

// Timer bounds
export const TIMER_MIN_TURN_SECONDS = 20;
export const TIMER_MAX_TURN_SECONDS = 600;
export const TIMER_DEFAULT_TURN_SECONDS = 120;

// Game modes
export const GAME_MODES = ['classic', 'duet', 'match'] as const;
export type GameMode = (typeof GAME_MODES)[number];

// Teams and roles
export const TEAMS = ['red', 'blue'] as const;
export const ROLES = ['spymaster', 'clicker', 'advisor', 'observer', 'spectator'] as const;

// ---- Card Scoring (Match Mode) ----

/** Match target: first team to reach this score (win by MATCH_WIN_MARGIN) */
export const MATCH_TARGET = 42;

/** Minimum lead required to win the match */
export const MATCH_WIN_MARGIN = 3;

/** Bonus points awarded to the team that wins a round */
export const ROUND_WIN_BONUS = 7;

/** Fixed number of standard (1-point) cards per board */
export const STANDARD_SCORE_CARDS = 8;

/**
 * Card score distribution ranges for non-assassin, non-standard cards.
 * The 'blank' (0-point) count fills whatever remains to reach 24 (BOARD_SIZE - 1 assassin).
 */
export const CARD_SCORE_DISTRIBUTION = {
    gold: { score: 3, min: 2, max: 4 },
    silver: { score: 2, min: 3, max: 6 },
    trap: { score: -1, min: 0, max: 4 },
} as const;

/** Board total value (sum of all 25 card scores) must fall within this range */
export const BOARD_VALUE_MIN = 20;
export const BOARD_VALUE_MAX = 30;

/**
 * Weighted pool for assassin score generation.
 * Median is -1 (negative-biased). Drawn uniformly from this array.
 */
export const ASSASSIN_SCORE_POOL = [-2, -2, -1, -1, -1, 0, 0, 1, 2] as const;

// ---- Clue rules ----

/** Maximum length of a clue word (after sanitization). */
export const CLUE_WORD_MAX_LENGTH = 40;

/** Maximum value for a clue number. */
export const CLUE_NUMBER_MAX = 9;

// ---- Custom word lists ----

/**
 * Maximum number of words in a custom word list. Shared by the frontend
 * parser (settings.ts) and the game:start Zod schema (gameSchemas.ts) so the
 * two bounds can't drift apart — a list the client accepts locally must also
 * be one the server will accept over the wire (e.g. "combined" mode unions
 * DEFAULT_WORDS with the custom list, so the parser cap alone isn't enough).
 */
export const MAX_CUSTOM_WORD_LIST_SIZE = 2000;

/**
 * Normalize a word for clue-legality comparison: NFKC, trim, uppercase.
 * Board words are stored uppercase, so this aligns the two sides.
 */
export function normalizeClueWord(word: string): string {
    return word.normalize('NFKC').trim().toLocaleUpperCase('en-US');
}

/**
 * Crude English stemmer used ONLY for clue-legality checks. Strips a few
 * common inflectional suffixes so e.g. RUNNING / RUNS collapse toward RUN.
 * Deliberately conservative and lossy — it governs clue legality, never
 * scoring, so occasional over-stemming is acceptable.
 */
function crudeStem(word: string): string {
    const suffixes = ['INGLY', 'EDLY', 'ING', 'EST', 'ERS', 'ED', 'ER', 'LY', 'ES', 'S'];
    for (const suffix of suffixes) {
        if (word.length > suffix.length + 2 && word.endsWith(suffix)) {
            return word.slice(0, -suffix.length);
        }
    }
    return word;
}

/** Result of a structural clue-shape check (see isValidClueWordShape / isValidClueNumberShape). */
export interface ClueShapeValidation {
    valid: boolean;
    reason?: string;
}

/**
 * Structural validation for a clue word: non-empty, within CLUE_WORD_MAX_LENGTH,
 * and a single word (no whitespace). Expects an already-sanitized/trimmed
 * value — it does not itself strip control characters. Does NOT check
 * board-word legality (see isClueLegalForBoard, which needs the board).
 *
 * Shared by the Zod schema (validators/gameSchemas.ts, human path) and
 * gameService.submitClue (bot path, which bypasses Zod entirely) so both
 * layers enforce the same bounds from one source of truth.
 */
export function isValidClueWordShape(word: string): ClueShapeValidation {
    if (word.length < 1) return { valid: false, reason: 'Clue is required' };
    if (word.length > CLUE_WORD_MAX_LENGTH) return { valid: false, reason: 'Clue is too long' };
    if (/\s/.test(word)) return { valid: false, reason: 'Clue must be a single word' };
    return { valid: true };
}

/** Structural validation for a clue number: a whole number within [0, CLUE_NUMBER_MAX]. */
export function isValidClueNumberShape(clueNumber: number): ClueShapeValidation {
    if (!Number.isInteger(clueNumber)) return { valid: false, reason: 'Clue number must be a whole number' };
    if (clueNumber < 0) return { valid: false, reason: 'Clue number must be at least 0' };
    if (clueNumber > CLUE_NUMBER_MAX) return { valid: false, reason: `Clue number cannot exceed ${CLUE_NUMBER_MAX}` };
    return { valid: true };
}

/**
 * Whether a clue is legal to give for a given board. Mirrors the standard
 * rule that a clue may not reference a word on the board: rejects an exact
 * match, a substring match in either direction (covers multi-word board
 * entries like "ICE CREAM"), or a shared crude stem (grammatical variant).
 *
 * Pure and environment-agnostic so both the server (gameService) and the
 * frontend (to pre-disable the submit button) can share it.
 *
 * @returns true if the clue may be given.
 */
export function isClueLegalForBoard(clue: string, boardWords: string[]): boolean {
    const c = normalizeClueWord(clue);
    if (c.length === 0) return false;
    const cStem = crudeStem(c);
    for (const raw of boardWords) {
        const b = normalizeClueWord(raw);
        if (b.length === 0) continue;
        if (c === b || c.includes(b) || b.includes(c)) return false;
        const bStem = crudeStem(b);
        if (cStem.length >= 3 && cStem === bStem) return false;
    }
    return true;
}

// Default word list (standard Codenames set)
export const DEFAULT_WORDS = [
    'AFRICA',
    'AGENT',
    'AIR',
    'ALIEN',
    'ALPS',
    'AMAZON',
    'AMBULANCE',
    'AMERICA',
    'ANGEL',
    'ANTARCTICA',
    'APPLE',
    'ARM',
    'ATLANTIS',
    'AUSTRALIA',
    'AZTEC',
    'BACK',
    'BALL',
    'BAND',
    'BANK',
    'BAR',
    'BARK',
    'BAT',
    'BATTERY',
    'BEACH',
    'BEAR',
    'BEAT',
    'BED',
    'BEIJING',
    'BELL',
    'BELT',
    'BERLIN',
    'BERMUDA',
    'BERRY',
    'BILL',
    'BLOCK',
    'BOARD',
    'BOLT',
    'BOMB',
    'BOND',
    'BOOM',
    'BOOT',
    'BOTTLE',
    'BOW',
    'BOX',
    'BRIDGE',
    'BRUSH',
    'BUCK',
    'BUFFALO',
    'BUG',
    'BUGLE',
    'BUTTON',
    'CALF',
    'CANADA',
    'CAP',
    'CAPITAL',
    'CAR',
    'CARD',
    'CARROT',
    'CASINO',
    'CAST',
    'CAT',
    'CELL',
    'CENTAUR',
    'CENTER',
    'CHAIR',
    'CHANGE',
    'CHARGE',
    'CHECK',
    'CHEST',
    'CHICK',
    'CHINA',
    'CHOCOLATE',
    'CHURCH',
    'CIRCLE',
    'CLIFF',
    'CLOAK',
    'CLUB',
    'CODE',
    'COLD',
    'COMIC',
    'COMPOUND',
    'CONCERT',
    'CONDUCTOR',
    'CONTRACT',
    'COOK',
    'COPPER',
    'COTTON',
    'COURT',
    'COVER',
    'CRANE',
    'CRASH',
    'CRICKET',
    'CROSS',
    'CROWN',
    'CYCLE',
    'CZECH',
    'DANCE',
    'DATE',
    'DAY',
    'DEATH',
    'DECK',
    'DEGREE',
    'DIAMOND',
    'DICE',
    'DINOSAUR',
    'DISEASE',
    'DOCTOR',
    'DOG',
    'DRAFT',
    'DRAGON',
    'DRESS',
    'DRILL',
    'DROP',
    'DUCK',
    'DWARF',
    'EAGLE',
    'EGYPT',
    'EMBASSY',
    'ENGINE',
    'ENGLAND',
    'EUROPE',
    'EYE',
    'FACE',
    'FAIR',
    'FALL',
    'FAN',
    'FENCE',
    'FIELD',
    'FIGHTER',
    'FIGURE',
    'FILE',
    'FILM',
    'FIRE',
    'FISH',
    'FLUTE',
    'FLY',
    'FOOT',
    'FORCE',
    'FOREST',
    'FORK',
    'FRANCE',
    'GAME',
    'GAS',
    'GENIUS',
    'GERMANY',
    'GHOST',
    'GIANT',
    'GLASS',
    'GLOVE',
    'GOLD',
    'GRACE',
    'GRASS',
    'GREECE',
    'GREEN',
    'GROUND',
    'HAM',
    'HAND',
    'HAWK',
    'HEAD',
    'HEART',
    'HELICOPTER',
    'HIMALAYAS',
    'HOLE',
    'HOLLYWOOD',
    'HONEY',
    'HOOD',
    'HOOK',
    'HORN',
    'HORSE',
    'HOSPITAL',
    'HOTEL',
    'ICE',
    'ICE CREAM',
    'INDIA',
    'IRON',
    'IVORY',
    'JACK',
    'JAM',
    'JET',
    'JUPITER',
    'KANGAROO',
    'KETCHUP',
    'KEY',
    'KID',
    'KING',
    'KIWI',
    'KNIFE',
    'KNIGHT',
    'LAB',
    'LAP',
    'LASER',
    'LAWYER',
    'LEAD',
    'LEMON',
    'LEPRECHAUN',
    'LIFE',
    'LIGHT',
    'LIMOUSINE',
    'LINE',
    'LINK',
    'LION',
    'LITTER',
    'LOCH NESS',
    'LOCK',
    'LOG',
    'LONDON',
    'LUCK',
    'MAIL',
    'MAMMOTH',
    'MAPLE',
    'MARBLE',
    'MARCH',
    'MASS',
    'MATCH',
    'MERCURY',
    'MEXICO',
    'MICROSCOPE',
    'MILLIONAIRE',
    'MINE',
    'MINT',
    'MISSILE',
    'MODEL',
    'MOLE',
    'MOON',
    'MOSCOW',
    'MOUNT',
    'MOUSE',
    'MOUTH',
    'MUG',
    'NAIL',
    'NEEDLE',
    'NET',
    'NEW YORK',
    'NIGHT',
    'NINJA',
    'NOTE',
    'NOVEL',
    'NURSE',
    'NUT',
    'OCTOPUS',
    'OIL',
    'OLIVE',
    'OLYMPUS',
    'OPERA',
    'ORANGE',
    'ORGAN',
    'PALM',
    'PAN',
    'PANDA',
    'PAPER',
    'PARACHUTE',
    'PARK',
    'PART',
    'PASS',
    'PASTE',
    'PENGUIN',
    'PHOENIX',
    'PIANO',
    'PIE',
    'PILOT',
    'PIN',
    'PIPE',
    'PIRATE',
    'PISTOL',
    'PIT',
    'PITCH',
    'PLANE',
    'PLASTIC',
    'PLATE',
    'PLATYPUS',
    'PLAY',
    'PLOT',
    'POINT',
    'POISON',
    'POLE',
    'POLICE',
    'POOL',
    'PORT',
    'POST',
    'POUND',
    'PRESS',
    'PRINCESS',
    'PUMPKIN',
    'PUPIL',
    'PYRAMID',
    'QUEEN',
    'RABBIT',
    'RACKET',
    'RAY',
    'REVOLUTION',
    'RING',
    'ROBIN',
    'ROBOT',
    'ROCK',
    'ROME',
    'ROOT',
    'ROSE',
    'ROULETTE',
    'ROUND',
    'ROW',
    'RULER',
    'SATELLITE',
    'SATURN',
    'SCALE',
    'SCHOOL',
    'SCIENTIST',
    'SCORPION',
    'SCREEN',
    'SCUBA DIVER',
    'SEAL',
    'SERVER',
    'SHADOW',
    'SHAKESPEARE',
    'SHARK',
    'SHIP',
    'SHOE',
    'SHOP',
    'SHOT',
    'SHOULDER',
    'SILK',
    'SINK',
    'SKYSCRAPER',
    'SLIP',
    'SLUG',
    'SMUGGLER',
    'SNOW',
    'SNOWMAN',
    'SOCK',
    'SOLDIER',
    'SOUL',
    'SOUND',
    'SPACE',
    'SPELL',
    'SPIDER',
    'SPIKE',
    'SPINE',
    'SPOT',
    'SPRING',
    'SPY',
    'SQUARE',
    'STADIUM',
    'STAFF',
    'STAR',
    'STATE',
    'STICK',
    'STOCK',
    'STRAW',
    'STREAM',
    'STRIKE',
    'STRING',
    'SUB',
    'SUIT',
    'SUPERHERO',
    'SWING',
    'SWITCH',
    'TABLE',
    'TABLET',
    'TAG',
    'TAIL',
    'TAP',
    'TEACHER',
    'TELESCOPE',
    'TEMPLE',
    'THIEF',
    'THUMB',
    'TICK',
    'TIE',
    'TIME',
    'TOKYO',
    'TOOTH',
    'TORCH',
    'TOWER',
    'TRACK',
    'TRAIN',
    'TRIANGLE',
    'TRIP',
    'TRUNK',
    'TUBE',
    'TURKEY',
    'UNDERTAKER',
    'UNICORN',
    'VACUUM',
    'VAN',
    'VET',
    'VOLCANO',
    'WALL',
    'WAR',
    'WASHER',
    'WASHINGTON',
    'WATCH',
    'WATER',
    'WAVE',
    'WEB',
    'WELL',
    'WHALE',
    'WHIP',
    'WIND',
    'WITCH',
    'WORM',
    'YARD',
] as const;
