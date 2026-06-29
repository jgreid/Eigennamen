/**
 * Bot Handlers Unit Tests — host-only bot:add / bot:remove.
 */

const { SAFE_ERROR_CODES, createMockRateLimitHandler } = require('../helpers/mocks');
jest.mock('../../socket/rateLimitHandler', () => ({
    createRateLimitedHandler: createMockRateLimitHandler(SAFE_ERROR_CODES),
}));

jest.mock('../../services/botService');
jest.mock('../../services/playerService');
jest.mock('../../services/gameService');
jest.mock('../../socket/gameMutationNotifier', () => ({ notifyGameMutation: jest.fn(), onGameMutation: jest.fn() }));
jest.mock('../../utils/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

jest.mock('../../socket/socketFunctionProvider', () => ({
    getSocketFunctions: jest.fn(() => ({
        startTurnTimer: jest.fn().mockResolvedValue({}),
        stopTurnTimer: jest.fn().mockResolvedValue(),
        emitToRoom: jest.fn(),
        emitToPlayer: jest.fn(),
        getTimerStatus: jest.fn().mockResolvedValue(null),
        getIO: jest.fn(),
    })),
    isRegistered: jest.fn(() => true),
}));

const botService = require('../../services/botService');
const playerService = require('../../services/playerService');
const gameService = require('../../services/gameService');
const { clearGameStateCache } = require('../../socket/playerContext');

describe('Bot Handlers', () => {
    let mockSocket;
    let mockIo;
    let botHandlers;

    beforeEach(() => {
        jest.clearAllMocks();
        clearGameStateCache();

        mockSocket = {
            id: 'socket-1',
            sessionId: 'host-session',
            roomCode: 'ROOM12',
            emit: jest.fn(),
            on: jest.fn(),
            join: jest.fn(),
            leave: jest.fn(),
        };
        mockIo = { to: jest.fn().mockReturnThis(), emit: jest.fn() };

        // Default: requester is the host
        playerService.getPlayer.mockResolvedValue({
            sessionId: 'host-session',
            roomCode: 'ROOM12',
            nickname: 'Host',
            team: 'red',
            role: 'spectator',
            isHost: true,
        });
        playerService.getPlayersInRoom.mockResolvedValue([]);
        playerService.getRoomStats.mockResolvedValue({});
        gameService.getGame.mockResolvedValue(null);

        botHandlers = require('../../socket/handlers/botHandlers');
        botHandlers(mockIo, mockSocket);
    });

    function handlerFor(event) {
        return mockSocket.on.mock.calls.find((c) => c[0] === event)?.[1];
    }

    it('registers bot:add and bot:remove', () => {
        expect(handlerFor('bot:add')).toBeDefined();
        expect(handlerFor('bot:remove')).toBeDefined();
    });

    it('adds a bot and broadcasts it as a player join (host)', async () => {
        const bot = {
            sessionId: 'bot-1',
            nickname: 'Greedy Bot',
            team: 'red',
            role: 'clicker',
            isHost: false,
            connected: true,
            isBot: true,
        };
        botService.addBot.mockResolvedValue(bot);

        await handlerFor('bot:add')({
            team: 'red',
            role: 'clicker',
            strategyId: 'greedyClicker',
            skillPreset: 'expert',
        });

        expect(botService.addBot).toHaveBeenCalledWith(
            'ROOM12',
            expect.objectContaining({
                team: 'red',
                role: 'clicker',
                strategyId: 'greedyClicker',
                skillPreset: 'expert',
            })
        );
        expect(mockIo.to).toHaveBeenCalledWith('room:ROOM12');
        expect(mockIo.emit).toHaveBeenCalledWith('room:playerJoined', { player: bot });
    });

    it('rejects bot:add from a non-host', async () => {
        playerService.getPlayer.mockResolvedValue({
            sessionId: 'host-session',
            roomCode: 'ROOM12',
            nickname: 'NotHost',
            isHost: false,
        });

        await handlerFor('bot:add')({
            team: 'red',
            role: 'clicker',
            strategyId: 'greedyClicker',
            skillPreset: 'expert',
        });

        expect(botService.addBot).not.toHaveBeenCalled();
    });

    it('removes a bot and broadcasts the departure (host)', async () => {
        botService.removeBot.mockResolvedValue(undefined);

        await handlerFor('bot:remove')({ sessionId: 'bot-1' });

        expect(botService.removeBot).toHaveBeenCalledWith('ROOM12', 'bot-1');
        expect(mockIo.emit).toHaveBeenCalledWith('room:playerLeft', expect.objectContaining({ sessionId: 'bot-1' }));
    });
});
