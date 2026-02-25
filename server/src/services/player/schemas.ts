import { z } from 'zod';

/**
 * Zod schema for Player data from Redis.
 * Validates critical fields when present; non-essential fields are optional
 * so tests with sparse mocks still pass. No .passthrough() — unknown keys are stripped.
 */
export const playerSchema = z.object({
    sessionId: z.string(),
    roomCode: z.string(),
    nickname: z.string(),
    team: z.enum(['red', 'blue']).nullable(),
    role: z.enum(['spymaster', 'clicker', 'spectator']),
    isHost: z.boolean(),
    connected: z.boolean(),
    lastSeen: z.number(),
    joinedAt: z.number().optional(),
    createdAt: z.number().optional(),
    connectedAt: z.number().optional(),
    disconnectedAt: z.number().optional(),
    lastIP: z.string().optional(),
    userId: z.string().optional(),
});

/**
 * Lua script result schema (used by setTeam, setRole)
 */
export const luaResultSchema = z.object({
    success: z.boolean(),
    error: z.string().optional(),
    reason: z.string().optional(),
    player: playerSchema.optional(),
    existingNickname: z.string().optional(),
});

/**
 * Host transfer Lua result schema
 */
export const hostTransferResultSchema = z.object({
    success: z.boolean(),
    error: z.string().optional(),
    newHostSessionId: z.string().optional(),
    newHostNickname: z.string().optional(),
});
