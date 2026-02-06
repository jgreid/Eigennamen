/**
 * Socket.io Authentication Middleware
 *
 * Provides secure session validation with:
 * - Session age validation
 * - IP consistency checks
 * - Rate limiting for validation attempts
 * - JWT token verification
 */

import type { Socket } from 'socket.io';
import type { Player } from '../types';

/* eslint-disable @typescript-eslint/no-var-requires */
const { v4: uuidv4, validate: isValidUuid } = require('uuid');
const logger = require('../utils/logger');
const playerService = require('../services/playerService');
const { verifyTokenWithClaims, isJwtEnabled, JWT_ERROR_CODES } = require('../config/jwt');
const { getRedis } = require('../config/redis');
const {
    SESSION_SECURITY,
    REDIS_TTL,
    ERROR_CODES
} = require('../config/constants');
const { audit } = require('../services/auditService');
/* eslint-enable @typescript-eslint/no-var-requires */

/**
 * Extended socket with custom properties
 */
interface AuthSocket extends Socket {
    sessionId: string;
    clientIP: string;
    userId?: string;
    user?: JwtPayload;
    jwtVerified?: boolean;
    jwtExpired?: boolean;
    ipMismatch?: boolean;
}

/**
 * JWT payload structure
 */
interface JwtPayload {
    userId: string;
    sessionId?: string;
    [key: string]: unknown;
}

/**
 * Token verification result
 */
interface TokenVerificationResult {
    valid: boolean;
    decoded?: JwtPayload;
    error?: string;
    message?: string;
}

/**
 * Rate limit check result
 */
interface RateLimitResult {
    allowed: boolean;
    attempts: number;
}

/**
 * Session age validation result
 */
interface SessionAgeResult {
    valid: boolean;
    reason?: string;
}

/**
 * IP validation result
 */
interface IPValidationResult {
    valid: boolean;
    ipMismatch: boolean;
}

/**
 * Session validation result
 */
interface SessionValidationResult {
    valid: boolean;
    player?: Player;
    reason?: string;
    ipMismatch?: boolean;
}

/**
 * Origin validation result
 */
interface OriginValidationResult {
    valid: boolean;
    reason?: string;
}

/**
 * Check if we should trust proxy headers (X-Forwarded-For)
 * Only trust when explicitly configured or in known deployment environments
 */
function shouldTrustProxy(): boolean {
    // Trust proxy if explicitly configured
    if (process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1') {
        return true;
    }
    // Auto-detect Fly.io deployment (sets FLY_APP_NAME)
    if (process.env.FLY_APP_NAME) {
        return true;
    }
    // Auto-detect Heroku (sets DYNO)
    if (process.env.DYNO) {
        return true;
    }
    // Don't trust by default in other environments
    return false;
}

/**
 * Get client IP address from socket, handling proxies securely
 * Only trusts X-Forwarded-For when behind a known/configured proxy
 */
function getClientIP(socket: Socket): string {
    // Only check X-Forwarded-For if we're configured to trust proxy
    if (shouldTrustProxy()) {
        const xForwardedFor = socket.handshake.headers['x-forwarded-for'];
        if (xForwardedFor) {
            // X-Forwarded-For can contain multiple IPs; the first one is the original client
            const headerValue = Array.isArray(xForwardedFor) ? xForwardedFor[0] : xForwardedFor;
            const ips = (headerValue || '').split(',').map(ip => ip.trim());
            return ips[0] || socket.handshake.address;
        }
    }
    // Fall back to direct connection address
    return socket.handshake.address;
}

/**
 * Rate limit session validation attempts by IP
 * Prevents brute-force session hijacking attempts
 */
