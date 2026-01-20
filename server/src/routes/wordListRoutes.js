/**
 * Word List API Routes
 *
 * NOTE: Create/Update/Delete operations require authentication.
 * These endpoints are protected and will return 403 until proper
 * authentication is implemented.
 */

const express = require('express');
const wordListService = require('../services/wordListService');
const { validateBody, validateParams, validateQuery } = require('../middleware/validation');
const { z } = require('zod');
const { BOARD_SIZE } = require('../config/constants');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Authentication middleware placeholder
 * Extracts user from JWT token if present
 * TODO: Implement full JWT authentication when user accounts are enabled
 */
function extractUser(req, res, next) {
    // Check for Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
            const token = authHeader.substring(7);
            const jwt = require('jsonwebtoken');
            const secret = process.env.JWT_SECRET;
            if (secret) {
                const decoded = jwt.verify(token, secret);
                req.user = decoded;
            }
        } catch (error) {
            // Invalid token - continue without user
            logger.debug('Invalid auth token in word list request');
        }
    }
    next();
}

/**
 * Authorization middleware - requires authenticated user
 */
function requireAuth(req, res, next) {
    if (!req.user || !req.user.id) {
        return res.status(403).json({
            error: {
                code: 'NOT_AUTHORIZED',
                message: 'Authentication required for this operation'
            }
        });
    }
    next();
}

// Apply user extraction to all routes
router.use(extractUser);

// Validation schemas
const wordListIdSchema = z.object({
    id: z.string().uuid()
});

const wordListQuerySchema = z.object({
    search: z.string().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    offset: z.coerce.number().int().min(0).optional().default(0)
});

const createWordListSchema = z.object({
    name: z.string().min(1).max(100).trim(),
    description: z.string().max(500).optional(),
    words: z.array(z.string().min(1).max(50))
        .min(BOARD_SIZE, `Must have at least ${BOARD_SIZE} words`),
    isPublic: z.boolean().optional().default(false)
});

const updateWordListSchema = z.object({
    name: z.string().min(1).max(100).trim().optional(),
    description: z.string().max(500).optional(),
    words: z.array(z.string().min(1).max(50))
        .min(BOARD_SIZE, `Must have at least ${BOARD_SIZE} words`)
        .optional(),
    isPublic: z.boolean().optional()
});

/**
 * Get all public word lists
 * GET /api/wordlists
 */
router.get('/', validateQuery(wordListQuerySchema), async (req, res, next) => {
    try {
        const { search, limit, offset } = req.query;
        const wordLists = await wordListService.getPublicWordLists({
            search,
            limit,
            offset
        });

        res.json({ wordLists });
    } catch (error) {
        next(error);
    }
});

/**
 * Get a specific word list by ID
 * GET /api/wordlists/:id
 */
router.get('/:id', validateParams(wordListIdSchema), async (req, res, next) => {
    try {
        const wordList = await wordListService.getWordList(req.params.id);

        if (!wordList) {
            return res.status(404).json({
                error: {
                    code: 'WORD_LIST_NOT_FOUND',
                    message: 'Word list not found'
                }
            });
        }

        // Only return full word list if public or owned by requester
        // For now, return full list for public ones
        if (!wordList.isPublic) {
            // In a full implementation, check ownership here
            return res.status(403).json({
                error: {
                    code: 'NOT_AUTHORIZED',
                    message: 'Not authorized to view this word list'
                }
            });
        }

        res.json({
            wordList: {
                ...wordList,
                wordCount: wordList.words.length
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * Create a new word list
 * POST /api/wordlists
 * Requires authentication
 */
router.post('/', requireAuth, validateBody(createWordListSchema), async (req, res, next) => {
    try {
        const { name, description, words, isPublic } = req.body;

        const wordList = await wordListService.createWordList({
            name,
            description,
            words,
            isPublic,
            ownerId: req.user.id
        });

        res.status(201).json({ wordList });
    } catch (error) {
        next(error);
    }
});

/**
 * Update a word list
 * PUT /api/wordlists/:id
 * Requires authentication and ownership
 */
router.put('/:id', requireAuth, validateParams(wordListIdSchema), validateBody(updateWordListSchema), async (req, res, next) => {
    try {
        const { name, description, words, isPublic } = req.body;

        const wordList = await wordListService.updateWordList(
            req.params.id,
            { name, description, words, isPublic },
            req.user.id
        );

        res.json({ wordList });
    } catch (error) {
        next(error);
    }
});

/**
 * Delete a word list
 * DELETE /api/wordlists/:id
 * Requires authentication and ownership
 */
router.delete('/:id', requireAuth, validateParams(wordListIdSchema), async (req, res, next) => {
    try {
        await wordListService.deleteWordList(req.params.id, req.user.id);
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
