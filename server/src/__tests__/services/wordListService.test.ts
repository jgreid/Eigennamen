/**
 * Tests for Word List Service
 */

const {
    getWordList,
    getPublicWordLists,
    getUserWordLists,
    createWordList,
    updateWordList,
    deleteWordList,
    incrementUsageCount,
    getWordsForGame
} = require('../../services/wordListService');

// Mock database
const mockPrisma = {
    wordList: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
    }
};

let mockIsDatabaseEnabled = true;

jest.mock('../../config/database', () => ({
    getDatabase: () => mockPrisma,
    isDatabaseEnabled: () => mockIsDatabaseEnabled
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
}));

const { BOARD_SIZE, ERROR_CODES } = require('../../config/constants');

describe('WordListService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockIsDatabaseEnabled = true;
    });

    describe('getWordList', () => {
        it('should return word list by ID', async () => {
            const mockWordList = {
                id: 'uuid-123',
                name: 'Test List',
                description: 'A test word list',
                words: ['WORD1', 'WORD2'],
                isPublic: true,
                timesUsed: 5,
                createdAt: new Date(),
                ownerId: 'owner-456'
            };
            mockPrisma.wordList.findUnique.mockResolvedValueOnce(mockWordList);

            const result = await getWordList('uuid-123');

            expect(result).toEqual(mockWordList);
            expect(mockPrisma.wordList.findUnique).toHaveBeenCalledWith({
                where: { id: 'uuid-123' },
                select: expect.any(Object)
            });
        });

        it('should return null when database is disabled', async () => {
            mockIsDatabaseEnabled = false;

            const result = await getWordList('uuid-123');

            expect(result).toBeNull();
            expect(mockPrisma.wordList.findUnique).not.toHaveBeenCalled();
        });

        it('should return null when word list not found', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValueOnce(null);

            const result = await getWordList('nonexistent');

            expect(result).toBeNull();
        });

        it('should throw on database error', async () => {
            mockPrisma.wordList.findUnique.mockRejectedValueOnce(new Error('DB error'));

            await expect(getWordList('uuid-123')).rejects.toMatchObject({
                code: ERROR_CODES.SERVER_ERROR
            });
        });
    });

    describe('getPublicWordLists', () => {
        it('should return public word lists', async () => {
            const mockLists = [
                { id: '1', name: 'List 1', words: ['A', 'B', 'C'], isPublic: true, timesUsed: 10 },
                { id: '2', name: 'List 2', words: ['D', 'E'], isPublic: true, timesUsed: 5 }
            ];
            mockPrisma.wordList.findMany.mockResolvedValueOnce(mockLists);

            const result = await getPublicWordLists();

            expect(result).toHaveLength(2);
            expect(result[0].wordCount).toBe(3);
            expect(result[1].wordCount).toBe(2);
            // Should not include full words array
            expect(result[0].words).toBeUndefined();
        });

        it('should return empty array when database is disabled', async () => {
            mockIsDatabaseEnabled = false;

            const result = await getPublicWordLists();

            expect(result).toEqual([]);
        });

        it('should apply search filter', async () => {
            mockPrisma.wordList.findMany.mockResolvedValueOnce([]);

            await getPublicWordLists({ search: 'test' });

            expect(mockPrisma.wordList.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        isPublic: true,
                        OR: expect.any(Array)
                    })
                })
            );
        });

        it('should apply pagination', async () => {
            mockPrisma.wordList.findMany.mockResolvedValueOnce([]);

            await getPublicWordLists({ limit: 10, offset: 20 });

            expect(mockPrisma.wordList.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    take: 10,
                    skip: 20
                })
            );
        });

        it('should cap limit at 100', async () => {
            mockPrisma.wordList.findMany.mockResolvedValueOnce([]);

            await getPublicWordLists({ limit: 500 });

            expect(mockPrisma.wordList.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    take: 100
                })
            );
        });

        it('should throw on database error', async () => {
            mockPrisma.wordList.findMany.mockRejectedValueOnce(new Error('DB error'));

            await expect(getPublicWordLists()).rejects.toMatchObject({
                code: ERROR_CODES.SERVER_ERROR
            });
        });
    });

    describe('getUserWordLists', () => {
        it('should return user word lists', async () => {
            const mockLists = [
                { id: '1', name: 'My List', words: ['A', 'B'], ownerId: 'user-123' }
            ];
            mockPrisma.wordList.findMany.mockResolvedValueOnce(mockLists);

            const result = await getUserWordLists('user-123');

            expect(result).toHaveLength(1);
            expect(result[0].wordCount).toBe(2);
            expect(mockPrisma.wordList.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { ownerId: 'user-123' }
                })
            );
        });

        it('should return empty array when database is disabled', async () => {
            mockIsDatabaseEnabled = false;

            const result = await getUserWordLists('user-123');

            expect(result).toEqual([]);
        });

        it('should throw on database error', async () => {
            mockPrisma.wordList.findMany.mockRejectedValueOnce(new Error('DB error'));

            await expect(getUserWordLists('user-123')).rejects.toMatchObject({
                code: ERROR_CODES.SERVER_ERROR
            });
        });
    });

    describe('createWordList', () => {
        const validWords = Array(30).fill(null).map((_, i) => `Word${i}`);

        it('should create word list', async () => {
            const createdList = {
                id: 'new-uuid',
                name: 'Test List',
                description: 'Test description',
                words: validWords.map(w => w.toUpperCase()),
                isPublic: false,
                ownerId: 'user-123'
            };
            mockPrisma.wordList.create.mockResolvedValueOnce(createdList);

            const result = await createWordList({
                name: '  Test List  ',
                description: 'Test description',
                words: validWords,
                isPublic: false,
                ownerId: 'user-123'
            });

            expect(result.id).toBe('new-uuid');
            expect(result.wordCount).toBe(30);
            expect(mockPrisma.wordList.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    name: 'Test List',  // Trimmed
                    isPublic: false
                })
            });
        });

        it('should throw when database is disabled', async () => {
            mockIsDatabaseEnabled = false;

            await expect(createWordList({
                name: 'Test',
                words: validWords
            })).rejects.toMatchObject({
                code: ERROR_CODES.SERVER_ERROR,
                message: expect.stringContaining('database')
            });
        });

        it('should throw when not enough words', async () => {
            const fewWords = Array(10).fill(null).map((_, i) => `Word${i}`);

            await expect(createWordList({
                name: 'Test',
                words: fewWords
            })).rejects.toMatchObject({
                code: ERROR_CODES.INVALID_INPUT,
                message: expect.stringContaining(`${BOARD_SIZE}`)
            });
        });

        it('should deduplicate words', async () => {
            const duplicateWords = [...validWords, ...validWords]; // Double the words
            mockPrisma.wordList.create.mockResolvedValueOnce({
                id: 'new-uuid',
                words: validWords.map(w => w.toUpperCase())
            });

            await createWordList({
                name: 'Test',
                words: duplicateWords
            });

            expect(mockPrisma.wordList.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    words: expect.arrayContaining([expect.any(String)])
                })
            });
            // The words array should be deduplicated
            const createCall = mockPrisma.wordList.create.mock.calls[0][0];
            expect(createCall.data.words.length).toBeLessThanOrEqual(validWords.length);
        });

        it('should throw when too few unique words after cleaning', async () => {
            const duplicateWords = Array(30).fill('SAME');

            await expect(createWordList({
                name: 'Test',
                words: duplicateWords
            })).rejects.toMatchObject({
                code: ERROR_CODES.INVALID_INPUT
            });
        });

        it('should filter empty words', async () => {
            const wordsWithEmpty = [...validWords, '', '  ', '\t'];
            mockPrisma.wordList.create.mockResolvedValueOnce({
                id: 'new-uuid',
                words: validWords.map(w => w.toUpperCase())
            });

            await createWordList({
                name: 'Test',
                words: wordsWithEmpty
            });

            const createCall = mockPrisma.wordList.create.mock.calls[0][0];
            expect(createCall.data.words.every(w => w.length > 0)).toBe(true);
        });

        it('should uppercase all words', async () => {
            mockPrisma.wordList.create.mockResolvedValueOnce({
                id: 'new-uuid',
                words: validWords.map(w => w.toUpperCase())
            });

            await createWordList({
                name: 'Test',
                words: validWords
            });

            const createCall = mockPrisma.wordList.create.mock.calls[0][0];
            expect(createCall.data.words.every(w => w === w.toUpperCase())).toBe(true);
        });

        it('should throw on database error', async () => {
            mockPrisma.wordList.create.mockRejectedValueOnce(new Error('DB error'));

            await expect(createWordList({
                name: 'Test',
                words: validWords
            })).rejects.toMatchObject({
                code: ERROR_CODES.SERVER_ERROR
            });
        });
    });

    describe('updateWordList', () => {
        const validWords = Array(30).fill(null).map((_, i) => `Word${i}`);

        it('should update word list when owner', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValueOnce({
                id: 'uuid-123',
                ownerId: 'user-123'
            });
            mockPrisma.wordList.update.mockResolvedValueOnce({
                id: 'uuid-123',
                name: 'Updated Name',
                words: validWords
            });

            const result = await updateWordList(
                'uuid-123',
                { name: '  Updated Name  ' },
                'user-123'
            );

            expect(result.id).toBe('uuid-123');
            expect(mockPrisma.wordList.update).toHaveBeenCalledWith({
                where: { id: 'uuid-123' },
                data: { name: 'Updated Name' }
            });
        });

        it('should throw when database is disabled', async () => {
            mockIsDatabaseEnabled = false;

            await expect(updateWordList('uuid-123', { name: 'Test' })).rejects.toMatchObject({
                code: ERROR_CODES.SERVER_ERROR
            });
        });

        it('should throw when word list not found', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValueOnce(null);

            await expect(updateWordList('nonexistent', { name: 'Test' })).rejects.toMatchObject({
                code: ERROR_CODES.WORD_LIST_NOT_FOUND
            });
        });

        it('should throw when trying to update anonymous word list', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValueOnce({
                id: 'uuid-123',
                ownerId: null  // Anonymous
            });

            await expect(updateWordList('uuid-123', { name: 'Test' })).rejects.toMatchObject({
                code: ERROR_CODES.NOT_AUTHORIZED
            });
        });

        it('should throw when requester is not owner', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValueOnce({
                id: 'uuid-123',
                ownerId: 'user-123'
            });

            await expect(updateWordList('uuid-123', { name: 'Test' }, 'different-user')).rejects.toMatchObject({
                code: ERROR_CODES.NOT_AUTHORIZED
            });
        });

        it('should validate updated words', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValueOnce({
                id: 'uuid-123',
                ownerId: 'user-123'
            });

            await expect(updateWordList(
                'uuid-123',
                { words: ['A', 'B', 'C'] },  // Not enough words
                'user-123'
            )).rejects.toMatchObject({
                code: ERROR_CODES.INVALID_INPUT
            });
        });

        it('should allow partial updates', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValueOnce({
                id: 'uuid-123',
                ownerId: 'user-123'
            });
            mockPrisma.wordList.update.mockResolvedValueOnce({
                id: 'uuid-123',
                isPublic: true,
                words: validWords
            });

            await updateWordList('uuid-123', { isPublic: true }, 'user-123');

            expect(mockPrisma.wordList.update).toHaveBeenCalledWith({
                where: { id: 'uuid-123' },
                data: { isPublic: true }
            });
        });

        it('should throw on database error', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValueOnce({
                id: 'uuid-123',
                ownerId: 'user-123'
            });
            mockPrisma.wordList.update.mockRejectedValueOnce(new Error('DB error'));

            await expect(updateWordList('uuid-123', { name: 'Test' }, 'user-123')).rejects.toMatchObject({
                code: ERROR_CODES.SERVER_ERROR
            });
        });
    });

    describe('deleteWordList', () => {
        it('should delete word list when owner', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValueOnce({
                id: 'uuid-123',
                ownerId: 'user-123'
            });
            mockPrisma.wordList.delete.mockResolvedValueOnce({});

            await deleteWordList('uuid-123', 'user-123');

            expect(mockPrisma.wordList.delete).toHaveBeenCalledWith({
                where: { id: 'uuid-123' }
            });
        });

        it('should throw when database is disabled', async () => {
            mockIsDatabaseEnabled = false;

            await expect(deleteWordList('uuid-123', 'user-123')).rejects.toMatchObject({
                code: ERROR_CODES.SERVER_ERROR
            });
        });

        it('should throw when word list not found', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValueOnce(null);

            await expect(deleteWordList('nonexistent', 'user-123')).rejects.toMatchObject({
                code: ERROR_CODES.WORD_LIST_NOT_FOUND
            });
        });

        it('should throw when trying to delete anonymous word list', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValueOnce({
                id: 'uuid-123',
                ownerId: null
            });

            await expect(deleteWordList('uuid-123', 'user-123')).rejects.toMatchObject({
                code: ERROR_CODES.NOT_AUTHORIZED
            });
        });

        it('should throw when requester is not owner', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValueOnce({
                id: 'uuid-123',
                ownerId: 'user-123'
            });

            await expect(deleteWordList('uuid-123', 'different-user')).rejects.toMatchObject({
                code: ERROR_CODES.NOT_AUTHORIZED
            });
        });

        it('should throw on database error', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValueOnce({
                id: 'uuid-123',
                ownerId: 'user-123'
            });
            mockPrisma.wordList.delete.mockRejectedValueOnce(new Error('DB error'));

            await expect(deleteWordList('uuid-123', 'user-123')).rejects.toMatchObject({
                code: ERROR_CODES.SERVER_ERROR
            });
        });
    });

    describe('incrementUsageCount', () => {
        it('should increment usage count', async () => {
            mockPrisma.wordList.update.mockResolvedValueOnce({});

            await incrementUsageCount('uuid-123');

            expect(mockPrisma.wordList.update).toHaveBeenCalledWith({
                where: { id: 'uuid-123' },
                data: { timesUsed: { increment: 1 } }
            });
        });

        it('should silently skip when database is disabled', async () => {
            mockIsDatabaseEnabled = false;

            await incrementUsageCount('uuid-123');

            expect(mockPrisma.wordList.update).not.toHaveBeenCalled();
        });

        it('should not throw on error (non-critical)', async () => {
            mockPrisma.wordList.update.mockRejectedValueOnce(new Error('DB error'));

            // Should not throw
            await expect(incrementUsageCount('uuid-123')).resolves.not.toThrow();
        });
    });

    describe('getWordsForGame', () => {
        it('should return words from word list', async () => {
            const mockWords = ['WORD1', 'WORD2', 'WORD3'];
            mockPrisma.wordList.findUnique.mockResolvedValueOnce({ words: mockWords });
            mockPrisma.wordList.update.mockResolvedValueOnce({});

            const result = await getWordsForGame('uuid-123');

            expect(result).toEqual(mockWords);
        });

        it('should return null when database is disabled', async () => {
            mockIsDatabaseEnabled = false;

            const result = await getWordsForGame('uuid-123');

            expect(result).toBeNull();
        });

        it('should return null when word list not found', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValueOnce(null);

            const result = await getWordsForGame('nonexistent');

            expect(result).toBeNull();
        });

        it('should return null on error', async () => {
            mockPrisma.wordList.findUnique.mockRejectedValueOnce(new Error('DB error'));

            const result = await getWordsForGame('uuid-123');

            expect(result).toBeNull();
        });

        it('should increment usage count in background', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValueOnce({ words: ['WORD1'] });
            mockPrisma.wordList.update.mockResolvedValueOnce({});

            await getWordsForGame('uuid-123');

            // Wait for the fire-and-forget promise
            await new Promise(resolve => setImmediate(resolve));

            expect(mockPrisma.wordList.update).toHaveBeenCalled();
        });

        it('should not fail if usage count increment fails', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValueOnce({ words: ['WORD1'] });
            mockPrisma.wordList.update.mockRejectedValueOnce(new Error('DB error'));

            const result = await getWordsForGame('uuid-123');

            expect(result).toEqual(['WORD1']);
        });
    });
});
