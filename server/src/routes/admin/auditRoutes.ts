/**
 * Admin Audit Routes - Audit log retrieval endpoints
 */

import type { Request, Response, Router as ExpressRouter } from 'express';

import express from 'express';
import logger from '../../utils/logger';
import { getAuditLogs, getAuditSummary } from '../../services/auditService';
import type { AuditCategory, AuditSeverity } from '../../services/auditService';

const router: ExpressRouter = express.Router();

/**
 * GET /admin/api/audit - Get audit logs
 */
router.get('/api/audit', async (req: Request, res: Response) => {
    try {
        const { category = 'all', limit = '100', severity = null } = req.query as {
            category?: string;
            limit?: string;
            severity?: string | null;
        };

        const logs = await getAuditLogs({
            category: category as AuditCategory,
            limit: Math.min(parseInt(limit, 10) || 100, 1000),
            severity: severity as AuditSeverity | null
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
