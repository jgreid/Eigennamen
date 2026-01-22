/**
 * Word List Service - Custom word list management
 *
 * NOTE: This service requires a database connection.
 * All functions return empty/null results when database is disabled.
 */

const { getDatabase, isDatabaseEnabled } = require('../config/database');
const logger = require('../utils/logger');
const { BOARD_SIZE, ERROR_CODES } = require('../config/constants');
const { ServerError, ValidationError, WordListError, PlayerError } = require('../errors/GameError');
const crypto = require('crypto');

/**
 * Generate a secure edit token for anonymous word lists
 * @private Reserved for future anonymous edit feature
 */
function _generateEditToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Hash an edit token for secure storage
 * @private Reserved for future anonymous edit feature
 */
function _hashEditToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Get a word list by ID
 * @param {string} id - Word list UUID
 * @returns {Object|null} Word list or null if not found/database disabled
 */
async function getWordList(id) {
    if (!isDatabaseEnabled()) {
        return null;
    }
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
        logger.error('Error fetching word list', { error: error.message });
        throw new ServerError('Failed to fetch word list');
    }
}

/**
 * Get all public word lists with optional search
 * @param {Object} options - Query options
 * @param {string} options.search - Search term for name/description
 * @param {number} options.limit - Max results (default 50)
 * @param {number} options.offset - Pagination offset
 * @returns {Array} Array of word lists (empty if database disabled)
 */
async function getPublicWordLists({ search = '', limit = 50, offset = 0 } = {}) {
    if (!isDatabaseEnabled()) {
        return [];
    }
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
        logger.error('Error fetching public word lists', { error: error.message });
        throw new ServerError('Failed to fetch word lists');
    }
}

/**
 * Get word lists owned by a user
 * @param {string} ownerId - User UUID
 * @returns {Array} Array of word lists (empty if database disabled)
 */
async function getUserWordLists(ownerId) {
    if (!isDatabaseEnabled()) {
        return [];
    }
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
        logger.error('Error fetching user word lists', { error: error.message });
        throw new ServerError('Failed to fetch word lists');
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
 * @throws {Object} Error if database is disabled
 */
async function createWordList({ name, description, words, isPublic = false, ownerId = null }) {
    if (!isDatabaseEnabled()) {
        throw new ServerError('Word list storage requires database (not configured)');
    }
    const prisma = getDatabase();

    // Validate minimum words
    if (!words || words.length < BOARD_SIZE) {
        throw new ValidationError(`Word list must contain at least ${BOARD_SIZE} words`);
    }

    // Clean and deduplicate words
    const cleanedWords = [...new Set(
        words
            .map(w => w.trim().toUpperCase())
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
        logger.error('Error creating word list', { error: error.message });
        throw new ServerError('Failed to create word list');
    }
}

/**
 * Update a word list
 * @param {string} id - Word list ID
 * @param {Object} data - Update data
 * @param {string} requesterId - ID of user making request (for ownership check)
 * @returns {Object} Updated word list
 * @throws {Object} Error if database is disabled
 */
async function updateWordList(id, { name, description, words, isPublic }, requesterId = null) {
    if (!isDatabaseEnabled()) {
        throw new ServerError('Word list storage requires database (not configured)');
    }
    const prisma = getDatabase();

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
            throw new ValidationError(`Word list must contain at least ${BOARD_SIZE} unique words`);
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
        logger.error('Error updating word list', { error: error.message });
        throw new ServerError('Failed to update word list');
    }
}

/**
 * Delete a word list
 * @param {string} id - Word list ID
 * @param {string} requesterId - ID of user making request (for ownership check)
 * @throws {Object} Error if database is disabled
 */
async function deleteWordList(id, requesterId = null) {
    if (!isDatabaseEnabled()) {
        throw new ServerError('Word list storage requires database (not configured)');
    }
    const prisma = getDatabase();

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
        logger.error('Error deleting word list', { error: error.message });
        throw new ServerError('Failed to delete word list');
    }
}

/**
 * Increment the usage count for a word list
 * @param {string} id - Word list ID
 */
async function incrementUsageCount(id) {
    if (!isDatabaseEnabled()) {
        return; // Silently skip if no database
    }
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
 * @returns {Array<string>|null} Array of words or null if not found/database disabled
 */
async function getWordsForGame(id) {
    if (!isDatabaseEnabled()) {
        return null;
    }
    const prisma = getDatabase();

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
            logger.warn('Failed to increment word list usage count:', err.message);
        });

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
