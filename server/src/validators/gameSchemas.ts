import type { z as ZodType } from 'zod';

import { z } from 'zod';
import { BOARD_SIZE } from '../config/constants';
import {
    CLUE_WORD_MAX_LENGTH,
    MAX_CUSTOM_WORD_LIST_SIZE,
    isValidClueWordShape,
    isValidClueNumberShape,
} from '../shared/gameRules';
import { removeControlChars } from '../utils/sanitize';

const gameStartSchema = z
    .object({
        // Pass custom words directly.
        // Apply removeControlChars to each word for XSS prevention
        wordList: z
            .array(
                z
                    .string()
                    .min(1)
                    .max(50)
                    .transform((val: string) => removeControlChars(val).trim())
                    .refine((val: string) => val.length >= 1, 'Word cannot be empty after sanitization')
            )
            .min(BOARD_SIZE, `Must have at least ${BOARD_SIZE} words`)
            .max(MAX_CUSTOM_WORD_LIST_SIZE, 'Too many words')
            .refine(
                (words: string[]) => new Set(words.map((w: string) => w.toLowerCase())).size >= BOARD_SIZE,
                `Must have at least ${BOARD_SIZE} unique words (case-insensitive)`
            )
            .optional(),
        // Provenance for the client's word-list library: the stable id and name
        // of the saved list `wordList` came from. Recorded on the game/history so
        // the recap can show "Played with <name>". These are NOT selectors — the
        // words themselves still travel in `wordList`; the server never resolves a
        // list by id. Sanitized (control chars stripped) and length-bounded; the
        // display path uses textContent, so no markup can execute.
        wordListId: z
            .string()
            .max(64, 'wordListId too long')
            .transform((val: string) => removeControlChars(val).trim())
            .optional(),
        wordListName: z
            .string()
            .max(80, 'wordListName too long')
            .transform((val: string) => removeControlChars(val).trim())
            .optional(),
    })
    .optional()
    .default({});

const gameRevealSchema = z.object({
    index: z
        .number()
        .int()
        .min(0, 'Invalid card index')
        .max(BOARD_SIZE - 1, 'Invalid card index'),
});

// Clue schema (for game:clue) — structural validation only. Board-word
// legality (clue must not reference a word on the board) is enforced in the
// service layer where the board is known, so both the socket handler and any
// internal caller (e.g. bots) share that rule.
const gameClueSchema = z.object({
    word: z
        .string()
        .min(1, 'Clue is required')
        .max(CLUE_WORD_MAX_LENGTH, 'Clue is too long')
        .transform((val: string) => removeControlChars(val).trim())
        .superRefine((val: string, ctx) => {
            const result = isValidClueWordShape(val);
            if (!result.valid) ctx.addIssue(result.reason ?? 'Invalid clue');
        }),
    // isValidClueNumberShape's own integer/range checks are the source of
    // truth shared with gameService.submitClue's bot path; .int() here just
    // gives Zod's usual type-coercion-rejection behavior on the raw input.
    number: z
        .number()
        .int('Clue number must be a whole number')
        .superRefine((val: number, ctx) => {
            const result = isValidClueNumberShape(val);
            if (!result.valid) ctx.addIssue(result.reason ?? 'Invalid clue number');
        }),
});

// Game history limit schema (for game:getHistory)
const gameHistoryLimitSchema = z.object({
    limit: z.number().int().min(1, 'Limit must be at least 1').max(50, 'Limit cannot exceed 50').optional().default(10),
});

// Game replay schema (for game:getReplay) - gameId should be a valid identifier
const gameReplaySchema = z.object({
    gameId: z
        .string()
        .min(1, 'Game ID is required')
        .max(100, 'Game ID too long')
        .transform((val: string) => removeControlChars(val).trim())
        .refine((val: string) => val.length >= 1, 'Game ID is required'),
});

// Forfeit schema - optional team to forfeit on behalf of
const gameForfeitSchema = z
    .object({
        team: z.enum(['red', 'blue']).optional(),
    })
    .optional()
    .default({});

const gameReadySchema = z.object({}).strict();

// Type exports for schema inference
export type GameStartInput = ZodType.infer<typeof gameStartSchema>;
export type GameRevealInput = ZodType.infer<typeof gameRevealSchema>;
export type GameClueInput = ZodType.infer<typeof gameClueSchema>;
export type GameHistoryLimitInput = ZodType.infer<typeof gameHistoryLimitSchema>;
export type GameReplayInput = ZodType.infer<typeof gameReplaySchema>;
export type GameForfeitInput = ZodType.infer<typeof gameForfeitSchema>;
export type GameReadyInput = ZodType.infer<typeof gameReadySchema>;

export {
    gameStartSchema,
    gameRevealSchema,
    gameClueSchema,
    gameHistoryLimitSchema,
    gameReplaySchema,
    gameForfeitSchema,
    gameReadySchema,
};
