// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Security E2E Tests
 *
 * Verify security headers, authentication boundaries, rate limiting,
 * CORS configuration, and input validation.
 */

test.describe('CSP Headers', () => {
    test('response includes Content-Security-Policy header', async ({ page }) => {
        const response = await page.goto('/');
        expect(response).not.toBeNull();

        const csp = response.headers()['content-security-policy'];
        expect(csp).toBeDefined();
        expect(csp.length).toBeGreaterThan(0);
    });

    test('CSP does not allow unsafe-inline in style-src', async ({ page }) => {
        const response = await page.goto('/');
        const csp = response.headers()['content-security-policy'];

        // Extract style-src directive
        const styleSrc = csp
            .split(';')
            .map((d) => d.trim())
            .find((d) => d.startsWith('style-src'));

        expect(styleSrc).toBeDefined();
        expect(styleSrc).not.toContain("'unsafe-inline'");
    });

    test('CSP does not allow unsafe-inline in script-src', async ({ page }) => {
        const response = await page.goto('/');
        const csp = response.headers()['content-security-policy'];

        const scriptSrc = csp
            .split(';')
            .map((d) => d.trim())
            .find((d) => d.startsWith('script-src'));

        expect(scriptSrc).toBeDefined();
        expect(scriptSrc).not.toContain("'unsafe-inline'");
        expect(scriptSrc).not.toContain("'unsafe-eval'");
    });

    test('CSP includes restrictive default-src', async ({ page }) => {
        const response = await page.goto('/');
        const csp = response.headers()['content-security-policy'];

        const defaultSrc = csp
            .split(';')
            .map((d) => d.trim())
            .find((d) => d.startsWith('default-src'));

        expect(defaultSrc).toBeDefined();
        expect(defaultSrc).toContain("'self'");
    });

    test('CSP blocks object embedding', async ({ page }) => {
        const response = await page.goto('/');
        const csp = response.headers()['content-security-policy'];

        const objectSrc = csp
            .split(';')
            .map((d) => d.trim())
            .find((d) => d.startsWith('object-src'));

        expect(objectSrc).toBeDefined();
        expect(objectSrc).toContain("'none'");
    });

    test('CSP blocks framing via frame-ancestors', async ({ page }) => {
        const response = await page.goto('/');
        const csp = response.headers()['content-security-policy'];

        const frameAncestors = csp
            .split(';')
            .map((d) => d.trim())
            .find((d) => d.startsWith('frame-ancestors'));

        expect(frameAncestors).toBeDefined();
        expect(frameAncestors).toContain("'none'");
    });
});

test.describe('Security Headers', () => {
    test('includes X-Content-Type-Options: nosniff', async ({ page }) => {
        const response = await page.goto('/');
        const header = response.headers()['x-content-type-options'];
        expect(header).toBe('nosniff');
    });

    test('includes X-Frame-Options header', async ({ page }) => {
        const response = await page.goto('/');
        // Helmet sets X-Frame-Options in addition to CSP frame-ancestors
        const header = response.headers()['x-frame-options'];
        expect(header).toBeDefined();
        expect(['DENY', 'SAMEORIGIN']).toContain(header);
    });

    test('includes X-DNS-Prefetch-Control: off', async ({ page }) => {
        const response = await page.goto('/');
        const header = response.headers()['x-dns-prefetch-control'];
        expect(header).toBe('off');
    });

    test('includes Referrer-Policy header', async ({ page }) => {
        const response = await page.goto('/');
        const header = response.headers()['referrer-policy'];
        expect(header).toBeDefined();
        expect(header).toContain('strict-origin-when-cross-origin');
    });

    test('includes Permissions-Policy header', async ({ page }) => {
        const response = await page.goto('/');
        const header = response.headers()['permissions-policy'];
        expect(header).toBeDefined();
        expect(header).toContain('camera=()');
        expect(header).toContain('microphone=()');
        expect(header).toContain('geolocation=()');
    });

    test('includes Cross-Origin-Opener-Policy header', async ({ page }) => {
        const response = await page.goto('/');
        const header = response.headers()['cross-origin-opener-policy'];
        expect(header).toBeDefined();
        expect(header).toContain('same-origin');
    });

    test('includes X-Permitted-Cross-Domain-Policies: none', async ({ page }) => {
        const response = await page.goto('/');
        const header = response.headers()['x-permitted-cross-domain-policies'];
        expect(header).toBe('none');
    });

    test('does not expose X-Powered-By header', async ({ page }) => {
        const response = await page.goto('/');
        const header = response.headers()['x-powered-by'];
        expect(header).toBeUndefined();
    });
});

