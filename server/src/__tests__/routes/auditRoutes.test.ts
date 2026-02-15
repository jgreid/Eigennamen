/**
 * Admin Audit Routes Tests
 *
 * Tests for GET /admin/api/audit endpoint
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../services/auditService', () => ({
    getAuditLogs: jest.fn(),
    getAuditSummary: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

const auditService = require('../../services/auditService');
const logger = require('../../utils/logger');

function createApp() {
    const app = express();
    app.use(express.json());
    const auditRoutesModule = require('../../routes/admin/auditRoutes');
    const auditRoutes = auditRoutesModule.default || auditRoutesModule;
    app.use('/admin', auditRoutes);
    return app;
}

describe('Admin Audit Routes', () => {
    let app: any;

    beforeEach(() => {
        jest.clearAllMocks();
        app = createApp();
    });

    describe('GET /admin/api/audit', () => {
        it('should return audit logs and summary with defaults', async () => {
            const mockLogs = [
                { timestamp: '2024-01-01', event: 'login', severity: 'low' },
            ];
            const mockSummary = { total: 1, byCategory: { admin: 1 } };

            auditService.getAuditLogs.mockResolvedValue(mockLogs);
            auditService.getAuditSummary.mockResolvedValue(mockSummary);

            const response = await request(app)
                .get('/admin/api/audit')
                .expect(200);

            expect(response.body.logs).toEqual(mockLogs);
            expect(response.body.summary).toEqual(mockSummary);
            expect(auditService.getAuditLogs).toHaveBeenCalledWith({
                category: 'all',
                limit: 100,
                severity: null,
            });
        });

        it('should pass query parameters to service', async () => {
            auditService.getAuditLogs.mockResolvedValue([]);
            auditService.getAuditSummary.mockResolvedValue({});

            await request(app)
                .get('/admin/api/audit?category=security&limit=50&severity=high')
                .expect(200);

            expect(auditService.getAuditLogs).toHaveBeenCalledWith({
                category: 'security',
                limit: 50,
                severity: 'high',
            });
        });

        it('should cap limit at 1000', async () => {
            auditService.getAuditLogs.mockResolvedValue([]);
            auditService.getAuditSummary.mockResolvedValue({});

            await request(app)
                .get('/admin/api/audit?limit=5000')
                .expect(200);

            expect(auditService.getAuditLogs).toHaveBeenCalledWith(
                expect.objectContaining({ limit: 1000 })
            );
        });

        it('should default invalid limit to 100', async () => {
            auditService.getAuditLogs.mockResolvedValue([]);
            auditService.getAuditSummary.mockResolvedValue({});

            await request(app)
                .get('/admin/api/audit?limit=notanumber')
                .expect(200);

            expect(auditService.getAuditLogs).toHaveBeenCalledWith(
                expect.objectContaining({ limit: 100 })
            );
        });

        it('should return 500 when service throws', async () => {
            auditService.getAuditLogs.mockRejectedValue(new Error('Redis down'));

            const response = await request(app)
                .get('/admin/api/audit')
                .expect(500);

            expect(response.body.error.code).toBe('AUDIT_ERROR');
            expect(response.body.error.message).toBe('Failed to fetch audit logs');
            expect(logger.error).toHaveBeenCalledWith(
                'Failed to fetch audit logs',
                expect.objectContaining({ error: 'Redis down' })
            );
        });

        it('should handle getAuditSummary failure', async () => {
            auditService.getAuditLogs.mockResolvedValue([]);
            auditService.getAuditSummary.mockRejectedValue(new Error('summary error'));

            const response = await request(app)
                .get('/admin/api/audit')
                .expect(500);

            expect(response.body.error.code).toBe('AUDIT_ERROR');
        });
    });
});
