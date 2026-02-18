/**
 * Database Integration Tests
 *
 * Tests Prisma schema migrations and basic CRUD operations against
 * a real PostgreSQL database. Requires DATABASE_URL to be set.
 *
 * Run with: DATABASE_URL=postgresql://... npm test -- database.test.ts
 *
 * These tests are SKIPPED by default when no DATABASE_URL is configured,
 * making them safe to include in the standard test suite.
 */

const DB_URL = process.env.DATABASE_URL;
const describeFn = DB_URL ? describe : describe.skip;

// Dynamic import to avoid errors when Prisma client isn't generated
let PrismaClient: any;
try {
    PrismaClient = require('@prisma/client').PrismaClient;
} catch {
    // Prisma not available — tests will be skipped
}

describeFn('Database Integration', () => {
    let prisma: any;

    beforeAll(async () => {
        if (!PrismaClient) return;
        prisma = new PrismaClient({
            datasources: { db: { url: DB_URL } },
            log: ['error']
        });
        await prisma.$connect();
    });

    afterAll(async () => {
        if (prisma) {
            await prisma.$disconnect();
        }
    });

    describe('User CRUD', () => {
        const testUsername = `test-user-${Date.now()}`;

        afterAll(async () => {
            if (!prisma) return;
            await prisma.user.deleteMany({ where: { username: testUsername } });
        });

        it('should create a user', async () => {
            const user = await prisma.user.create({
                data: { username: testUsername }
            });
            expect(user.id).toBeDefined();
            expect(user.username).toBe(testUsername);
            expect(user.gamesPlayed).toBe(0);
            expect(user.gamesWon).toBe(0);
        });

        it('should read a user by username', async () => {
            const user = await prisma.user.findUnique({
                where: { username: testUsername }
            });
            expect(user).not.toBeNull();
            expect(user.username).toBe(testUsername);
        });

        it('should update a user', async () => {
            const user = await prisma.user.update({
                where: { username: testUsername },
                data: { gamesPlayed: 5, gamesWon: 3 }
            });
            expect(user.gamesPlayed).toBe(5);
            expect(user.gamesWon).toBe(3);
        });

        it('should reject duplicate usernames', async () => {
            await expect(
                prisma.user.create({ data: { username: testUsername } })
            ).rejects.toThrow();
        });
    });

    describe('Room and Game relationships', () => {
        let roomId: string;
        const roomCode = `test-room-${Date.now()}`;

        afterAll(async () => {
            if (!prisma) return;
            await prisma.game.deleteMany({ where: { roomId } });
            await prisma.room.deleteMany({ where: { code: roomCode } });
        });

        it('should create a room', async () => {
            const room = await prisma.room.create({
                data: { code: roomCode, settings: {} }
            });
            roomId = room.id;
            expect(room.code).toBe(roomCode);
            expect(room.status).toBe('waiting');
        });

        it('should create a game in a room', async () => {
            const game = await prisma.game.create({
                data: {
                    roomId,
                    seed: 'test-seed-123',
                    words: Array(25).fill('word'),
                    types: Array(25).fill('neutral'),
                    revealed: Array(25).fill(false)
                }
            });
            expect(game.roomId).toBe(roomId);
            expect(game.gameOver).toBe(false);
            expect(game.currentTurn).toBe('red');
        });

        it('should cascade-delete games when room is deleted', async () => {
            const gamesBefore = await prisma.game.count({ where: { roomId } });
            expect(gamesBefore).toBeGreaterThan(0);

            await prisma.room.delete({ where: { id: roomId } });

            const gamesAfter = await prisma.game.count({ where: { roomId } });
            expect(gamesAfter).toBe(0);

            // Prevent afterAll cleanup from failing
            roomId = '';
        });
    });

    describe('WordList CRUD', () => {
        let wordListId: string;

        afterAll(async () => {
            if (!prisma || !wordListId) return;
            await prisma.wordList.deleteMany({ where: { id: wordListId } });
        });

        it('should create a word list', async () => {
            const wl = await prisma.wordList.create({
                data: {
                    name: 'Test List',
                    description: 'Integration test word list',
                    words: ['alpha', 'beta', 'gamma', 'delta'],
                    isPublic: true
                }
            });
            wordListId = wl.id;
            expect(wl.words).toHaveLength(4);
            expect(wl.timesUsed).toBe(0);
        });

        it('should query public word lists', async () => {
            const lists = await prisma.wordList.findMany({
                where: { isPublic: true, id: wordListId }
            });
            expect(lists).toHaveLength(1);
            expect(lists[0].name).toBe('Test List');
        });

        it('should increment timesUsed', async () => {
            const updated = await prisma.wordList.update({
                where: { id: wordListId },
                data: { timesUsed: { increment: 1 } }
            });
            expect(updated.timesUsed).toBe(1);
        });
    });
});
