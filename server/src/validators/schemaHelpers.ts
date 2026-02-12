/**
 * Schema Helpers - Shared validation utilities
 *
 * Provides reusable schema builders, regex patterns, and
 * validation functions used across domain-specific schemas.
 */

import type { z as ZodType } from 'zod';

const { z } = require('zod');
const { VALIDATION, RESERVED_NAMES, GAME_MODE_CONFIG } = require('../config/constants');
const { removeControlChars, isReservedName, toEnglishLowerCase } = require('../utils/sanitize');

// Re-export z for external use
export { z };

// Team name validation regex - Unicode letters/numbers, spaces, hyphens
// Uses Unicode property escapes (\p{L} for letters, \p{N} for numbers) to support international characters
// XSS defense maintained via removeControlChars and HTML escaping on output
const teamNameRegex = /^[\p{L}\p{N}\s\-]+$/u;

// Room ID validation regex - Unicode letters/numbers, hyphens, underscores (no spaces for easier sharing)
const roomIdRegex = /^[\p{L}\p{N}\-_]+$/u;

// Nickname validation regex - Unicode letters/numbers, spaces, hyphens, underscores
const nicknameRegex = /^[\p{L}\p{N}\s\-_]+$/u;

/**
 * Create a sanitized string schema with control character removal and regex validation.
 * Reduces duplication across room ID, team name, chat message, and similar fields.
 */
const createSanitizedString = (maxLength: number, regex: RegExp, regexMessage: string) =>
    z.string()
        .min(1, 'Value is required')
        .max(maxLength)
        .transform((val: string) => removeControlChars(val).trim())
        .refine((val: string) => val.length >= 1, 'Value is required')
        .refine((val: string) => regex.test(val), regexMessage);

/**
 * Create a team name schema with consistent validation.
 */
const createTeamNameSchema = () =>
    createSanitizedString(VALIDATION.TEAM_NAME_MAX_LENGTH, teamNameRegex, 'Team name contains invalid characters');

/**
 * Create a room ID schema with consistent validation and lowercase normalization.
 * Uses toEnglishLowerCase() for locale-independent normalization, matching the
 * service layer (roomService.ts) and HTTP routes (roomRoutes.ts).
 */
const createRoomIdSchema = () =>
    z.string()
        .min(3, 'Room ID must be at least 3 characters')
        .max(20, 'Room ID must be at most 20 characters')
        .transform((val: string) => toEnglishLowerCase(removeControlChars(val).trim()))
        .refine((val: string) => val.length >= 3, 'Room ID must be at least 3 characters')
        .refine((val: string) => roomIdRegex.test(val), 'Room ID contains invalid characters');

/**
 * Create a validated nickname schema with reserved name checking
 * Used for all nickname inputs throughout the application
 */
const createNicknameSchema = (): ZodType.ZodEffects<ZodType.ZodEffects<ZodType.ZodEffects<ZodType.ZodEffects<ZodType.ZodString, string, string>, string, string>, string, string>, string, string> => z.string()
    .min(VALIDATION.NICKNAME_MIN_LENGTH, 'Nickname is required')
    .max(VALIDATION.NICKNAME_MAX_LENGTH, 'Nickname too long')
    .transform((val: string) => removeControlChars(val).trim())
    .refine((val: string) => val.length >= VALIDATION.NICKNAME_MIN_LENGTH, 'Nickname is required')
    .refine((val: string) => !/^\s*$/.test(val), 'Nickname cannot be only whitespace')
    .refine((val: string) => nicknameRegex.test(val), 'Nickname contains invalid characters')
    .refine((val: string) => !isReservedName(val, RESERVED_NAMES), 'This nickname is reserved');

/**
 * Validate turnTimer against game mode limits from GAME_MODE_CONFIG.
 * Blitz mode forces a 30s timer; classic/duet allow host-configured timers within mode bounds.
 */
const validateModeTimer = (data: { gameMode?: string; turnTimer?: number | null }, ctx: ZodType.RefinementCtx) => {
    if (data.turnTimer == null || data.gameMode == null) return;
    const modeConfig = GAME_MODE_CONFIG[data.gameMode as keyof typeof GAME_MODE_CONFIG];
    if (!modeConfig) return;

    if (modeConfig.forcedTurnTimer != null && data.turnTimer !== modeConfig.forcedTurnTimer) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${modeConfig.label} mode requires a ${modeConfig.forcedTurnTimer}s timer`,
            path: ['turnTimer']
        });
        return;
    }

    if (data.turnTimer < modeConfig.minTurnTimer || data.turnTimer > modeConfig.maxTurnTimer) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Timer must be between ${modeConfig.minTurnTimer}s and ${modeConfig.maxTurnTimer}s for ${modeConfig.label} mode`,
            path: ['turnTimer']
        });
    }
};

export {
    createSanitizedString,
    createTeamNameSchema,
    createRoomIdSchema,
    createNicknameSchema,
    validateModeTimer
};
