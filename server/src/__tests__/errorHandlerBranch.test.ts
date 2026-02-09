/**
 * Error Handler Branch Coverage Tests
 */

jest.mock('../utils/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));

describe('Error Handler Branch Coverage', () => {
    let errorHandler: any;
    let notFoundHandler: any;

    beforeEach(() => {
        jest.clearAllMocks();
        const mod = require('../middleware/errorHandler');
        errorHandler = mod.errorHandler;
        notFoundHandler = mod.notFoundHandler;
    });

    const makeRes = () => {
        const res: any = { statusCode: 200, body: null };
        res.status = jest.fn((code: number) => { res.statusCode = code; return res; });
        res.json = jest.fn((body: any) => { res.body = body; return res; });
        return res;
    };

    it('should return 404 with route info from notFoundHandler', () => {
        const req = { method: 'GET', path: '/nonexistent' } as any;
        const res = makeRes();
        notFoundHandler(req, res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('should handle known error code with proper status', () => {
        const err = Object.assign(new Error('Room not found'), { code: 'ROOM_NOT_FOUND' });
        const res = makeRes();
        errorHandler(err, {} as any, res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should handle ZodError with 400 status', () => {
        const err = Object.assign(new Error('Validation'), {
            name: 'ZodError',
            errors: [{ path: ['name'], message: 'Required' }]
        });
        const res = makeRes();
        errorHandler(err, {} as any, res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.body.error.code).toBe('INVALID_INPUT');
    });

    it('should hide error message in production', () => {
        const origEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            const err = new Error('Sensitive internal details');
            const res = makeRes();
            errorHandler(err, {} as any, res, jest.fn());
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.body.error.message).toBe('Internal server error');
        } finally {
            process.env.NODE_ENV = origEnv;
        }
    });

    it('should show error message in non-production', () => {
        const origEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'test';
        try {
            const err = new Error('Detailed error info');
            const res = makeRes();
            errorHandler(err, {} as any, res, jest.fn());
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.body.error.message).toBe('Detailed error info');
        } finally {
            process.env.NODE_ENV = origEnv;
        }
    });

    it('should include details from AppError', () => {
        const err = Object.assign(new Error('Bad input'), {
            code: 'INVALID_INPUT',
            details: { field: 'name' }
        });
        const res = makeRes();
        errorHandler(err, {} as any, res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.body.error.details).toEqual({ field: 'name' });
    });
});
