/**
 * Extended CSRF Protection Middleware Tests
 *
 * Additional tests to increase coverage from 34% to 70%+
 * Covers edge cases, internal functions, and error paths
 */

const { csrfProtection } = require('../middleware/csrf');

describe('CSRF Protection Extended Tests', () => {
    let mockReq;
    let mockRes;
    let nextFn;

    beforeEach(() => {
        mockReq = {
            method: 'POST',
            headers: {}
        };
        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis()
        };
        nextFn = jest.fn();
        delete process.env.CORS_ORIGIN;
    });

    afterEach(() => {
        delete process.env.CORS_ORIGIN;
    });

    describe('HTTP Method Handling', () => {
        test.each(['PATCH', 'DELETE', 'PUT'])('blocks %s without X-Requested-With', (method) => {
            mockReq.method = method;
            csrfProtection(mockReq, mockRes, nextFn);
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(nextFn).not.toHaveBeenCalled();
        });

        test.each(['GET', 'HEAD', 'OPTIONS'])('allows %s method without any headers', (method) => {
            mockReq.method = method;
            mockReq.headers = {}; // No headers at all
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
            expect(mockRes.status).not.toHaveBeenCalled();
        });

        test('handles lowercase method names', () => {
            mockReq.method = 'get';
            csrfProtection(mockReq, mockRes, nextFn);
            // Lowercase methods are not in the safe list, so this should fail
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });
    });

    describe('X-Requested-With Header Variations', () => {
        test('blocks empty X-Requested-With header', () => {
            mockReq.headers['x-requested-with'] = '';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        test('blocks null-ish X-Requested-With header', () => {
            mockReq.headers['x-requested-with'] = null;
            csrfProtection(mockReq, mockRes, nextFn);
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        test('allows X-Requested-With: XMLHttpRequest (case sensitive)', () => {
            mockReq.headers['x-requested-with'] = 'XMLHttpRequest';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });

        test('blocks XMLhttprequest (wrong case)', () => {
            mockReq.headers['x-requested-with'] = 'xmlhttprequest';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        test('blocks Fetch (wrong case)', () => {
            mockReq.headers['x-requested-with'] = 'Fetch';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        test('allows fetch (lowercase)', () => {
            mockReq.headers['x-requested-with'] = 'fetch';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });

        test('blocks whitespace-only X-Requested-With', () => {
            mockReq.headers['x-requested-with'] = '   ';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        test('blocks X-Requested-With with extra characters', () => {
            mockReq.headers['x-requested-with'] = 'XMLHttpRequest ';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });
    });

    describe('Origin Header Edge Cases', () => {
        beforeEach(() => {
            process.env.CORS_ORIGIN = 'http://allowed.com';
            mockReq.headers['x-requested-with'] = 'XMLHttpRequest';
        });

        test('handles origin with port number', () => {
            process.env.CORS_ORIGIN = 'http://localhost:3000';
            mockReq.headers['origin'] = 'http://localhost:3000';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });

        test('blocks origin with different port', () => {
            process.env.CORS_ORIGIN = 'http://localhost:3000';
            mockReq.headers['origin'] = 'http://localhost:3001';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        test('handles origin with trailing slash in config', () => {
            process.env.CORS_ORIGIN = 'http://example.com/';
            mockReq.headers['origin'] = 'http://example.com';
            csrfProtection(mockReq, mockRes, nextFn);
            // Trailing slash in config means they don't match
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        test('handles HTTPS origin', () => {
            process.env.CORS_ORIGIN = 'https://secure.com';
            mockReq.headers['origin'] = 'https://secure.com';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });

        test('blocks HTTP when HTTPS is required', () => {
            process.env.CORS_ORIGIN = 'https://secure.com';
            mockReq.headers['origin'] = 'http://secure.com';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        test('handles empty origin header', () => {
            mockReq.headers['origin'] = '';
            // Empty string is falsy, so no origin validation; with restricted CORS
            // and no referer, the request is rejected
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).not.toHaveBeenCalled();
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });
    });

    describe('Referer Header Edge Cases', () => {
        beforeEach(() => {
            process.env.CORS_ORIGIN = 'http://example.com';
            mockReq.headers['x-requested-with'] = 'XMLHttpRequest';
        });

        test('handles referer with query string', () => {
            mockReq.headers['referer'] = 'http://example.com/page?foo=bar';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });

        test('handles referer with hash fragment', () => {
            mockReq.headers['referer'] = 'http://example.com/page#section';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });

        test('handles referer with complex path', () => {
            mockReq.headers['referer'] = 'http://example.com/a/b/c/d?x=1&y=2#hash';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });

        test('blocks referer with protocol-relative URL', () => {
            mockReq.headers['referer'] = '//evil.com/page';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        test('blocks referer that is just a path', () => {
            mockReq.headers['referer'] = '/internal/page';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        test('handles referer with empty path', () => {
            mockReq.headers['referer'] = 'http://example.com';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });
    });

    describe('Wildcard Domain Matching', () => {
        beforeEach(() => {
            mockReq.headers['x-requested-with'] = 'XMLHttpRequest';
        });

        test('wildcard matches exact domain', () => {
            process.env.CORS_ORIGIN = '*.example.com';
            mockReq.headers['origin'] = 'http://example.com';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });

        test('wildcard matches single subdomain', () => {
            process.env.CORS_ORIGIN = '*.example.com';
            mockReq.headers['origin'] = 'http://www.example.com';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });

        test('wildcard matches multi-level subdomain', () => {
            process.env.CORS_ORIGIN = '*.example.com';
            mockReq.headers['origin'] = 'http://api.v2.staging.example.com';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });

        test('wildcard blocks suffix attack', () => {
            process.env.CORS_ORIGIN = '*.example.com';
            mockReq.headers['origin'] = 'http://notexample.com';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        test('wildcard blocks dash suffix attack', () => {
            process.env.CORS_ORIGIN = '*.example.com';
            mockReq.headers['origin'] = 'http://fake-example.com';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        test('wildcard with HTTPS scheme', () => {
            process.env.CORS_ORIGIN = '*.secure.com';
            mockReq.headers['origin'] = 'https://app.secure.com';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });

        test('wildcard blocks malformed origin', () => {
            process.env.CORS_ORIGIN = '*.example.com';
            mockReq.headers['origin'] = 'not-a-valid-url-at-all';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        test('wildcard with port in origin', () => {
            process.env.CORS_ORIGIN = '*.example.com';
            mockReq.headers['origin'] = 'http://app.example.com:8080';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });
    });

    describe('Multiple Allowed Origins', () => {
        beforeEach(() => {
            mockReq.headers['x-requested-with'] = 'XMLHttpRequest';
        });

        test('allows first origin in list', () => {
            process.env.CORS_ORIGIN = 'http://first.com,http://second.com,http://third.com';
            mockReq.headers['origin'] = 'http://first.com';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });

        test('allows middle origin in list', () => {
            process.env.CORS_ORIGIN = 'http://first.com,http://second.com,http://third.com';
            mockReq.headers['origin'] = 'http://second.com';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });

        test('allows last origin in list', () => {
            process.env.CORS_ORIGIN = 'http://first.com,http://second.com,http://third.com';
            mockReq.headers['origin'] = 'http://third.com';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });

        test('blocks origin not in list', () => {
            process.env.CORS_ORIGIN = 'http://first.com,http://second.com';
            mockReq.headers['origin'] = 'http://fourth.com';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        test('handles whitespace around origins', () => {
            process.env.CORS_ORIGIN = ' http://first.com , http://second.com ';
            mockReq.headers['origin'] = 'http://second.com';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });

        test('handles mixed wildcards and exact origins', () => {
            process.env.CORS_ORIGIN = 'http://exact.com,*.wildcard.com';
            mockReq.headers['origin'] = 'http://sub.wildcard.com';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });
    });

    describe('Error Response Format', () => {
        test('missing header error has correct format', () => {
            csrfProtection(mockReq, mockRes, nextFn);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: {
                    code: 'CSRF_VALIDATION_FAILED',
                    message: 'Missing required X-Requested-With header'
                }
            });
        });

        test('cross-origin error has correct format', () => {
            process.env.CORS_ORIGIN = 'http://allowed.com';
            mockReq.headers['x-requested-with'] = 'XMLHttpRequest';
            mockReq.headers['origin'] = 'http://evil.com';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: {
                    code: 'CSRF_VALIDATION_FAILED',
                    message: 'Cross-origin request blocked'
                }
            });
        });

        test('invalid referer error has correct format', () => {
            process.env.CORS_ORIGIN = 'http://allowed.com';
            mockReq.headers['x-requested-with'] = 'XMLHttpRequest';
            mockReq.headers['referer'] = ':::invalid:::';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: {
                    code: 'CSRF_VALIDATION_FAILED',
                    message: 'Invalid referer header'
                }
            });
        });
    });

    describe('Combined Scenarios', () => {
        test('origin takes precedence over referer', () => {
            process.env.CORS_ORIGIN = 'http://allowed.com';
            mockReq.headers['x-requested-with'] = 'XMLHttpRequest';
            mockReq.headers['origin'] = 'http://allowed.com';
            mockReq.headers['referer'] = 'http://evil.com/page';
            csrfProtection(mockReq, mockRes, nextFn);
            // Origin is valid, referer is ignored
            expect(nextFn).toHaveBeenCalled();
        });

        test('falls back to referer when origin is missing', () => {
            process.env.CORS_ORIGIN = 'http://allowed.com';
            mockReq.headers['x-requested-with'] = 'XMLHttpRequest';
            mockReq.headers['referer'] = 'http://allowed.com/page';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });

        test('allows when neither origin nor referer present but CORS is *', () => {
            process.env.CORS_ORIGIN = '*';
            mockReq.headers['x-requested-with'] = 'XMLHttpRequest';
            csrfProtection(mockReq, mockRes, nextFn);
            expect(nextFn).toHaveBeenCalled();
        });
    });
});
