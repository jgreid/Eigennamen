/**
 * Input Validation Schemas (Zod) - Barrel Re-export
 *
 * All schemas are organized by domain in separate files:
 *   - schemaHelpers: Shared utilities (createSanitizedString, createNicknameSchema, etc.)
 *   - roomSchemas: Room creation, joining, settings, reconnection
 *   - playerSchemas: Team, role, nickname, kick, spectator
 *   - gameSchemas: Start, reveal, clue, history, replay
 *   - chatSchemas: Chat messages, spectator chat
 *   - timerSchemas: Timer add-time
 *
 * This barrel file re-exports everything for backwards compatibility.
 */

// Re-export shared helpers
const {
    z,
    createSanitizedString,
    createTeamNameSchema,
    createRoomIdSchema,
    createNicknameSchema
} = require('./schemaHelpers');

// Re-export room schemas
const {
    roomCreateSchema,
    roomJoinSchema,
    roomSettingsSchema,
    roomReconnectSchema,
    roomCodeSchema,
    wordListIdSchema
} = require('./roomSchemas');

// Re-export player schemas
const {
    playerTeamSchema,
    playerRoleSchema,
    playerNicknameSchema,
    playerKickSchema,
    spectatorJoinRequestSchema,
    spectatorJoinResponseSchema
} = require('./playerSchemas');

// Re-export game schemas
const {
    gameStartSchema,
    gameRevealSchema,
    gameClueSchema,
    gameHistoryLimitSchema,
    gameReplaySchema
} = require('./gameSchemas');

// Re-export chat schemas
const {
    chatMessageSchema,
    spectatorChatSchema
} = require('./chatSchemas');

// Re-export timer schemas
const {
    timerAddTimeSchema
} = require('./timerSchemas');

// Re-export z for external use
export { z };

// Re-export types from domain files
export type { RoomCreateInput, RoomJoinInput, RoomSettingsInput, RoomReconnectInput } from './roomSchemas';
export type { PlayerTeamInput, PlayerRoleInput, PlayerNicknameInput, PlayerKickInput, SpectatorJoinRequestInput, SpectatorJoinResponseInput } from './playerSchemas';
export type { GameStartInput, GameRevealInput, GameClueInput, GameHistoryLimitInput, GameReplayInput } from './gameSchemas';
export type { ChatMessageInput, SpectatorChatInput } from './chatSchemas';
export type { TimerAddTimeInput } from './timerSchemas';

export {
    createSanitizedString,
    createTeamNameSchema,
    createRoomIdSchema,
    createNicknameSchema,
    roomCreateSchema,
    roomJoinSchema,
    roomSettingsSchema,
    roomReconnectSchema,
    roomCodeSchema,
    wordListIdSchema,
    playerTeamSchema,
    playerRoleSchema,
    playerNicknameSchema,
    playerKickSchema,
    spectatorJoinRequestSchema,
    spectatorJoinResponseSchema,
    gameStartSchema,
    gameRevealSchema,
    gameClueSchema,
    gameHistoryLimitSchema,
    gameReplaySchema,
    chatMessageSchema,
    spectatorChatSchema,
    timerAddTimeSchema
};
