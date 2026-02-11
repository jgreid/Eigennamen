/**
 * Audit Service Tests
 *
 * Tests for services/auditService.js - the security audit logging service
 * that stores events in Redis for compliance and forensics.
 */

// Mock logger first
jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
}));

// Mock Redis configuration
const mockRedisStorage = new Map();
const mockRedis = {
    lPush: jest.fn(async (key, value) => {
        const existing = mockRedisStorage.get(key) || [];
        existing.unshift(value);
        mockRedisStorage.set(key, existing);
        return existing.length;
    }),
    lTrim: jest.fn(async () => 'OK'),
    expire: jest.fn(async () => 1),
    lRange: jest.fn(async (key, start, end) => {
        const list = mockRedisStorage.get(key) || [];
        return list.slice(start, end + 1);
    }),
    lLen: jest.fn(async (key) => {
        return (mockRedisStorage.get(key) || []).length;
    })
};

// Use mockUsingMemoryMode (prefixed with mock for Jest)
let mockUsingMemoryMode = false;
jest.mock('../config/redis', () => ({
    getRedis: jest.fn(() => mockRedis),
    isUsingMemoryMode: jest.fn(() => mockUsingMemoryMode)
}));

const {
    AUDIT_EVENTS,
    logAuditEvent,
    getAuditLogs,
    getAuditSummary,
    audit,
    clearMemoryLogs
} = require('../services/auditService');
const logger = require('../utils/logger');
require('../config/redis');

