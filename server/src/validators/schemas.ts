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
export { z, createSanitizedString, createTeamNameSchema, createRoomIdSchema, createNicknameSchema } from './schemaHelpers';

// Re-export room schemas
export { roomCreateSchema, roomJoinSchema, roomSettingsSchema, roomReconnectSchema, roomCodeSchema, wordListIdSchema } from './roomSchemas';

// Re-export player schemas
export { playerTeamSchema, playerRoleSchema, playerNicknameSchema, playerKickSchema, spectatorJoinRequestSchema, spectatorJoinResponseSchema } from './playerSchemas';

// Re-export game schemas
export { gameStartSchema, gameRevealSchema, gameClueSchema, gameHistoryLimitSchema, gameReplaySchema } from './gameSchemas';

// Re-export chat schemas
export { chatMessageSchema, spectatorChatSchema } from './chatSchemas';

// Re-export timer schemas
export { timerAddTimeSchema } from './timerSchemas';

// Re-export types from domain files
export type { RoomCreateInput, RoomJoinInput, RoomSettingsInput, RoomReconnectInput } from './roomSchemas';
export type { PlayerTeamInput, PlayerRoleInput, PlayerNicknameInput, PlayerKickInput, SpectatorJoinRequestInput, SpectatorJoinResponseInput } from './playerSchemas';
export type { GameStartInput, GameRevealInput, GameClueInput, GameHistoryLimitInput, GameReplayInput } from './gameSchemas';
export type { ChatMessageInput, SpectatorChatInput } from './chatSchemas';
export type { TimerAddTimeInput } from './timerSchemas';
