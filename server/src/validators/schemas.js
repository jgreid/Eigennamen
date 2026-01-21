/**
 * Input Validation Schemas (Zod)
 */

const { z } = require('zod');
const { BOARD_SIZE, VALIDATION } = require('../config/constants');

// Team name validation regex - alphanumeric, spaces, hyphens only (defense-in-depth against XSS)
const teamNameRegex = /^[a-zA-Z0-9\s\-]+$/;

// Room schemas
const roomCreateSchema = z.object({
    settings: z.object({
        teamNames: z.object({
            red: z.string().max(VALIDATION.TEAM_NAME_MAX_LENGTH).regex(teamNameRegex, 'Team name can only contain letters, numbers, spaces, and hyphens').default('Red'),
            blue: z.string().max(VALIDATION.TEAM_NAME_MAX_LENGTH).regex(teamNameRegex, 'Team name can only contain letters, numbers, spaces, and hyphens').default('Blue')
        }).optional(),
        turnTimer: z.number().int().min(30).max(300).nullable().optional(),
        allowSpectators: z.boolean().optional(),
        wordListId: z.string().uuid().nullable().optional(),
        password: z.string().max(50).optional()
    }).optional().default({})
});

// Nickname validation regex - alphanumeric, spaces, hyphens, underscores only (defense against XSS)
const nicknameRegex = /^[a-zA-Z0-9\s\-_]+$/;

const roomJoinSchema = z.object({
    // Room code validation - matches characters used by roomService.js generator
    // Excludes: I, L (look like 1), O (looks like 0), 0 (zero), 1 (one)
    code: z.string()
        .length(6)
        .transform(s => s.toUpperCase())
        .refine(s => /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/.test(s), 'Invalid room code format'),
    nickname: z.string()
        .min(VALIDATION.NICKNAME_MIN_LENGTH, 'Nickname is required')
        .max(VALIDATION.NICKNAME_MAX_LENGTH, 'Nickname too long')
        .trim()
        .regex(nicknameRegex, 'Nickname can only contain letters, numbers, spaces, hyphens, and underscores'),
    password: z.string().max(50).optional()
});

const roomSettingsSchema = z.object({
    teamNames: z.object({
        red: z.string().max(VALIDATION.TEAM_NAME_MAX_LENGTH).regex(teamNameRegex, 'Team name can only contain letters, numbers, spaces, and hyphens'),
        blue: z.string().max(VALIDATION.TEAM_NAME_MAX_LENGTH).regex(teamNameRegex, 'Team name can only contain letters, numbers, spaces, and hyphens')
    }).optional(),
    turnTimer: z.number().int().min(30).max(300).nullable().optional(),
    allowSpectators: z.boolean().optional(),
    password: z.string().max(50).nullable().optional()
});

// Player schemas
const playerTeamSchema = z.object({
    team: z.enum(['red', 'blue']).nullable()
});

const playerRoleSchema = z.object({
    role: z.enum(['spymaster', 'clicker', 'spectator'])
});

const playerNicknameSchema = z.object({
    nickname: z.string()
        .min(1, 'Nickname is required')
        .max(30, 'Nickname too long')
        .trim()
        .regex(nicknameRegex, 'Nickname can only contain letters, numbers, spaces, hyphens, and underscores')
});

// Game schemas
const gameStartSchema = z.object({
    // Option 1: Reference a word list stored in database (requires database)
    wordListId: z.string().uuid().nullable().optional(),
    // Option 2: Pass custom words directly (works without database)
    wordList: z.array(z.string().min(1).max(50).trim())
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

const gameClueSchema = z.object({
    word: z.string()
        .min(1, 'Clue word is required')
        .max(VALIDATION.CLUE_MAX_LENGTH, 'Clue word too long')
        .trim()
        .regex(/^[A-Za-z\s\-']+$/, 'Clue must contain only letters, spaces, hyphens, and apostrophes'),
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
        .trim(),
    teamOnly: z.boolean().default(false)
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
    chatMessageSchema
};
