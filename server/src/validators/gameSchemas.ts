import type { z as ZodType } from 'zod';

import { z } from 'zod';
import { BOARD_SIZE } from '../config/constants';
import { removeControlChars } from '../utils/sanitize';

const gameStartSchema = z.object({
    // Option 1: Reference a word list stored in database (requires database)
    wordListId: z.string().uuid().nullable().optional(),
    // Option 2: Pass custom words directly (works without database)
    // Apply removeControlChars to each word for XSS prevention
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
export type GameHistoryLimitInput = ZodType.infer<typeof gameHistoryLimitSchema>;
export type GameReplayInput = ZodType.infer<typeof gameReplaySchema>;

export {
    gameStartSchema,
    gameRevealSchema,
    gameHistoryLimitSchema,
    gameReplaySchema
};
