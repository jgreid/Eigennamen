/**
 * Unit Tests for Validation Schemas
 */

const {
    roomCreateSchema,
    roomJoinSchema,
    roomSettingsSchema,
    playerTeamSchema,
    playerRoleSchema,
    playerNicknameSchema,
    gameRevealSchema,
    chatMessageSchema,
} = require('../../validators/schemas');
const { VALIDATION } = require('../../config/constants');

describe('roomJoinSchema', () => {
    test('accepts valid room ID and nickname', () => {
        const result = roomJoinSchema.safeParse({
            roomId: 'my-room',
            nickname: 'Player1',
        });
        expect(result.success).toBe(true);
        expect(result.data.roomId).toBe('my-room');
        expect(result.data.nickname).toBe('Player1');
    });

    test('trims room ID whitespace', () => {
        const result = roomJoinSchema.safeParse({
            roomId: '  my-room  ',
            nickname: 'Player1',
        });
        expect(result.success).toBe(true);
        expect(result.data.roomId).toBe('my-room');
    });

    test('trims nickname whitespace', () => {
        const result = roomJoinSchema.safeParse({
            roomId: 'my-room',
            nickname: '  Player1  ',
        });
        expect(result.success).toBe(true);
        expect(result.data.nickname).toBe('Player1');
    });

    test('rejects room ID too short', () => {
        const result = roomJoinSchema.safeParse({
            roomId: 'AB',
            nickname: 'Player1',
        });
        expect(result.success).toBe(false);
    });

    test('accepts room ID with hyphen and underscore', () => {
        const result = roomJoinSchema.safeParse({
            roomId: 'my-room_123',
            nickname: 'Player1',
        });
        expect(result.success).toBe(true);
    });

    test('rejects empty nickname', () => {
        const result = roomJoinSchema.safeParse({
            roomId: 'my-room',
            nickname: '',
        });
        expect(result.success).toBe(false);
    });

    test('rejects too long nickname', () => {
        const result = roomJoinSchema.safeParse({
            roomId: 'my-room',
            nickname: 'A'.repeat(31),
        });
        expect(result.success).toBe(false);
    });
});

describe('playerTeamSchema', () => {
    test('accepts red team', () => {
        const result = playerTeamSchema.safeParse({ team: 'red' });
        expect(result.success).toBe(true);
        expect(result.data.team).toBe('red');
    });

    test('accepts blue team', () => {
        const result = playerTeamSchema.safeParse({ team: 'blue' });
        expect(result.success).toBe(true);
        expect(result.data.team).toBe('blue');
    });

    test('accepts null team', () => {
        const result = playerTeamSchema.safeParse({ team: null });
        expect(result.success).toBe(true);
        expect(result.data.team).toBeNull();
    });

    test('rejects invalid team', () => {
        const result = playerTeamSchema.safeParse({ team: 'green' });
        expect(result.success).toBe(false);
    });
});