async function checkValidationRateLimit(clientIP: string): Promise<RateLimitResult> {
    const redis = getRedis();
    const key = `session:validation:${clientIP}`;

    try {
        const attempts: number = await redis.incr(key);

        // Set expiry on first attempt
        if (attempts === 1) {
            await redis.expire(key, REDIS_TTL.SESSION_VALIDATION_WINDOW);
        }

        const maxAttempts = SESSION_SECURITY.MAX_VALIDATION_ATTEMPTS_PER_IP;
        if (attempts > maxAttempts) {
            logger.warn('Session validation rate limited', {
                clientIP,
                attempts,
                maxAttempts
            });
            return { allowed: false, attempts };
        }

        return { allowed: true, attempts };
    } catch (error) {
        // Configurable fail behavior: fail-open (availability) vs fail-closed (security)
        logger.error('Rate limit check failed:', (error as Error).message);
        if (SESSION_SECURITY.RATE_LIMIT_FAIL_CLOSED) {
            logger.warn('Rate limit Redis failure - denying request (fail-closed mode)');
            return { allowed: false, attempts: 0 };
        }
        // Default: fail-open for availability
        return { allowed: true, attempts: 0 };
    }
}

/**
 * Validate session age
 */
function validateSessionAge(player: Player): SessionAgeResult {
    const createdAt = player.createdAt || player.connectedAt;
    if (!createdAt) {
        // No creation time - allow but log
        logger.debug('Session has no creation timestamp');
        return { valid: true };
    }

    const sessionAge = Date.now() - createdAt;
    if (sessionAge > SESSION_SECURITY.MAX_SESSION_AGE_MS) {
        return {
            valid: false,
            reason: ERROR_CODES.SESSION_EXPIRED
        };
    }

    return { valid: true };
}

/**
 * Validate IP consistency for session reconnection
 */
function validateIPConsistency(player: Player, currentIP: string): IPValidationResult {
    if (!player.lastIP) {
        // No previous IP recorded - allow
        return { valid: true, ipMismatch: false };
    }

    if (player.lastIP !== currentIP) {
        logger.warn('IP mismatch on session reconnection', {
            sessionId: player.sessionId,
            previousIP: player.lastIP,
            currentIP,
            nickname: player.nickname,
            roomCode: player.roomCode
        });

        if (SESSION_SECURITY.IP_MISMATCH_ALLOWED) {
            // Allow but flag for monitoring
            return { valid: true, ipMismatch: true };
        }

        return { valid: false, ipMismatch: true };
    }

    return { valid: true, ipMismatch: false };
}

/**
 * Comprehensive session validation
 */
async function validateSession(sessionId: string, clientIP: string): Promise<SessionValidationResult> {
    // Check rate limit first
    const rateLimit = await checkValidationRateLimit(clientIP);
    if (!rateLimit.allowed) {
        return {
            valid: false,
            reason: ERROR_CODES.SESSION_VALIDATION_RATE_LIMITED
        };
    }

    // Get player data
    const player: Player | null = await playerService.getPlayer(sessionId);
    if (!player) {
        return {
            valid: false,
            reason: ERROR_CODES.SESSION_NOT_FOUND
        };
    }

    // Validate session age
    const ageValidation = validateSessionAge(player);
    if (!ageValidation.valid) {
        return {
            valid: false,
            reason: ageValidation.reason
        };
    }

    // Validate IP consistency
    const ipValidation = validateIPConsistency(player, clientIP);
    if (!ipValidation.valid) {
        return {
            valid: false,
            reason: ERROR_CODES.NOT_AUTHORIZED
        };
    }

    return {
        valid: true,
        player,
        ipMismatch: ipValidation.ipMismatch
    };
}

/**
 * Validate WebSocket connection origin for CSRF protection
 */
