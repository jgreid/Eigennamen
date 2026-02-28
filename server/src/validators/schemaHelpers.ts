import type { z as ZodType } from 'zod';

import { z } from 'zod';
import { VALIDATION, RESERVED_NAMES, GAME_MODE_CONFIG } from '../config/constants';
import { NICKNAME_REGEX, ROOM_CODE_REGEX, TEAM_NAME_REGEX } from '../shared';
import { removeControlChars, isReservedName, normalizeRoomCode } from '../utils/sanitize';

// Re-export z for external use
export { z };

// Regex patterns sourced from shared module (single source of truth for frontend + backend)
const teamNameRegex = TEAM_NAME_REGEX;
const roomIdRegex = ROOM_CODE_REGEX;
const nicknameRegex = NICKNAME_REGEX;

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
        .transform((val: string) => normalizeRoomCode(removeControlChars(val)))
        .refine((val: string) => val.length >= 3, 'Room ID must be at least 3 characters')
        .refine((val: string) => roomIdRegex.test(val), 'Room ID contains invalid characters');

/**
 * Create a validated nickname schema with reserved name checking
 * Used for all nickname inputs throughout the application
 */
const createNicknameSchema = () => z.string()
    .min(VALIDATION.NICKNAME_MIN_LENGTH, 'Nickname is required')
    .max(VALIDATION.NICKNAME_MAX_LENGTH, 'Nickname too long')
    .transform((val: string) => removeControlChars(val).trim())
    .refine((val: string) => val.length >= VALIDATION.NICKNAME_MIN_LENGTH, 'Nickname is required')
    .refine((val: string) => !/^\s*$/.test(val), 'Nickname cannot be only whitespace')
    .refine((val: string) => nicknameRegex.test(val), 'Nickname contains invalid characters')
    .refine((val: string) => !isReservedName(val, [...RESERVED_NAMES]), 'This nickname is reserved');

/**
 * Validate turnTimer bounds (if provided).
 * Timer is optional for all modes; when set, must be within global bounds
 * (enforced by the Zod min/max on the turnTimer field itself).
 */
const validateModeTimer = (data: { gameMode?: string; turnTimer?: number | null }, _ctx: ZodType.RefinementCtx) => {
    if (data.turnTimer == null || data.gameMode == null) return;
    const modeConfig = GAME_MODE_CONFIG[data.gameMode as keyof typeof GAME_MODE_CONFIG];
    if (!modeConfig) return;
};

export {
    createSanitizedString,
    createTeamNameSchema,
    createRoomIdSchema,
    createNicknameSchema,
    validateModeTimer
};
