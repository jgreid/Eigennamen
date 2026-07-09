import type { z as ZodType } from 'zod';

import { z } from 'zod';
import { removeControlChars } from '../utils/sanitize';
import { createNicknameSchema } from './schemaHelpers';
import { PUBLIC_PLAYER_ID_REGEX } from '../services/player/publicId';

const playerTeamSchema = z.object({
    team: z.enum(['red', 'blue']).nullable(),
});

const playerRoleSchema = z.object({
    role: z.enum(['spymaster', 'clicker', 'advisor', 'observer', 'spectator']),
});

const playerTeamRoleSchema = z.object({
    team: z.enum(['red', 'blue']),
    role: z.enum(['spymaster', 'clicker', 'advisor']),
});

const playerNicknameSchema = z.object({
    nickname: createNicknameSchema(),
});

// Clients identify peers only by the opaque derived playerId (N1) — fixed-length
// lowercase hex. Peer sessionIds are never sent to clients, so no payload may
// carry one.
const playerIdRegex = PUBLIC_PLAYER_ID_REGEX;

// Player kick schema (for player:kick)
const playerKickSchema = z.object({
    targetPlayerId: z
        .string()
        .min(1, 'Target player ID is required')
        .max(100, 'Player ID too long')
        .transform((val: string) => removeControlChars(val).trim())
        .refine((val: string) => playerIdRegex.test(val), 'Invalid player ID format'),
});

// Spectator join request schema
const spectatorJoinRequestSchema = z.object({
    team: z.enum(['red', 'blue']),
});

// Spectator join approval/denial schema
const spectatorJoinResponseSchema = z.object({
    requesterId: z
        .string()
        .min(1, 'Requester ID is required')
        .max(100, 'Requester ID too long')
        .transform((val: string) => removeControlChars(val).trim())
        .refine((val: string) => playerIdRegex.test(val), 'Invalid requester ID format'),
    approved: z.boolean(),
    // Team the requester asked to join, echoed back by the host's client so the
    // server can seat the approved spectator. Optional/ignored on a denial.
    team: z.enum(['red', 'blue']).optional(),
});

// Type exports for schema inference
export type PlayerTeamInput = ZodType.infer<typeof playerTeamSchema>;
export type PlayerRoleInput = ZodType.infer<typeof playerRoleSchema>;
export type PlayerTeamRoleInput = ZodType.infer<typeof playerTeamRoleSchema>;
export type PlayerNicknameInput = ZodType.infer<typeof playerNicknameSchema>;
export type PlayerKickInput = ZodType.infer<typeof playerKickSchema>;
export type SpectatorJoinRequestInput = ZodType.infer<typeof spectatorJoinRequestSchema>;
export type SpectatorJoinResponseInput = ZodType.infer<typeof spectatorJoinResponseSchema>;

export {
    playerTeamSchema,
    playerRoleSchema,
    playerTeamRoleSchema,
    playerNicknameSchema,
    playerKickSchema,
    spectatorJoinRequestSchema,
    spectatorJoinResponseSchema,
};
