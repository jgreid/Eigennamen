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

// Team name validation regex - Unicode letters/numbers, spaces, hyphens
// Uses Unicode property escapes (\p{L} for letters, \p{N} for numbers) to support international characters
// XSS defense maintained via removeControlChars and HTML escaping on output
const teamNameRegex = /^[\p{L}\p{N}\s\-]+$/u;

// Room ID validation regex - Unicode letters/numbers, hyphens, underscores (no spaces for easier sharing)
const roomIdRegex = /^[\p{L}\p{N}\-_]+$/u;

// Nickname validation regex - Unicode letters/numbers, spaces, hyphens, underscores
const nicknameRegex = /^[\p{L}\p{N}\s\-_]+$/u;

/**
 * Create a validated nickname schema with reserved name checking
 * Used for all nickname inputs throughout the application
 * IMPORTANT: Defined early so it can be used in roomCreateSchema
 */
const createNicknameSchema = () => z.string()
    .min(VALIDATION.NICKNAME_MIN_LENGTH, 'Nickname is required')
    .max(VALIDATION.NICKNAME_MAX_LENGTH, 'Nickname too long')
    .transform(val => removeControlChars(val).trim())
    .refine(val => val.length >= VALIDATION.NICKNAME_MIN_LENGTH, 'Nickname is required')
    .refine(val => !/^\s*$/.test(val), 'Nickname cannot be only whitespace')
    .refine(val => nicknameRegex.test(val), 'Nickname contains invalid characters')
    .refine(val => !isReservedName(val, RESERVED_NAMES), 'This nickname is reserved');

// Room schemas
const roomCreateSchema = z.object({
    // Room ID provided by host - serves as both room name and access key
    roomId: z.string()
        .min(3, 'Room ID must be at least 3 characters')
        .max(20, 'Room ID must be at most 20 characters')
        .transform(val => removeControlChars(val).trim())
        .refine(val => roomIdRegex.test(val), 'Room ID contains invalid characters'),
    settings: z.object({
        teamNames: z.object({
            // FIX: Add removeControlChars transform with refine for regex validation
            red: z.string().max(VALIDATION.TEAM_NAME_MAX_LENGTH).transform(val => removeControlChars(val).trim()).refine(val => teamNameRegex.test(val), 'Team name contains invalid characters').default('Red'),
            blue: z.string().max(VALIDATION.TEAM_NAME_MAX_LENGTH).transform(val => removeControlChars(val).trim()).refine(val => teamNameRegex.test(val), 'Team name contains invalid characters').default('Blue')
        }).optional(),
        turnTimer: z.number().int().min(30).max(300).nullable().optional(),
        allowSpectators: z.boolean().optional(),
        wordListId: z.string().uuid().nullable().optional(),
        // FIX: Host nickname uses full validation (control chars, regex, reserved names)
        nickname: createNicknameSchema().optional()
    }).optional().default({})
});

const roomJoinSchema = z.object({
    // Room ID - the same ID the host used when creating the room
    roomId: z.string()
        .min(3, 'Room ID must be at least 3 characters')
        .max(20, 'Room ID must be at most 20 characters')
        .transform(val => removeControlChars(val).trim())
        .refine(val => roomIdRegex.test(val), 'Room ID contains invalid characters'),
    nickname: createNicknameSchema()
});

const roomSettingsSchema = z.object({
    teamNames: z.object({
        // FIX: Add removeControlChars transform with refine for regex validation
        red: z.string().max(VALIDATION.TEAM_NAME_MAX_LENGTH).transform(val => removeControlChars(val).trim()).refine(val => teamNameRegex.test(val), 'Team name contains invalid characters'),
        blue: z.string().max(VALIDATION.TEAM_NAME_MAX_LENGTH).transform(val => removeControlChars(val).trim()).refine(val => teamNameRegex.test(val), 'Team name contains invalid characters')
    }).optional(),
    turnTimer: z.number().int().min(30).max(300).nullable().optional(),
    allowSpectators: z.boolean().optional()
});

