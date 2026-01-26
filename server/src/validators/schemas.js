/**
 * Input Validation Schemas (Zod)
 *
 * Provides comprehensive input validation with:
 * - Type checking and constraints
 * - XSS prevention via character restrictions
 * - Reserved name blocking
 * - Control character removal
 */

const { z } = require('zod');
const { BOARD_SIZE, VALIDATION, RESERVED_NAMES } = require('../config/constants');
const { removeControlChars, isReservedName } = require('../utils/sanitize');

// Team name validation regex - alphanumeric, spaces, hyphens only (defense-in-depth against XSS)
const teamNameRegex = /^[a-zA-Z0-9\s\-]+$/;

// Room ID validation regex - alphanumeric, hyphens, underscores (no spaces for easier sharing)
const roomIdRegex = /^[a-zA-Z0-9\-_]+$/;

// Room schemas
const roomCreateSchema = z.object({
    // Room ID provided by host - serves as both room name and access key
    roomId: z.string()
        .min(3, 'Room ID must be at least 3 characters')
        .max(20, 'Room ID must be at most 20 characters')
        .transform(val => removeControlChars(val).trim())
        .refine(val => roomIdRegex.test(val), 'Room ID can only contain letters, numbers, hyphens, and underscores'),
    settings: z.object({
        teamNames: z.object({
            red: z.string().max(VALIDATION.TEAM_NAME_MAX_LENGTH).regex(teamNameRegex, 'Team name can only contain letters, numbers, spaces, and hyphens').default('Red'),
            blue: z.string().max(VALIDATION.TEAM_NAME_MAX_LENGTH).regex(teamNameRegex, 'Team name can only contain letters, numbers, spaces, and hyphens').default('Blue')
        }).optional(),
        turnTimer: z.number().int().min(30).max(300).nullable().optional(),
        allowSpectators: z.boolean().optional(),
        wordListId: z.string().uuid().nullable().optional(),
        // Host nickname for room creation
        nickname: z.string().max(20).optional()
    }).optional().default({})
});

// Nickname validation regex - alphanumeric, spaces, hyphens, underscores only (defense against XSS)
const nicknameRegex = /^[a-zA-Z0-9\s\-_]+$/;

/**
 * Create a validated nickname schema with reserved name checking
 * Used for all nickname inputs throughout the application
 */
const createNicknameSchema = () => z.string()
    .min(VALIDATION.NICKNAME_MIN_LENGTH, 'Nickname is required')
    .max(VALIDATION.NICKNAME_MAX_LENGTH, 'Nickname too long')
    .transform(val => removeControlChars(val).trim())
    .refine(val => val.length >= VALIDATION.NICKNAME_MIN_LENGTH, 'Nickname is required')
    .refine(val => !/^\s*$/.test(val), 'Nickname cannot be only whitespace')
    .refine(val => nicknameRegex.test(val), 'Nickname can only contain letters, numbers, spaces, hyphens, and underscores')
    .refine(val => !isReservedName(val, RESERVED_NAMES), 'This nickname is reserved');

const roomJoinSchema = z.object({
    // Room ID - the same ID the host used when creating the room
    roomId: z.string()
        .min(3, 'Room ID must be at least 3 characters')
        .max(20, 'Room ID must be at most 20 characters')
        .transform(val => removeControlChars(val).trim())
        .refine(val => roomIdRegex.test(val), 'Room ID can only contain letters, numbers, hyphens, and underscores'),
    nickname: createNicknameSchema()
});

const roomSettingsSchema = z.object({
    teamNames: z.object({
        red: z.string().max(VALIDATION.TEAM_NAME_MAX_LENGTH).regex(teamNameRegex, 'Team name can only contain letters, numbers, spaces, and hyphens'),
        blue: z.string().max(VALIDATION.TEAM_NAME_MAX_LENGTH).regex(teamNameRegex, 'Team name can only contain letters, numbers, spaces, and hyphens')
    }).optional(),
    turnTimer: z.number().int().min(30).max(300).nullable().optional(),
    allowSpectators: z.boolean().optional()
});

// Player schemas
const playerTeamSchema = z.object({
    team: z.enum(['red', 'blue']).nullable()
});

const playerRoleSchema = z.object({
    role: z.enum(['spymaster', 'clicker', 'spectator'])
});

const playerNicknameSchema = z.object({
    nickname: createNicknameSchema()
});

// Game schemas
const gameStartSchema = z.object({
    // Option 1: Reference a word list stored in database (requires database)
    wordListId: z.string().uuid().nullable().optional(),
    // Option 2: Pass custom words directly (works without database)
    // SECURITY FIX: Apply removeControlChars to each word for XSS prevention
    wordList: z.array(
        z.string()
            .min(1)
            .max(50)
            .transform(val => removeControlChars(val).trim())
            .refine(val => val.length >= 1, 'Word cannot be empty after sanitization')
        )
        .min(BOARD_SIZE, `Must have at least ${BOARD_SIZE} words`)
        .max(500, 'Too many words')
        .optional()
}).optional().default({});

const gameRevealSchema = z.object({
    index: z.number()
        .int()
        .min(0, 'Invalid card index')
        .max(BOARD_SIZE - 1, 'Invalid card index')
});

// ISSUE #2 FIX: Clue word regex with quantified repetition to prevent ReDoS
// Allows letters with optional single spaces/hyphens/apostrophes between words
// Maximum of 10 word parts to prevent excessive backtracking
const clueWordRegex = /^[A-Za-z]+(?:[\s\-'][A-Za-z]+){0,9}$/;

const gameClueSchema = z.object({
    word: z.string()
        .min(1, 'Clue word is required')
        .max(VALIDATION.CLUE_MAX_LENGTH, 'Clue word too long')
        .transform(val => removeControlChars(val).trim())
        .transform(val => val.replace(/\s+/g, ' ')) // Normalize multiple spaces to single space
        .refine(val => val.length >= 1, 'Clue word is required')
        .refine(val => clueWordRegex.test(val), 'Clue must be letters optionally separated by single spaces, hyphens, or apostrophes'),
    number: z.number()
        .int()
        .min(VALIDATION.CLUE_NUMBER_MIN, 'Number must be 0 or greater')
        .max(VALIDATION.CLUE_NUMBER_MAX, `Number must be between ${VALIDATION.CLUE_NUMBER_MIN} and ${VALIDATION.CLUE_NUMBER_MAX}`)
});

// Chat schemas
const chatMessageSchema = z.object({
    text: z.string()
        .min(1, 'Message is required')
        .max(500, 'Message too long')
        .transform(val => removeControlChars(val).trim())
        .refine(val => val.length >= 1, 'Message is required'),
    teamOnly: z.boolean().default(false),
    spectatorOnly: z.boolean().default(false) // US-16.1: Spectator-only chat
});

// Spectator chat schema (for dedicated spectator chat event)
const spectatorChatSchema = z.object({
    message: z.string()
        .min(1, 'Message is required')
        .max(VALIDATION.CHAT_MESSAGE_MAX_LENGTH, 'Message too long')
        .transform(val => removeControlChars(val).trim())
        .refine(val => val.length >= 1, 'Message is required')
});

module.exports = {
    roomCreateSchema,
    roomJoinSchema,
    roomSettingsSchema,
    playerTeamSchema,
    playerRoleSchema,
    playerNicknameSchema,
    gameStartSchema,
    gameRevealSchema,
    gameClueSchema,
    chatMessageSchema,
    spectatorChatSchema,
    // Export for reuse in custom validation
    createNicknameSchema
};
