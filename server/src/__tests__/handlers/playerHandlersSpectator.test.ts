/**
 * Player Handlers - Spectator & Missing Path Tests
 *
 * Covers spectator:requestJoin, spectator:approveJoin handlers,
 * and remaining uncovered paths in setTeam/setNickname/setRole.
 */

// Mock rate limit handler to bypass rate limiting
const { SAFE_ERROR_CODES, createMockRateLimitHandler } = require('../helpers/mocks');
jest.mock('../../socket/rateLimitHandler', () => ({
    createRateLimitedHandler: createMockRateLimitHandler(SAFE_ERROR_CODES),
}));

jest.mock('../../services/playerService');
jest.mock('../../services/gameService');
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
}));
jest.mock('../../utils/sanitize', () => ({
    sanitizeHtml: jest.fn((str: string) => str),
    removeControlChars: jest.fn((str: string) => str),
    isReservedName: jest.fn(() => false),
}));
jest.mock('../../utils/distributedLock', () => ({
    withLock: jest.fn(async (_key, fn) => fn()),
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
            playerService.getPlayersInRoom.mockResolvedValue([{ sessionId: 'host-1', isHost: true, nickname: 'Host' }]);

            await handlers['spectator:requestJoin']({ team: 'red' });

            // Host is addressed via its player: room, not the bare sessionId.
            expect(mockIo.to).toHaveBeenCalledWith('player:host-1');
            expect(mockIo.emit).toHaveBeenCalledWith('spectator:joinRequest', {
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

            expect(mockSocket.emit).toHaveBeenCalledWith(
                'spectator:error',
                expect.objectContaining({
                    code: 'NOT_AUTHORIZED',
                })
            );
        });

        it('should reject a teamless observer (has seen the unmasked board)', async () => {
            // An observer has no team but HAS seen every card type — it must not be
            // able to launder that knowledge into a live seat via this flow. The
            // guard requires role === 'spectator' exactly, not merely "no team".
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1',
                roomCode: 'TEST12',
                nickname: 'Peeker',
                team: null,
                role: 'observer',
                isHost: false,
            });
            playerService.getPlayersInRoom.mockResolvedValue([{ sessionId: 'host-1', isHost: true, nickname: 'Host' }]);

            await handlers['spectator:requestJoin']({ team: 'red' });

            expect(mockIo.emit).not.toHaveBeenCalledWith('spectator:joinRequest', expect.anything());
            expect(mockSocket.emit).toHaveBeenCalledWith(
                'spectator:error',
                expect.objectContaining({ code: 'NOT_AUTHORIZED' })
            );
        });

        it('should error when no host found', async () => {
            playerService.getPlayersInRoom.mockResolvedValue([{ sessionId: 'session-2', isHost: false }]);

            await handlers['spectator:requestJoin']({ team: 'red' });

            expect(mockSocket.emit).toHaveBeenCalledWith(
                'spectator:error',
                expect.objectContaining({
                    code: 'NOT_HOST',
                })
            );
        });

        it('should not throw when host has no connected socket', async () => {
            playerService.getPlayersInRoom.mockResolvedValue([{ sessionId: 'host-1', isHost: true }]);

            // Emitting to an empty player: room is a harmless no-op.
            await handlers['spectator:requestJoin']({ team: 'red' });

            expect(mockIo.to).toHaveBeenCalledWith('player:host-1');
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
            // Seating succeeds by default (F6): join the team, take the clicker seat.
            playerService.setTeam.mockResolvedValue({ sessionId: 'requester-1', team: 'red', role: 'spectator' });
            playerService.setRole.mockResolvedValue({ sessionId: 'requester-1', team: 'red', role: 'clicker' });
        });

        it('should approve and seat a spectator as a team clicker (F6)', async () => {
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
                team: 'red',
            });

            // Server actually seats the requester: onto the team, then as a clicker.
            expect(playerService.setTeam).toHaveBeenCalledWith('requester-1', 'red');
            expect(playerService.setRole).toHaveBeenCalledWith('requester-1', 'clicker');
            // Whole room learns the requester is now a red clicker.
            expect(mockIo.emit).toHaveBeenCalledWith(
                'player:updated',
                expect.objectContaining({
                    sessionId: 'requester-1',
                    changes: expect.objectContaining({ team: 'red', role: 'clicker' }),
                })
            );
            // Requester gets an approval carrying the team they joined.
            expect(mockIo.to).toHaveBeenCalledWith('player:requester-1');
            expect(mockIo.emit).toHaveBeenCalledWith(
                'spectator:joinApproved',
                expect.objectContaining({ team: 'red', message: expect.stringContaining('approved') })
            );
        });

        it('should reject an approval that carries no team', async () => {
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

            await handlers['spectator:approveJoin']({ requesterId: 'requester-1', approved: true });

            expect(playerService.setTeam).not.toHaveBeenCalled();
            expect(mockSocket.emit).toHaveBeenCalledWith(
                'spectator:error',
                expect.objectContaining({ code: 'INVALID_INPUT' })
            );
        });

        it('should revert the team move when the clicker seat is already taken', async () => {
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
            const { ValidationError } = require('../../errors/GameError');
            playerService.setRole.mockRejectedValueOnce(new ValidationError('red team already has a clicker'));

            await handlers['spectator:approveJoin']({ requesterId: 'requester-1', approved: true, team: 'red' });

            // Seated onto the team, failed on the clicker seat, reverted to no team.
            expect(playerService.setTeam).toHaveBeenNthCalledWith(1, 'requester-1', 'red');
            expect(playerService.setTeam).toHaveBeenNthCalledWith(2, 'requester-1', null);
            expect(mockSocket.emit).toHaveBeenCalledWith(
                'spectator:error',
                expect.objectContaining({ code: 'INVALID_INPUT' })
            );
            // Never falsely told the requester they were approved.
            expect(mockIo.emit).not.toHaveBeenCalledWith('spectator:joinApproved', expect.anything());
        });

        it('should deny a spectator join request', async () => {
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

            expect(mockIo.to).toHaveBeenCalledWith('player:requester-1');
            expect(mockIo.emit).toHaveBeenCalledWith(
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

            expect(mockSocket.emit).toHaveBeenCalledWith(
                'spectator:error',
                expect.objectContaining({
                    code: 'PLAYER_NOT_FOUND',
                })
            );
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

            expect(mockSocket.emit).toHaveBeenCalledWith(
                'spectator:error',
                expect.objectContaining({
                    code: 'PLAYER_NOT_FOUND',
                })
            );
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

            expect(mockSocket.emit).toHaveBeenCalledWith(
                'spectator:error',
                expect.objectContaining({
                    code: 'NOT_AUTHORIZED',
                })
            );
        });

        it('should reject approving a teamless observer as a clicker (board-knowledge laundering)', async () => {
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
                    nickname: 'Peeker',
                    team: null,
                    role: 'observer',
                });

            await handlers['spectator:approveJoin']({
                requesterId: 'requester-1',
                approved: true,
                team: 'red',
            });

            // An observer must never be seated — no team/role mutation, no approval.
            expect(playerService.setTeam).not.toHaveBeenCalled();
            expect(playerService.setRole).not.toHaveBeenCalled();
            expect(mockIo.emit).not.toHaveBeenCalledWith('spectator:joinApproved', expect.anything());
            expect(mockSocket.emit).toHaveBeenCalledWith(
                'spectator:error',
                expect.objectContaining({ code: 'NOT_AUTHORIZED' })
            );
        });

        it('should not throw when requester has no connected socket on approve', async () => {
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

            // Should not throw — emit to an empty player: room is a no-op.
            await handlers['spectator:approveJoin']({
                requesterId: 'requester-1',
                approved: true,
                team: 'red',
            });

            expect(mockIo.to).toHaveBeenCalledWith('player:requester-1');
        });

        it('should not throw when requester has no connected socket on deny', async () => {
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

            expect(mockIo.to).toHaveBeenCalledWith('player:requester-1');
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

            expect(mockSocket.emit).toHaveBeenCalledWith(
                'player:error',
                expect.objectContaining({
                    code: 'SERVER_ERROR',
                })
            );
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

            expect(mockSocket.emit).toHaveBeenCalledWith(
                'player:error',
                expect.objectContaining({
                    code: 'PLAYER_NOT_FOUND',
                })
            );
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

            // A spymaster can never leave the role during an active game (not just
            // during their own turn) — see canChangeTeamOrRole's spymaster lockout.
            expect(mockSocket.emit).toHaveBeenCalledWith(
                'player:error',
                expect.objectContaining({
                    code: 'SPYMASTER_CANNOT_CHANGE_ROLE',
                })
            );
        });
    });
});
