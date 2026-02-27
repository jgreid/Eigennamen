/**
 * Unit tests for playerContext.js
 *
 * Tests context building, requirement enforcement, state mismatch
 * detection/correction, canChangeTeamOrRole, and syncSocketRooms.
 */

jest.mock('../../services/playerService');
jest.mock('../../services/gameService');
jest.mock('../../utils/logger', () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
}));

const playerService = require('../../services/playerService');
const gameService = require('../../services/gameService');
const logger = require('../../utils/logger');
const { ERROR_CODES } = require('../../config/constants');
const { getPlayerContext, canChangeTeamOrRole, syncSocketRooms, clearGameStateCache } = require('../../socket/playerContext');

describe('playerContext', () => {
    let mockSocket;

    beforeEach(() => {
        jest.clearAllMocks();
        clearGameStateCache();
        mockSocket = {
            id: 'socket-1',
            sessionId: 'session-1',
            roomCode: 'ROOM01',
            emit: jest.fn(),
            join: jest.fn(),
            leave: jest.fn()
        };
        gameService.getGame.mockResolvedValue(null);
    });

    describe('getPlayerContext', () => {
        it('builds a valid context when player is in a room', async () => {
            const player = {
                sessionId: 'session-1',
                roomCode: 'ROOM01',
                team: 'red',
                role: 'clicker',
                isHost: true
            };
            playerService.getPlayer.mockResolvedValue(player);
            gameService.getGame.mockResolvedValue({ gameOver: false });

            const ctx = await getPlayerContext(mockSocket, { requireRoom: true });

            expect(ctx.sessionId).toBe('session-1');
            expect(ctx.roomCode).toBe('ROOM01');
            expect(ctx.player).toBe(player);
            expect(ctx.isInRoom).toBe(true);
            expect(ctx.isHost).toBe(true);
            expect(ctx.team).toBe('red');
            expect(ctx.role).toBe('clicker');
            expect(ctx.game).toEqual({ gameOver: false });
        });

        it('fetches game state when player is in a room', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1', roomCode: 'ROOM01', team: null, role: null, isHost: false
            });
            const game = { gameOver: false, currentTurn: 'red' };
            gameService.getGame.mockResolvedValue(game);

            const ctx = await getPlayerContext(mockSocket);

            expect(gameService.getGame).toHaveBeenCalledWith('ROOM01');
            expect(ctx.game).toBe(game);
        });

        it('does not fetch game when player has no room', async () => {
            mockSocket.roomCode = null;
            playerService.getPlayer.mockResolvedValue(null);

            try {
                await getPlayerContext(mockSocket, { requireRoom: false });
            } catch { /* may throw */ }

            expect(gameService.getGame).not.toHaveBeenCalled();
        });

        // --- Requirement enforcement ---

        it('throws ROOM_NOT_FOUND when requireRoom and player not in room', async () => {
            mockSocket.roomCode = null;
            playerService.getPlayer.mockResolvedValue(null);

            await expect(getPlayerContext(mockSocket, { requireRoom: true }))
                .rejects.toMatchObject({ code: ERROR_CODES.ROOM_NOT_FOUND });
        });

        it('throws GAME_NOT_STARTED when requireGame and no active game', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1', roomCode: 'ROOM01', isHost: false
            });
            gameService.getGame.mockResolvedValue(null);

            await expect(getPlayerContext(mockSocket, { requireRoom: true, requireGame: true }))
                .rejects.toMatchObject({ code: ERROR_CODES.GAME_NOT_STARTED });
        });

        it('throws NOT_HOST when requireHost and player is not host', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1', roomCode: 'ROOM01', isHost: false
            });

            await expect(getPlayerContext(mockSocket, { requireRoom: true, requireHost: true }))
                .rejects.toMatchObject({ code: ERROR_CODES.NOT_HOST });
        });

        it('throws NOT_AUTHORIZED when requireTeam and player has no team', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1', roomCode: 'ROOM01', team: null, isHost: false
            });

            await expect(getPlayerContext(mockSocket, { requireRoom: true, requireTeam: true }))
                .rejects.toMatchObject({ code: ERROR_CODES.NOT_AUTHORIZED });
        });

        it('throws NOT_AUTHORIZED when requireRole does not match', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1', roomCode: 'ROOM01', role: 'clicker', isHost: false
            });

            await expect(getPlayerContext(mockSocket, { requireRoom: true, requireRole: 'spymaster' }))
                .rejects.toMatchObject({ code: ERROR_CODES.NOT_AUTHORIZED });
        });

        it('passes when requireRole matches', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1', roomCode: 'ROOM01', role: 'spymaster', team: 'red', isHost: false
            });

            const ctx = await getPlayerContext(mockSocket, { requireRoom: true, requireRole: 'spymaster' });
            expect(ctx.role).toBe('spymaster');
        });

        // --- State mismatch detection ---

        it('corrects socket roomCode when Redis has a different room', async () => {
            mockSocket.roomCode = 'OLD_ROOM';
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1', roomCode: 'NEW_ROOM', isHost: false
            });

            const ctx = await getPlayerContext(mockSocket, { requireRoom: true });

            expect(mockSocket.leave).toHaveBeenCalledWith('room:OLD_ROOM');
            expect(mockSocket.leave).toHaveBeenCalledWith('spectators:OLD_ROOM');
            expect(mockSocket.roomCode).toBe('NEW_ROOM');
            expect(mockSocket.join).toHaveBeenCalledWith('room:NEW_ROOM');
            expect(ctx.roomCode).toBe('NEW_ROOM');
            expect(logger.warn).toHaveBeenCalledWith(
                'Socket/Redis room state mismatch detected',
                expect.any(Object)
            );
        });

        it('clears socket roomCode when Redis says player has no room', async () => {
            mockSocket.roomCode = 'STALE';
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1', roomCode: null, isHost: false
            });

            // requireRoom: false so it doesn't throw
            try {
                await getPlayerContext(mockSocket, { requireRoom: false });
            } catch { /* may throw */ }

            expect(mockSocket.leave).toHaveBeenCalledWith('room:STALE');
            expect(mockSocket.leave).toHaveBeenCalledWith('spectators:STALE');
            expect(mockSocket.roomCode).toBe(null);
        });

        it('corrects socket when socket has no roomCode but Redis does', async () => {
            mockSocket.roomCode = null;
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1', roomCode: 'REDIS_ROOM', isHost: false
            });

            const ctx = await getPlayerContext(mockSocket, { requireRoom: true });

            expect(mockSocket.roomCode).toBe('REDIS_ROOM');
            expect(mockSocket.join).toHaveBeenCalledWith('room:REDIS_ROOM');
            expect(ctx.roomCode).toBe('REDIS_ROOM');
        });

        it('does not warn when socket and Redis agree', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1', roomCode: 'ROOM01', isHost: false
            });

            await getPlayerContext(mockSocket, { requireRoom: true });

            expect(logger.warn).not.toHaveBeenCalled();
        });

        // --- Edge cases ---

        it('handles player with no team or role gracefully', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1', roomCode: 'ROOM01', team: null, role: null, isHost: false
            });

            const ctx = await getPlayerContext(mockSocket);

            expect(ctx.team).toBe(null);
            expect(ctx.role).toBe(null);
            expect(ctx.isInRoom).toBe(true);
        });

        it('returns context with no game when room has no active game', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: 'session-1', roomCode: 'ROOM01', isHost: false
            });
            gameService.getGame.mockResolvedValue(null);

            const ctx = await getPlayerContext(mockSocket, { requireRoom: true });

            expect(ctx.game).toBe(null);
        });
    });

    describe('canChangeTeamOrRole', () => {
        it('allows changes when no game exists', () => {
            const result = canChangeTeamOrRole({ player: { role: 'spymaster', team: 'red' }, game: null });
            expect(result.allowed).toBe(true);
        });

        it('allows changes when game is over', () => {
            const result = canChangeTeamOrRole({
                player: { role: 'spymaster', team: 'red' },
                game: { gameOver: true, currentTurn: 'red' }
            });
            expect(result.allowed).toBe(true);
        });

        it('blocks spymaster from changing during their team turn', () => {
            const result = canChangeTeamOrRole({
                player: { role: 'spymaster', team: 'red' },
                game: { gameOver: false, currentTurn: 'red' }
            });
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('spymaster');
        });

        it('blocks clicker from changing during their team turn', () => {
            const result = canChangeTeamOrRole({
                player: { role: 'clicker', team: 'blue' },
                game: { gameOver: false, currentTurn: 'blue' }
            });
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('clicker');
        });

        it('allows spymaster to change when it is NOT their team turn', () => {
            const result = canChangeTeamOrRole({
                player: { role: 'spymaster', team: 'red' },
                game: { gameOver: false, currentTurn: 'blue' }
            });
            expect(result.allowed).toBe(true);
        });

        it('allows spectator to change freely during active game', () => {
            const result = canChangeTeamOrRole({
                player: { role: 'spectator', team: null },
                game: { gameOver: false, currentTurn: 'red' }
            });
            expect(result.allowed).toBe(true);
        });

        it('allows player with non-restricted role to change during game', () => {
            // A player on a team but with no special role
            const result = canChangeTeamOrRole({
                player: { role: null, team: 'red' },
                game: { gameOver: false, currentTurn: 'red' }
            });
            expect(result.allowed).toBe(true);
        });
    });

    describe('syncSocketRooms', () => {
        it('does nothing when player is null', () => {
            syncSocketRooms(mockSocket, null, null);
            expect(mockSocket.join).not.toHaveBeenCalled();
            expect(mockSocket.leave).not.toHaveBeenCalled();
        });

        it('does nothing when player has no roomCode', () => {
            syncSocketRooms(mockSocket, { roomCode: null, team: 'red', role: 'clicker' });
            expect(mockSocket.join).not.toHaveBeenCalled();
            expect(mockSocket.leave).not.toHaveBeenCalled();
        });

        it('leaves spectators room when transitioning from spectator to team player', () => {
            const previous = { team: null, role: 'spectator', roomCode: 'ROOM01' };
            const current = { team: 'red', role: 'clicker', roomCode: 'ROOM01' };
            syncSocketRooms(mockSocket, current, previous);
            expect(mockSocket.leave).toHaveBeenCalledWith('spectators:ROOM01');
        });

        it('joins spectators room when transitioning from team player to spectator', () => {
            const previous = { team: 'red', role: 'clicker', roomCode: 'ROOM01' };
            const current = { team: null, role: 'spectator', roomCode: 'ROOM01' };
            syncSocketRooms(mockSocket, current, previous);
            expect(mockSocket.join).toHaveBeenCalledWith('spectators:ROOM01');
        });

        it('does nothing when player stays on a team', () => {
            const previous = { team: 'red', role: 'clicker', roomCode: 'ROOM01' };
            const current = { team: 'blue', role: 'clicker', roomCode: 'ROOM01' };
            syncSocketRooms(mockSocket, current, previous);
            expect(mockSocket.join).not.toHaveBeenCalled();
            expect(mockSocket.leave).not.toHaveBeenCalled();
        });

        it('does nothing when player stays a spectator', () => {
            const previous = { team: null, role: 'spectator', roomCode: 'ROOM01' };
            const current = { team: null, role: 'spectator', roomCode: 'ROOM01' };
            syncSocketRooms(mockSocket, current, previous);
            expect(mockSocket.join).not.toHaveBeenCalled();
            expect(mockSocket.leave).not.toHaveBeenCalled();
        });

        it('defaults wasSpectator=true when previousPlayer is null (first call)', () => {
            // Player is now on a team — should leave spectators since default previous is spectator
            const current = { team: 'red', role: 'clicker', roomCode: 'ROOM01' };
            syncSocketRooms(mockSocket, current, null);
            expect(mockSocket.leave).toHaveBeenCalledWith('spectators:ROOM01');
        });

        it('treats player with team but role=spectator as spectator', () => {
            // Edge case: player assigned to team but role is spectator
            const previous = { team: 'red', role: 'clicker', roomCode: 'ROOM01' };
            const current = { team: 'red', role: 'spectator', roomCode: 'ROOM01' };
            syncSocketRooms(mockSocket, current, previous);
            expect(mockSocket.join).toHaveBeenCalledWith('spectators:ROOM01');
        });

        it('treats player with no team but non-spectator role as spectator', () => {
            // Edge case: no team means spectator regardless of role field
            const previous = { team: 'red', role: 'clicker', roomCode: 'ROOM01' };
            const current = { team: null, role: 'clicker', roomCode: 'ROOM01' };
            syncSocketRooms(mockSocket, current, previous);
            expect(mockSocket.join).toHaveBeenCalledWith('spectators:ROOM01');
        });
    });
});
