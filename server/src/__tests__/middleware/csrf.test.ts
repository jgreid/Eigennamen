/**
 * CSRF Protection Middleware Tests
 */

const { csrfProtection } = require('../../middleware/csrf');

describe('CSRF Protection Middleware', () => {
    let mockReq;
    let mockRes;
    let nextFn;

    beforeEach(() => {
        mockReq = {
            method: 'POST',
            headers: {},
        };
        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        };
        nextFn = jest.fn();
        // Clear environment
        delete process.env.CORS_ORIGIN;
    });

    afterEach(() => {
        delete process.env.CORS_ORIGIN;
    });

    describe('Safe Methods', () => {
        test('allows GET requests without headers', () => {
            mockReq.method = 'GET';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
            expect(mockRes.status).not.toHaveBeenCalled();
        });

        test('allows HEAD requests without headers', () => {
            mockReq.method = 'HEAD';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });

        test('allows OPTIONS requests without headers', () => {
            mockReq.method = 'OPTIONS';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });
    });

    describe('X-Requested-With Header Requirement', () => {
        test('blocks POST without X-Requested-With header', () => {
            mockReq.method = 'POST';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).not.toHaveBeenCalled();
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: {
                    code: 'CSRF_VALIDATION_FAILED',
                    message: 'Missing required X-Requested-With header',
                },
            });
        });

        test('blocks PUT without X-Requested-With header', () => {
            mockReq.method = 'PUT';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        test('blocks DELETE without X-Requested-With header', () => {
            mockReq.method = 'DELETE';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        test('allows POST with X-Requested-With: XMLHttpRequest', () => {
            mockReq.headers['x-requested-with'] = 'XMLHttpRequest';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });

        test('allows POST with X-Requested-With: fetch', () => {
            mockReq.headers['x-requested-with'] = 'fetch';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });

        test('blocks POST with invalid X-Requested-With value', () => {
            mockReq.headers['x-requested-with'] = 'invalid';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });
    });

    describe('Origin Validation with CORS restrictions', () => {
        beforeEach(() => {
            process.env.CORS_ORIGIN = 'http://localhost:3000,http://example.com';
            mockReq.headers['x-requested-with'] = 'XMLHttpRequest';
        });

        test('allows request with valid origin', () => {
            mockReq.headers['origin'] = 'http://localhost:3000';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });

        test('blocks request with invalid origin', () => {
            mockReq.headers['origin'] = 'http://evil.com';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: {
                    code: 'CSRF_VALIDATION_FAILED',
                    message: 'Cross-origin request blocked',
                },
            });
        });

        test('allows request with valid referer when no origin header', () => {
            mockReq.headers['referer'] = 'http://example.com/page';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });

        test('blocks request with invalid referer', () => {
            mockReq.headers['referer'] = 'http://evil.com/page';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        test('blocks request with malformed referer', () => {
            mockReq.headers['referer'] = 'not-a-valid-url';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: {
                    code: 'CSRF_VALIDATION_FAILED',
                    message: 'Invalid referer header',
                },
            });
        });

        test('rejects request without origin or referer even when X-Requested-With is present', () => {
            // No origin or referer — when CORS is restricted, this is rejected
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).not.toHaveBeenCalled();
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });
    });

    describe('Wildcard Subdomain Matching', () => {
        beforeEach(() => {
            process.env.CORS_ORIGIN = '*.example.com';
            mockReq.headers['x-requested-with'] = 'XMLHttpRequest';
        });

        test('allows exact domain match', () => {
            mockReq.headers['origin'] = 'http://example.com';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });

        test('allows valid subdomain', () => {
            mockReq.headers['origin'] = 'http://sub.example.com';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });

        test('allows deeply nested subdomain', () => {
            mockReq.headers['origin'] = 'http://a.b.c.example.com';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });

        test('blocks domain that ends with pattern but is not subdomain', () => {
            mockReq.headers['origin'] = 'http://attacker-example.com';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        test('blocks completely different domain', () => {
            mockReq.headers['origin'] = 'http://evil.com';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        test('handles invalid origin URL gracefully', () => {
            mockReq.headers['origin'] = 'not-a-url';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });
    });

    describe('CORS_ORIGIN=* (allow all)', () => {
        beforeEach(() => {
            process.env.CORS_ORIGIN = '*';
            mockReq.headers['x-requested-with'] = 'XMLHttpRequest';
        });

        test('allows any origin when CORS_ORIGIN is *', () => {
            mockReq.headers['origin'] = 'http://any-origin.com';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });

        test('still requires X-Requested-With even with CORS_ORIGIN=*', () => {
            delete mockReq.headers['x-requested-with'];
            mockReq.headers['origin'] = 'http://any-origin.com';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });
    });

    describe('Default CORS behavior (no env set)', () => {
        beforeEach(() => {
            delete process.env.CORS_ORIGIN;
            mockReq.headers['x-requested-with'] = 'XMLHttpRequest';
        });

        test('defaults to allowing all origins', () => {
            mockReq.headers['origin'] = 'http://any-origin.com';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });
    });
});
