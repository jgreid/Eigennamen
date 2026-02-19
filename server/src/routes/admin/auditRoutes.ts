/**
 * Admin Audit Routes - Audit log retrieval endpoints
 */

import type { Request, Response, Router as ExpressRouter } from 'express';

import express from 'express';
import { z } from 'zod';
import logger from '../../utils/logger';
import { getAuditLogs, getAuditSummary } from '../../services/auditService';

const auditQuerySchema = z.object({
    category: z.enum(['admin', 'security', 'all']).default('all'),
    limit: z.coerce.number().int().min(1).max(1000).default(100),
    severity: z.enum(['critical', 'high', 'medium', 'low']).nullable().default(null)
});

const router: ExpressRouter = express.Router();

/**
 * GET /admin/api/audit - Get audit logs
 */
router.get('/api/audit', async (req: Request, res: Response) => {
    try {
        const parsed = auditQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            res.status(400).json({
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Invalid query parameters',
                    details: parsed.error.issues.map(i => i.message)
                }
            });
            return;
        }
        const { category, limit, severity } = parsed.data;

        const logs = await getAuditLogs({
            category,
            limit,
            severity
        });

        const summary = await getAuditSummary();

        res.json({
            summary,
            logs
        });
    } catch (error) {
        logger.error('Failed to fetch audit logs', { error: (error as Error).message });
        res.status(500).json({
            error: {
                code: 'AUDIT_ERROR',
                message: 'Failed to fetch audit logs'
            }
        });
    }
});

export default router;