describe('Audit Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockRedisStorage.clear();
        clearMemoryLogs();
        mockUsingMemoryMode = false;
    });

    describe('AUDIT_EVENTS', () => {
        it('should contain all admin event types', () => {
            expect(AUDIT_EVENTS.ADMIN_LOGIN).toBe('admin.login');
            expect(AUDIT_EVENTS.ADMIN_LOGIN_FAILED).toBe('admin.login_failed');
            expect(AUDIT_EVENTS.ADMIN_ACTION).toBe('admin.action');
            expect(AUDIT_EVENTS.ADMIN_ROOM_VIEW).toBe('admin.room_view');
            expect(AUDIT_EVENTS.ADMIN_PLAYER_KICK).toBe('admin.player_kick');
            expect(AUDIT_EVENTS.ADMIN_ROOM_DELETE).toBe('admin.room_delete');
            expect(AUDIT_EVENTS.ADMIN_BROADCAST).toBe('admin.broadcast');
        });

        it('should contain all security event types', () => {
            expect(AUDIT_EVENTS.RATE_LIMIT_HIT).toBe('security.rate_limit');
            expect(AUDIT_EVENTS.AUTH_FAILURE).toBe('security.auth_failure');
            expect(AUDIT_EVENTS.INVALID_TOKEN).toBe('security.invalid_token');
            expect(AUDIT_EVENTS.SESSION_HIJACK_ATTEMPT).toBe('security.session_hijack');
            expect(AUDIT_EVENTS.SUSPICIOUS_ACTIVITY).toBe('security.suspicious');
        });

        it('should contain all room event types', () => {
            expect(AUDIT_EVENTS.ROOM_CREATED).toBe('room.created');
            expect(AUDIT_EVENTS.ROOM_DELETED).toBe('room.deleted');
            expect(AUDIT_EVENTS.PLAYER_KICKED).toBe('room.player_kicked');
            expect(AUDIT_EVENTS.HOST_TRANSFERRED).toBe('room.host_transferred');
        });

        it('should contain all game event types', () => {
            expect(AUDIT_EVENTS.GAME_STARTED).toBe('game.started');
            expect(AUDIT_EVENTS.GAME_ENDED).toBe('game.ended');
            expect(AUDIT_EVENTS.GAME_FORFEITED).toBe('game.forfeited');
        });
    });

    describe('logAuditEvent()', () => {
        it('should log audit event with full details', async () => {
            await logAuditEvent(AUDIT_EVENTS.ROOM_CREATED, {
                actor: 'session-123',
                target: 'ABCDEF',
                ip: '192.168.1.1',
                metadata: { hostNickname: 'TestUser' }
            });

            expect(logger.info).toHaveBeenCalledWith('Audit event', expect.objectContaining({
                audit: true,
                event: AUDIT_EVENTS.ROOM_CREATED,
                actor: 'session-123',
                target: 'ABCDEF',
                ip: '192.168.1.1',
                severity: 'low'
            }));
        });

        it('should use default values for missing details', async () => {
            await logAuditEvent(AUDIT_EVENTS.ROOM_DELETED);

            expect(logger.info).toHaveBeenCalledWith('Audit event', expect.objectContaining({
                audit: true,
                event: AUDIT_EVENTS.ROOM_DELETED,
                actor: 'unknown',
                target: null,
                ip: null
            }));
        });

        it('should log critical events with error level', async () => {
            await logAuditEvent(AUDIT_EVENTS.SESSION_HIJACK_ATTEMPT, {
                actor: 'attacker-session',
                ip: '10.0.0.1'
            });

            expect(logger.error).toHaveBeenCalledWith('Audit event', expect.objectContaining({
                severity: 'critical'
            }));
        });

        it('should log high severity events with warn level', async () => {
            await logAuditEvent(AUDIT_EVENTS.AUTH_FAILURE, {
                actor: 'unknown',
                ip: '10.0.0.1'
            });

            expect(logger.warn).toHaveBeenCalledWith('Audit event', expect.objectContaining({
                severity: 'high'
            }));
        });

        it('should store audit log in Redis when not in memory mode', async () => {
            await logAuditEvent(AUDIT_EVENTS.ROOM_CREATED, {
                actor: 'session-123',
                target: 'XYZABC'
            });

            expect(mockRedis.lPush).toHaveBeenCalled();
            expect(mockRedis.lTrim).toHaveBeenCalled();
            expect(mockRedis.expire).toHaveBeenCalled();
        });

        it('should not store in Redis when in memory mode', async () => {
            mockUsingMemoryMode = true;

            await logAuditEvent(AUDIT_EVENTS.GAME_STARTED, {
                actor: 'host-session',
                target: 'ROOM01'
            });

            expect(mockRedis.lPush).not.toHaveBeenCalled();
        });

        it('should handle Redis errors gracefully', async () => {
            mockRedis.lPush.mockRejectedValueOnce(new Error('Redis connection failed'));

            await logAuditEvent(AUDIT_EVENTS.ROOM_CREATED, {
                actor: 'session-123'
            });

            // Should still log the event
            expect(logger.info).toHaveBeenCalled();
            // And log the error
            expect(logger.error).toHaveBeenCalledWith('Failed to store audit log', expect.objectContaining({
                error: 'Redis connection failed'
            }));
        });

        it('should store admin events in admin key', async () => {
            await logAuditEvent(AUDIT_EVENTS.ADMIN_LOGIN, {
                actor: 'admin',
                ip: '127.0.0.1'
            });

            const calls = mockRedis.lPush.mock.calls;
            expect(calls.some(call => call[0] === 'audit:admin')).toBe(true);
        });

        it('should store security events in security key', async () => {
            await logAuditEvent(AUDIT_EVENTS.RATE_LIMIT_HIT, {
                actor: 'session-456',
                ip: '10.0.0.5'
            });

            const calls = mockRedis.lPush.mock.calls;
            expect(calls.some(call => call[0] === 'audit:security')).toBe(true);
        });

        it('should include timestamp in log entry', async () => {
            const beforeTime = new Date().toISOString();
            await logAuditEvent(AUDIT_EVENTS.GAME_ENDED, {});
            const afterTime = new Date().toISOString();

            const logCall = logger.info.mock.calls[0];
            const logEntry = logCall[1];
            expect(logEntry.timestamp).toBeDefined();
            expect(logEntry.timestamp >= beforeTime).toBe(true);
            expect(logEntry.timestamp <= afterTime).toBe(true);
        });
    });

    describe('getSeverity() via logAuditEvent', () => {
        it('should return critical for session hijack attempt', async () => {
            await logAuditEvent(AUDIT_EVENTS.SESSION_HIJACK_ATTEMPT, {});
            expect(logger.error).toHaveBeenCalledWith('Audit event', expect.objectContaining({
                severity: 'critical'
            }));
        });

        it('should return critical for admin room delete', async () => {
            await logAuditEvent(AUDIT_EVENTS.ADMIN_ROOM_DELETE, {});
            expect(logger.error).toHaveBeenCalledWith('Audit event', expect.objectContaining({
                severity: 'critical'
            }));
        });

        it('should return high for admin login failed', async () => {
            await logAuditEvent(AUDIT_EVENTS.ADMIN_LOGIN_FAILED, {});
            expect(logger.warn).toHaveBeenCalledWith('Audit event', expect.objectContaining({
                severity: 'high'
            }));
        });

        it('should return high for auth failure', async () => {
            await logAuditEvent(AUDIT_EVENTS.AUTH_FAILURE, {});
            expect(logger.warn).toHaveBeenCalledWith('Audit event', expect.objectContaining({
                severity: 'high'
            }));
        });

        it('should return high for invalid token', async () => {
            await logAuditEvent(AUDIT_EVENTS.INVALID_TOKEN, {});
            expect(logger.warn).toHaveBeenCalledWith('Audit event', expect.objectContaining({
                severity: 'high'
            }));
        });

        it('should return high for suspicious activity', async () => {
            await logAuditEvent(AUDIT_EVENTS.SUSPICIOUS_ACTIVITY, {});
            expect(logger.warn).toHaveBeenCalledWith('Audit event', expect.objectContaining({
                severity: 'high'
            }));
        });

        it('should return high for admin player kick', async () => {
            await logAuditEvent(AUDIT_EVENTS.ADMIN_PLAYER_KICK, {});
            expect(logger.warn).toHaveBeenCalledWith('Audit event', expect.objectContaining({
                severity: 'high'
            }));
        });

        it('should return high for admin broadcast', async () => {
            await logAuditEvent(AUDIT_EVENTS.ADMIN_BROADCAST, {});
            expect(logger.warn).toHaveBeenCalledWith('Audit event', expect.objectContaining({
                severity: 'high'
            }));
        });

        it('should return medium for rate limit hit', async () => {
            await logAuditEvent(AUDIT_EVENTS.RATE_LIMIT_HIT, {});
            expect(logger.info).toHaveBeenCalledWith('Audit event', expect.objectContaining({
                severity: 'medium'
            }));
        });

        it('should return medium for admin login', async () => {
            await logAuditEvent(AUDIT_EVENTS.ADMIN_LOGIN, {});
            expect(logger.info).toHaveBeenCalledWith('Audit event', expect.objectContaining({
                severity: 'medium'
            }));
        });

        it('should return medium for admin action', async () => {
            await logAuditEvent(AUDIT_EVENTS.ADMIN_ACTION, {});
            expect(logger.info).toHaveBeenCalledWith('Audit event', expect.objectContaining({
                severity: 'medium'
            }));
        });

        it('should return medium for player kicked', async () => {
            await logAuditEvent(AUDIT_EVENTS.PLAYER_KICKED, {});
            expect(logger.info).toHaveBeenCalledWith('Audit event', expect.objectContaining({
                severity: 'medium'
            }));
        });

        it('should return low for room created', async () => {
            await logAuditEvent(AUDIT_EVENTS.ROOM_CREATED, {});
            expect(logger.info).toHaveBeenCalledWith('Audit event', expect.objectContaining({
                severity: 'low'
            }));
        });

        it('should return low for game started', async () => {
            await logAuditEvent(AUDIT_EVENTS.GAME_STARTED, {});
            expect(logger.info).toHaveBeenCalledWith('Audit event', expect.objectContaining({
                severity: 'low'
            }));
        });

        it('should return low for unknown events', async () => {
            await logAuditEvent('unknown.event', {});
            expect(logger.info).toHaveBeenCalledWith('Audit event', expect.objectContaining({
                severity: 'low'
            }));
        });
    });

    describe('getAuditLogs()', () => {
        it('should return empty array in memory mode with no prior events', async () => {
            mockUsingMemoryMode = true;
            const logs = await getAuditLogs();
            expect(logs).toEqual([]);
        });

        it('should return stored logs in memory mode after logging events', async () => {
            mockUsingMemoryMode = true;
            await logAuditEvent(AUDIT_EVENTS.ROOM_CREATED, { actor: 'session-1', target: 'ROOM1' });
            const logs = await getAuditLogs();
            expect(logs.length).toBeGreaterThanOrEqual(1);
            expect(logs[0].event).toBe(AUDIT_EVENTS.ROOM_CREATED);
        });

        it('should return parsed logs from main log key by default', async () => {
            const testLog = JSON.stringify({
                timestamp: new Date().toISOString(),
                event: AUDIT_EVENTS.ROOM_CREATED,
                actor: 'session-1',
                severity: 'low'
            });
            mockRedisStorage.set('audit:log', [testLog]);

            const logs = await getAuditLogs();

            expect(mockRedis.lRange).toHaveBeenCalledWith('audit:log', 0, 99);
            expect(logs).toHaveLength(1);
            expect(logs[0].event).toBe(AUDIT_EVENTS.ROOM_CREATED);
        });

        it('should return logs from admin key when category is admin', async () => {
            const testLog = JSON.stringify({
                event: AUDIT_EVENTS.ADMIN_LOGIN,
                severity: 'medium'
            });
            mockRedisStorage.set('audit:admin', [testLog]);

            const logs = await getAuditLogs({ category: 'admin' });

            expect(mockRedis.lRange).toHaveBeenCalledWith('audit:admin', 0, 99);
            expect(logs[0].event).toBe(AUDIT_EVENTS.ADMIN_LOGIN);
        });

        it('should return logs from security key when category is security', async () => {
            const testLog = JSON.stringify({
                event: AUDIT_EVENTS.AUTH_FAILURE,
                severity: 'high'
            });
            mockRedisStorage.set('audit:security', [testLog]);

            const logs = await getAuditLogs({ category: 'security' });

            expect(mockRedis.lRange).toHaveBeenCalledWith('audit:security', 0, 99);
            expect(logs[0].event).toBe(AUDIT_EVENTS.AUTH_FAILURE);
        });

        it('should respect limit option', async () => {
            await getAuditLogs({ limit: 50 });
            expect(mockRedis.lRange).toHaveBeenCalledWith('audit:log', 0, 49);
        });

        it('should filter by severity when specified', async () => {
            const logs = [
                JSON.stringify({ event: 'test1', severity: 'high' }),
                JSON.stringify({ event: 'test2', severity: 'low' }),
                JSON.stringify({ event: 'test3', severity: 'high' })
            ];
            mockRedisStorage.set('audit:log', logs);

            const result = await getAuditLogs({ severity: 'high' });

            expect(result).toHaveLength(2);
            expect(result.every(log => log.severity === 'high')).toBe(true);
        });

        it('should handle malformed JSON gracefully', async () => {
            const logs = [
                JSON.stringify({ event: 'valid', severity: 'low' }),
                'not valid json',
                JSON.stringify({ event: 'also valid', severity: 'low' })
            ];
            mockRedisStorage.set('audit:log', logs);

            const result = await getAuditLogs();

            expect(result).toHaveLength(2);
        });

        it('should handle Redis errors gracefully', async () => {
            mockRedis.lRange.mockRejectedValueOnce(new Error('Redis error'));

            const logs = await getAuditLogs();

            expect(logs).toEqual([]);
            expect(logger.error).toHaveBeenCalledWith('Failed to retrieve audit logs', expect.any(Object));
        });
    });

    describe('getAuditSummary()', () => {
        it('should return zero counts in memory mode with no prior events', async () => {
            mockUsingMemoryMode = true;

            const summary = await getAuditSummary();

            expect(summary).toEqual({
                total: 0,
                admin: 0,
                security: 0,
                bySeverity: {}
            });
        });

        it('should return counts from Redis', async () => {
            mockRedisStorage.set('audit:log', ['log1', 'log2', 'log3']);
            mockRedisStorage.set('audit:admin', ['admin1']);
            mockRedisStorage.set('audit:security', ['security1', 'security2']);

            const summary = await getAuditSummary();

            expect(summary.total).toBe(3);
            expect(summary.admin).toBe(1);
            expect(summary.security).toBe(2);
        });

        it('should include severity breakdown', async () => {
            const logs = [
                JSON.stringify({ severity: 'high' }),
                JSON.stringify({ severity: 'high' }),
                JSON.stringify({ severity: 'low' }),
                JSON.stringify({ severity: 'medium' })
            ];
            mockRedisStorage.set('audit:log', logs);

            const summary = await getAuditSummary();

            expect(summary.bySeverity).toEqual({
                high: 2,
                low: 1,
                medium: 1
            });
        });

        it('should handle Redis errors gracefully', async () => {
            mockRedis.lLen.mockRejectedValueOnce(new Error('Redis error'));

            const summary = await getAuditSummary();

            expect(summary).toEqual({
                total: 0,
                admin: 0,
                security: 0,
                bySeverity: {},
                error: 'Redis error'
            });
            expect(logger.error).toHaveBeenCalledWith('Failed to get audit summary', expect.any(Object));
        });
    });

    describe('audit convenience functions', () => {
        describe('audit.adminLogin()', () => {
            it('should log successful admin login', async () => {
                await audit.adminLogin('192.168.1.1', true);

                expect(logger.info).toHaveBeenCalledWith('Audit event', expect.objectContaining({
                    event: AUDIT_EVENTS.ADMIN_LOGIN,
                    actor: 'admin',
                    ip: '192.168.1.1'
                }));
            });

            it('should log failed admin login', async () => {
                await audit.adminLogin('10.0.0.1', false);

                expect(logger.warn).toHaveBeenCalledWith('Audit event', expect.objectContaining({
                    event: AUDIT_EVENTS.ADMIN_LOGIN_FAILED,
                    actor: 'admin',
                    ip: '10.0.0.1'
                }));
            });
        });

        describe('audit.adminAction()', () => {
            it('should log admin action with all details', async () => {
                await audit.adminAction('view_room', 'ABCDEF', '127.0.0.1', { detail: 'test' });

                expect(logger.info).toHaveBeenCalledWith('Audit event', expect.objectContaining({
                    event: AUDIT_EVENTS.ADMIN_ACTION,
                    actor: 'admin',
                    target: 'ABCDEF',
                    ip: '127.0.0.1'
                }));
            });
        });

        describe('audit.adminKickPlayer()', () => {
            it('should log player kick by admin', async () => {
                await audit.adminKickPlayer('ROOM01', 'player-123', '127.0.0.1', 'disruptive');

                expect(logger.warn).toHaveBeenCalledWith('Audit event', expect.objectContaining({
                    event: AUDIT_EVENTS.ADMIN_PLAYER_KICK,
                    actor: 'admin',
                    target: 'ROOM01/player-123',
                    ip: '127.0.0.1'
                }));
            });
        });

        describe('audit.adminDeleteRoom()', () => {
            it('should log room deletion by admin', async () => {
                await audit.adminDeleteRoom('ROOM02', '127.0.0.1', 'inactive');

                expect(logger.error).toHaveBeenCalledWith('Audit event', expect.objectContaining({
                    event: AUDIT_EVENTS.ADMIN_ROOM_DELETE,
                    actor: 'admin',
                    target: 'ROOM02',
                    ip: '127.0.0.1',
                    severity: 'critical'
                }));
            });
        });

        describe('audit.rateLimitHit()', () => {
            it('should log rate limit event', async () => {
                await audit.rateLimitHit('room:create', 'session-456', '10.0.0.5');

                expect(logger.info).toHaveBeenCalledWith('Audit event', expect.objectContaining({
                    event: AUDIT_EVENTS.RATE_LIMIT_HIT,
                    actor: 'session-456',
                    ip: '10.0.0.5'
                }));
            });
        });

        describe('audit.authFailure()', () => {
            it('should log authentication failure', async () => {
                await audit.authFailure('invalid token', '192.168.0.100', { tokenPrefix: 'abc' });

                expect(logger.warn).toHaveBeenCalledWith('Audit event', expect.objectContaining({
                    event: AUDIT_EVENTS.AUTH_FAILURE,
                    actor: 'unknown',
                    ip: '192.168.0.100'
                }));
            });
        });

        describe('audit.suspicious()', () => {
            it('should log suspicious activity', async () => {
                await audit.suspicious('Multiple failed logins', 'session-789', '203.0.113.50', { attempts: 10 });

                expect(logger.warn).toHaveBeenCalledWith('Audit event', expect.objectContaining({
                    event: AUDIT_EVENTS.SUSPICIOUS_ACTIVITY,
                    actor: 'session-789',
                    ip: '203.0.113.50'
                }));
            });
        });

        describe('audit.roomCreated()', () => {
            it('should log room creation', async () => {
                await audit.roomCreated('XYZABC', 'host-session', '1.2.3.4');

                expect(logger.info).toHaveBeenCalledWith('Audit event', expect.objectContaining({
                    event: AUDIT_EVENTS.ROOM_CREATED,
                    actor: 'host-session',
                    target: 'XYZABC',
                    ip: '1.2.3.4'
                }));
            });
        });

        describe('audit.playerKicked()', () => {
            it('should log player kick', async () => {
                await audit.playerKicked('ROOM03', 'kicker-session', 'kicked-player', 'idle');

                expect(logger.info).toHaveBeenCalledWith('Audit event', expect.objectContaining({
                    event: AUDIT_EVENTS.PLAYER_KICKED,
                    actor: 'kicker-session',
                    target: 'ROOM03/kicked-player'
                }));
            });
        });
    });

    describe('Redis storage behavior', () => {
        it('should trim logs to MAX_LOGS_PER_CATEGORY', async () => {
            await logAuditEvent(AUDIT_EVENTS.ROOM_CREATED, {});

            expect(mockRedis.lTrim).toHaveBeenCalledWith(expect.any(String), 0, 9999);
        });

        it('should set TTL on audit log keys', async () => {
            await logAuditEvent(AUDIT_EVENTS.ROOM_CREATED, {});

            // 7 days in seconds
            expect(mockRedis.expire).toHaveBeenCalledWith(expect.any(String), 604800);
        });

        it('should store in both category-specific and main log key', async () => {
            await logAuditEvent(AUDIT_EVENTS.ADMIN_LOGIN, {});

            const lPushCalls = mockRedis.lPush.mock.calls;
            const keys = lPushCalls.map(call => call[0]);

            expect(keys).toContain('audit:admin');
            expect(keys).toContain('audit:log');
        });
    });
});
