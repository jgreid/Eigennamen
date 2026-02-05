/**
 * TypeScript Types Generated from Zod Schemas
 *
 * This file provides TypeScript types inferred from the Zod validation schemas.
 * These types ensure consistency between runtime validation and compile-time checking.
 *
 * Usage:
 *   import type { RoomCreateInput, GameClueInput } from './schemas.types';
 */

import { z } from 'zod';

// Import schemas - using require for CommonJS compatibility
// eslint-disable-next-line @typescript-eslint/no-var-requires
const schemas = require('./schemas');

// ============================================================================
// Room Schema Types
// ============================================================================

/**
 * Input type for room:create event
 */
export type RoomCreateInput = z.infer<typeof schemas.roomCreateSchema>;

/**
 * Input type for room:join event
 */
export type RoomJoinInput = z.infer<typeof schemas.roomJoinSchema>;

/**
 * Input type for room:settings event
 */
export type RoomSettingsInput = z.infer<typeof schemas.roomSettingsSchema>;

/**
 * Input type for room:reconnect event
 */
export type RoomReconnectInput = z.infer<typeof schemas.roomReconnectSchema>;

// ============================================================================
// Player Schema Types
// ============================================================================

/**
 * Input type for player:setTeam event
 */
export type PlayerTeamInput = z.infer<typeof schemas.playerTeamSchema>;

/**
 * Input type for player:setRole event
 */
export type PlayerRoleInput = z.infer<typeof schemas.playerRoleSchema>;

/**
 * Input type for player:setNickname event
 */
export type PlayerNicknameInput = z.infer<typeof schemas.playerNicknameSchema>;

/**
 * Input type for player:kick event
 */
export type PlayerKickInput = z.infer<typeof schemas.playerKickSchema>;

// ============================================================================
// Game Schema Types
// ============================================================================

/**
 * Input type for game:start event
 */
export type GameStartInput = z.infer<typeof schemas.gameStartSchema>;

/**
 * Input type for game:reveal event
 */
export type GameRevealInput = z.infer<typeof schemas.gameRevealSchema>;

/**
 * Input type for game:clue event
 */
export type GameClueInput = z.infer<typeof schemas.gameClueSchema>;

/**
 * Input type for game:getHistory event
 */
export type GameHistoryLimitInput = z.infer<typeof schemas.gameHistoryLimitSchema>;

/**
 * Input type for game:getReplay event
 */
export type GameReplayInput = z.infer<typeof schemas.gameReplaySchema>;

// ============================================================================
// Chat Schema Types
// ============================================================================

/**
 * Input type for chat:message event
 */
export type ChatMessageInput = z.infer<typeof schemas.chatMessageSchema>;

/**
 * Input type for chat:spectator event
 */
export type SpectatorChatInput = z.infer<typeof schemas.spectatorChatSchema>;

// ============================================================================
// Timer Schema Types
// ============================================================================

/**
 * Input type for timer:addTime event
 */
export type TimerAddTimeInput = z.infer<typeof schemas.timerAddTimeSchema>;

// ============================================================================
// Re-export schema objects with types
// ============================================================================

export {
    schemas as validationSchemas
};

// ============================================================================
// Type-safe validation helper
// ============================================================================

/**
 * Result of a Zod parse operation
 */
export type ZodParseResult<T> =
    | { success: true; data: T }
    | { success: false; error: z.ZodError };

/**
 * Validate data against a Zod schema with type inference
 * @param schema - Zod schema to validate against
 * @param data - Data to validate
 * @returns Parse result with typed data
 */
export function validateWithSchema<T extends z.ZodType>(
    schema: T,
    data: unknown
): ZodParseResult<z.infer<T>> {
    const result = schema.safeParse(data);
    if (result.success) {
        return { success: true, data: result.data };
    }
    return { success: false, error: result.error };
}

// ============================================================================
// Extracted nested types for convenience
// ============================================================================

/**
 * Team names object type
 */
export interface TeamNamesInput {
    red?: string;
    blue?: string;
}

/**
 * Room settings for creation
 */
export interface CreateRoomSettingsInput {
    teamNames?: TeamNamesInput;
    turnTimer?: number | null;
    allowSpectators?: boolean;
    wordListId?: string | null;
    nickname?: string;
}