// FIX H10: Add schema for room:reconnect validation
// Reconnection token is 64 hex characters (32 bytes in hex)
const reconnectionTokenRegex = /^[0-9a-f]{64}$/i;

const roomReconnectSchema = z.object({
    code: z.string()
        .min(3, 'Room code must be at least 3 characters')
        .max(20, 'Room code must be at most 20 characters')
        .transform(val => removeControlChars(val).trim().toLowerCase()),
    reconnectionToken: z.string()
        .length(64, 'Invalid reconnection token format')
        .refine(val => reconnectionTokenRegex.test(val), 'Invalid reconnection token format')
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
// Allows Unicode letters with optional single spaces/hyphens/apostrophes between words
// Maximum of 10 word parts to prevent excessive backtracking
// Uses Unicode property escapes to support international characters (é, ñ, ü, etc.)
const clueWordRegex = /^[\p{L}]+(?:[\s\-'][\p{L}]+){0,9}$/u;

const gameClueSchema = z.object({
    word: z.string()
        .min(1, 'Clue word is required')
        .max(VALIDATION.CLUE_MAX_LENGTH, 'Clue word too long')
        .transform(val => removeControlChars(val).trim())
        .transform(val => val.replace(/\s+/g, ' ')) // Normalize multiple spaces to single space
        .refine(val => val.length >= 1, 'Clue word is required')
        .refine(val => clueWordRegex.test(val), 'Clue must be words optionally separated by single spaces, hyphens, or apostrophes'),
    number: z.number()
        .int()
        .min(VALIDATION.CLUE_NUMBER_MIN, 'Number must be 0 or greater')
        .max(VALIDATION.CLUE_NUMBER_MAX, `Number must be between ${VALIDATION.CLUE_NUMBER_MIN} and ${VALIDATION.CLUE_NUMBER_MAX}`)
});

// Chat schemas
const chatMessageSchema = z.object({
    text: z.string()
        .min(1, 'Message is required')
        .max(VALIDATION.CHAT_MESSAGE_MAX_LENGTH, 'Message too long')
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

// FIX: Add missing schemas for events that previously used manual validation

// Game history limit schema (for game:getHistory)
const gameHistoryLimitSchema = z.object({
    limit: z.number()
        .int()
        .min(1, 'Limit must be at least 1')
        .max(50, 'Limit cannot exceed 50')
        .optional()
        .default(10)
});

// Game replay schema (for game:getReplay) - gameId should be a valid identifier
const gameReplaySchema = z.object({
    gameId: z.string()
        .min(1, 'Game ID is required')
        .max(100, 'Game ID too long')
        .transform(val => removeControlChars(val).trim())
        .refine(val => val.length >= 1, 'Game ID is required')
});

// Session ID regex - UUIDs or similar identifiers
const sessionIdRegex = /^[a-zA-Z0-9\-_]+$/;

// Player kick schema (for player:kick)
const playerKickSchema = z.object({
    targetSessionId: z.string()
        .min(1, 'Target session ID is required')
        .max(100, 'Session ID too long')
        .transform(val => removeControlChars(val).trim())
        .refine(val => sessionIdRegex.test(val), 'Invalid session ID format')
});

module.exports = {
    roomCreateSchema,
    roomJoinSchema,
    roomSettingsSchema,
    roomReconnectSchema,
    playerTeamSchema,
    playerRoleSchema,
    playerNicknameSchema,
    gameStartSchema,
    gameRevealSchema,
    gameClueSchema,
    chatMessageSchema,
    spectatorChatSchema,
    // FIX: Export new schemas for previously unvalidated events
    gameHistoryLimitSchema,
    gameReplaySchema,
    playerKickSchema,
    // Export for reuse in custom validation
    createNicknameSchema
};
