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
    // Must stay in sync with setRole.lua, validators/playerSchemas.ts and the Role
    // type. Omitting 'advisor'/'observer' here made getPlayer() treat those records
    // as corrupted and delete them (breaking advisor bots and human observers).
    role: z.enum(['spymaster', 'clicker', 'advisor', 'observer', 'spectator']),
    isHost: z.boolean(),
    connected: z.boolean(),
    lastSeen: z.number(),
    joinedAt: z.number().optional(),
    createdAt: z.number().optional(),
    connectedAt: z.number().optional(),
    disconnectedAt: z.number().optional(),
    lastIP: z.string().optional(),
    userId: z.string().optional(),
    isBot: z.boolean().optional(),
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
 * Host transfer Lua result schema.
 *
 * hostTransfer.lua returns `{success:true, oldHost, newHost}` on success or
 * `{success:false, reason}` on failure. Only `success` and `reason` are consumed
 * by callers (the failure reason is logged in disconnectHandler), so the schema
 * preserves `reason`. The previous schema declared `error`/`newHostSessionId`/
 * `newHostNickname`, which the script never emits, and omitted `reason`, so the
 * real failure reason was silently stripped and logged as `undefined`.
 */
export const hostTransferResultSchema = z.object({
    success: z.boolean(),
    reason: z.string().optional(),
});