function validateOrigin(socket: Socket): OriginValidationResult {
    const origin = socket.handshake.headers.origin;
    const corsOrigin = process.env.CORS_ORIGIN;
    const isProduction = process.env.NODE_ENV === 'production';

    // In development with wildcard CORS, allow all origins
    if (!isProduction && (!corsOrigin || corsOrigin === '*')) {
        return { valid: true };
    }

    // If no origin header (e.g., same-origin or non-browser client), allow in dev
    if (!origin) {
        if (isProduction) {
            // In production, missing origin is suspicious - log but allow for backwards compat
            logger.warn('WebSocket connection without origin header', {
                socketId: socket.id,
                clientIP: getClientIP(socket)
            });
        }
        return { valid: true };
    }

    // Parse allowed origins from CORS_ORIGIN
    const allowedOrigins = (corsOrigin || '').split(',').map(o => o.trim().toLowerCase());

    // Check if origin is allowed
    const originLower = origin.toLowerCase();
    const isAllowed = allowedOrigins.some(allowed => {
        if (allowed === '*') return true;
        // Exact match
        if (allowed === originLower) return true;
        // Support wildcard subdomains (e.g., *.example.com)
        if (allowed.startsWith('*.')) {
            const domain = allowed.slice(2);
            return originLower.endsWith(domain) &&
                   (originLower.length === domain.length ||
                    originLower[originLower.length - domain.length - 1] === '.');
        }
        return false;
    });

    if (!isAllowed) {
        logger.warn('WebSocket CSRF protection: origin not allowed', {
            origin,
            allowedOrigins,
            socketId: socket.id,
            clientIP: getClientIP(socket)
        });

        // Audit suspicious activity
        audit.suspicious(
            'WebSocket connection from unauthorized origin',
            (socket.handshake.auth as { sessionId?: string })?.sessionId || 'unknown',
            getClientIP(socket),
            { origin, allowedOrigins }
        );

        return {
            valid: false,
            reason: 'Origin not allowed'
        };
    }

    return { valid: true };
}

/**
 * Authenticate socket connection
 * Includes comprehensive session validation with security checks
 */
