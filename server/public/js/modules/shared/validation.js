export const NICKNAME_MIN_LENGTH = 1;
export const NICKNAME_MAX_LENGTH = 30;
export const ROOM_CODE_MIN_LENGTH = 3;
export const ROOM_CODE_MAX_LENGTH = 20;
export const CHAT_MESSAGE_MAX_LENGTH = 500;
export const TEAM_NAME_MAX_LENGTH = 32;
export const NICKNAME_REGEX = /^[\p{L}\p{N}\s\-_]+$/u;
export const ROOM_CODE_REGEX = /^[\p{L}\p{N}\-_]+$/u;
export const TEAM_NAME_REGEX = /^[\p{L}\p{N}\s\-]+$/u;
export const RESERVED_NAMES = [
    'admin', 'administrator', 'system', 'host', 'server',
    'mod', 'moderator', 'bot', 'eigennamen', 'game',
    'official', 'support', 'help', 'null', 'undefined'
];
//# sourceMappingURL=validation.js.map