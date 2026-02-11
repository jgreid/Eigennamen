/**
 * Word List API Routes
 *
 * NOTE: Create/Update/Delete operations require authentication.
 * These endpoints are protected and will return 403 until proper
 * authentication is implemented.
 */

import type { Request, Response, NextFunction, Router as ExpressRouter } from 'express';

import express from 'express';
import jwt from 'jsonwebtoken';
import * as wordListService from '../services/wordListService';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { z } from 'zod';
import { BOARD_SIZE } from '../config/constants';
import logger from '../utils/logger';
import { getJwtSecret } from '../infrastructure/jwt';
import { removeControlChars } from '../utils/sanitize';
const router: ExpressRouter = express.Router();

/**
 * User from JWT token
 */
interface JwtUser {
    id: string;
    [key: string]: unknown;
}

/**
 * Request with authenticated user
 */
interface AuthenticatedRequest extends Request {
    user?: JwtUser;
}

// Uses WordList type from wordListService (imported via the service)

/**
 * Authentication middleware placeholder
 * Extracts user from JWT token if present
 * Uses centralized JWT secret management but simple verification
 * (no issuer/audience claims required for backwards compatibility)
 */
function extractUser(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
    // Check for Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const secret = getJwtSecret();
        // Only attempt JWT verification if secret is configured
        if (!secret) {
            logger.debug('JWT_SECRET not configured, skipping token verification');
            return next();
        }

        try {
            const token = authHeader.substring(7);
            // Use simple verification with just algorithm check (original behavior)
            const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as JwtUser;
            // Validate token structure
            if (decoded && typeof decoded.id === 'string') {
                req.user = decoded;
            } else {
                logger.debug('Invalid auth token structure in word list request');
            }
        } catch {
            // Invalid token - continue without user
            logger.debug('Invalid auth token in word list request');
        }
    }
    next();
}

/**
 * Authorization middleware - requires authenticated user
 */
function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Response | void {
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
    name: z.string().min(1).max(100).transform((val: string) => removeControlChars(val).trim()),
    description: z.string().max(500).transform((val: string) => removeControlChars(val).trim()).optional(),
    // Apply removeControlChars to each word for XSS prevention (consistent with gameStartSchema)
    words: z.array(
        z.string()
            .min(1)
            .max(50)
            .transform((val: string) => removeControlChars(val).trim())
            .refine((val: string) => val.length >= 1, 'Word cannot be empty after sanitization')
    )
        .min(BOARD_SIZE, `Must have at least ${BOARD_SIZE} words`),
    isPublic: z.boolean().optional().default(false)
});

const updateWordListSchema = z.object({
    name: z.string().min(1).max(100).transform((val: string) => removeControlChars(val).trim()).optional(),
    description: z.string().max(500).transform((val: string) => removeControlChars(val).trim()).optional(),
    // Apply removeControlChars to each word for XSS prevention (consistent with gameStartSchema)
    words: z.array(
        z.string()
            .min(1)
            .max(50)
            .transform((val: string) => removeControlChars(val).trim())
            .refine((val: string) => val.length >= 1, 'Word cannot be empty after sanitization')
    )
        .min(BOARD_SIZE, `Must have at least ${BOARD_SIZE} words`)
        .optional(),
    isPublic: z.boolean().optional()
});

/**
 * Get all public word lists
 * GET /api/wordlists
 */
router.get('/', validateQuery(wordListQuerySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { search, limit, offset } = req.query as { search?: string; limit?: number; offset?: number };
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
router.get('/:id', validateParams(wordListIdSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const wordList = await wordListService.getWordList(req.params.id!);

        if (!wordList) {
            res.status(404).json({
                error: {
                    code: 'WORD_LIST_NOT_FOUND',
                    message: 'Word list not found'
                }
            });
            return;
        }

        // Only return full word list if public or owned by requester
        if (!wordList.isPublic) {
            // Check ownership - user must be authenticated and be the owner
            const isOwner = req.user && req.user.id && wordList.ownerId === req.user.id;
            if (!isOwner) {
                res.status(403).json({
                    error: {
                        code: 'NOT_AUTHORIZED',
                        message: 'Not authorized to view this word list'
                    }
                });
                return;
            }
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
router.post('/', requireAuth, validateBody(createWordListSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { name, description, words, isPublic } = req.body;

        // Safe to cast: requireAuth middleware guarantees req.user exists with a valid id
        const user = req.user as JwtUser;
        const wordList = await wordListService.createWordList({
            name,
            description,
            words,
            isPublic,
            ownerId: user.id
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
router.put('/:id', requireAuth, validateParams(wordListIdSchema), validateBody(updateWordListSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { name, description, words, isPublic } = req.body;

        // Safe to cast: requireAuth middleware guarantees req.user exists with a valid id
        const user = req.user as JwtUser;
        const wordList = await wordListService.updateWordList(
            req.params.id!,
            { name, description, words, isPublic },
            user.id
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
router.delete('/:id', requireAuth, validateParams(wordListIdSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        // Safe to cast: requireAuth middleware guarantees req.user exists with a valid id
        const user = req.user as JwtUser;
        await wordListService.deleteWordList(req.params.id!, user.id);
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

export default router;
