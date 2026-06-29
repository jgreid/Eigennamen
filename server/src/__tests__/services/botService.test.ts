/**
 * Tests for botService: adding/removing bots as first-class room members and
 * reading their config. Redis and playerService are mocked.
 */
const { ERROR_CODES } = require('../../config/constants');

const mockRedis = {
    set: jest.fn().mockResolvedValue('OK'),
    sAdd: jest.fn().mockResolvedValue(1),
    sRem: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    del: jest.fn().mockResolvedValue(1),
    get: jest.fn(),
    eval: jest.fn().mockResolvedValue(1),
};

jest.mock('../../config/redis', () => ({ getRedis: () => mockRedis }));
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../services/playerService', () => ({
    getPlayersInRoom: jest.fn(),
    getPlayer: jest.fn(),
    removePlayer: jest.fn(),
}));

const playerService = require('../../services/playerService');
const { addBot, removeBot, getBotConfig } = require('../../services/botService');

describe('botService.addBot', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockRedis.set.mockResolvedValue('OK');
        mockRedis.sAdd.mockResolvedValue(1);
        mockRedis.sRem.mockResolvedValue(1);
        mockRedis.expire.mockResolvedValue(1);
        mockRedis.eval.mockResolvedValue(1);
        playerService.getPlayersInRoom.mockResolvedValue([]);
    });

    it('creates a bot player on the requested team/role', async () => {
        const bot = await addBot('ROOM01', {
            team: 'red',
            role: 'clicker',
            strategyId: 'greedyClicker',
            skillPreset: 'expert',
        });

        expect(bot.isBot).toBe(true);
        expect(bot.team).toBe('red');
        expect(bot.role).toBe('clicker');
        expect(bot.connected).toBe(true);
        expect(bot.sessionId.startsWith('bot-')).toBe(true);
        expect(bot.nickname).toContain('Greedy');

        // Atomic join (player record + players-set insertion + capacity check).
        expect(mockRedis.eval).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                keys: ['room:ROOM01:players', 'room:ROOM01'],
                arguments: expect.arrayContaining([bot.sessionId, `player:${bot.sessionId}`]),
            })
        );
        // Added to the team set.
        expect(mockRedis.sAdd).toHaveBeenCalledWith('room:ROOM01:team:red', bot.sessionId);
        // Config persisted under bot:{sessionId}:cfg.
        expect(mockRedis.set).toHaveBeenCalledWith(
            `bot:${bot.sessionId}:cfg`,
            expect.any(String),
            expect.objectContaining({ EX: expect.any(Number) })
        );
    });

    it('rejects when the room is at capacity', async () => {
        mockRedis.eval.mockResolvedValue(0); // atomic join: room full
        await expect(
            addBot('ROOM01', { team: 'red', role: 'clicker', strategyId: 'randomClicker', skillPreset: 'novice' })
        ).rejects.toMatchObject({ code: ERROR_CODES.ROOM_FULL });
    });

    it('rejects when the room no longer exists', async () => {
        mockRedis.eval.mockResolvedValue(-2); // atomic join: room deleted
        await expect(
            addBot('ROOM01', { team: 'red', role: 'clicker', strategyId: 'randomClicker', skillPreset: 'novice' })
        ).rejects.toMatchObject({ code: ERROR_CODES.ROOM_NOT_FOUND });
    });

    it('rolls back the bot when a follow-up write fails', async () => {
        mockRedis.eval.mockResolvedValue(1); // join succeeded
        mockRedis.set.mockRejectedValueOnce(new Error('cfg write failed')); // cfg blob fails
        await expect(
            addBot('ROOM01', { team: 'blue', role: 'spymaster', strategyId: 'randomSpymaster', skillPreset: 'novice' })
        ).rejects.toThrow('cfg write failed');
        // Player + set memberships are cleaned up so no half-bot is left behind.
        expect(mockRedis.sRem).toHaveBeenCalledWith('room:ROOM01:players', expect.stringMatching(/^bot-/));
        expect(mockRedis.sRem).toHaveBeenCalledWith('room:ROOM01:team:blue', expect.stringMatching(/^bot-/));
        expect(mockRedis.del).toHaveBeenCalledWith(expect.stringMatching(/^player:bot-/));
    });
});

describe('botService.removeBot', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockRedis.del.mockResolvedValue(1);
        playerService.removePlayer.mockResolvedValue(undefined);
    });

    it('removes a bot and deletes its config', async () => {
        playerService.getPlayer.mockResolvedValue({ sessionId: 'bot-1', roomCode: 'ROOM01', isBot: true });
        await removeBot('ROOM01', 'bot-1');
        expect(playerService.removePlayer).toHaveBeenCalledWith('bot-1');
        expect(mockRedis.del).toHaveBeenCalledWith('bot:bot-1:cfg');
    });

    it('refuses to remove a non-bot player', async () => {
        playerService.getPlayer.mockResolvedValue({ sessionId: 'p1', roomCode: 'ROOM01', isBot: false });
        await expect(removeBot('ROOM01', 'p1')).rejects.toMatchObject({ code: ERROR_CODES.INVALID_INPUT });
        expect(playerService.removePlayer).not.toHaveBeenCalled();
    });

    it('throws when the bot is not found in the room', async () => {
        playerService.getPlayer.mockResolvedValue(null);
        await expect(removeBot('ROOM01', 'ghost')).rejects.toMatchObject({ code: ERROR_CODES.PLAYER_NOT_FOUND });
    });
});

describe('botService.getBotConfig', () => {
    beforeEach(() => jest.clearAllMocks());

    it('parses a stored config', async () => {
        mockRedis.get.mockResolvedValue(
            JSON.stringify({ strategyId: 'greedyClicker', skillPreset: 'expert', seed: 7 })
        );
        const cfg = await getBotConfig('bot-1');
        expect(cfg).toMatchObject({ strategyId: 'greedyClicker', skillPreset: 'expert', seed: 7 });
    });

    it('returns null when there is no config', async () => {
        mockRedis.get.mockResolvedValue(null);
        expect(await getBotConfig('bot-1')).toBeNull();
    });
});
