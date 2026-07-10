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
const { notifyGameMutation } = require('../../socket/gameMutationNotifier');
const { clearGameStateCache } = require('../../socket/playerContext');
const { derivePlayerId } = require('../../services/player/publicId');

describe('Bot Handlers', () => {
    let mockSocket;
    let mockIo;
    let botHandlers;

    beforeEach(() => {
        jest.clearAllMocks();
        clearGameStateCache();

        // Public-player projection used at peer-broadcast sites (N2) — pass through.
        playerService.toPublicPlayer.mockImplementation((p) => p);
        playerService.toPublicPlayers.mockImplementation((arr) => arr);

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
        const botPlayerId = derivePlayerId('bot-1');
        botService.removeBot.mockResolvedValue(undefined);
        // Handler resolves the client-supplied opaque playerId back to the bot (N1).
        playerService.findPlayerByPublicId.mockResolvedValue({
            sessionId: 'bot-1',
            roomCode: 'ROOM12',
            nickname: 'Greedy Bot',
            team: 'red',
            role: 'clicker',
            isBot: true,
            connected: true,
        });

        await handlerFor('bot:remove')({ playerId: botPlayerId });

        expect(playerService.findPlayerByPublicId).toHaveBeenCalledWith('ROOM12', botPlayerId);
        expect(botService.removeBot).toHaveBeenCalledWith('ROOM12', 'bot-1');
        expect(mockIo.emit).toHaveBeenCalledWith('room:playerLeft', expect.objectContaining({ playerId: botPlayerId }));
        // Roster in the departure broadcast goes through the public projection (N2).
        expect(playerService.toPublicPlayers).toHaveBeenCalled();
    });

    it('rejects bot:remove for a playerId not in the room', async () => {
        playerService.findPlayerByPublicId.mockResolvedValue(null);

        await handlerFor('bot:remove')({ playerId: derivePlayerId('not-here') });

        expect(botService.removeBot).not.toHaveBeenCalled();
    });

    describe('removing the acting bot mid-turn warns the room (N25)', () => {
        const redSpymasterBot = {
            sessionId: 'bot-1',
            roomCode: 'ROOM12',
            nickname: 'SpyBot',
            team: 'red',
            role: 'spymaster',
            isBot: true,
            connected: true,
        };

        it('emits SEAT_VACATED + nudges the controller when the removed bot held the current turn seat', async () => {
            botService.removeBot.mockResolvedValue(undefined);
            playerService.findPlayerByPublicId.mockResolvedValue(redSpymasterBot);
            // Live game, red's clue phase (no clue yet → the pending seat is the
            // spymaster) — exactly the seat the removed bot occupied.
            gameService.getGame.mockResolvedValue({
                id: 'game-1',
                gameOver: false,
                paused: false,
                currentTurn: 'red',
                currentClue: null,
            });

            await handlerFor('bot:remove')({ playerId: derivePlayerId('bot-1') });

            expect(mockIo.emit).toHaveBeenCalledWith(
                'room:warning',
                expect.objectContaining({ code: 'SEAT_VACATED', team: 'red' })
            );
            // The controller is nudged so a remaining/re-added bot re-evaluates.
            expect(notifyGameMutation).toHaveBeenCalledWith('ROOM12');
        });

        it('does NOT warn when the removed bot did not hold the pending seat, but still nudges', async () => {
            botService.removeBot.mockResolvedValue(undefined);
            // An advisor bot — never the acting seat — is removed mid-game.
            playerService.findPlayerByPublicId.mockResolvedValue({
                ...redSpymasterBot,
                sessionId: 'adv-1',
                role: 'advisor',
            });
            gameService.getGame.mockResolvedValue({
                id: 'game-1',
                gameOver: false,
                paused: false,
                currentTurn: 'red',
                currentClue: null,
            });

            await handlerFor('bot:remove')({ playerId: derivePlayerId('adv-1') });

            expect(mockIo.emit).not.toHaveBeenCalledWith('room:warning', expect.anything());
            expect(notifyGameMutation).toHaveBeenCalledWith('ROOM12');
        });

        it('does nothing extra when there is no live game', async () => {
            botService.removeBot.mockResolvedValue(undefined);
            playerService.findPlayerByPublicId.mockResolvedValue(redSpymasterBot);
            gameService.getGame.mockResolvedValue(null);

            await handlerFor('bot:remove')({ playerId: derivePlayerId('bot-1') });

            expect(mockIo.emit).not.toHaveBeenCalledWith('room:warning', expect.anything());
            expect(notifyGameMutation).not.toHaveBeenCalled();
        });
    });
});