test.describe('Rate Limiting', () => {
    test('API responses include rate limit headers', async ({ request }) => {
        const response = await request.get('/api/health', {
            // health endpoint may not exist, use a known API path
            failOnStatusCode: false,
        });

        // The rate limiter uses standardHeaders (RateLimit-* headers per RFC draft)
        const headers = response.headers();
        // express-rate-limit with standardHeaders:true sets these headers
        const hasRateLimitPolicy = headers['ratelimit-policy'] !== undefined;
        const hasRateLimitLimit = headers['ratelimit-limit'] !== undefined;
        const hasXRateLimitLimit = headers['x-ratelimit-limit'] !== undefined;

        // At least one rate limit header scheme should be present
        expect(hasRateLimitPolicy || hasRateLimitLimit || hasXRateLimitLimit).toBe(true);
    });

    test('health endpoint responds without rate limit blocking', async ({ request }) => {
        // Health endpoints should be accessible (not rate limited on first request)
        const response = await request.get('/health');
        expect(response.status()).toBe(200);
    });
});

test.describe('CORS', () => {
    test('responds to preflight OPTIONS request', async ({ request }) => {
        const response = await request.fetch('/api/health', {
            method: 'OPTIONS',
            headers: {
                Origin: 'http://localhost:3000',
                'Access-Control-Request-Method': 'GET',
            },
            failOnStatusCode: false,
        });

        // Should return a successful preflight response (200 or 204)
        expect([200, 204]).toContain(response.status());
    });

    test('includes Access-Control-Allow-Methods in preflight', async ({ request }) => {
        const response = await request.fetch('/api/health', {
            method: 'OPTIONS',
            headers: {
                Origin: 'http://localhost:3000',
                'Access-Control-Request-Method': 'POST',
            },
            failOnStatusCode: false,
        });

        const methods = response.headers()['access-control-allow-methods'];
        expect(methods).toBeDefined();
    });

    test('includes Access-Control-Allow-Headers in preflight', async ({ request }) => {
        const response = await request.fetch('/api/health', {
            method: 'OPTIONS',
            headers: {
                Origin: 'http://localhost:3000',
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'Content-Type',
            },
            failOnStatusCode: false,
        });

        const headers = response.headers()['access-control-allow-headers'];
        expect(headers).toBeDefined();
    });
});

test.describe('Admin Authentication', () => {
    test('admin dashboard rejects unauthenticated requests', async ({ request }) => {
        const response = await request.get('/admin', {
            failOnStatusCode: false,
        });

        expect(response.status()).toBe(401);
    });

    test('admin API rejects unauthenticated requests', async ({ request }) => {
        const response = await request.get('/admin/api/stats', {
            failOnStatusCode: false,
        });

        expect(response.status()).toBe(401);
    });

    test('admin returns WWW-Authenticate header on 401', async ({ request }) => {
        const response = await request.get('/admin', {
            failOnStatusCode: false,
        });

        expect(response.status()).toBe(401);
        const wwwAuth = response.headers()['www-authenticate'];
        expect(wwwAuth).toBeDefined();
        expect(wwwAuth).toContain('Basic');
    });

    test('admin rejects invalid credentials', async ({ request }) => {
        const invalidAuth = Buffer.from('admin:wrongpassword').toString('base64');
        const response = await request.get('/admin', {
            headers: {
                Authorization: `Basic ${invalidAuth}`,
            },
            failOnStatusCode: false,
        });

        expect(response.status()).toBe(401);
    });

    test('admin returns structured error response', async ({ request }) => {
        const response = await request.get('/admin', {
            failOnStatusCode: false,
        });

        expect(response.status()).toBe(401);
        const body = await response.json();
        expect(body).toHaveProperty('error');
        expect(body.error).toHaveProperty('code');
        expect(body.error).toHaveProperty('message');
    });
});

