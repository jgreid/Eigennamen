/**
 * Lua Script Validation Tests
 *
 * Since unit tests mock Redis.eval (returning null), Lua scripts are never
 * actually executed. These tests verify script structure, key usage patterns,
 * and expected behavior contracts to catch common issues.
 */
import {
    ATOMIC_CREATE_ROOM_SCRIPT,
    ATOMIC_JOIN_SCRIPT,
    ATOMIC_REFRESH_TTL_SCRIPT,
    ATOMIC_SET_ROOM_STATUS_SCRIPT,
    ATOMIC_REMOVE_PLAYER_SCRIPT,
    ATOMIC_CLEANUP_DISCONNECTED_PLAYER_SCRIPT,
    ATOMIC_SET_SOCKET_MAPPING_SCRIPT,
    ATOMIC_UPDATE_SETTINGS_SCRIPT,
    ATOMIC_ADD_TIME_SCRIPT,
    ATOMIC_TIMER_STATUS_SCRIPT,
    INVALIDATE_TOKEN_SCRIPT,
    CLEANUP_ORPHANED_TOKEN_SCRIPT,
    RELEASE_LOCK_SCRIPT,
    EXTEND_LOCK_SCRIPT,
} from '../../scripts';

describe('Lua Script Validation', () => {
    describe('script KEYS/ARGV access patterns', () => {
        it('ATOMIC_CREATE_ROOM_SCRIPT uses KEYS[1], KEYS[2], ARGV[1], ARGV[2]', () => {
            expect(ATOMIC_CREATE_ROOM_SCRIPT).toContain('KEYS[1]');
            expect(ATOMIC_CREATE_ROOM_SCRIPT).toContain('KEYS[2]');
            expect(ATOMIC_CREATE_ROOM_SCRIPT).toContain('ARGV[1]');
            expect(ATOMIC_CREATE_ROOM_SCRIPT).toContain('ARGV[2]');
        });

        it('ATOMIC_JOIN_SCRIPT validates room exists before joining', () => {
            expect(ATOMIC_JOIN_SCRIPT).toContain("redis.call('EXISTS', roomKey)");
            expect(ATOMIC_JOIN_SCRIPT).toContain('return -2');
        });

        it('ATOMIC_JOIN_SCRIPT checks capacity before adding', () => {
            expect(ATOMIC_JOIN_SCRIPT).toContain("redis.call('SCARD', playersKey)");
            expect(ATOMIC_JOIN_SCRIPT).toContain('maxPlayers');
            expect(ATOMIC_JOIN_SCRIPT).toContain('return 0');
        });

        it('ATOMIC_JOIN_SCRIPT checks for duplicate membership', () => {
            expect(ATOMIC_JOIN_SCRIPT).toContain("redis.call('SISMEMBER'");
            expect(ATOMIC_JOIN_SCRIPT).toContain('return -1');
        });
    });

    describe('atomicity guarantees', () => {
        it('ATOMIC_REMOVE_PLAYER_SCRIPT reads then deletes in single script', () => {
            expect(ATOMIC_REMOVE_PLAYER_SCRIPT).toContain("redis.call('GET', playerKey)");
            expect(ATOMIC_REMOVE_PLAYER_SCRIPT).toContain("redis.call('SREM'");
            expect(ATOMIC_REMOVE_PLAYER_SCRIPT).toContain("redis.call('DEL', playerKey)");
        });

        it('ATOMIC_CLEANUP_DISCONNECTED_PLAYER_SCRIPT guards against reconnected players', () => {
            expect(ATOMIC_CLEANUP_DISCONNECTED_PLAYER_SCRIPT).toContain('player.connected');
            expect(ATOMIC_CLEANUP_DISCONNECTED_PLAYER_SCRIPT).toContain("return 'RECONNECTED'");
        });

        it('RELEASE_LOCK_SCRIPT only releases owned locks', () => {
            expect(RELEASE_LOCK_SCRIPT).toContain('redis.call("get", KEYS[1]) == ARGV[1]');
            expect(RELEASE_LOCK_SCRIPT).toContain('redis.call("del", KEYS[1])');
            expect(RELEASE_LOCK_SCRIPT).toContain('return 0');
        });

        it('EXTEND_LOCK_SCRIPT only extends owned locks', () => {
            expect(EXTEND_LOCK_SCRIPT).toContain('redis.call("get", KEYS[1]) == ARGV[1]');
            expect(EXTEND_LOCK_SCRIPT).toContain('redis.call("pexpire"');
        });
    });

    describe('TTL handling', () => {
        it('ATOMIC_REFRESH_TTL_SCRIPT checks key existence before setting EXPIRE', () => {
            // Should not blindly set TTL on non-existent keys (which would create empty keys)
            const existsCount = (ATOMIC_REFRESH_TTL_SCRIPT.match(/redis\.call\('EXISTS'/g) || []).length;
            const expireCount = (ATOMIC_REFRESH_TTL_SCRIPT.match(/redis\.call\('EXPIRE'/g) || []).length;
            expect(existsCount).toBe(expireCount);
        });

        it('ATOMIC_SET_SOCKET_MAPPING_SCRIPT sets TTL on socket key', () => {
            expect(ATOMIC_SET_SOCKET_MAPPING_SCRIPT).toContain("'EX'");
            expect(ATOMIC_SET_SOCKET_MAPPING_SCRIPT).toContain('socketTTL');
        });

        it('ATOMIC_ADD_TIME_SCRIPT updates TTL with buffer', () => {
            expect(ATOMIC_ADD_TIME_SCRIPT).toContain("'EX'");
            expect(ATOMIC_ADD_TIME_SCRIPT).toContain('newTtl');
        });
    });

    describe('timer script correctness', () => {
        it('ATOMIC_TIMER_STATUS_SCRIPT handles paused timers', () => {
            expect(ATOMIC_TIMER_STATUS_SCRIPT).toContain('timer.paused');
            expect(ATOMIC_TIMER_STATUS_SCRIPT).toContain('timer.pausedAt');
            expect(ATOMIC_TIMER_STATUS_SCRIPT).toContain('timer.remainingWhenPaused');
        });

        it('ATOMIC_TIMER_STATUS_SCRIPT detects expiry during pause', () => {
            expect(ATOMIC_TIMER_STATUS_SCRIPT).toContain("redis.call('DEL', timerKey)");
            expect(ATOMIC_TIMER_STATUS_SCRIPT).toContain("return 'EXPIRED'");
        });

        it('ATOMIC_ADD_TIME_SCRIPT rejects paused timers', () => {
            expect(ATOMIC_ADD_TIME_SCRIPT).toContain('timer.paused');
            expect(ATOMIC_ADD_TIME_SCRIPT).toContain('return nil');
        });

        it('ATOMIC_ADD_TIME_SCRIPT rejects expired timers', () => {
            expect(ATOMIC_ADD_TIME_SCRIPT).toContain('remainingMs <= 0');
        });
    });

    describe('cjson usage', () => {
        const scriptsUsingJSON: Record<string, string> = {
            ATOMIC_SET_ROOM_STATUS_SCRIPT,
            ATOMIC_REMOVE_PLAYER_SCRIPT,
            ATOMIC_CLEANUP_DISCONNECTED_PLAYER_SCRIPT,
            ATOMIC_SET_SOCKET_MAPPING_SCRIPT,
            ATOMIC_UPDATE_SETTINGS_SCRIPT,
            ATOMIC_ADD_TIME_SCRIPT,
            ATOMIC_TIMER_STATUS_SCRIPT,
        };

        for (const [name, script] of Object.entries(scriptsUsingJSON)) {
            it(`${name} uses cjson.decode for parsing`, () => {
                expect(script).toContain('cjson.decode');
            });
        }
    });

    describe('settings update script', () => {
        it('validates host authorization', () => {
            expect(ATOMIC_UPDATE_SETTINGS_SCRIPT).toContain('hostSessionId');
            expect(ATOMIC_UPDATE_SETTINGS_SCRIPT).toContain('NOT_HOST');
        });

        it('only merges allowed setting keys', () => {
            expect(ATOMIC_UPDATE_SETTINGS_SCRIPT).toContain('teamNames');
            expect(ATOMIC_UPDATE_SETTINGS_SCRIPT).toContain('turnTimer');
            expect(ATOMIC_UPDATE_SETTINGS_SCRIPT).toContain('allowSpectators');
            expect(ATOMIC_UPDATE_SETTINGS_SCRIPT).toContain('gameMode');
        });
    });

    describe('reconnection token scripts', () => {
        it('INVALIDATE_TOKEN_SCRIPT deletes both token and session keys', () => {
            const delCount = (INVALIDATE_TOKEN_SCRIPT.match(/redis\.call\('DEL'/g) || []).length;
            expect(delCount).toBe(2);
        });

        it('CLEANUP_ORPHANED_TOKEN_SCRIPT checks player existence before cleanup', () => {
            expect(CLEANUP_ORPHANED_TOKEN_SCRIPT).toContain("redis.call('GET', playerKey)");
            // If player exists, return 0 (no cleanup)
            expect(CLEANUP_ORPHANED_TOKEN_SCRIPT).toContain('return 0');
        });
    });
});