describe('playerNicknameSchema', () => {
    test('accepts valid nickname', () => {
        const result = playerNicknameSchema.safeParse({ nickname: 'Player1' });
        expect(result.success).toBe(true);
        expect(result.data.nickname).toBe('Player1');
    });

    test('trims whitespace', () => {
        const result = playerNicknameSchema.safeParse({ nickname: '  Player1  ' });
        expect(result.success).toBe(true);
        expect(result.data.nickname).toBe('Player1');
    });

    test('rejects empty nickname', () => {
        const result = playerNicknameSchema.safeParse({ nickname: '' });
        expect(result.success).toBe(false);
    });

    test('rejects too long nickname', () => {
        const result = playerNicknameSchema.safeParse({ nickname: 'A'.repeat(31) });
        expect(result.success).toBe(false);
    });

    test('rejects reserved names (admin)', () => {
        const result = playerNicknameSchema.safeParse({ nickname: 'admin' });
        expect(result.success).toBe(false);
    });

    test('rejects reserved names case-insensitively', () => {
        const result = playerNicknameSchema.safeParse({ nickname: 'ADMIN' });
        expect(result.success).toBe(false);
    });

    test('rejects system reserved name', () => {
        const result = playerNicknameSchema.safeParse({ nickname: 'system' });
        expect(result.success).toBe(false);
    });

    test('rejects moderator reserved name', () => {
        const result = playerNicknameSchema.safeParse({ nickname: 'Moderator' });
        expect(result.success).toBe(false);
    });

    test('removes control characters', () => {
        const result = playerNicknameSchema.safeParse({ nickname: 'Player\x00Name' });
        expect(result.success).toBe(true);
        expect(result.data.nickname).toBe('PlayerName');
    });

    test('rejects whitespace-only nickname', () => {
        const result = playerNicknameSchema.safeParse({ nickname: '   ' });
        expect(result.success).toBe(false);
    });

    test('accepts nickname with hyphens and underscores', () => {
        const result = playerNicknameSchema.safeParse({ nickname: 'Player-Name_123' });
        expect(result.success).toBe(true);
    });

    test('rejects nickname with special characters', () => {
        const result = playerNicknameSchema.safeParse({ nickname: 'Player@Name' });
        expect(result.success).toBe(false);
    });
});

describe('playerRoleSchema', () => {
    test('accepts spymaster role', () => {
        const result = playerRoleSchema.safeParse({ role: 'spymaster' });
        expect(result.success).toBe(true);
    });

    test('accepts clicker role', () => {
        const result = playerRoleSchema.safeParse({ role: 'clicker' });
        expect(result.success).toBe(true);
    });

    test('accepts spectator role', () => {
        const result = playerRoleSchema.safeParse({ role: 'spectator' });
        expect(result.success).toBe(true);
    });

    test('rejects invalid role', () => {
        const result = playerRoleSchema.safeParse({ role: 'admin' });
        expect(result.success).toBe(false);
    });
});

describe('gameRevealSchema', () => {
    test('accepts valid index', () => {
        const result = gameRevealSchema.safeParse({ index: 0 });
        expect(result.success).toBe(true);
    });

    test('accepts max valid index', () => {
        const result = gameRevealSchema.safeParse({ index: 24 });
        expect(result.success).toBe(true);
    });

    test('rejects negative index', () => {
        const result = gameRevealSchema.safeParse({ index: -1 });
        expect(result.success).toBe(false);
    });

    test('rejects index too large', () => {
        const result = gameRevealSchema.safeParse({ index: 25 });
        expect(result.success).toBe(false);
    });

    test('rejects non-integer', () => {
        const result = gameRevealSchema.safeParse({ index: 1.5 });
        expect(result.success).toBe(false);
    });
});

describe('chatMessageSchema', () => {
    test('accepts valid message', () => {
        const result = chatMessageSchema.safeParse({
            text: 'Hello team!',
        });
        expect(result.success).toBe(true);
        expect(result.data.teamOnly).toBe(false); // default
    });

    test('accepts team-only message', () => {
        const result = chatMessageSchema.safeParse({
            text: 'Secret strategy',
            teamOnly: true,
        });
        expect(result.success).toBe(true);
        expect(result.data.teamOnly).toBe(true);
    });

    test('trims whitespace', () => {
        const result = chatMessageSchema.safeParse({
            text: '  Hello  ',
        });
        expect(result.success).toBe(true);
        expect(result.data.text).toBe('Hello');
    });

    test('rejects empty message', () => {
        const result = chatMessageSchema.safeParse({
            text: '',
        });
        expect(result.success).toBe(false);
    });

    test('rejects too long message', () => {
        const result = chatMessageSchema.safeParse({
            text: 'A'.repeat(501),
        });
        expect(result.success).toBe(false);
    });

    test('removes control characters from message', () => {
        const result = chatMessageSchema.safeParse({
            text: 'Hello\x00World',
        });
        expect(result.success).toBe(true);
        expect(result.data.text).toBe('HelloWorld');
    });
});