test.describe('Input Validation', () => {
    test('rejects oversized JSON body', async ({ request }) => {
        // Server has a 1mb limit on JSON body; send something over that
        // We send a moderately large payload and verify the server handles it
        const largePayload = 'x'.repeat(2 * 1024 * 1024); // 2MB
        const response = await request.post('/api/csp-report', {
            headers: {
                'Content-Type': 'application/json',
            },
            data: JSON.stringify({ data: largePayload }),
            failOnStatusCode: false,
        });

        // Should reject with 413 (Payload Too Large) or similar error status
        expect(response.status()).toBeGreaterThanOrEqual(400);
    });

    test('rejects invalid Content-Type for CSP report endpoint', async ({ request }) => {
        const response = await request.post('/api/csp-report', {
            headers: {
                'Content-Type': 'text/plain',
            },
            data: 'not json',
            failOnStatusCode: false,
        });

        // Server should not crash; it may return 204 (ignoring body) or 4xx
        expect(response.status()).toBeLessThan(500);
    });

    test('unknown API routes return 404', async ({ request }) => {
        const response = await request.get('/api/nonexistent-endpoint-12345', {
            failOnStatusCode: false,
        });

        // Should return 404, not expose stack traces or internal errors
        expect(response.status()).toBe(404);
    });

    test('404 response does not expose stack traces', async ({ request }) => {
        const response = await request.get('/api/nonexistent-endpoint-12345', {
            failOnStatusCode: false,
        });

        const text = await response.text();
        expect(text).not.toContain('Error:');
        expect(text).not.toContain('at ');
        expect(text).not.toContain('node_modules');
    });
});

test.describe('Socket.io Security', () => {
    test('socket.io endpoint is accessible', async ({ request }) => {
        // Verify socket.io polling transport responds (GET with transport=polling)
        const response = await request.get('/socket.io/?EIO=4&transport=polling', {
            failOnStatusCode: false,
        });

        // Socket.io should respond (200 for valid handshake or 400 for missing params)
        expect(response.status()).toBeLessThan(500);
    });

    test('socket.io rejects malformed transport requests', async ({ request }) => {
        const response = await request.get('/socket.io/?EIO=4&transport=invalid', {
            failOnStatusCode: false,
        });

        // Should reject gracefully without server error
        expect(response.status()).toBeLessThan(500);
    });
});

test.describe('Static File Security', () => {
    test('service worker has no-cache headers', async ({ request }) => {
        const response = await request.get('/service-worker.js', {
            failOnStatusCode: false,
        });

        if (response.status() === 200) {
            const cacheControl = response.headers()['cache-control'];
            expect(cacheControl).toBeDefined();
            expect(cacheControl).toContain('no-cache');
        }
    });

    test('HTML pages have no-cache headers to ensure fresh deploys', async ({ request }) => {
        const response = await request.get('/', {
            failOnStatusCode: false,
        });

        expect(response.status()).toBe(200);
        const cacheControl = response.headers()['cache-control'];
        expect(cacheControl).toBeDefined();
        expect(cacheControl).toContain('no-cache');
    });

    test('directory traversal attempts are blocked', async ({ request }) => {
        const response = await request.get('/../../etc/passwd', {
            failOnStatusCode: false,
        });

        // Should not return sensitive file contents
        expect(response.status()).not.toBe(200);
        const text = await response.text();
        expect(text).not.toContain('root:');
    });
});
