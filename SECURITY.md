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

We aim to acknowledge reports within 48 hours and provide an initial assessment within 5 business days.

## Threat Model

### Assets Protected
- **Spymaster card types**: Must never be exposed to non-spymaster clients (game integrity)
- **Session tokens**: JWT secrets, reconnection tokens, session IDs
- **Player data**: Nicknames, IP addresses, session history
- **Game state**: Redis-stored state must resist tampering via crafted WebSocket messages

### Attack Surfaces
| Surface | Threats | Mitigations |
|---------|---------|-------------|
| **WebSocket events** | Injection, unauthorized actions, replay attacks | Zod validation, role-based authorization, rate limiting |
| **HTTP API** | CSRF, injection, DoS | Helmet.js headers, CORS, express-rate-limit, body size limits |
| **Redis** | Unauthorized access, data corruption | Password authentication, Lua script atomicity, TTL expiration |
| **Authentication** | Session hijacking, brute-force | JWT with min 32-char secret, IP consistency checks, session age limits |
| **Client** | XSS, DOM manipulation | CSP headers, HTML escaping, NFKC normalization |

### Trust Boundaries
- **Client ↔ Server**: All client input is untrusted. Zod schemas validate at every entry point.
- **Server ↔ Redis**: Internal boundary. Redis requires password in production; Lua scripts re-validate preconditions.
- **Server ↔ Admin API**: Requires `ADMIN_PASSWORD`. Admin endpoints are separate from player endpoints.

## Security Measures

### Input Validation
- Zod schemas at all WebSocket event handlers and REST endpoints
- NFKC Unicode normalization prevents homoglyph attacks
- 1MB request body size limit (HTTP)
- 100KB max WebSocket message size
- Board index validation (0-24) in both server and Lua scripts

### Authentication & Sessions
- JWT with enforced minimum 32-character secret in production
- Session age limit: 8 hours max lifetime
- Reconnection tokens: 32-byte cryptographic tokens with 5-minute TTL
- IP consistency checking (configurable via `ALLOW_IP_MISMATCH`)
- Socket auth rate limiting: per-IP failure tracking with progressive blocking

### Network Security
- Helmet.js: CSP, HSTS (1 year, preload, includeSubDomains), X-Frame-Options DENY
- CORS: Wildcard origin blocked in production (`process.exit(1)`)
- CSRF: X-Requested-With header required + Origin/Referer validation
- HTTPS enforced in production (Fly.io auto-redirect)

### Rate Limiting
- **HTTP**: express-rate-limit (configurable window and max requests)
- **WebSocket**: Per-event rate limiting with Redis-backed counters
- **Auth failures**: Per-IP auth failure tracking with automatic blocking after threshold
- **Connection limits**: Max concurrent connections per IP

### Data Protection
- Spymaster card types filtered per-player before emission (`getGameStateForPlayer`)
- Error responses strip sensitive fields (sessionId, roomId) in production
- Audit logging for security events (CSRF violations, auth failures, rate limit hits)
- No secrets in Docker image layers (multi-stage build)

### Infrastructure
- Non-root Docker container execution
- Redis password required in docker-compose
- Graceful shutdown with client notification
- CI/CD: npm audit, Trivy vulnerability scanning, CodeQL analysis

## Incident Response

1. **Detection**: Audit logs and rate limit metrics surface suspicious activity
2. **Containment**: Block offending IPs via auth failure rate limiter or infrastructure-level rules
3. **Assessment**: Review audit logs, Redis state, and server logs
4. **Remediation**: Deploy fix, rotate JWT secret if session compromise suspected
5. **Communication**: Notify affected users if personal data was exposed

## Security Configuration

Key environment variables for security hardening:

| Variable | Purpose | Default |
|----------|---------|---------|
| `JWT_SECRET` | JWT signing key (min 32 chars in production) | Required |
| `ADMIN_PASSWORD` | Admin dashboard authentication | Optional (warned if missing) |
| `CORS_ORIGIN` | Allowed CORS origins | Wildcard blocked in production |
| `ALLOW_IP_MISMATCH` | Allow reconnection from different IPs | `false` |
| `RATE_LIMIT_WINDOW_MS` | HTTP rate limit window | `60000` |
| `RATE_LIMIT_MAX_REQUESTS` | HTTP rate limit max requests | `100` |
