// Re-export shared helpers
export {
    z,
    createSanitizedString,
    createTeamNameSchema,
    createRoomIdSchema,
    createNicknameSchema,
} from './schemaHelpers';

// Re-export room schemas
export {
    roomCreateSchema,
    roomJoinSchema,
    roomSettingsSchema,
    roomReconnectSchema,
    roomCodeSchema,
} from './roomSchemas';

// Re-export player schemas
export {
    playerTeamSchema,
    playerRoleSchema,
    playerTeamRoleSchema,
    playerNicknameSchema,
    playerKickSchema,
    spectatorJoinRequestSchema,
    spectatorJoinResponseSchema,
} from './playerSchemas';

// Re-export game schemas
export {
    gameStartSchema,
    gameRevealSchema,
    gameClueSchema,
    gameHistoryLimitSchema,
    gameReplaySchema,
    gameForfeitSchema,
    gameReadySchema,
} from './gameSchemas';

// Re-export bot schemas
export { botConfigSchema, botAddSchema, botRemoveSchema } from './botSchemas';
export type { BotAddInput, BotRemoveInput } from './botSchemas';

// Re-export chat schemas
export { chatMessageSchema, spectatorChatSchema } from './chatSchemas';

// Re-export timer schemas
export { timerAddTimeSchema } from './timerSchemas';

// Re-export types from domain files
export type { RoomCreateInput, RoomJoinInput, RoomSettingsInput, RoomReconnectInput } from './roomSchemas';
export type {
    PlayerTeamInput,
    PlayerRoleInput,
    PlayerTeamRoleInput,
    PlayerNicknameInput,
    PlayerKickInput,
    SpectatorJoinRequestInput,
    SpectatorJoinResponseInput,
} from './playerSchemas';
export type {
    GameStartInput,
    GameRevealInput,
    GameClueInput,
    GameHistoryLimitInput,
    GameReplayInput,
    GameForfeitInput,
    GameReadyInput,
} from './gameSchemas';
export type { ChatMessageInput, SpectatorChatInput } from './chatSchemas';
export type { TimerAddTimeInput } from './timerSchemas';
