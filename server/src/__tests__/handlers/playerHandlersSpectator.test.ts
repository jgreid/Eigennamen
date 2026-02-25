/**
 * Player Handlers - Spectator & Missing Path Tests
 *
 * Covers spectator:requestJoin, spectator:approveJoin handlers,
 * and remaining uncovered paths in setTeam/setNickname/setRole.
 */

// Mock rate limit handler to bypass rate limiting
const { SAFE_ERROR_CODES, createMockRateLimitHandler } = require('../helpers/mocks');
jest.mock('../../socket/rateLimitHandler', () => ({
    createRateLimitedHandler: createMockRateLimitHandler(SAFE_ERROR_CODES)
}));

jest.mock('../../services/playerService');
jest.mock('../../services/gameService');
jest.mock('../../utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));
jest.mock('../../utils/sanitize', () => ({
    sanitizeHtml: jest.fn((str: string) => str),
    removeControlChars: jest.fn((str: string) => str),
    isReservedName: jest.fn(() => false)
}));

const playerService = require('../../services/playerService');
const gameService = require('../../services/gameService');

describe('Player Handlers - Spectator & Missing Paths', () => {
    let mockSocket: any;
    let mockIo: any;
    let handlers: Record<string, Function>;

    beforeEach(() => {
        jest.clearAllMocks();

        handlers = {};
        mockSocket = {
            id: 'socket-1',
            sessionId: 'session-1',
            roomCode: 'TEST12',
            emit: jest.fn(),
            on: jest.fn((event: string, handler: Function) => {
                handlers[event] = handler;
            }),
            join: jest.fn(),
            leave: jest.fn(),
        };

        const mockHostSocket = { emit: jest.fn() };
        mockIo = {
            to: jest.fn().mockReturnThis(),
            emit: jest.fn(),
            in: jest.fn().mockReturnValue({
                fetchSockets: jest.fn().mockResolvedValue([mockHostSocket]),
            }),
            sockets: { sockets: new Map() },
        };

        // Default player mock
        playerService.getPlayer.mockResolvedValue({
            sessionId: 'session-1',
            roomCode: 'TEST12',
            nickname: 'Player1',
            team: null,
            role: 'spectator',
            isHost: false,
        });
        gameService.getGame.mockResolvedValue(null);
        playerService.getRoomStats.mockResolvedValue({});
        playerService.getPlayersInRoom.mockResolvedValue([]);

        const playerHandlers = require('../../socket/handlers/playerHandlers');
        playerHandlers(mockIo, mockSocket);
    });

    describe('spectator:requestJoin', () => {
        it('should send join request to host', async () => {
            const mockHostSocket = { emit: jest.fn() };
            mockIo.in.mockReturnValue({
                fetchSockets: jest.fn().mockResolvedValue([mockHostSocket]),
            });

            playerService.getPlayersInRoom.mockResolvedValue([
                { sessionId: 'host-1', isHost: true, nickname: 'Host' },
            ]);

            await handlers['spectator:requestJoin']({ team: 'red' });

            expect(mockIo.in).toHaveBeenCalledWith('host-1');
            expect(mockHostSocket.emit).toHaveBeenCalledWith('spectator:joinRequest', {
                requesterId: 'session-1',
                requesterNickname: 'Player1',
                team: 'red',
                timestamp: expect.any(Number),
            });
        });

        it('should reject non-spectators', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'TEST12',
                nickname: 'Player1',
                team: 'red',
                role: 'clicker',
                isHost: false,
            });

            await handlers['spectator:requestJoin']({ team: 'blue' });

            expect(mockSocket.emit).toHaveBeenCalledWith('spectator:error', expect.objectContaining({
                code: 'NOT_AUTHORIZED',
            }));
        });

        it('should error when no host found', async () => {
            playerService.getPlayersInRoom.mockResolvedValue([
                { sessionId: 'session-2', isHost: false },
            ]);

            await handlers['spectator:requestJoin']({ team: 'red' });

            expect(mockSocket.emit).toHaveBeenCalledWith('spectator:error', expect.objectContaining({
                code: 'NOT_HOST',
            }));
        });

        it('should handle host with no connected socket', async () => {
            mockIo.in.mockReturnValue({
                fetchSockets: jest.fn().mockResolvedValue([]),
            });

            playerService.getPlayersInRoom.mockResolvedValue([
                { sessionId: 'host-1', isHost: true },
            ]);

            // Should not throw, just silently skip emit
            await handlers['spectator:requestJoin']({ team: 'red' });

            expect(mockIo.in).toHaveBeenCalledWith('host-1');
        });
    });

    describe('spectator:approveJoin', () => {
        beforeEach(() => {
            // Host player context
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'TEST12',
                nickname: 'Host',
                team: 'red',
                role: 'spymaster',
                isHost: true,
            });
        });

        it('should approve a spectator join request', async () => {
            const mockRequesterSocket = { emit: jest.fn() };
            mockIo.in.mockReturnValue({
                fetchSockets: jest.fn().mockResolvedValue([mockRequesterSocket]),
            });

            // Target is a spectator
            playerService.getPlayer
                .mockResolvedValueOnce({
                    sessionId: 'session-1',
                    roomCode: 'TEST12',
                    isHost: true,
                    nickname: 'Host',
                    team: 'red',
                    role: 'spymaster',
                })
                .mockResolvedValueOnce({
                    sessionId: 'requester-1',
                    roomCode: 'TEST12',
                    nickname: 'Spectator',
                    team: null,
                    role: 'spectator',
                });

            await handlers['spectator:approveJoin']({
                requesterId: 'requester-1',
                approved: true,
            });

            expect(mockRequesterSocket.emit).toHaveBeenCalledWith(
                'spectator:joinApproved',
                expect.objectContaining({
                    message: expect.stringContaining('approved'),
                })
            );
        });

        it('should deny a spectator join request', async () => {
            const mockDeniedSocket = { emit: jest.fn() };
            mockIo.in.mockReturnValue({
                fetchSockets: jest.fn().mockResolvedValue([mockDeniedSocket]),
            });

            playerService.getPlayer
                .mockResolvedValueOnce({
                    sessionId: 'session-1',
                    roomCode: 'TEST12',
                    isHost: true,
                    nickname: 'Host',
                    team: 'red',
                    role: 'spymaster',
                })
                .mockResolvedValueOnce({
                    sessionId: 'requester-1',
                    roomCode: 'TEST12',
                    nickname: 'Spectator',
                    team: null,
                    role: 'spectator',
                });

            await handlers['spectator:approveJoin']({
                requesterId: 'requester-1',
                approved: false,
            });

            expect(mockDeniedSocket.emit).toHaveBeenCalledWith(
                'spectator:joinDenied',
                expect.objectContaining({
                    message: expect.stringContaining('denied'),
                })
            );
        });

        it('should error when requester not found', async () => {
            playerService.getPlayer
                .mockResolvedValueOnce({
                    sessionId: 'session-1',
                    roomCode: 'TEST12',
                    isHost: true,
                    nickname: 'Host',
                    team: 'red',
                    role: 'spymaster',
                })
                .mockResolvedValueOnce(null);

            await handlers['spectator:approveJoin']({
                requesterId: 'unknown',
                approved: true,
            });

            expect(mockSocket.emit).toHaveBeenCalledWith('spectator:error', expect.objectContaining({
                code: 'PLAYER_NOT_FOUND',
            }));
        });

        it('should error when requester is in different room', async () => {
            playerService.getPlayer
                .mockResolvedValueOnce({
                    sessionId: 'session-1',
                    roomCode: 'TEST12',
                    isHost: true,
                    nickname: 'Host',
                    team: 'red',
                    role: 'spymaster',
                })
                .mockResolvedValueOnce({
                    sessionId: 'requester-1',
                    roomCode: 'OTHER',
                    nickname: 'Spectator',
                    team: null,
                    role: 'spectator',
                });

            await handlers['spectator:approveJoin']({
                requesterId: 'requester-1',
                approved: true,
            });

            expect(mockSocket.emit).toHaveBeenCalledWith('spectator:error', expect.objectContaining({
                code: 'PLAYER_NOT_FOUND',
            }));
        });

        it('should reject if requester is not a spectator', async () => {
            playerService.getPlayer
                .mockResolvedValueOnce({
                    sessionId: 'session-1',
                    roomCode: 'TEST12',
                    isHost: true,
                    nickname: 'Host',
                    team: 'red',
                    role: 'spymaster',
                })
                .mockResolvedValueOnce({
                    sessionId: 'requester-1',
                    roomCode: 'TEST12',
                    nickname: 'NotSpectator',
                    team: 'blue',
                    role: 'clicker',
                });

            await handlers['spectator:approveJoin']({
                requesterId: 'requester-1',
                approved: true,
            });

            expect(mockSocket.emit).toHaveBeenCalledWith('spectator:error', expect.objectContaining({
                code: 'NOT_AUTHORIZED',
            }));
        });

        it('should handle requester with no connected socket on approve', async () => {
            mockIo.in.mockReturnValue({
                fetchSockets: jest.fn().mockResolvedValue([]),
            });

            playerService.getPlayer
                .mockResolvedValueOnce({
                    sessionId: 'session-1',
                    roomCode: 'TEST12',
                    isHost: true,
                    nickname: 'Host',
                    team: 'red',
                    role: 'spymaster',
                })
                .mockResolvedValueOnce({
                    sessionId: 'requester-1',
                    roomCode: 'TEST12',
                    nickname: 'Spectator',
                    team: null,
                    role: 'spectator',
                });

            // Should not throw
            await handlers['spectator:approveJoin']({
                requesterId: 'requester-1',
                approved: true,
            });

            expect(mockIo.in).toHaveBeenCalledWith('requester-1');
        });

        it('should handle requester with no connected socket on deny', async () => {
            mockIo.in.mockReturnValue({
                fetchSockets: jest.fn().mockResolvedValue([]),
            });

            playerService.getPlayer
                .mockResolvedValueOnce({
                    sessionId: 'session-1',
                    roomCode: 'TEST12',
                    isHost: true,
                    nickname: 'Host',
                    team: 'red',
                    role: 'spymaster',
                })
                .mockResolvedValueOnce({
                    sessionId: 'requester-1',
                    roomCode: 'TEST12',
                    nickname: 'Spectator',
                    team: null,
                    role: 'spectator',
                });

            await handlers['spectator:approveJoin']({
                requesterId: 'requester-1',
                approved: false,
            });

            expect(mockIo.in).toHaveBeenCalledWith('requester-1');
        });
    });

    describe('setTeam - service throws', () => {
        it('should error when setTeam throws ServerError', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'TEST12',
                nickname: 'Player1',
                team: null,
                role: 'spectator',
                isHost: false,
            });
            playerService.setTeam.mockRejectedValue(new Error('Player not found'));

            await handlers['player:setTeam']({ team: 'red' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', expect.objectContaining({
                code: 'SERVER_ERROR',
            }));
        });
    });

    describe('setNickname - null player from service', () => {
        it('should error when setNickname returns null', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'TEST12',
                nickname: 'Player1',
                team: null,
                role: 'spectator',
                isHost: false,
            });
            playerService.setNickname.mockResolvedValue(null);

            await handlers['player:setNickname']({ nickname: 'NewName' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', expect.objectContaining({
                code: 'PLAYER_NOT_FOUND',
            }));
        });
    });

    describe('setRole - canChangeTeamOrRole rejection', () => {
        it('should error when spymaster tries to become spectator during their turn', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'TEST12',
                nickname: 'Player1',
                team: 'red',
                role: 'spymaster',
                isHost: false,
            });
            gameService.getGame.mockResolvedValue({
                currentTurn: 'red',
                gameOver: false,
            });

            await handlers['player:setRole']({ role: 'spectator' });

            expect(mockSocket.emit).toHaveBeenCalledWith('player:error', expect.objectContaining({
                code: 'CANNOT_CHANGE_ROLE_DURING_TURN',
            }));
        });
    });
});
