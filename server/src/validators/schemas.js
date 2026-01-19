/**
 * Input Validation Schemas (Zod)
 */

const { z } = require('zod');
const { BOARD_SIZE, TEAMS, ROLES } = require('../config/constants');

// Room schemas
const roomCreateSchema = z.object({
    settings: z.object({
        teamNames: z.object({
            red: z.string().max(20).default('Red'),
            blue: z.string().max(20).default('Blue')
        }).optional(),
        turnTimer: z.number().int().min(30).max(300).nullable().optional(),
        allowSpectators: z.boolean().optional(),
        wordListId: z.string().uuid().nullable().optional()
    }).optional().default({})
});

const roomJoinSchema = z.object({
    code: z.string()
        .length(6)
        .transform(s => s.toUpperCase())
        .refine(s => /^[A-Z0-9]+$/.test(s), 'Invalid room code format'),
    nickname: z.string()
        .min(1, 'Nickname is required')
        .max(30, 'Nickname too long')
        .trim()
});

const roomSettingsSchema = z.object({
    teamNames: z.object({
        red: z.string().max(20),
        blue: z.string().max(20)
    }).optional(),
    turnTimer: z.number().int().min(30).max(300).nullable().optional(),
    allowSpectators: z.boolean().optional()
});

// Player schemas
const playerTeamSchema = z.object({
    team: z.enum(['red', 'blue']).nullable()
});

const playerRoleSchema = z.object({
    role: z.enum(['spymaster', 'guesser', 'spectator'])
});

const playerNicknameSchema = z.object({
    nickname: z.string()
        .min(1, 'Nickname is required')
        .max(30, 'Nickname too long')
        .trim()
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
        .max(50, 'Clue word too long')
        .trim()
        .regex(/^[A-Za-z\s-]+$/, 'Clue must contain only letters, spaces, and hyphens'),
    number: z.number()
        .int()
        .min(0, 'Number must be 0 or greater')
        .max(BOARD_SIZE, 'Number too large')
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
