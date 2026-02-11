# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 2.x     | Yes       |
| < 2.0   | No        |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities
2. Email the maintainers or use GitHub's private vulnerability reporting feature
3. Include a description of the vulnerability and steps to reproduce
4. Allow reasonable time for a fix before public disclosure

## Security Measures

This project implements:

- Input validation with Zod schemas at all entry points
- CSRF protection (custom header + origin validation)
- Rate limiting per-event and per-IP (Redis-backed)
- Helmet.js security headers (CSP, HSTS, X-Frame-Options)
- JWT authentication with enforced secret strength
- Session security with age limits and IP consistency checks
- Audit logging for security events
- NFKC Unicode normalization for input sanitization
- Distributed locks for concurrent operation safety
- Non-root Docker container execution
