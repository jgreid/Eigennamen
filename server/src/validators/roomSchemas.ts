/**
 * Room Validation Schemas
 *
 * Zod schemas for room creation, joining, settings, reconnection,
 * and HTTP route parameter validation.
 */

import type { z as ZodType } from 'zod';

import { z } from 'zod';
import { TIMER } from '../config/constants';
import { removeControlChars, normalizeRoomCode } from '../utils/sanitize';
import { createRoomIdSchema, createTeamNameSchema, createNicknameSchema, validateModeTimer } from './schemaHelpers';

const roomCreateSchema = z.object({
    roomId: createRoomIdSchema(),
    settings: z.object({
        teamNames: z.object({
            red: createTeamNameSchema().default('Red'),
            blue: createTeamNameSchema().default('Blue')
        }).optional(),
        turnTimer: z.number().int().min(TIMER.MIN_TURN_SECONDS).max(TIMER.MAX_TURN_SECONDS).nullable().optional(),
        allowSpectators: z.boolean().optional(),
        wordListId: z.string().uuid().nullable().optional(),
        gameMode: z.enum(['classic', 'blitz', 'duet']).optional().default('classic'),
        nickname: createNicknameSchema().optional()
    }).superRefine(validateModeTimer).optional().default({ gameMode: 'classic' as const })
});

const roomJoinSchema = z.object({
    roomId: createRoomIdSchema(),
    nickname: createNicknameSchema()
});

const roomSettingsSchema = z.object({
    teamNames: z.object({
        red: createTeamNameSchema(),
        blue: createTeamNameSchema()
    }).optional(),
    turnTimer: z.number().int().min(TIMER.MIN_TURN_SECONDS).max(TIMER.MAX_TURN_SECONDS).nullable().optional(),
    allowSpectators: z.boolean().optional(),
    gameMode: z.enum(['classic', 'blitz', 'duet']).optional()
}).superRefine(validateModeTimer);

// Reconnection token is 64 hex characters (32 bytes in hex)
const reconnectionTokenRegex = /^[0-9a-f]{64}$/i;

const roomReconnectSchema = z.object({
    code: z.string()
        .min(3, 'Room code must be at least 3 characters')
        .max(20, 'Room code must be at most 20 characters')
        .transform((val: string) => normalizeRoomCode(removeControlChars(val))),
    reconnectionToken: z.string()
        .length(64, 'Invalid reconnection token format')
        .refine((val: string) => reconnectionTokenRegex.test(val), 'Invalid reconnection token format')
});

// HTTP route validation schema for room code parameter
const roomCodeSchema = z.object({
    code: z.string()
        .min(3, 'Room code must be at least 3 characters')
        .max(20, 'Room code must be at most 20 characters')
        .transform((val: string) => normalizeRoomCode(removeControlChars(val)))
});

// HTTP route validation schema for word list ID parameter
const wordListIdSchema = z.object({
    id: z.string().uuid('Invalid word list ID format')
});

// Type exports for schema inference
export type RoomCreateInput = ZodType.infer<typeof roomCreateSchema>;
export type RoomJoinInput = ZodType.infer<typeof roomJoinSchema>;
export type RoomSettingsInput = ZodType.infer<typeof roomSettingsSchema>;
export type RoomReconnectInput = ZodType.infer<typeof roomReconnectSchema>;

export {
    roomCreateSchema,
    roomJoinSchema,
    roomSettingsSchema,
    roomReconnectSchema,
    roomCodeSchema,
    wordListIdSchema
};
