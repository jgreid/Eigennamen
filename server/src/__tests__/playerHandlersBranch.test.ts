/**
 * Player Handlers Branch Coverage Tests
 *
 * Tests additional branches in playerHandlers.ts including:
 * - setTeam: shouldCheckEmpty logic, role changed by team switch, setTeam returns null
 * - setRole: idempotent skip, canChangeTeamOrRole blocked, setRole returns null,
 *   spymaster view with game over, no game
 * - setNickname: setNickname returns null
 * - kick: target socket not found in sockets map
 */

// Mock rate limit handler to bypass rate limiting and capture handler functions
const SAFE_ERROR_CODES_MOCK = ['RATE_LIMITED', 'ROOM_NOT_FOUND', 'ROOM_FULL', 'NOT_HOST', 'NOT_YOUR_TURN', 'GAME_OVER', 'INVALID_INPUT', 'CARD_ALREADY_REVEALED', 'NOT_SPYMASTER', 'NOT_CLICKER', 'NOT_AUTHORIZED', 'SESSION_EXPIRED', 'PLAYER_NOT_FOUND', 'GAME_IN_PROGRESS', 'VALIDATION_ERROR', 'CANNOT_SWITCH_TEAM_DURING_TURN', 'CANNOT_CHANGE_ROLE_DURING_TURN', 'SPYMASTER_CANNOT_CHANGE_TEAM', 'GAME_NOT_STARTED'];
jest.mock('../socket/rateLimitHandler', () => ({
    createRateLimitedHandler: jest.fn((socket: any, eventName: string, handler: any) => {
        return async (data: any) => {
            try {
                return await handler(data);
            } catch (error: any) {
                const errorEvent = `${eventName.split(':')[0]}:error`;
                const code = error.code || 'SERVER_ERROR';
                const isSafe = SAFE_ERROR_CODES_MOCK.includes(code);
                socket.emit(errorEvent, {
                    code,
                    message: isSafe ? (error.message || 'An unexpected error occurred') : 'An unexpected error occurred'
                });
            }
        };
    })
}));

jest.mock('../services/playerService');
jest.mock('../services/gameService');
jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const playerService = require('../services/playerService');
const gameService = require('../services/gameService');

