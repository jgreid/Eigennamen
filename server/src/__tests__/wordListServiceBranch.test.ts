/**
 * Word List Service Branch Coverage Tests
 *
 * Tests edge cases in word list creation/validation including:
 * - Database disabled paths
 * - Word cleaning/deduplication edge cases
 * - Update ownership checks
 * - Delete ownership checks
 * - Error handling branches
 */

const mockPrisma = {
    wordList: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
    }
};

let mockDbEnabled = true;

jest.mock('../config/database', () => ({
    getDatabase: () => mockPrisma,
    isDatabaseEnabled: () => mockDbEnabled
}));

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../utils/sanitize', () => ({
    toEnglishUpperCase: (s: string) => s.toUpperCase()
}));

const wordListService = require('../services/wordListService');

describe('Word List Service Branch Coverage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockDbEnabled = true;
    });

    describe('getWordList - database disabled', () => {
        it('should return null when database is disabled', async () => {
            mockDbEnabled = false;
            const result = await wordListService.getWordList('some-id');
            expect(result).toBeNull();
        });

        it('should return word list when found', async () => {
            const wl = { id: 'wl-1', name: 'Test', words: ['A', 'B'] };
            mockPrisma.wordList.findUnique.mockResolvedValue(wl);

            const result = await wordListService.getWordList('wl-1');
            expect(result).toEqual(wl);
        });

        it('should throw ServerError on database error', async () => {
            mockPrisma.wordList.findUnique.mockRejectedValue(new Error('DB Error'));

            await expect(wordListService.getWordList('wl-1'))
                .rejects.toThrow('Failed to fetch word list');
        });
    });

    describe('getPublicWordLists', () => {
        it('should return empty array when database disabled', async () => {
            mockDbEnabled = false;
            const result = await wordListService.getPublicWordLists();
            expect(result).toEqual([]);
        });

        it('should apply search filter', async () => {
            mockPrisma.wordList.findMany.mockResolvedValue([
                { id: '1', name: 'Test', words: ['A', 'B', 'C'] }
            ]);

            const result = await wordListService.getPublicWordLists({ search: 'test' });
            expect(result).toHaveLength(1);
            expect(result[0].wordCount).toBe(3);
        });

        it('should cap limit at 100', async () => {
            mockPrisma.wordList.findMany.mockResolvedValue([]);

            await wordListService.getPublicWordLists({ limit: 500 });
            expect(mockPrisma.wordList.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ take: 100 })
            );
        });

        it('should handle no search parameter', async () => {
            mockPrisma.wordList.findMany.mockResolvedValue([]);

            await wordListService.getPublicWordLists({});
            // No OR clause in where
            expect(mockPrisma.wordList.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { isPublic: true }
                })
            );
        });

        it('should throw on database error', async () => {
            mockPrisma.wordList.findMany.mockRejectedValue(new Error('DB Error'));

            await expect(wordListService.getPublicWordLists())
                .rejects.toThrow('Failed to fetch word lists');
        });
    });

    describe('getUserWordLists', () => {
        it('should return empty array when database disabled', async () => {
            mockDbEnabled = false;
            const result = await wordListService.getUserWordLists('owner-1');
            expect(result).toEqual([]);
        });

        it('should return user word lists with word count', async () => {
            mockPrisma.wordList.findMany.mockResolvedValue([
                { id: '1', name: 'My List', words: ['A', 'B'] }
            ]);

            const result = await wordListService.getUserWordLists('owner-1');
            expect(result[0].wordCount).toBe(2);
        });

        it('should throw on database error', async () => {
            mockPrisma.wordList.findMany.mockRejectedValue(new Error('DB Error'));

            await expect(wordListService.getUserWordLists('owner-1'))
                .rejects.toThrow('Failed to fetch word lists');
        });
    });

    describe('createWordList - validation edge cases', () => {
        it('should throw when database is disabled', async () => {
            mockDbEnabled = false;
            await expect(wordListService.createWordList({
                name: 'Test', words: Array(25).fill('word')
            })).rejects.toThrow('requires database');
        });

        it('should throw for empty name', async () => {
            await expect(wordListService.createWordList({
                name: '', words: Array(25).fill('word')
            })).rejects.toThrow('Word list name is required');
        });

        it('should throw for whitespace-only name', async () => {
            await expect(wordListService.createWordList({
                name: '   ', words: Array(25).fill('word')
            })).rejects.toThrow('Word list name is required');
        });

        it('should throw for null name', async () => {
            await expect(wordListService.createWordList({
                name: null as unknown as string, words: Array(25).fill('word')
            })).rejects.toThrow('Word list name is required');
        });

        it('should throw for too few words', async () => {
            await expect(wordListService.createWordList({
                name: 'Test', words: ['A', 'B']
            })).rejects.toThrow('at least 25 words');
        });

        it('should throw for null words array', async () => {
            await expect(wordListService.createWordList({
                name: 'Test', words: null as unknown as string[]
            })).rejects.toThrow('at least 25 words');
        });

        it('should deduplicate words', async () => {
            const words = Array(25).fill('SAME');
            // After dedup, only 1 unique word
            await expect(wordListService.createWordList({
                name: 'Test', words
            })).rejects.toThrow('unique words after cleaning');
        });

        it('should filter out empty strings', async () => {
            const words = [...Array(25).fill('WORD'), ...Array(10).fill('')];
            // Only 1 unique word after cleaning
            await expect(wordListService.createWordList({
                name: 'Test', words
            })).rejects.toThrow('unique words after cleaning');
        });

        it('should create successfully with valid data', async () => {
            const words = Array.from({ length: 30 }, (_, i) => `word${i}`);
            const created = {
                id: 'new-id',
                name: 'Test',
                description: null,
                words: words.map(w => w.toUpperCase()),
                isPublic: false,
                timesUsed: 0,
                createdAt: new Date(),
                ownerId: null
            };
            mockPrisma.wordList.create.mockResolvedValue(created);

            const result = await wordListService.createWordList({
                name: 'Test', words, description: '  My description  '
            });
            expect(result.id).toBe('new-id');
            expect(result.wordCount).toBe(30);
        });

        it('should create with explicit isPublic and ownerId', async () => {
            const words = Array.from({ length: 30 }, (_, i) => `word${i}`);
            const created = {
                id: 'new-id',
                name: 'Test',
                description: null,
                words: words.map(w => w.toUpperCase()),
                isPublic: true,
                timesUsed: 0,
                createdAt: new Date(),
                ownerId: 'owner-1'
            };
            mockPrisma.wordList.create.mockResolvedValue(created);

            const result = await wordListService.createWordList({
                name: 'Test', words, isPublic: true, ownerId: 'owner-1'
            });
            expect(result.wordCount).toBe(30);
        });

        it('should throw ServerError on create error', async () => {
            const words = Array.from({ length: 30 }, (_, i) => `word${i}`);
            mockPrisma.wordList.create.mockRejectedValue(new Error('DB Error'));

            await expect(wordListService.createWordList({
                name: 'Test', words
            })).rejects.toThrow('Failed to create word list');
        });
    });

    describe('updateWordList - ownership and edge cases', () => {
        it('should throw when database is disabled', async () => {
            mockDbEnabled = false;
            await expect(wordListService.updateWordList('id', {}))
                .rejects.toThrow('requires database');
        });

        it('should throw when word list not found', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValue(null);

            await expect(wordListService.updateWordList('missing-id', {}))
                .rejects.toThrow('Word list not found');
        });

        it('should throw for anonymous (no owner) word list', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValue({
                id: 'wl-1', ownerId: null
            });

            await expect(wordListService.updateWordList('wl-1', {}))
                .rejects.toThrow('Not authorized');
        });

        it('should throw when requester does not match owner', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValue({
                id: 'wl-1', ownerId: 'owner-1'
            });

            await expect(wordListService.updateWordList('wl-1', {}, 'other-user'))
                .rejects.toThrow('Not authorized');
        });

        it('should throw when requester is null', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValue({
                id: 'wl-1', ownerId: 'owner-1'
            });

            await expect(wordListService.updateWordList('wl-1', {}, null))
                .rejects.toThrow('Not authorized');
        });

        it('should update name', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValue({
                id: 'wl-1', ownerId: 'owner-1'
            });
            mockPrisma.wordList.update.mockResolvedValue({
                id: 'wl-1', name: 'New Name', words: ['A', 'B']
            });

            const result = await wordListService.updateWordList('wl-1', { name: ' New Name ' }, 'owner-1');
            expect(result.id).toBe('wl-1');
        });

        it('should update description', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValue({
                id: 'wl-1', ownerId: 'owner-1'
            });
            mockPrisma.wordList.update.mockResolvedValue({
                id: 'wl-1', description: 'New Desc', words: ['A']
            });

            const result = await wordListService.updateWordList('wl-1', { description: '  New Desc  ' }, 'owner-1');
            expect(result).toBeDefined();
        });

        it('should update description to null when empty', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValue({
                id: 'wl-1', ownerId: 'owner-1'
            });
            mockPrisma.wordList.update.mockResolvedValue({
                id: 'wl-1', description: null, words: ['A']
            });

            await wordListService.updateWordList('wl-1', { description: '' }, 'owner-1');
            expect(mockPrisma.wordList.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ description: null })
                })
            );
        });

        it('should update isPublic', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValue({
                id: 'wl-1', ownerId: 'owner-1'
            });
            mockPrisma.wordList.update.mockResolvedValue({
                id: 'wl-1', isPublic: true, words: ['A']
            });

            await wordListService.updateWordList('wl-1', { isPublic: true }, 'owner-1');
            expect(mockPrisma.wordList.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ isPublic: true })
                })
            );
        });

        it('should update words with validation', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValue({
                id: 'wl-1', ownerId: 'owner-1'
            });

            const newWords = Array.from({ length: 30 }, (_, i) => `word${i}`);
            mockPrisma.wordList.update.mockResolvedValue({
                id: 'wl-1', words: newWords.map(w => w.toUpperCase())
            });

            await wordListService.updateWordList('wl-1', { words: newWords }, 'owner-1');
            expect(mockPrisma.wordList.update).toHaveBeenCalled();
        });

        it('should throw when updated words have too few unique words', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValue({
                id: 'wl-1', ownerId: 'owner-1'
            });

            await expect(wordListService.updateWordList('wl-1', {
                words: Array(25).fill('SAME')
            }, 'owner-1')).rejects.toThrow('unique words');
        });

        it('should throw ServerError on update database error', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValue({
                id: 'wl-1', ownerId: 'owner-1'
            });
            mockPrisma.wordList.update.mockRejectedValue(new Error('DB Error'));

            await expect(wordListService.updateWordList('wl-1', { name: 'New' }, 'owner-1'))
                .rejects.toThrow('Failed to update word list');
        });
    });

    describe('deleteWordList - ownership and edge cases', () => {
        it('should throw when database disabled', async () => {
            mockDbEnabled = false;
            await expect(wordListService.deleteWordList('id'))
                .rejects.toThrow('requires database');
        });

        it('should throw when not found', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValue(null);

            await expect(wordListService.deleteWordList('missing'))
                .rejects.toThrow('Word list not found');
        });

        it('should throw for anonymous word list', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValue({
                id: 'wl-1', ownerId: null
            });

            await expect(wordListService.deleteWordList('wl-1'))
                .rejects.toThrow('Not authorized');
        });

        it('should throw when requester does not match owner', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValue({
                id: 'wl-1', ownerId: 'owner-1'
            });

            await expect(wordListService.deleteWordList('wl-1', 'other'))
                .rejects.toThrow('Not authorized');
        });

        it('should throw when requester is null', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValue({
                id: 'wl-1', ownerId: 'owner-1'
            });

            await expect(wordListService.deleteWordList('wl-1', null))
                .rejects.toThrow('Not authorized');
        });

        it('should delete successfully', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValue({
                id: 'wl-1', ownerId: 'owner-1'
            });
            mockPrisma.wordList.delete.mockResolvedValue(undefined);

            await expect(wordListService.deleteWordList('wl-1', 'owner-1'))
                .resolves.toBeUndefined();
        });

        it('should throw on database error during delete', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValue({
                id: 'wl-1', ownerId: 'owner-1'
            });
            mockPrisma.wordList.delete.mockRejectedValue(new Error('DB Error'));

            await expect(wordListService.deleteWordList('wl-1', 'owner-1'))
                .rejects.toThrow('Failed to delete word list');
        });
    });

    describe('incrementUsageCount', () => {
        it('should skip when database disabled', async () => {
            mockDbEnabled = false;
            await expect(wordListService.incrementUsageCount('id'))
                .resolves.toBeUndefined();
        });

        it('should increment successfully', async () => {
            mockPrisma.wordList.update.mockResolvedValue({});
            await expect(wordListService.incrementUsageCount('id'))
                .resolves.toBeUndefined();
        });

        it('should silently log on error', async () => {
            mockPrisma.wordList.update.mockRejectedValue(new Error('DB Error'));
            // Should not throw
            await expect(wordListService.incrementUsageCount('id'))
                .resolves.toBeUndefined();
        });
    });

    describe('getWordsForGame', () => {
        it('should return null when database disabled', async () => {
            mockDbEnabled = false;
            const result = await wordListService.getWordsForGame('id');
            expect(result).toBeNull();
        });

        it('should return null when word list not found', async () => {
            mockPrisma.wordList.findUnique.mockResolvedValue(null);
            const result = await wordListService.getWordsForGame('id');
            expect(result).toBeNull();
        });

        it('should return words and increment usage', async () => {
            const words = ['A', 'B', 'C'];
            mockPrisma.wordList.findUnique.mockResolvedValue({ words });
            mockPrisma.wordList.update.mockResolvedValue({});

            const result = await wordListService.getWordsForGame('id');
            expect(result).toEqual(words);
        });

        it('should return null on database error', async () => {
            mockPrisma.wordList.findUnique.mockRejectedValue(new Error('DB Error'));
            const result = await wordListService.getWordsForGame('id');
            expect(result).toBeNull();
        });
    });
});
