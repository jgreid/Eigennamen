/**
 * Game Modes Tests
 *
 * Tests for the game mode system including Classic and Blitz modes.
 * Validates that mode-specific settings, timers, and constraints work correctly.
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
        test('defines classic and blitz game modes', () => {
            expect(GAME_MODES).toContain('classic');
            expect(GAME_MODES).toContain('blitz');
        });

        test('classic mode has no forced timer', () => {
            expect(GAME_MODE_CONFIG.classic.forcedTurnTimer).toBeNull();
        });

        test('blitz mode has a 30-second forced timer', () => {
            expect(GAME_MODE_CONFIG.blitz.forcedTurnTimer).toBe(30);
        });

        test('blitz mode timer bounds are both 30', () => {
            expect(GAME_MODE_CONFIG.blitz.minTurnTimer).toBe(30);
            expect(GAME_MODE_CONFIG.blitz.maxTurnTimer).toBe(30);
        });

        test('classic mode allows flexible timer range', () => {
            expect(GAME_MODE_CONFIG.classic.minTurnTimer).toBe(30);
            expect(GAME_MODE_CONFIG.classic.maxTurnTimer).toBe(300);
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

        test('roomCreateSchema accepts blitz mode', () => {
            const result = roomCreateSchema.safeParse({
                roomId: 'test-room',
                settings: { gameMode: 'blitz' }
            });
            expect(result.success).toBe(true);
            expect(result.data.settings.gameMode).toBe('blitz');
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

        test('roomSettingsSchema accepts gameMode', () => {
            const result = roomSettingsSchema.safeParse({
                gameMode: 'blitz'
            });
            expect(result.success).toBe(true);
            expect(result.data.gameMode).toBe('blitz');
        });

        test('roomSettingsSchema makes gameMode optional', () => {
            const result = roomSettingsSchema.safeParse({
                turnTimer: 60
            });
            expect(result.success).toBe(true);
            expect(result.data.gameMode).toBeUndefined();
        });
    });

    describe('Room Service - Game Mode Settings', () => {
        test('room creation defaults to classic mode', async () => {
            const hostSessionId = 'host-session-123';
            // Mock Redis eval for atomic create
            mockRedis.eval = jest.fn(async () => 1);
            // Mock player service
            jest.spyOn(require('../../services/playerService'), 'createPlayer')
                .mockResolvedValue(createMockPlayer({ sessionId: hostSessionId, isHost: true }));

            const result = await roomService.createRoom('testroom', hostSessionId, {});

            // The room object passed to redis.eval should have gameMode: 'classic'
            expect(result.room.settings.gameMode).toBe('classic');
        });

        test('room creation accepts blitz mode', async () => {
            const hostSessionId = 'host-session-456';
            mockRedis.eval = jest.fn(async () => 1);
            jest.spyOn(require('../../services/playerService'), 'createPlayer')
                .mockResolvedValue(createMockPlayer({ sessionId: hostSessionId, isHost: true }));

            const result = await roomService.createRoom('blitzroom', hostSessionId, {
                gameMode: 'blitz'
            });

            expect(result.room.settings.gameMode).toBe('blitz');
        });

        test('updateSettings enforces blitz timer when switching to blitz mode', async () => {
            // updateSettings now uses atomic Lua script via redis.eval
            mockRedis.eval = jest.fn(async () => JSON.stringify({
                success: true,
                settings: {
                    teamNames: { red: 'Red', blue: 'Blue' },
                    turnTimer: 30,
                    allowSpectators: true,
                    gameMode: 'blitz'
                }
            }));

            const result = await roomService.updateSettings('testroom', 'host-123', {
                gameMode: 'blitz'
            });

            expect(result.gameMode).toBe('blitz');
            expect(result.turnTimer).toBe(30);
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

        test('updateSettings allows switching from blitz back to classic', async () => {
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
                gameMode: 'classic',
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
                    turnTimer: 30,
                    allowSpectators: true,
                    gameMode: 'blitz'
                }
            }));

            const result = await roomService.updateSettings('testroom', 'host-123', {
                gameMode: 'blitz',
                someMaliciousKey: 'evil'
            } as AnyRecord);

            // gameMode should be allowed
            expect(result.gameMode).toBe('blitz');
            // malicious key should be rejected
            expect((result as AnyRecord).someMaliciousKey).toBeUndefined();
        });

        test('non-host cannot change game mode', async () => {
            mockRedis.eval = jest.fn(async () => JSON.stringify({ error: 'NOT_HOST' }));

            await expect(
                roomService.updateSettings('testroom', 'not-host-456', { gameMode: 'blitz' })
            ).rejects.toThrow();
        });
    });
});
