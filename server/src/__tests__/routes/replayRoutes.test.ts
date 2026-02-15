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

jest.mock('../../utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

const gameHistoryService = require('../../services/gameHistoryService');
const logger = require('../../utils/logger');

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

            const response = await request(app)
                .get(`/api/replays/TEST12/${validGameId}`)
                .expect(200);

            expect(response.body.replay).toEqual(mockReplay);
            expect(gameHistoryService.getReplayEvents).toHaveBeenCalledWith(
                'test12', // normalized to lowercase
                validGameId
            );
        });

        it('should return 404 when replay not found', async () => {
            gameHistoryService.getReplayEvents.mockResolvedValue(null);

            const response = await request(app)
                .get(`/api/replays/ABCDEF/${validGameId}`)
                .expect(404);

            expect(response.body.error.code).toBe('REPLAY_NOT_FOUND');
        });

        it('should return 400 for invalid gameId (not UUID)', async () => {
            const response = await request(app)
                .get('/api/replays/TEST12/not-a-uuid')
                .expect(400);

            expect(response.body.error.code).toBe('VALIDATION_ERROR');
            expect(response.body.error.message).toBe('Invalid room code or game ID format');
        });

        it('should return 400 for room code too short', async () => {
            const response = await request(app)
                .get(`/api/replays/AB/${validGameId}`)
                .expect(400);

            expect(response.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('should return 400 for room code too long', async () => {
            const longCode = 'A'.repeat(25);
            const response = await request(app)
                .get(`/api/replays/${longCode}/${validGameId}`)
                .expect(400);

            expect(response.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('should normalize room code to lowercase', async () => {
            gameHistoryService.getReplayEvents.mockResolvedValue({ id: validGameId });

            await request(app)
                .get(`/api/replays/UPPER/${validGameId}`)
                .expect(200);

            expect(gameHistoryService.getReplayEvents).toHaveBeenCalledWith('upper', validGameId);
        });

        it('should pass errors to next middleware', async () => {
            gameHistoryService.getReplayEvents.mockRejectedValue(new Error('DB error'));

            const response = await request(app)
                .get(`/api/replays/TEST12/${validGameId}`)
                .expect(500);

            expect(logger.error).toHaveBeenCalledWith('Error fetching replay', expect.objectContaining({ roomCode: 'TEST12', error: 'DB error' }));
            expect(response.body.error.code).toBe('SERVER_ERROR');
        });
    });
});
