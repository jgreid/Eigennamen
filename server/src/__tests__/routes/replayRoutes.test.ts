/**
 * Replay Routes Tests
 *
 * Tests for GET /api/replays/:roomCode/:gameId endpoint
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../services/gameHistoryService', () => ({
    getReplayEvents: jest.fn(),
}));

jest.mock('../../services/playerService', () => ({
    getPlayer: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

const gameHistoryService = require('../../services/gameHistoryService');
const playerService = require('../../services/playerService');
const logger = require('../../utils/logger');

const VALID_SESSION_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

function createApp() {
    const app = express();
    app.use(express.json());
    const replayRoutes = require('../../routes/replayRoutes');
    app.use('/api/replays', replayRoutes);
    // Error handler
    app.use((err: any, _req: any, res: any, _next: any) => {
        res.status(500).json({ error: { code: 'SERVER_ERROR', message: err.message } });
    });
    return app;
}

/** Helper: set up playerService.getPlayer to return an authenticated player in the given room */
function mockAuthenticatedPlayer(roomCode: string) {
    playerService.getPlayer.mockResolvedValue({
        sessionId: VALID_SESSION_ID,
        roomCode,
        nickname: 'TestPlayer',
        team: 'red',
        role: 'spectator'
    });
}

describe('Replay Routes', () => {
    let app: any;

    beforeEach(() => {
        jest.clearAllMocks();
        app = createApp();
    });

    describe('GET /api/replays/:roomCode/:gameId', () => {
        const validGameId = '550e8400-e29b-41d4-a716-446655440000';

        it('should return replay data for valid parameters', async () => {
            const mockReplay = {
                id: validGameId,
                roomCode: 'test12',
                events: [{ type: 'CARD_REVEALED' }],
                duration: 300,
            };
            gameHistoryService.getReplayEvents.mockResolvedValue(mockReplay);
            mockAuthenticatedPlayer('test12');

            const response = await request(app)
                .get(`/api/replays/TEST12/${validGameId}`)
                .set('X-Session-Id', VALID_SESSION_ID)
                .expect(200);

            expect(response.body.replay).toEqual(mockReplay);
            expect(gameHistoryService.getReplayEvents).toHaveBeenCalledWith(
                'test12', // normalized to lowercase by route (original roomCode passed)
                validGameId
            );
        });

        it('should return 401 when X-Session-Id header is missing', async () => {
            const response = await request(app)
                .get(`/api/replays/TEST12/${validGameId}`)
                .expect(401);

            expect(response.body.error.code).toBe('NOT_AUTHORIZED');
            expect(response.body.error.message).toBe('Session ID required');
        });

        it('should return 403 when player is not in the room', async () => {
            playerService.getPlayer.mockResolvedValue({
                sessionId: VALID_SESSION_ID,
                roomCode: 'other-room', // different room
                nickname: 'TestPlayer'
            });

            const response = await request(app)
                .get(`/api/replays/TEST12/${validGameId}`)
                .set('X-Session-Id', VALID_SESSION_ID)
                .expect(403);

            expect(response.body.error.code).toBe('NOT_AUTHORIZED');
        });

        it('should return 403 when player does not exist', async () => {
            playerService.getPlayer.mockResolvedValue(null);

            const response = await request(app)
                .get(`/api/replays/TEST12/${validGameId}`)
                .set('X-Session-Id', VALID_SESSION_ID)
                .expect(403);

            expect(response.body.error.code).toBe('NOT_AUTHORIZED');
        });

        it('should return 404 when replay not found', async () => {
            gameHistoryService.getReplayEvents.mockResolvedValue(null);
            mockAuthenticatedPlayer('abcdef');

            const response = await request(app)
                .get(`/api/replays/ABCDEF/${validGameId}`)
                .set('X-Session-Id', VALID_SESSION_ID)
                .expect(404);

            expect(response.body.error.code).toBe('REPLAY_NOT_FOUND');
        });

        it('should return 400 for invalid gameId (not UUID)', async () => {
            const response = await request(app)
                .get('/api/replays/TEST12/not-a-uuid')
                .set('X-Session-Id', VALID_SESSION_ID)
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_INPUT');
            expect(response.body.error.message).toBe('Invalid room code or game ID format');
        });

        it('should return 400 for room code too short', async () => {
            const response = await request(app)
                .get(`/api/replays/AB/${validGameId}`)
                .set('X-Session-Id', VALID_SESSION_ID)
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_INPUT');
        });

        it('should return 400 for room code too long', async () => {
            const longCode = 'A'.repeat(25);
            const response = await request(app)
                .get(`/api/replays/${longCode}/${validGameId}`)
                .set('X-Session-Id', VALID_SESSION_ID)
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_INPUT');
        });

        it('should normalize room code to lowercase', async () => {
            gameHistoryService.getReplayEvents.mockResolvedValue({ id: validGameId });
            mockAuthenticatedPlayer('upper');

            await request(app)
                .get(`/api/replays/UPPER/${validGameId}`)
                .set('X-Session-Id', VALID_SESSION_ID)
                .expect(200);

            expect(gameHistoryService.getReplayEvents).toHaveBeenCalledWith('upper', validGameId);
        });

        it('should pass errors to next middleware', async () => {
            gameHistoryService.getReplayEvents.mockRejectedValue(new Error('DB error'));
            mockAuthenticatedPlayer('test12');

            const response = await request(app)
                .get(`/api/replays/TEST12/${validGameId}`)
                .set('X-Session-Id', VALID_SESSION_ID)
                .expect(500);

            expect(logger.error).toHaveBeenCalledWith('Error fetching replay', expect.objectContaining({ roomCode: 'TEST12', error: 'DB error' }));
            expect(response.body.error.code).toBe('SERVER_ERROR');
        });
    });
});