describe('Player Handlers Branch Coverage', () => {
    let mockIo: any;
    let mockSocket: any;
    let eventHandlers: Record<string, any>;

    beforeEach(() => {
        jest.clearAllMocks();

        mockSocket = {
            id: 'socket-1',
            sessionId: 'session-1',
            roomCode: 'TEST12',
            on: jest.fn((event: string, handler: any) => {
                if (!eventHandlers) eventHandlers = {};
                eventHandlers[event] = handler;
            }),
            emit: jest.fn(),
            join: jest.fn(),
            leave: jest.fn()
        };

        mockIo = {
            to: jest.fn().mockReturnValue({
                emit: jest.fn()
            }),
            sockets: {
                sockets: new Map()
            }
        };

        eventHandlers = {};

        // Default mocks
        playerService.getPlayer.mockResolvedValue({
            sessionId: 'session-1',
            nickname: 'TestPlayer',
            roomCode: 'TEST12',
            team: 'red',
            role: 'clicker',
            isHost: false
        });
        playerService.setTeam.mockResolvedValue({
            sessionId: 'session-1',
            nickname: 'TestPlayer',
            team: 'blue',
            role: 'clicker'
        });
        playerService.setRole.mockResolvedValue({
            sessionId: 'session-1',
            nickname: 'TestPlayer',
            roomCode: 'TEST12',
            role: 'spymaster'
        });
        playerService.setNickname.mockResolvedValue({
            sessionId: 'session-1',
            nickname: 'NewNickname',
            roomCode: 'TEST12'
        });
        playerService.getPlayersInRoom.mockResolvedValue([]);
        playerService.getSocketId.mockResolvedValue(null);
        playerService.removePlayer.mockResolvedValue();
        playerService.getRoomStats.mockResolvedValue({});

        gameService.getGame.mockResolvedValue(null);

        // Load handlers
        const playerHandlers = require('../socket/handlers/playerHandlers');
        playerHandlers(mockIo, mockSocket);
    });

    describe('player:setTeam - shouldCheckEmpty branch', () => {
        it('should set shouldCheckEmpty true when switching teams during active game', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                nickname: 'TestPlayer',
                roomCode: 'TEST12',
                team: 'red',
                role: 'clicker',
                isHost: false
            });
            gameService.getGame.mockResolvedValue({
                gameOver: false,
                currentTurn: 'blue'
            });

            await eventHandlers['player:setTeam']({ team: 'blue' });

            // shouldCheckEmpty should be true: game exists, not game over,
            // player has team, team is different
            expect(playerService.setTeam).toHaveBeenCalledWith('session-1', 'blue', true);
        });

        it('should set shouldCheckEmpty false when no game', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                nickname: 'TestPlayer',
                roomCode: 'TEST12',
                team: 'red',
                role: 'clicker',
                isHost: false
            });
            gameService.getGame.mockResolvedValue(null);

            await eventHandlers['player:setTeam']({ team: 'blue' });

            expect(playerService.setTeam).toHaveBeenCalledWith('session-1', 'blue', false);
        });

        it('should set shouldCheckEmpty false when game is over', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                nickname: 'TestPlayer',
                roomCode: 'TEST12',
                team: 'red',
                role: 'clicker',
                isHost: false
            });
            gameService.getGame.mockResolvedValue({ gameOver: true });

            await eventHandlers['player:setTeam']({ team: 'blue' });

            expect(playerService.setTeam).toHaveBeenCalledWith('session-1', 'blue', false);
        });

        it('should set shouldCheckEmpty false when switching to same team', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                nickname: 'TestPlayer',
                roomCode: 'TEST12',
                team: 'red',
                role: 'clicker',
                isHost: false
            });
            gameService.getGame.mockResolvedValue({ gameOver: false, currentTurn: 'blue' });

            await eventHandlers['player:setTeam']({ team: 'red' });

            // Same team, so shouldCheckEmpty = false
            expect(playerService.setTeam).toHaveBeenCalledWith('session-1', 'red', false);
        });

        it('should set shouldCheckEmpty false when player has no team', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                nickname: 'TestPlayer',
                roomCode: 'TEST12',
                team: null,
                role: 'spectator',
                isHost: false
            });
            gameService.getGame.mockResolvedValue({ gameOver: false, currentTurn: 'blue' });

            await eventHandlers['player:setTeam']({ team: 'blue' });

            // No previous team, so shouldCheckEmpty = false
            expect(playerService.setTeam).toHaveBeenCalledWith('session-1', 'blue', false);
        });
    });

    describe('player:setTeam - role change included', () => {
        it('should include role in changes when role changed by team switch', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                nickname: 'TestPlayer',
                roomCode: 'TEST12',
                team: 'red',
                role: 'spymaster', // was spymaster
                isHost: false
            });
            // After team switch, role is reset to spectator
            playerService.setTeam.mockResolvedValue({
                sessionId: 'session-1',
                nickname: 'TestPlayer',
                team: 'blue',
                role: 'spectator' // role changed
            });
            gameService.getGame.mockResolvedValue({ gameOver: true });

            await eventHandlers['player:setTeam']({ team: 'blue' });

            expect(mockIo.to().emit).toHaveBeenCalledWith('player:updated', {
                sessionId: 'session-1',
                changes: { team: 'blue', role: 'spectator' }
            });
        });

        it('should not include role in changes when role unchanged', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                nickname: 'TestPlayer',
                roomCode: 'TEST12',
                team: 'red',
                role: 'clicker',
                isHost: false
            });
            playerService.setTeam.mockResolvedValue({
                sessionId: 'session-1',
                nickname: 'TestPlayer',
                team: 'blue',
                role: 'clicker' // role unchanged
            });

            await eventHandlers['player:setTeam']({ team: 'blue' });

            expect(mockIo.to().emit).toHaveBeenCalledWith('player:updated', {
                sessionId: 'session-1',
                changes: { team: 'blue' }
            });
        });
    });

    describe('player:setTeam - setTeam returns null', () => {
        it('should emit error when setTeam returns null', async () => {
            playerService.setTeam.mockResolvedValue(null);

            await eventHandlers['player:setTeam']({ team: 'blue' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', {
                code: 'PLAYER_NOT_FOUND',
                message: 'Player not found'
            });
        });
    });

    describe('player:setRole - idempotent skip', () => {
        it('should skip canChangeTeamOrRole check when already has requested role', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                nickname: 'TestPlayer',
                roomCode: 'TEST12',
                team: 'red',
                role: 'spymaster', // already spymaster
                isHost: false
            });
            gameService.getGame.mockResolvedValue({
                gameOver: false,
                currentTurn: 'red' // it's this player's turn
            });

            await eventHandlers['player:setRole']({ role: 'spymaster' });

            // Should still succeed even though it would normally block
            expect(playerService.setRole).toHaveBeenCalledWith('session-1', 'spymaster');
        });
    });

    describe('player:setRole - blocked by canChangeTeamOrRole', () => {
        it('should block role change during active turn for clicker', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                nickname: 'TestPlayer',
                roomCode: 'TEST12',
                team: 'red',
                role: 'clicker',
                isHost: false
            });
            gameService.getGame.mockResolvedValue({
                gameOver: false,
                currentTurn: 'red' // it's this player's turn
            });

            await eventHandlers['player:setRole']({ role: 'spectator' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', {
                code: 'CANNOT_CHANGE_ROLE_DURING_TURN',
                message: expect.stringContaining('Cannot change')
            });
        });
    });

    describe('player:setRole - setRole returns null', () => {
        it('should emit error when setRole returns null', async () => {
            playerService.setRole.mockResolvedValue(null);

            await eventHandlers['player:setRole']({ role: 'clicker' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', {
                code: 'PLAYER_NOT_FOUND',
                message: 'Player not found'
            });
        });
    });

    describe('player:setRole - spymaster view with no active game', () => {
        it('should not send spymaster view when no game', async () => {
            playerService.setRole.mockResolvedValue({
                sessionId: 'session-1',
                nickname: 'TestPlayer',
                roomCode: 'TEST12',
                role: 'spymaster'
            });
            gameService.getGame.mockResolvedValue(null);

            await eventHandlers['player:setRole']({ role: 'spymaster' });

            expect(mockSocket.emit).not.toHaveBeenCalledWith('game:spymasterView', expect.anything());
        });
    });

    describe('player:setNickname - setNickname returns null', () => {
        it('should emit error when setNickname returns null', async () => {
            playerService.setNickname.mockResolvedValue(null);

            await eventHandlers['player:setNickname']({ nickname: 'NewName' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', {
                code: 'PLAYER_NOT_FOUND',
                message: 'Player not found'
            });
        });
    });

    describe('player:kick - socket ID found but socket not in map', () => {
        it('should handle case where socket ID exists but socket not found in sockets map', async () => {
            playerService.getPlayer.mockReset();
            playerService.getPlayer
                .mockResolvedValueOnce({
                    sessionId: 'session-1',
                    nickname: 'Host',
                    roomCode: 'TEST12',
                    isHost: true
                })
                .mockResolvedValueOnce({
                    sessionId: 'session-2',
                    nickname: 'Target',
                    roomCode: 'TEST12',
                    isHost: false
                });
            playerService.getSocketId.mockResolvedValue('nonexistent-socket-id');

            await eventHandlers['player:kick']({ targetSessionId: 'session-2' });

            // Should still complete - socket not found is non-fatal
            expect(playerService.removePlayer).toHaveBeenCalledWith('session-2');
        });
    });

    describe('syncSpectatorRoomMembership - player not found (line 106)', () => {
        it('should return early when getPlayer returns null in syncSpectatorRoomMembership', async () => {
            // First getPlayer call returns player (for the handler)
            // Second getPlayer call returns null (for syncSpectatorRoomMembership)
            playerService.getPlayer.mockReset();
            playerService.getPlayer
                .mockResolvedValueOnce({
                    sessionId: 'session-1',
                    nickname: 'TestPlayer',
                    roomCode: 'TEST12',
                    team: 'red',
                    role: 'clicker',
                    isHost: false
                })
                .mockResolvedValueOnce(null); // second call in syncSpectatorRoomMembership

            gameService.getGame.mockResolvedValue(null);
            playerService.setTeam.mockResolvedValue({
                sessionId: 'session-1',
                nickname: 'TestPlayer',
                team: 'blue',
                role: 'clicker'
            });

            await eventHandlers['player:setTeam']({ team: 'blue' });

            // syncSpectatorRoomMembership should have returned early
            // socket.join/leave should NOT be called for spectator room
            const joinCalls = mockSocket.join.mock.calls.filter(
                (call: any[]) => call[0]?.includes?.('spectators:')
            );
            const leaveCalls = mockSocket.leave.mock.calls.filter(
                (call: any[]) => call[0]?.includes?.('spectators:')
            );
            expect(joinCalls.length + leaveCalls.length).toBe(0);
        });
    });

    describe('player:kick - getPlayersInRoom returns null (line 290)', () => {
        it('should fallback to empty array when getPlayersInRoom returns null', async () => {
            playerService.getPlayer.mockReset();
            playerService.getPlayer
                .mockResolvedValueOnce({
                    sessionId: 'session-1',
                    nickname: 'Host',
                    roomCode: 'TEST12',
                    isHost: true
                })
                .mockResolvedValueOnce({
                    sessionId: 'session-2',
                    nickname: 'Target',
                    roomCode: 'TEST12',
                    isHost: false
                });
            playerService.getSocketId.mockResolvedValue(null);
            playerService.getPlayersInRoom.mockResolvedValue(null);

            await eventHandlers['player:kick']({ targetSessionId: 'session-2' });

            expect(playerService.removePlayer).toHaveBeenCalledWith('session-2');
            // Room emission should use [] as fallback
            expect(mockIo.to().emit).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ players: [] })
            );
        });
    });

    describe('player:setTeam - spymaster cannot change team during active game', () => {
        it('should block team change for spymaster during active game', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                nickname: 'TestPlayer',
                roomCode: 'TEST12',
                team: 'red',
                role: 'spymaster',
                isHost: false
            });
            gameService.getGame.mockResolvedValue({
                gameOver: false,
                currentTurn: 'blue'
            });

            await eventHandlers['player:setTeam']({ team: 'blue' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', {
                code: 'SPYMASTER_CANNOT_CHANGE_TEAM',
                message: expect.stringContaining('Cannot change teams as spymaster')
            });
        });
    });
});
