/**
 * Database Integration Tests
 *
 * Phase 3.4: Tests for Prisma database operations.
 * These tests require a test database and are skipped if DATABASE_URL is not set.
 */

// Skip all tests if no database URL is configured
const skipTests = !process.env.DATABASE_URL || process.env.SKIP_DB_TESTS === 'true';

// Conditionally import PrismaClient only when running tests
let PrismaClient;
let prisma;

if (!skipTests) {
    try {
        const prismaModule = require('@prisma/client');
        PrismaClient = prismaModule.PrismaClient;
    } catch (e) {
        // Prisma not available
    }
}

const describeFn = skipTests ? describe.skip : describe;

describeFn('Database Integration Tests', () => {
    beforeAll(async () => {
        if (!PrismaClient) {
            throw new Error('Prisma client not available');
        }
        prisma = new PrismaClient({
            datasources: {
                db: { url: process.env.DATABASE_URL }
            }
        });
        await prisma.$connect();
    });

    afterAll(async () => {
        if (prisma) {
            await prisma.$disconnect();
        }
    });

    describe('WordList Model', () => {
        let testWordListId;

        afterEach(async () => {
            // Cleanup test data
            if (testWordListId) {
                await prisma.wordList.delete({ where: { id: testWordListId } }).catch(() => {});
                testWordListId = null;
            }
        });

        test('creates and retrieves a word list', async () => {
            const wordList = await prisma.wordList.create({
                data: {
                    name: 'Test Word List',
                    description: 'A test word list for integration tests',
                    words: ['apple', 'banana', 'cherry', 'date', 'elderberry'],
                    isPublic: false
                }
            });
            testWordListId = wordList.id;

            expect(wordList.id).toBeDefined();
            expect(wordList.name).toBe('Test Word List');
            expect(wordList.words).toHaveLength(5);
            expect(wordList.isPublic).toBe(false);

            // Retrieve and verify
            const retrieved = await prisma.wordList.findUnique({
                where: { id: wordList.id }
            });

            expect(retrieved).not.toBeNull();
            expect(retrieved.name).toBe('Test Word List');
            expect(retrieved.words).toEqual(['apple', 'banana', 'cherry', 'date', 'elderberry']);
        });

        test('updates a word list', async () => {
            const wordList = await prisma.wordList.create({
                data: {
                    name: 'Update Test List',
                    words: ['one', 'two', 'three'],
                    isPublic: false
                }
            });
            testWordListId = wordList.id;

            const updated = await prisma.wordList.update({
                where: { id: wordList.id },
                data: {
                    name: 'Updated Name',
                    isPublic: true,
                    timesUsed: { increment: 1 }
                }
            });

            expect(updated.name).toBe('Updated Name');
            expect(updated.isPublic).toBe(true);
            expect(updated.timesUsed).toBe(1);
        });

        test('deletes a word list', async () => {
            const wordList = await prisma.wordList.create({
                data: {
                    name: 'Delete Test List',
                    words: ['delete', 'me'],
                    isPublic: false
                }
            });

            await prisma.wordList.delete({ where: { id: wordList.id } });

            const deleted = await prisma.wordList.findUnique({
                where: { id: wordList.id }
            });

            expect(deleted).toBeNull();
        });

        test('finds public word lists', async () => {
            // Create a public word list
            const publicList = await prisma.wordList.create({
                data: {
                    name: 'Public Test List',
                    words: ['public', 'words'],
                    isPublic: true
                }
            });
            testWordListId = publicList.id;

            const publicLists = await prisma.wordList.findMany({
                where: { isPublic: true }
            });

            expect(publicLists.length).toBeGreaterThanOrEqual(1);
            expect(publicLists.some(l => l.id === publicList.id)).toBe(true);
        });
    });

    describe('Room Model', () => {
        let testRoomId;

        afterEach(async () => {
            if (testRoomId) {
                await prisma.room.delete({ where: { id: testRoomId } }).catch(() => {});
                testRoomId = null;
            }
        });

        test('creates a room with unique code', async () => {
            const uniqueCode = `TEST${Date.now()}`;
            const room = await prisma.room.create({
                data: {
                    code: uniqueCode,
                    settings: { redTeamName: 'Red', blueTeamName: 'Blue' },
                    status: 'waiting'
                }
            });
            testRoomId = room.id;

            expect(room.id).toBeDefined();
            expect(room.code).toBe(uniqueCode);
            expect(room.status).toBe('waiting');
        });

        test('enforces unique room codes', async () => {
            const uniqueCode = `UNIQUE${Date.now()}`;
            const room1 = await prisma.room.create({
                data: {
                    code: uniqueCode,
                    status: 'waiting'
                }
            });
            testRoomId = room1.id;

            await expect(
                prisma.room.create({
                    data: {
                        code: uniqueCode,
                        status: 'waiting'
                    }
                })
            ).rejects.toThrow();
        });

        test('updates room status', async () => {
            const uniqueCode = `STATUS${Date.now()}`;
            const room = await prisma.room.create({
                data: {
                    code: uniqueCode,
                    status: 'waiting'
                }
            });
            testRoomId = room.id;

            const updated = await prisma.room.update({
                where: { id: room.id },
                data: { status: 'playing' }
            });

            expect(updated.status).toBe('playing');
        });
    });

    describe('Game Model', () => {
        let testRoomId;
        let testGameId;

        beforeEach(async () => {
            // Create a room for game tests
            const room = await prisma.room.create({
                data: {
                    code: `GAME${Date.now()}`,
                    status: 'playing'
                }
            });
            testRoomId = room.id;
        });

        afterEach(async () => {
            if (testGameId) {
                await prisma.game.delete({ where: { id: testGameId } }).catch(() => {});
                testGameId = null;
            }
            if (testRoomId) {
                await prisma.room.delete({ where: { id: testRoomId } }).catch(() => {});
                testRoomId = null;
            }
        });

        test('creates a game linked to a room', async () => {
            const words = Array.from({ length: 25 }, (_, i) => `WORD${i + 1}`);
            const types = [
                ...Array(9).fill('red'),
                ...Array(8).fill('blue'),
                ...Array(7).fill('neutral'),
                'assassin'
            ];

            const game = await prisma.game.create({
                data: {
                    roomId: testRoomId,
                    seed: 'test-seed-123',
                    words: words,
                    types: types,
                    revealed: Array(25).fill(false),
                    currentTurn: 'red',
                    redTotal: 9,
                    blueTotal: 8
                }
            });
            testGameId = game.id;

            expect(game.id).toBeDefined();
            expect(game.roomId).toBe(testRoomId);
            expect(game.words).toHaveLength(25);
            expect(game.types).toHaveLength(25);
            expect(game.currentTurn).toBe('red');
        });

        test('updates game state after card reveal', async () => {
            const words = Array.from({ length: 25 }, (_, i) => `WORD${i + 1}`);
            const types = [
                ...Array(9).fill('red'),
                ...Array(8).fill('blue'),
                ...Array(7).fill('neutral'),
                'assassin'
            ];

            const game = await prisma.game.create({
                data: {
                    roomId: testRoomId,
                    seed: 'reveal-test',
                    words: words,
                    types: types,
                    revealed: Array(25).fill(false),
                    currentTurn: 'red'
                }
            });
            testGameId = game.id;

            // Simulate revealing a card
            const newRevealed = [...game.revealed];
            newRevealed[0] = true;

            const updated = await prisma.game.update({
                where: { id: game.id },
                data: {
                    revealed: newRevealed,
                    redScore: { increment: 1 }
                }
            });

            expect(updated.revealed[0]).toBe(true);
            expect(updated.redScore).toBe(1);
        });

        test('records game end state', async () => {
            const words = Array.from({ length: 25 }, (_, i) => `WORD${i + 1}`);
            const types = [
                ...Array(9).fill('red'),
                ...Array(8).fill('blue'),
                ...Array(7).fill('neutral'),
                'assassin'
            ];

            const game = await prisma.game.create({
                data: {
                    roomId: testRoomId,
                    seed: 'end-test',
                    words: words,
                    types: types,
                    revealed: Array(25).fill(false),
                    currentTurn: 'red'
                }
            });
            testGameId = game.id;

            const ended = await prisma.game.update({
                where: { id: game.id },
                data: {
                    gameOver: true,
                    winner: 'red',
                    endReason: 'completed',
                    endedAt: new Date()
                }
            });

            expect(ended.gameOver).toBe(true);
            expect(ended.winner).toBe('red');
            expect(ended.endReason).toBe('completed');
            expect(ended.endedAt).not.toBeNull();
        });

        test('cascades delete from room to games', async () => {
            const words = Array.from({ length: 25 }, (_, i) => `WORD${i + 1}`);
            const types = [
                ...Array(9).fill('red'),
                ...Array(8).fill('blue'),
                ...Array(7).fill('neutral'),
                'assassin'
            ];

            const game = await prisma.game.create({
                data: {
                    roomId: testRoomId,
                    seed: 'cascade-test',
                    words: words,
                    types: types,
                    revealed: Array(25).fill(false)
                }
            });
            const gameId = game.id;

            // Delete the room (should cascade to game)
            await prisma.room.delete({ where: { id: testRoomId } });
            testRoomId = null; // Already deleted

            // Game should be deleted too
            const deletedGame = await prisma.game.findUnique({
                where: { id: gameId }
            });

            expect(deletedGame).toBeNull();
        });
    });

    describe('User Model', () => {
        let testUserId;

        afterEach(async () => {
            if (testUserId) {
                await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
                testUserId = null;
            }
        });

        test('creates a user with unique username', async () => {
            const uniqueUsername = `testuser${Date.now()}`;
            const user = await prisma.user.create({
                data: {
                    username: uniqueUsername,
                    email: null
                }
            });
            testUserId = user.id;

            expect(user.id).toBeDefined();
            expect(user.username).toBe(uniqueUsername);
            expect(user.gamesPlayed).toBe(0);
            expect(user.gamesWon).toBe(0);
        });

        test('increments user game stats', async () => {
            const uniqueUsername = `statsuser${Date.now()}`;
            const user = await prisma.user.create({
                data: {
                    username: uniqueUsername
                }
            });
            testUserId = user.id;

            const updated = await prisma.user.update({
                where: { id: user.id },
                data: {
                    gamesPlayed: { increment: 1 },
                    gamesWon: { increment: 1 }
                }
            });

            expect(updated.gamesPlayed).toBe(1);
            expect(updated.gamesWon).toBe(1);
        });
    });
});

// Test for Prisma connection health
describe('Database Connection', () => {
    const skipConnectionTest = skipTests;

    (skipConnectionTest ? test.skip : test)('can connect to database', async () => {
        const testPrisma = new PrismaClient();
        await expect(testPrisma.$connect()).resolves.not.toThrow();
        await testPrisma.$disconnect();
    });
});
