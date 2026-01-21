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
    gameClueSchema,
    chatMessageSchema
} = require('../validators/schemas');

describe('roomJoinSchema', () => {
    test('accepts valid room code and nickname', () => {
        // Note: Room codes exclude 0, 1, I, L, O to avoid confusion
        const result = roomJoinSchema.safeParse({
            code: 'ABC234',
            nickname: 'Player1'
        });
        expect(result.success).toBe(true);
        expect(result.data.code).toBe('ABC234');
        expect(result.data.nickname).toBe('Player1');
    });

    test('transforms code to uppercase', () => {
        const result = roomJoinSchema.safeParse({
            code: 'abc234',
            nickname: 'Player1'
        });
        expect(result.success).toBe(true);
        expect(result.data.code).toBe('ABC234');
    });

    test('trims nickname whitespace', () => {
        const result = roomJoinSchema.safeParse({
            code: 'ABC234',
            nickname: '  Player1  '
        });
        expect(result.success).toBe(true);
        expect(result.data.nickname).toBe('Player1');
    });

    test('rejects invalid code length', () => {
        const result = roomJoinSchema.safeParse({
            code: 'ABC',
            nickname: 'Player1'
        });
        expect(result.success).toBe(false);
    });

    test('rejects invalid code characters', () => {
        const result = roomJoinSchema.safeParse({
            code: 'ABC-23',
            nickname: 'Player1'
        });
        expect(result.success).toBe(false);
    });

    test('rejects empty nickname', () => {
        const result = roomJoinSchema.safeParse({
            code: 'ABC234',
            nickname: ''
        });
        expect(result.success).toBe(false);
    });

    test('rejects too long nickname', () => {
        const result = roomJoinSchema.safeParse({
            code: 'ABC234',
            nickname: 'A'.repeat(31)
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

describe('gameClueSchema', () => {
    test('accepts valid clue', () => {
        const result = gameClueSchema.safeParse({
            word: 'Animal',
            number: 3
        });
        expect(result.success).toBe(true);
        expect(result.data.word).toBe('Animal');
        expect(result.data.number).toBe(3);
    });

    test('accepts zero as number', () => {
        const result = gameClueSchema.safeParse({
            word: 'Unlimited',
            number: 0
        });
        expect(result.success).toBe(true);
    });

    test('accepts hyphenated words', () => {
        const result = gameClueSchema.safeParse({
            word: 'well-known',
            number: 2
        });
        expect(result.success).toBe(true);
    });

    test('accepts words with spaces', () => {
        const result = gameClueSchema.safeParse({
            word: 'Ice Cream',
            number: 1
        });
        expect(result.success).toBe(true);
    });

    test('trims whitespace', () => {
        const result = gameClueSchema.safeParse({
            word: '  Animal  ',
            number: 2
        });
        expect(result.success).toBe(true);
        expect(result.data.word).toBe('Animal');
    });

    test('rejects empty word', () => {
        const result = gameClueSchema.safeParse({
            word: '',
            number: 2
        });
        expect(result.success).toBe(false);
    });

    test('rejects word with numbers', () => {
        const result = gameClueSchema.safeParse({
            word: 'Test123',
            number: 2
        });
        expect(result.success).toBe(false);
    });

    test('rejects word with special characters', () => {
        const result = gameClueSchema.safeParse({
            word: 'Test@Word',
            number: 2
        });
        expect(result.success).toBe(false);
    });

    test('rejects negative number', () => {
        const result = gameClueSchema.safeParse({
            word: 'Animal',
            number: -1
        });
        expect(result.success).toBe(false);
    });

    test('rejects number too large', () => {
        const result = gameClueSchema.safeParse({
            word: 'Animal',
            number: 26
        });
        expect(result.success).toBe(false);
    });

    test('removes control characters from clue', () => {
        const result = gameClueSchema.safeParse({
            word: 'Ani\x00mal',
            number: 2
        });
        expect(result.success).toBe(true);
        expect(result.data.word).toBe('Animal');
    });
});

describe('chatMessageSchema', () => {
    test('accepts valid message', () => {
        const result = chatMessageSchema.safeParse({
            text: 'Hello team!'
        });
        expect(result.success).toBe(true);
        expect(result.data.teamOnly).toBe(false); // default
    });

    test('accepts team-only message', () => {
        const result = chatMessageSchema.safeParse({
            text: 'Secret strategy',
            teamOnly: true
        });
        expect(result.success).toBe(true);
        expect(result.data.teamOnly).toBe(true);
    });

    test('trims whitespace', () => {
        const result = chatMessageSchema.safeParse({
            text: '  Hello  '
        });
        expect(result.success).toBe(true);
        expect(result.data.text).toBe('Hello');
    });

    test('rejects empty message', () => {
        const result = chatMessageSchema.safeParse({
            text: ''
        });
        expect(result.success).toBe(false);
    });

    test('rejects too long message', () => {
        const result = chatMessageSchema.safeParse({
            text: 'A'.repeat(501)
        });
        expect(result.success).toBe(false);
    });

    test('removes control characters from message', () => {
        const result = chatMessageSchema.safeParse({
            text: 'Hello\x00World'
        });
        expect(result.success).toBe(true);
        expect(result.data.text).toBe('HelloWorld');
    });
});

describe('roomCreateSchema', () => {
    test('accepts empty settings', () => {
        const result = roomCreateSchema.safeParse({});
        expect(result.success).toBe(true);
    });

    test('accepts custom team names', () => {
        const result = roomCreateSchema.safeParse({
            settings: {
                teamNames: {
                    red: 'Fire',
                    blue: 'Ice'
                }
            }
        });
        expect(result.success).toBe(true);
        expect(result.data.settings.teamNames.red).toBe('Fire');
    });

    test('rejects team names too long', () => {
        const result = roomCreateSchema.safeParse({
            settings: {
                teamNames: {
                    red: 'A'.repeat(21),
                    blue: 'Blue'
                }
            }
        });
        expect(result.success).toBe(false);
    });

    test('accepts valid turn timer', () => {
        const result = roomCreateSchema.safeParse({
            settings: {
                turnTimer: 60
            }
        });
        expect(result.success).toBe(true);
    });

    test('rejects turn timer too short', () => {
        const result = roomCreateSchema.safeParse({
            settings: {
                turnTimer: 10
            }
        });
        expect(result.success).toBe(false);
    });

    test('rejects turn timer too long', () => {
        const result = roomCreateSchema.safeParse({
            settings: {
                turnTimer: 600
            }
        });
        expect(result.success).toBe(false);
    });

    test('accepts room with password', () => {
        const result = roomCreateSchema.safeParse({
            settings: {
                password: 'secret123'
            }
        });
        expect(result.success).toBe(true);
        expect(result.data.settings.password).toBe('secret123');
    });

    test('accepts empty password', () => {
        const result = roomCreateSchema.safeParse({
            settings: {
                password: ''
            }
        });
        expect(result.success).toBe(true);
    });

    test('rejects password too long', () => {
        const result = roomCreateSchema.safeParse({
            settings: {
                password: 'A'.repeat(51)
            }
        });
        expect(result.success).toBe(false);
    });
});

describe('roomJoinSchema password validation', () => {
    test('accepts join with password', () => {
        const result = roomJoinSchema.safeParse({
            code: 'ABC234',
            nickname: 'Player1',
            password: 'secret123'
        });
        expect(result.success).toBe(true);
        expect(result.data.password).toBe('secret123');
    });

    test('accepts join without password', () => {
        const result = roomJoinSchema.safeParse({
            code: 'ABC234',
            nickname: 'Player1'
        });
        expect(result.success).toBe(true);
        expect(result.data.password).toBeUndefined();
    });

    test('rejects password too long', () => {
        const result = roomJoinSchema.safeParse({
            code: 'ABC234',
            nickname: 'Player1',
            password: 'A'.repeat(51)
        });
        expect(result.success).toBe(false);
    });
});

describe('roomSettingsSchema', () => {
    test('accepts valid settings with password', () => {
        const result = roomSettingsSchema.safeParse({
            password: 'secret123'
        });
        expect(result.success).toBe(true);
        expect(result.data.password).toBe('secret123');
    });

    test('accepts null password to remove it', () => {
        const result = roomSettingsSchema.safeParse({
            password: null
        });
        expect(result.success).toBe(true);
        expect(result.data.password).toBeNull();
    });

    test('accepts team names with password', () => {
        const result = roomSettingsSchema.safeParse({
            teamNames: {
                red: 'Fire',
                blue: 'Ice'
            },
            password: 'secret'
        });
        expect(result.success).toBe(true);
        expect(result.data.teamNames.red).toBe('Fire');
        expect(result.data.password).toBe('secret');
    });

    test('accepts turn timer setting', () => {
        const result = roomSettingsSchema.safeParse({
            turnTimer: 120
        });
        expect(result.success).toBe(true);
        expect(result.data.turnTimer).toBe(120);
    });

    test('rejects invalid turn timer', () => {
        const result = roomSettingsSchema.safeParse({
            turnTimer: 10
        });
        expect(result.success).toBe(false);
    });

    test('accepts allowSpectators setting', () => {
        const result = roomSettingsSchema.safeParse({
            allowSpectators: false
        });
        expect(result.success).toBe(true);
        expect(result.data.allowSpectators).toBe(false);
    });
});