describe('roomCreateSchema', () => {
    test('requires roomId', () => {
        const result = roomCreateSchema.safeParse({});
        expect(result.success).toBe(false);
    });

    test('accepts valid roomId with default settings', () => {
        const result = roomCreateSchema.safeParse({
            roomId: 'my-game',
        });
        expect(result.success).toBe(true);
        expect(result.data.roomId).toBe('my-game');
    });

    test('accepts custom team names', () => {
        const result = roomCreateSchema.safeParse({
            roomId: 'my-game',
            settings: {
                teamNames: {
                    red: 'Fire',
                    blue: 'Ice',
                },
            },
        });
        expect(result.success).toBe(true);
        expect(result.data.settings.teamNames.red).toBe('Fire');
    });

    test('rejects team names too long', () => {
        const result = roomCreateSchema.safeParse({
            roomId: 'my-game',
            settings: {
                teamNames: {
                    red: 'A'.repeat(VALIDATION.TEAM_NAME_MAX_LENGTH + 1),
                    blue: 'Blue',
                },
            },
        });
        expect(result.success).toBe(false);
    });

    test('accepts valid turn timer', () => {
        const result = roomCreateSchema.safeParse({
            roomId: 'my-game',
            settings: {
                turnTimer: 60,
            },
        });
        expect(result.success).toBe(true);
    });

    test('rejects turn timer too short', () => {
        const result = roomCreateSchema.safeParse({
            roomId: 'my-game',
            settings: {
                turnTimer: 10,
            },
        });
        expect(result.success).toBe(false);
    });

    test('rejects turn timer too long', () => {
        const result = roomCreateSchema.safeParse({
            roomId: 'my-game',
            settings: {
                turnTimer: 601,
            },
        });
        expect(result.success).toBe(false);
    });

    test('rejects roomId too short', () => {
        const result = roomCreateSchema.safeParse({
            roomId: 'AB',
        });
        expect(result.success).toBe(false);
    });

    test('rejects roomId too long', () => {
        const result = roomCreateSchema.safeParse({
            roomId: 'A'.repeat(21),
        });
        expect(result.success).toBe(false);
    });

    test('accepts roomId with allowed characters', () => {
        const result = roomCreateSchema.safeParse({
            roomId: 'My-Game_123',
        });
        expect(result.success).toBe(true);
    });
});

describe('roomSettingsSchema', () => {
    test('accepts valid settings with turn timer', () => {
        const result = roomSettingsSchema.safeParse({
            turnTimer: 90,
        });
        expect(result.success).toBe(true);
        expect(result.data.turnTimer).toBe(90);
    });

    test('accepts null turn timer to disable it', () => {
        const result = roomSettingsSchema.safeParse({
            turnTimer: null,
        });
        expect(result.success).toBe(true);
        expect(result.data.turnTimer).toBeNull();
    });

    test('accepts team names with turn timer', () => {
        const result = roomSettingsSchema.safeParse({
            teamNames: {
                red: 'Fire',
                blue: 'Ice',
            },
            turnTimer: 90,
        });
        expect(result.success).toBe(true);
        expect(result.data.teamNames.red).toBe('Fire');
        expect(result.data.turnTimer).toBe(90);
    });

    test('accepts turn timer setting', () => {
        const result = roomSettingsSchema.safeParse({
            turnTimer: 120,
        });
        expect(result.success).toBe(true);
        expect(result.data.turnTimer).toBe(120);
    });

    test('rejects invalid turn timer', () => {
        const result = roomSettingsSchema.safeParse({
            turnTimer: 10,
        });
        expect(result.success).toBe(false);
    });

    test('accepts allowSpectators setting', () => {
        const result = roomSettingsSchema.safeParse({
            allowSpectators: false,
        });
        expect(result.success).toBe(true);
        expect(result.data.allowSpectators).toBe(false);
    });
});
