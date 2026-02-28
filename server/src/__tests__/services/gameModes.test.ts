/**
 * Game Modes Tests
 *
 * Tests for the game mode system including Classic and Duet modes.
 * Validates that mode-specific settings and constraints work correctly.
 */

const { createMockRedis, createMockPlayer } = require('../helpers/mocks');


type AnyRecord = Record<string, any>;

// Mock Redis
let mockRedis: AnyRecord;

jest.mock('../../config/redis', () => ({
    getRedis: () => mockRedis
}));

jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => ({
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    }))
}));

const { GAME_MODES, GAME_MODE_CONFIG } = require('../../config/constants');
const roomService = require('../../services/roomService');
const { roomCreateSchema, roomSettingsSchema } = require('../../validators/schemas');

describe('Game Modes', () => {
    beforeEach(() => {
        mockRedis = createMockRedis();
        jest.clearAllMocks();
    });

    describe('Constants', () => {
        test('defines classic, duet, and match game modes', () => {
            expect(GAME_MODES).toContain('classic');
            expect(GAME_MODES).toContain('duet');
            expect(GAME_MODES).toContain('match');
            expect(GAME_MODES).not.toContain('blitz');
        });

        test('classic mode is not cooperative', () => {
            expect(GAME_MODE_CONFIG.classic.cooperative).toBe(false);
        });

        test('duet mode is cooperative', () => {
            expect(GAME_MODE_CONFIG.duet.cooperative).toBe(true);
        });

        test('match mode is not cooperative', () => {
            expect(GAME_MODE_CONFIG.match.cooperative).toBe(false);
        });
    });

    describe('Validation', () => {
        test('roomCreateSchema accepts classic mode', () => {
            const result = roomCreateSchema.safeParse({
                roomId: 'test-room',
                settings: { gameMode: 'classic' }
            });
            expect(result.success).toBe(true);
            expect(result.data.settings.gameMode).toBe('classic');
        });

        test('roomCreateSchema accepts duet mode', () => {
            const result = roomCreateSchema.safeParse({
                roomId: 'test-room',
                settings: { gameMode: 'duet' }
            });
            expect(result.success).toBe(true);
            expect(result.data.settings.gameMode).toBe('duet');
        });

        test('roomCreateSchema accepts match mode', () => {
            const result = roomCreateSchema.safeParse({
                roomId: 'test-room',
                settings: { gameMode: 'match' }
            });
            expect(result.success).toBe(true);
            expect(result.data.settings.gameMode).toBe('match');
        });

        test('roomCreateSchema defaults to classic mode', () => {
            const result = roomCreateSchema.safeParse({
                roomId: 'test-room'
            });
            expect(result.success).toBe(true);
            expect(result.data.settings.gameMode).toBe('classic');
        });

        test('roomCreateSchema rejects invalid game mode', () => {
            const result = roomCreateSchema.safeParse({
                roomId: 'test-room',
                settings: { gameMode: 'invalid' }
            });
            expect(result.success).toBe(false);
        });

        test('roomCreateSchema rejects blitz mode', () => {
            const result = roomCreateSchema.safeParse({
                roomId: 'test-room',
                settings: { gameMode: 'blitz' }
            });
            expect(result.success).toBe(false);
        });

        test('roomSettingsSchema accepts gameMode', () => {
            const result = roomSettingsSchema.safeParse({
                gameMode: 'duet'
            });
            expect(result.success).toBe(true);
            expect(result.data.gameMode).toBe('duet');
        });

        test('roomSettingsSchema makes gameMode optional', () => {
            const result = roomSettingsSchema.safeParse({
                turnTimer: 60
            });
            expect(result.success).toBe(true);
            expect(result.data.gameMode).toBeUndefined();
        });

        test('roomSettingsSchema accepts turnTimer within bounds', () => {
            const result = roomSettingsSchema.safeParse({
                turnTimer: 120
            });
            expect(result.success).toBe(true);
            expect(result.data.turnTimer).toBe(120);
        });

        test('roomSettingsSchema accepts turnTimer at min bound (20s)', () => {
            const result = roomSettingsSchema.safeParse({
                turnTimer: 20
            });
            expect(result.success).toBe(true);
        });

        test('roomSettingsSchema accepts turnTimer at max bound (600s)', () => {
            const result = roomSettingsSchema.safeParse({
                turnTimer: 600
            });
            expect(result.success).toBe(true);
        });

        test('roomSettingsSchema rejects turnTimer below min', () => {
            const result = roomSettingsSchema.safeParse({
                turnTimer: 10
            });
            expect(result.success).toBe(false);
        });
    });

    describe('Room Service - Game Mode Settings', () => {
        test('room creation defaults to classic mode', async () => {
            const hostSessionId = 'host-session-123';
            mockRedis.eval = jest.fn(async () => 1);
            jest.spyOn(require('../../services/playerService'), 'createPlayer')
                .mockResolvedValue(createMockPlayer({ sessionId: hostSessionId, isHost: true }));

            const result = await roomService.createRoom('testroom', hostSessionId, {});

            expect(result.room.settings.gameMode).toBe('classic');
        });

        test('room creation accepts duet mode', async () => {
            const hostSessionId = 'host-session-456';
            mockRedis.eval = jest.fn(async () => 1);
            jest.spyOn(require('../../services/playerService'), 'createPlayer')
                .mockResolvedValue(createMockPlayer({ sessionId: hostSessionId, isHost: true }));

            const result = await roomService.createRoom('duetroom', hostSessionId, {
                gameMode: 'duet'
            });

            expect(result.room.settings.gameMode).toBe('duet');
        });

        test('updateSettings preserves custom timer in classic mode', async () => {
            mockRedis.eval = jest.fn(async () => JSON.stringify({
                success: true,
                settings: {
                    teamNames: { red: 'Red', blue: 'Blue' },
                    turnTimer: 180,
                    allowSpectators: true,
                    gameMode: 'classic'
                }
            }));

            const result = await roomService.updateSettings('testroom', 'host-123', {
                turnTimer: 180
            });

            expect(result.gameMode).toBe('classic');
            expect(result.turnTimer).toBe(180);
        });

        test('updateSettings allows disabling timer', async () => {
            mockRedis.eval = jest.fn(async () => JSON.stringify({
                success: true,
                settings: {
                    teamNames: { red: 'Red', blue: 'Blue' },
                    turnTimer: null,
                    allowSpectators: true,
                    gameMode: 'classic'
                }
            }));

            const result = await roomService.updateSettings('testroom', 'host-123', {
                turnTimer: null
            });

            expect(result.gameMode).toBe('classic');
            expect(result.turnTimer).toBeNull();
        });

        test('updateSettings includes gameMode in allowed keys', async () => {
            mockRedis.eval = jest.fn(async () => JSON.stringify({
                success: true,
                settings: {
                    teamNames: { red: 'Red', blue: 'Blue' },
                    turnTimer: null,
                    allowSpectators: true,
                    gameMode: 'duet'
                }
            }));

            const result = await roomService.updateSettings('testroom', 'host-123', {
                gameMode: 'duet',
                someMaliciousKey: 'evil'
            } as AnyRecord);

            expect(result.gameMode).toBe('duet');
            expect((result as AnyRecord).someMaliciousKey).toBeUndefined();
        });

        test('non-host cannot change game mode', async () => {
            mockRedis.eval = jest.fn(async () => JSON.stringify({ error: 'NOT_HOST' }));

            await expect(
                roomService.updateSettings('testroom', 'not-host-456', { gameMode: 'duet' })
            ).rejects.toThrow();
        });
    });
});
