/**
 * Game Validation Schemas
 *
 * Zod schemas for game start, card reveal, clue giving,
 * game history, and replay retrieval.
 */

import type { z as ZodType } from 'zod';

const { z } = require('zod');
const { BOARD_SIZE, VALIDATION } = require('../config/constants');
const { removeControlChars } = require('../utils/sanitize');

const gameStartSchema = z.object({
    // Option 1: Reference a word list stored in database (requires database)
    wordListId: z.string().uuid().nullable().optional(),
    // Option 2: Pass custom words directly (works without database)
    // SECURITY FIX: Apply removeControlChars to each word for XSS prevention
    wordList: z.array(
        z.string()
            .min(1)
            .max(50)
            .transform((val: string) => removeControlChars(val).trim())
            .refine((val: string) => val.length >= 1, 'Word cannot be empty after sanitization')
    )
        .min(BOARD_SIZE, `Must have at least ${BOARD_SIZE} words`)
        .max(500, 'Too many words')
        .refine(
            (words: string[]) => new Set(words.map((w: string) => w.toLowerCase())).size >= BOARD_SIZE,
            `Must have at least ${BOARD_SIZE} unique words (case-insensitive)`
        )
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
// Uses Unicode property escapes to support international characters
const clueWordRegex = /^[\p{L}]+(?:[\s\-'][\p{L}]+){0,9}$/u;

const gameClueSchema = z.object({
    word: z.string()
        .min(1, 'Clue word is required')
        .max(VALIDATION.CLUE_MAX_LENGTH, 'Clue word too long')
        .transform((val: string) => removeControlChars(val).trim())
        .transform((val: string) => val.replace(/\s+/g, ' ')) // Normalize multiple spaces to single space
        .refine((val: string) => val.length >= 1, 'Clue word is required')
        .refine((val: string) => clueWordRegex.test(val), 'Clue must be words optionally separated by single spaces, hyphens, or apostrophes'),
    number: z.number()
        .int()
        .min(VALIDATION.CLUE_NUMBER_MIN, 'Number must be 0 or greater')
        .max(VALIDATION.CLUE_NUMBER_MAX, `Number must be between ${VALIDATION.CLUE_NUMBER_MIN} and ${VALIDATION.CLUE_NUMBER_MAX}`)
});

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
        .transform((val: string) => removeControlChars(val).trim())
        .refine((val: string) => val.length >= 1, 'Game ID is required')
});

// Type exports for schema inference
export type GameStartInput = ZodType.infer<typeof gameStartSchema>;
export type GameRevealInput = ZodType.infer<typeof gameRevealSchema>;
export type GameClueInput = ZodType.infer<typeof gameClueSchema>;
export type GameHistoryLimitInput = ZodType.infer<typeof gameHistoryLimitSchema>;
export type GameReplayInput = ZodType.infer<typeof gameReplaySchema>;

export {
    gameStartSchema,
    gameRevealSchema,
    gameClueSchema,
    gameHistoryLimitSchema,
    gameReplaySchema
};