async function authenticateSocket(socket: Socket, next: (err?: Error) => void): Promise<void> {
    try {
        const authSocket = socket as AuthSocket;

        // CSRF Protection: Validate origin header
        const originValidation = validateOrigin(socket);
        if (!originValidation.valid) {
            return next(new Error(originValidation.reason || 'Origin not allowed'));
        }

        const auth = socket.handshake.auth as { sessionId?: string; token?: string; reconnectToken?: string };
        const { sessionId, token } = auth;

        // Get client IP (handles proxies)
        const currentIP = getClientIP(socket);

        // Validate and use provided session ID, or generate new one
        let validatedSessionId: string | null = null;
        let sessionValidationResult: SessionValidationResult | null = null;

        if (sessionId) {
            // Validate session ID format (must be valid UUID)
            if (!isValidUuid(sessionId)) {
                logger.warn('Invalid session ID format rejected', {
                    sessionId: sessionId.substring(0, 10) + '...',
                    clientIP: currentIP
                });
            } else {
                // Check if there's an existing player with this session
                const existingPlayer: Player | null = await playerService.getPlayer(sessionId);

                if (existingPlayer) {
                    // Only allow session reuse if player is disconnected (legitimate reconnection)
                    if (!existingPlayer.connected) {
                        // Perform full session validation
                        sessionValidationResult = await validateSession(sessionId, currentIP);

                        if (sessionValidationResult.valid) {
                            // ISSUE #17 FIX: Validate reconnection token
                            const reconnectToken = auth.reconnectToken;

                            // SECURITY FIX: Validate token format before processing
                            // Reconnection tokens are hex-encoded, so length should be 64 chars (32 bytes * 2)
                            const expectedTokenLength = (SESSION_SECURITY.RECONNECTION_TOKEN_LENGTH || 32) * 2;
                            const isValidFormat = !reconnectToken ||
                                (typeof reconnectToken === 'string' &&
                                 reconnectToken.length === expectedTokenLength &&
                                 /^[0-9a-f]+$/i.test(reconnectToken));

                            if (reconnectToken && !isValidFormat) {
                                logger.warn('Invalid reconnection token format', {
                                    sessionId,
                                    tokenLength: reconnectToken?.length,
                                    expectedLength: expectedTokenLength,
                                    clientIP: currentIP
                                });
                                // Treat as no token provided - will generate new session
                                validatedSessionId = null;
                            } else {
                                const tokenValid: boolean = await playerService.validateReconnectToken(sessionId, reconnectToken);

                                if (tokenValid) {
                                    validatedSessionId = sessionId;
                                    logger.debug('Session validated for reconnection with token', {
                                        sessionId,
                                        ipMismatch: sessionValidationResult.ipMismatch
                                    });

                                    // Flag IP mismatch on socket for monitoring
                                    if (sessionValidationResult.ipMismatch) {
                                        authSocket.ipMismatch = true;
                                    }
                                } else {
                                    logger.warn('Reconnection token validation failed', {
                                        sessionId,
                                        hasToken: !!reconnectToken,
                                        clientIP: currentIP
                                    });
                                    // Token invalid - generate new session
                                    validatedSessionId = null;
                                }
                            }
                        } else {
                            logger.warn('Session validation failed', {
                                sessionId,
                                reason: sessionValidationResult.reason,
                                clientIP: currentIP
                            });
                        }
                    } else {
                        // Player is currently connected - potential hijacking attempt
                        logger.warn('Session hijacking attempt blocked', {
                            sessionId,
                            clientIP: currentIP
                        });
                        // Generate new session instead of rejecting (more user-friendly)
                        validatedSessionId = null;
                    }
                } else {
                    // No existing player with this session - could be returning user or stale session
                    // Allow it (session will be created fresh when they join a room)
                    validatedSessionId = sessionId;
                }
            }
        }

        // Use validated session ID or generate new one
        authSocket.sessionId = validatedSessionId || uuidv4();

        // Store client IP on socket for rate limiting
        authSocket.clientIP = currentIP;

        // Handle JWT token verification with claims validation
        if (token && isJwtEnabled()) {
            // Build expected claims for validation
            const expectedClaims: Record<string, unknown> = {};
            // If we have a validated session, the token should match it
            if (validatedSessionId && sessionValidationResult?.player?.userId) {
                expectedClaims.userId = sessionValidationResult.player.userId;
            }

            const tokenResult: TokenVerificationResult = verifyTokenWithClaims(token, expectedClaims);

            if (tokenResult.valid && tokenResult.decoded) {
                authSocket.userId = tokenResult.decoded.userId;
                authSocket.user = tokenResult.decoded;
                authSocket.jwtVerified = true;
                logger.debug('JWT token verified for socket', {
                    socketId: socket.id,
                    userId: tokenResult.decoded.userId,
                    sessionId: tokenResult.decoded.sessionId
                });
            } else {
                // Log detailed error information for debugging
                logger.debug('JWT token validation failed for socket', {
                    socketId: socket.id,
                    errorCode: tokenResult.error,
                    errorMessage: tokenResult.message
                });

                // Handle specific error cases
                if (tokenResult.error === JWT_ERROR_CODES.TOKEN_EXPIRED) {
                    authSocket.jwtExpired = true;
                } else if (tokenResult.error === JWT_ERROR_CODES.CLAIMS_MISMATCH) {
                    // Potential session/token mismatch - log for security monitoring
                    logger.warn('JWT claims mismatch detected', {
                        socketId: socket.id,
                        clientIP: currentIP,
                        sessionId: authSocket.sessionId
                    });
                }
            }
        }

        // Map socket ID to session ID for this connection (with IP tracking for security)
        await playerService.setSocketMapping(authSocket.sessionId, socket.id, currentIP);

        logger.debug('Socket authenticated', {
            socketId: socket.id,
            sessionId: authSocket.sessionId,
            hasUserId: !!authSocket.userId,
            clientIP: currentIP
        });
        next();

    } catch (error) {
        logger.error('Socket authentication error:', error);
        next(new Error('Authentication failed'));
    }
}

/**
 * Middleware to require authenticated user (JWT)
 */
function requireAuth(socket: Socket, next: (err?: Error) => void): void {
    const authSocket = socket as AuthSocket;
    if (!authSocket.userId) {
        return next(new Error('Authentication required'));
    }
    next();
}

module.exports = {
    authenticateSocket,
    requireAuth,
    getClientIP,
    validateSession,
    validateOrigin
};

export {
    authenticateSocket,
    requireAuth,
    getClientIP,
    validateSession,
    validateOrigin
};
