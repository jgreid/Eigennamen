/**
 * Word List Service - Custom word list management
 */

const { getDatabase } = require('../config/database');
const logger = require('../utils/logger');
const { BOARD_SIZE, ERROR_CODES } = require('../config/constants');

/**
 * Get a word list by ID
 * @param {string} id - Word list UUID
 * @returns {Object|null} Word list or null if not found
 */
async function getWordList(id) {
    const prisma = getDatabase();

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
        logger.error('Error fetching word list:', error);
        throw { code: ERROR_CODES.SERVER_ERROR, message: 'Failed to fetch word list' };
    }
}

/**
 * Get all public word lists with optional search
 * @param {Object} options - Query options
 * @param {string} options.search - Search term for name/description
 * @param {number} options.limit - Max results (default 50)
 * @param {number} options.offset - Pagination offset
 * @returns {Array} Array of word lists
 */
async function getPublicWordLists({ search = '', limit = 50, offset = 0 } = {}) {
    const prisma = getDatabase();

    try {
        const where = {
            isPublic: true
        };

        if (search) {
            where.OR = [
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

        // Add word count to each list, exclude full words array
        return wordLists.map(({ words, ...rest }) => ({
            ...rest,
            wordCount: words.length
        }));
    } catch (error) {
        logger.error('Error fetching public word lists:', error);
        throw { code: ERROR_CODES.SERVER_ERROR, message: 'Failed to fetch word lists' };
    }
}

/**
 * Get word lists owned by a user
 * @param {string} ownerId - User UUID
 * @returns {Array} Array of word lists
 */
async function getUserWordLists(ownerId) {
    const prisma = getDatabase();

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
        logger.error('Error fetching user word lists:', error);
        throw { code: ERROR_CODES.SERVER_ERROR, message: 'Failed to fetch word lists' };
    }
}

/**
 * Create a new word list
 * @param {Object} data - Word list data
 * @param {string} data.name - List name
 * @param {string} data.description - List description
 * @param {Array<string>} data.words - Array of words
 * @param {boolean} data.isPublic - Whether list is public
 * @param {string} data.ownerId - Owner user ID (optional)
 * @returns {Object} Created word list
 */
async function createWordList({ name, description, words, isPublic = false, ownerId = null }) {
    const prisma = getDatabase();

    // Validate minimum words
    if (!words || words.length < BOARD_SIZE) {
        throw {
            code: ERROR_CODES.INVALID_INPUT,
            message: `Word list must contain at least ${BOARD_SIZE} words`
        };
    }

    // Clean and deduplicate words
    const cleanedWords = [...new Set(
        words
            .map(w => w.trim().toUpperCase())
            .filter(w => w.length > 0)
    )];

    if (cleanedWords.length < BOARD_SIZE) {
        throw {
            code: ERROR_CODES.INVALID_INPUT,
            message: `Word list must contain at least ${BOARD_SIZE} unique words after cleaning`
        };
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
        logger.error('Error creating word list:', error);
        throw { code: ERROR_CODES.SERVER_ERROR, message: 'Failed to create word list' };
    }
}

/**
 * Update a word list
 * @param {string} id - Word list ID
 * @param {Object} data - Update data
 * @param {string} requesterId - ID of user making request (for ownership check)
 * @returns {Object} Updated word list
 */
async function updateWordList(id, { name, description, words, isPublic }, requesterId = null) {
    const prisma = getDatabase();

    // Check ownership if requesterId provided
    const existing = await prisma.wordList.findUnique({ where: { id } });
    if (!existing) {
        throw { code: ERROR_CODES.WORD_LIST_NOT_FOUND, message: 'Word list not found' };
    }

    if (requesterId && existing.ownerId && existing.ownerId !== requesterId) {
        throw { code: ERROR_CODES.NOT_AUTHORIZED, message: 'Not authorized to update this word list' };
    }

    const updateData = {};

    if (name !== undefined) {
        updateData.name = name.trim();
    }

    if (description !== undefined) {
        updateData.description = description?.trim() || null;
    }

    if (isPublic !== undefined) {
        updateData.isPublic = isPublic;
    }

    if (words !== undefined) {
        const cleanedWords = [...new Set(
            words
                .map(w => w.trim().toUpperCase())
                .filter(w => w.length > 0)
        )];

        if (cleanedWords.length < BOARD_SIZE) {
            throw {
                code: ERROR_CODES.INVALID_INPUT,
                message: `Word list must contain at least ${BOARD_SIZE} unique words`
            };
        }

        updateData.words = cleanedWords;
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
        logger.error('Error updating word list:', error);
        throw { code: ERROR_CODES.SERVER_ERROR, message: 'Failed to update word list' };
    }
}

/**
 * Delete a word list
 * @param {string} id - Word list ID
 * @param {string} requesterId - ID of user making request (for ownership check)
 */
async function deleteWordList(id, requesterId = null) {
    const prisma = getDatabase();

    // Check ownership if requesterId provided
    const existing = await prisma.wordList.findUnique({ where: { id } });
    if (!existing) {
        throw { code: ERROR_CODES.WORD_LIST_NOT_FOUND, message: 'Word list not found' };
    }

    if (requesterId && existing.ownerId && existing.ownerId !== requesterId) {
        throw { code: ERROR_CODES.NOT_AUTHORIZED, message: 'Not authorized to delete this word list' };
    }

    try {
        await prisma.wordList.delete({ where: { id } });
        logger.info(`Word list deleted: ${id}`);
    } catch (error) {
        logger.error('Error deleting word list:', error);
        throw { code: ERROR_CODES.SERVER_ERROR, message: 'Failed to delete word list' };
    }
}

/**
 * Increment the usage count for a word list
 * @param {string} id - Word list ID
 */
async function incrementUsageCount(id) {
    const prisma = getDatabase();

    try {
        await prisma.wordList.update({
            where: { id },
            data: { timesUsed: { increment: 1 } }
        });
    } catch (error) {
        // Non-critical, just log
        logger.warn(`Failed to increment usage count for word list ${id}:`, error.message);
    }
}

/**
 * Get words from a word list for game creation
 * @param {string} id - Word list ID
 * @returns {Array<string>|null} Array of words or null if not found
 */
async function getWordsForGame(id) {
    const prisma = getDatabase();

    try {
        const wordList = await prisma.wordList.findUnique({
            where: { id },
            select: { words: true }
        });

        if (!wordList) {
            return null;
        }

        // Increment usage count in background
        incrementUsageCount(id);

        return wordList.words;
    } catch (error) {
        logger.error('Error fetching words for game:', error);
        return null;
    }
}

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
