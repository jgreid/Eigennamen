/**
 * Word List Service - Custom word list management
 *
 * NOTE: This service requires a database connection.
 * All functions return empty/null results when database is disabled.
 */

const { getDatabase, isDatabaseEnabled } = require('../config/database');
const logger = require('../utils/logger');
const { BOARD_SIZE } = require('../config/constants');
const { ServerError, ValidationError, WordListError, PlayerError } = require('../errors/GameError');
const { toEnglishUpperCase } = require('../utils/sanitize');

/**
 * Word list data structure
 */
export interface WordList {
    id: string;
    name: string;
    description: string | null;
    words: string[];
    isPublic: boolean;
    timesUsed: number;
    createdAt: Date;
    ownerId: string | null;
}

/**
 * Word list with word count (for list views)
 */
export interface WordListSummary {
    id: string;
    name: string;
    description: string | null;
    isPublic: boolean;
    timesUsed: number;
    createdAt: Date;
    wordCount: number;
}

/**
 * Options for getting public word lists
 */
export interface GetWordListsOptions {
    search?: string;
    limit?: number;
    offset?: number;
}

/**
 * Data for creating a word list
 */
export interface CreateWordListData {
    name: string;
    description?: string;
    words: string[];
    isPublic?: boolean;
    ownerId?: string | null;
}

/**
 * Data for updating a word list
 */
export interface UpdateWordListData {
    name?: string;
    description?: string;
    words?: string[];
    isPublic?: boolean;
}

/**
 * Prisma client type (simplified for migration)
 */
interface PrismaClient {
    wordList: {
        findUnique(args: {
            where: { id: string };
            select?: Record<string, boolean>;
        }): Promise<WordList | null>;
        findMany(args: {
            where?: Record<string, unknown>;
            select?: Record<string, boolean>;
            orderBy?: Record<string, string>;
            take?: number;
            skip?: number;
        }): Promise<Array<WordList & { words: string[] }>>;
        create(args: {
            data: Record<string, unknown>;
        }): Promise<WordList>;
        update(args: {
            where: { id: string };
            data: Record<string, unknown>;
        }): Promise<WordList>;
        delete(args: { where: { id: string } }): Promise<void>;
    };
}

/**
 * Get a word list by ID
 */
export async function getWordList(id: string): Promise<WordList | null> {
    if (!isDatabaseEnabled()) {
        return null;
    }
    const prisma: PrismaClient = getDatabase();

    try {
        const wordList = await prisma.wordList.findUnique({
            where: { id },
            select: {
                id: true,
                name: true,
                description: true,
                words: true,
                isPublic: true,
                timesUsed: true,
                createdAt: true,
                ownerId: true
            }
        });

        return wordList;
    } catch (error) {
        logger.error('Error fetching word list', { error: (error as Error).message });
        throw new ServerError('Failed to fetch word list');
    }
}

/**
 * Get all public word lists with optional search
 */
export async function getPublicWordLists(
    options: GetWordListsOptions = {}
): Promise<WordListSummary[]> {
    const { search = '', limit = 50, offset = 0 } = options;

    if (!isDatabaseEnabled()) {
        return [];
    }
    const prisma: PrismaClient = getDatabase();

    try {
        const where: Record<string, unknown> = {
            isPublic: true
        };

        if (search) {
            where['OR'] = [
                { name: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } }
            ];
        }

        const wordLists = await prisma.wordList.findMany({
            where,
            select: {
                id: true,
                name: true,
                description: true,
                isPublic: true,
                timesUsed: true,
                createdAt: true,
                words: true
            },
            orderBy: { timesUsed: 'desc' },
            take: Math.min(limit, 100),
            skip: offset
        });

        // Add word count to each list, exclude full words array from response
        return wordLists.map(({ words, ...rest }) => ({
            ...rest,
            wordCount: words.length
        }));
    } catch (error) {
        logger.error('Error fetching public word lists', { error: (error as Error).message });
        throw new ServerError('Failed to fetch word lists');
    }
}

/**
 * Get word lists owned by a user
 */
export async function getUserWordLists(ownerId: string): Promise<WordListSummary[]> {
    if (!isDatabaseEnabled()) {
        return [];
    }
    const prisma: PrismaClient = getDatabase();

    try {
        const wordLists = await prisma.wordList.findMany({
            where: { ownerId },
            select: {
                id: true,
                name: true,
                description: true,
                words: true,
                isPublic: true,
                timesUsed: true,
                createdAt: true
            },
            orderBy: { createdAt: 'desc' }
        });

        return wordLists.map(wl => ({
            ...wl,
            wordCount: wl.words.length
        }));
    } catch (error) {
        logger.error('Error fetching user word lists', { error: (error as Error).message });
        throw new ServerError('Failed to fetch word lists');
    }
}

/**
 * Create a new word list
 */
