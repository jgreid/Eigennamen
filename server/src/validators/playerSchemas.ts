/**
 * Player Validation Schemas
 *
 * Zod schemas for player team assignment, role changes,
 * nickname updates, kick actions, and spectator join flows.
 */

import type { z as ZodType } from 'zod';

const { z } = require('zod');
const { removeControlChars } = require('../utils/sanitize');
const { createNicknameSchema } = require('./schemaHelpers');

const playerTeamSchema = z.object({
    team: z.enum(['red', 'blue']).nullable()
});

const playerRoleSchema = z.object({
    role: z.enum(['spymaster', 'clicker', 'spectator'])
});

const playerNicknameSchema = z.object({
    nickname: createNicknameSchema()
});

// Session ID regex - alphanumeric, hyphens, underscores (not strict UUID format)
const sessionIdRegex = /^[a-zA-Z0-9\-_]+$/;

// Player kick schema (for player:kick)
const playerKickSchema = z.object({
    targetSessionId: z.string()
        .min(1, 'Target session ID is required')
        .max(100, 'Session ID too long')
        .transform((val: string) => removeControlChars(val).trim())
        .refine((val: string) => sessionIdRegex.test(val), 'Invalid session ID format')
});

// Spectator join request schema
const spectatorJoinRequestSchema = z.object({
    team: z.enum(['red', 'blue'])
});

// Spectator join approval/denial schema
const spectatorJoinResponseSchema = z.object({
    requesterId: z.string().min(1, 'Requester ID is required').max(100),
    approved: z.boolean()
});

// Type exports for schema inference
export type PlayerTeamInput = ZodType.infer<typeof playerTeamSchema>;
export type PlayerRoleInput = ZodType.infer<typeof playerRoleSchema>;
export type PlayerNicknameInput = ZodType.infer<typeof playerNicknameSchema>;
export type PlayerKickInput = ZodType.infer<typeof playerKickSchema>;
export type SpectatorJoinRequestInput = ZodType.infer<typeof spectatorJoinRequestSchema>;
export type SpectatorJoinResponseInput = ZodType.infer<typeof spectatorJoinResponseSchema>;

export {
    playerTeamSchema,
    playerRoleSchema,
    playerNicknameSchema,
    playerKickSchema,
    spectatorJoinRequestSchema,
    spectatorJoinResponseSchema
};
