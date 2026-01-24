/**
 * Room Routes Coverage Tests (Sprint 15)
 *
 * Tests to achieve 90%+ coverage for roomRoutes.js
 */

const request = require('supertest');
const express = require('express');
const roomRoutes = require('../routes/roomRoutes');

// Mock services
jest.mock('../services/roomService', () => ({
    roomExists: jest.fn(),
    getRoom: jest.fn(),
    findRoomByPassword: jest.fn()
}));

jest.mock('../services/playerService', () => ({
    getPlayersInRoom: jest.fn()
}));

const roomService = require('../services/roomService');
const playerService = require('../services/playerService');

describe('Room Routes Coverage Tests', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();

        // Create fresh Express app for each test
        app = express();
        app.use(express.json());
        app.use('/api/rooms', roomRoutes);

        // Error handler middleware (respects statusCode from validation)
        app.use((err, req, res, next) => {
            const statusCode = err.statusCode || 500;
            res.status(statusCode).json({
                error: {
                    code: err.code || 'INTERNAL_ERROR',
                    message: err.message || 'Internal server error'
                }
            });
        });
    });

    describe('GET /api/rooms/by-password/:password', () => {
        test('returns room when password matches', async () => {
            roomService.findRoomByPassword.mockResolvedValue({
                code: 'ABCD12',
                hasPassword: true
            });

            const response = await request(app)
                .get('/api/rooms/by-password/mysecretpassword')
                .expect(200);

            expect(response.body.code).toBe('ABCD12');
            expect(roomService.findRoomByPassword).toHaveBeenCalledWith('mysecretpassword');
        });

        test('returns 404 when no room found with password', async () => {
            roomService.findRoomByPassword.mockResolvedValue(null);

            const response = await request(app)
                .get('/api/rooms/by-password/wrongpassword')
                .expect(404);

            expect(response.body.error.code).toBe('ROOM_NOT_FOUND');
            expect(response.body.error.message).toBe('No room found with that password');
        });

        test('handles empty password correctly', async () => {
            // A single space decodes to " " which is truthy but treated as
            // a valid password that won't find a room
            roomService.findRoomByPassword.mockResolvedValue(null);

            const response = await request(app)
                .get('/api/rooms/by-password/%20') // URL-encoded space
                .expect(404);

            expect(response.body.error.code).toBe('ROOM_NOT_FOUND');
        });

        test('returns 400 for password exceeding max length', async () => {
            const longPassword = 'a'.repeat(51);

            const response = await request(app)
                .get(`/api/rooms/by-password/${longPassword}`)
                .expect(400);

            expect(response.body.error.code).toBe('INVALID_PASSWORD');
        });

        test('handles URL-encoded passwords correctly', async () => {
            roomService.findRoomByPassword.mockResolvedValue({
                code: 'ROOM99'
            });

            const password = 'test+password&special=chars';
            const encodedPassword = encodeURIComponent(password);

            const response = await request(app)
                .get(`/api/rooms/by-password/${encodedPassword}`)
                .expect(200);

            expect(roomService.findRoomByPassword).toHaveBeenCalledWith(password);
        });

        test('handles service error', async () => {
            roomService.findRoomByPassword.mockRejectedValue(new Error('Database error'));

            const response = await request(app)
                .get('/api/rooms/by-password/test')
                .expect(500);

            expect(response.body.error.code).toBe('INTERNAL_ERROR');
        });
    });

    describe('GET /api/rooms/:code/exists', () => {
        test('returns true when room exists', async () => {
            roomService.roomExists.mockResolvedValue(true);

            const response = await request(app)
                .get('/api/rooms/ABCD12/exists')
                .expect(200);

            expect(response.body.exists).toBe(true);
        });

        test('returns false when room does not exist', async () => {
            roomService.roomExists.mockResolvedValue(false);

            const response = await request(app)
                .get('/api/rooms/NOTFND/exists')
                .expect(200);

            expect(response.body.exists).toBe(false);
        });

        test('validates room code format - wrong length', async () => {
            // "invalid" is 7 characters, but the schema expects 6
            const response = await request(app)
                .get('/api/rooms/TOOLONG/exists')
                .expect(400);

            expect(response.body.error).toBeDefined();
        });

        test('handles service error', async () => {
            roomService.roomExists.mockRejectedValue(new Error('Redis error'));

            const response = await request(app)
                .get('/api/rooms/ABCD12/exists')
                .expect(500);

            expect(response.body.error.code).toBe('INTERNAL_ERROR');
        });
    });

    describe('GET /api/rooms/:code', () => {
        test('returns room info when room exists', async () => {
            roomService.getRoom.mockResolvedValue({
                code: 'ABCD12',
                status: 'waiting',
                passwordHash: 'hash123',
                settings: {
                    teamNames: { red: 'Red Team', blue: 'Blue Team' },
                    allowSpectators: true
                }
            });
            playerService.getPlayersInRoom.mockResolvedValue([
                { sessionId: 'p1' },
                { sessionId: 'p2' }
            ]);

            const response = await request(app)
                .get('/api/rooms/ABCD12')
                .expect(200);

            expect(response.body.room.code).toBe('ABCD12');
            expect(response.body.room.status).toBe('waiting');
            expect(response.body.room.hasPassword).toBe(true);
            expect(response.body.room.settings.teamNames).toBeDefined();
            expect(response.body.playerCount).toBe(2);
        });

        test('returns room info without password', async () => {
            roomService.getRoom.mockResolvedValue({
                code: 'NOPASS',
                status: 'playing',
                passwordHash: null,
                settings: {
                    teamNames: { red: 'Red', blue: 'Blue' },
                    allowSpectators: false
                }
            });
            playerService.getPlayersInRoom.mockResolvedValue([]);

            const response = await request(app)
                .get('/api/rooms/NOPASS')
                .expect(200);

            expect(response.body.room.hasPassword).toBe(false);
            expect(response.body.playerCount).toBe(0);
        });

        test('returns 404 when room not found', async () => {
            roomService.getRoom.mockResolvedValue(null);

            const response = await request(app)
                .get('/api/rooms/NOTFND')
                .expect(404);

            expect(response.body.error.code).toBe('ROOM_NOT_FOUND');
            expect(response.body.error.message).toBe('Room not found');
        });

        test('validates room code format - too short', async () => {
            const response = await request(app)
                .get('/api/rooms/ABC12')
                .expect(400);

            expect(response.body.error).toBeDefined();
        });

        test('validates room code format - too long', async () => {
            const response = await request(app)
                .get('/api/rooms/ABCD123')
                .expect(400);

            expect(response.body.error).toBeDefined();
        });

        test('handles service error', async () => {
            roomService.getRoom.mockRejectedValue(new Error('Database timeout'));

            const response = await request(app)
                .get('/api/rooms/ABCD12')
                .expect(500);

            expect(response.body.error.code).toBe('INTERNAL_ERROR');
        });

        test('transforms room code to uppercase', async () => {
            roomService.getRoom.mockResolvedValue({
                code: 'ABCD12',
                status: 'waiting',
                settings: {
                    teamNames: {},
                    allowSpectators: true
                }
            });
            playerService.getPlayersInRoom.mockResolvedValue([]);

            await request(app)
                .get('/api/rooms/abcd12')
                .expect(200);

            expect(roomService.getRoom).toHaveBeenCalledWith('ABCD12');
        });
    });
});