export async function createWordList(data: CreateWordListData): Promise<WordListSummary> {
    const { name, description, words, isPublic = false, ownerId = null } = data;

    if (!isDatabaseEnabled()) {
        throw new ServerError('Word list storage requires database (not configured)');
    }
    const prisma: PrismaClient = getDatabase();

    // Validate name
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        throw new ValidationError('Word list name is required');
    }

    // Validate minimum words
    if (!words || words.length < BOARD_SIZE) {
        throw new ValidationError(`Word list must contain at least ${BOARD_SIZE} words`);
    }

    // Clean and deduplicate words
    const cleanedWords = [...new Set(
        words
            .map(w => toEnglishUpperCase(w.trim()))
            .filter(w => w.length > 0)
    )];

    if (cleanedWords.length < BOARD_SIZE) {
        throw new ValidationError(`Word list must contain at least ${BOARD_SIZE} unique words after cleaning`);
    }

    try {
        const wordList = await prisma.wordList.create({
            data: {
                name: name.trim(),
                description: description?.trim() || null,
                words: cleanedWords,
                isPublic,
                ownerId
            }
        });

        logger.info(`Word list created: ${wordList.id} (${cleanedWords.length} words)`);

        return {
            ...wordList,
            wordCount: wordList.words.length
        };
    } catch (error) {
        logger.error('Error creating word list', { error: (error as Error).message });
        throw new ServerError('Failed to create word list');
    }
}

/**
 * Update a word list
 */
export async function updateWordList(
    id: string,
    data: UpdateWordListData,
    requesterId: string | null = null
): Promise<WordListSummary> {
    const { name, description, words, isPublic } = data;

    if (!isDatabaseEnabled()) {
        throw new ServerError('Word list storage requires database (not configured)');
    }
    const prisma: PrismaClient = getDatabase();

    // Check ownership
    const existing = await prisma.wordList.findUnique({ where: { id } });
    if (!existing) {
        throw WordListError.notFound(id);
    }

    // Anonymous word lists (no owner) are immutable
    if (!existing.ownerId) {
        throw PlayerError.notAuthorized();
    }

    // Check if requester is the owner
    if (!requesterId || existing.ownerId !== requesterId) {
        throw WordListError.notAuthorized(id);
    }

    const updateData: Record<string, unknown> = {};

    if (name !== undefined) {
        updateData['name'] = name.trim();
    }

    if (description !== undefined) {
        updateData['description'] = description?.trim() || null;
    }

    if (isPublic !== undefined) {
        updateData['isPublic'] = isPublic;
    }

    if (words !== undefined) {
        const cleanedWords = [...new Set(
            words
                .map(w => toEnglishUpperCase(w.trim()))
                .filter(w => w.length > 0)
        )];

        if (cleanedWords.length < BOARD_SIZE) {
            throw new ValidationError(`Word list must contain at least ${BOARD_SIZE} unique words`);
        }

        updateData['words'] = cleanedWords;
    }

    try {
        const wordList = await prisma.wordList.update({
            where: { id },
            data: updateData
        });

        logger.info(`Word list updated: ${id}`);

        return {
            ...wordList,
            wordCount: wordList.words.length
        };
    } catch (error) {
        logger.error('Error updating word list', { error: (error as Error).message });
        throw new ServerError('Failed to update word list');
    }
}

/**
 * Delete a word list
 */
export async function deleteWordList(
    id: string,
    requesterId: string | null = null
): Promise<void> {
    if (!isDatabaseEnabled()) {
        throw new ServerError('Word list storage requires database (not configured)');
    }
    const prisma: PrismaClient = getDatabase();

    // Check ownership
    const existing = await prisma.wordList.findUnique({ where: { id } });
    if (!existing) {
        throw WordListError.notFound(id);
    }

    // Anonymous word lists (no owner) cannot be deleted via API
    if (!existing.ownerId) {
        throw PlayerError.notAuthorized();
    }

    // Check if requester is the owner
    if (!requesterId || existing.ownerId !== requesterId) {
        throw WordListError.notAuthorized(id);
    }

    try {
        await prisma.wordList.delete({ where: { id } });
        logger.info(`Word list deleted: ${id}`);
    } catch (error) {
        logger.error('Error deleting word list', { error: (error as Error).message });
        throw new ServerError('Failed to delete word list');
    }
}

/**
 * Increment the usage count for a word list
 */
export async function incrementUsageCount(id: string): Promise<void> {
    if (!isDatabaseEnabled()) {
        return; // Silently skip if no database
    }
    const prisma: PrismaClient = getDatabase();

    try {
        await prisma.wordList.update({
            where: { id },
            data: { timesUsed: { increment: 1 } }
        });
    } catch (error) {
        // Non-critical, just log
        logger.warn(`Failed to increment usage count for word list ${id}:`, (error as Error).message);
    }
}

/**
 * Get words from a word list for game creation
 */
export async function getWordsForGame(id: string): Promise<string[] | null> {
    if (!isDatabaseEnabled()) {
        return null;
    }
    const prisma: PrismaClient = getDatabase();

    try {
        const wordList = await prisma.wordList.findUnique({
            where: { id },
            select: { words: true }
        });

        if (!wordList) {
            return null;
        }

        // Increment usage count in background (fire-and-forget with error handling)
        incrementUsageCount(id).catch(err => {
            logger.warn('Failed to increment word list usage count:', (err as Error).message);
        });

        return wordList.words;
    } catch (error) {
        logger.error('Error fetching words for game:', error);
        return null;
    }
}

// CommonJS exports for compatibility
module.exports = {
    getWordList,
    getPublicWordLists,
    getUserWordLists,
    createWordList,
    updateWordList,
    deleteWordList,
    incrementUsageCount,
    getWordsForGame
};
