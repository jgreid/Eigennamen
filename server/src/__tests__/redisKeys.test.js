/**
 * Redis Keys Utility Tests
 *
 * Tests for utils/redisKeys.js - Redis key construction utilities.
 */

const {
    PREFIXES,
    room,
    game,
    player,
    timer,
    lock,
    session,
    scheduled,
    wordlist,
    history,
    rateLimit,
    patterns
} = require('../utils/redisKeys');

describe('Redis Keys Utility', () => {
    describe('PREFIXES', () => {
        it('should define all required prefixes', () => {
            expect(PREFIXES.ROOM).toBe('room');
            expect(PREFIXES.GAME).toBe('game');
            expect(PREFIXES.PLAYER).toBe('player');
            expect(PREFIXES.TIMER).toBe('timer');
            expect(PREFIXES.LOCK).toBe('lock');
            expect(PREFIXES.SESSION).toBe('session');
            expect(PREFIXES.SCHEDULED).toBe('scheduled');
            expect(PREFIXES.WORDLIST).toBe('wordlist');
            expect(PREFIXES.HISTORY).toBe('history');
            expect(PREFIXES.RATE_LIMIT).toBe('ratelimit');
        });
    });

    describe('room keys', () => {
        describe('room.info()', () => {
            it('should return correct key for room info', () => {
                expect(room.info('ABCDEF')).toBe('room:ABCDEF');
            });

            it('should handle different room codes', () => {
                expect(room.info('ROOM01')).toBe('room:ROOM01');
                expect(room.info('XYZ123')).toBe('room:XYZ123');
            });
        });

        describe('room.settings()', () => {
            it('should return correct key for room settings', () => {
                expect(room.settings('ABCDEF')).toBe('room:ABCDEF:settings');
            });
        });

        describe('room.players()', () => {
            it('should return correct key for room players', () => {
                expect(room.players('ABCDEF')).toBe('room:ABCDEF:players');
            });
        });

        describe('room.team()', () => {
            it('should return correct key for team members', () => {
                expect(room.team('ABCDEF', 'red')).toBe('room:ABCDEF:team:red');
                expect(room.team('ABCDEF', 'blue')).toBe('room:ABCDEF:team:blue');
            });
        });

        describe('room.host()', () => {
            it('should return correct key for room host', () => {
                expect(room.host('ABCDEF')).toBe('room:ABCDEF:host');
            });
        });

        describe('room.spectators()', () => {
            it('should return correct key for spectators', () => {
                expect(room.spectators('ABCDEF')).toBe('room:ABCDEF:spectators');
            });
        });

        describe('room.activeRooms()', () => {
            it('should return correct key for active rooms set', () => {
                expect(room.activeRooms()).toBe('room:active');
            });
        });

        describe('room.chat()', () => {
            it('should return correct key for chat history', () => {
                expect(room.chat('ABCDEF')).toBe('room:ABCDEF:chat');
            });
        });

        describe('room.parseCode()', () => {
            it('should extract room code from key', () => {
                expect(room.parseCode('room:ABCDEF')).toBe('ABCDEF');
                expect(room.parseCode('room:ABCDEF:settings')).toBe('ABCDEF');
                expect(room.parseCode('room:ABCDEF:players')).toBe('ABCDEF');
            });

            it('should return null for non-room keys', () => {
                expect(room.parseCode('game:ABCDEF')).toBeNull();
                expect(room.parseCode('player:session-123')).toBeNull();
                expect(room.parseCode('invalid-key')).toBeNull();
            });
        });
    });

    describe('game keys', () => {
        describe('game.state()', () => {
            it('should return correct key for game state', () => {
                expect(game.state('ABCDEF')).toBe('game:ABCDEF');
            });
        });

        describe('game.history()', () => {
            it('should return correct key for game history', () => {
                expect(game.history('ABCDEF')).toBe('game:ABCDEF:history');
            });
        });

        describe('game.clue()', () => {
            it('should return correct key for current clue', () => {
                expect(game.clue('ABCDEF')).toBe('game:ABCDEF:clue');
            });
        });

        describe('game.cards()', () => {
            it('should return correct key for game cards', () => {
                expect(game.cards('ABCDEF')).toBe('game:ABCDEF:cards');
            });
        });

        describe('game.types()', () => {
            it('should return correct key for card types (spymaster view)', () => {
                expect(game.types('ABCDEF')).toBe('game:ABCDEF:types');
            });
        });
    });

    describe('player keys', () => {
        describe('player.data()', () => {
            it('should return correct key for player data', () => {
                expect(player.data('session-123')).toBe('player:session-123');
            });

            it('should handle UUID session IDs', () => {
                expect(player.data('a1b2c3d4-e5f6-7890-abcd-ef1234567890'))
                    .toBe('player:a1b2c3d4-e5f6-7890-abcd-ef1234567890');
            });
        });

        describe('player.room()', () => {
            it('should return correct key for player room mapping', () => {
                expect(player.room('session-123')).toBe('player:session-123:room');
            });
        });

        describe('player.reconnectToken()', () => {
            it('should return correct key for reconnection token', () => {
                expect(player.reconnectToken('session-123')).toBe('player:session-123:reconnect');
            });
        });

        describe('player.parseSessionId()', () => {
            it('should extract sessionId from key', () => {
                expect(player.parseSessionId('player:session-123')).toBe('session-123');
                expect(player.parseSessionId('player:session-123:room')).toBe('session-123');
            });

            it('should return null for non-player keys', () => {
                expect(player.parseSessionId('room:ABCDEF')).toBeNull();
                expect(player.parseSessionId('game:ABCDEF')).toBeNull();
            });
        });
    });

    describe('timer keys', () => {
        describe('timer.state()', () => {
            it('should return correct key for timer state', () => {
                expect(timer.state('ABCDEF')).toBe('timer:ABCDEF');
            });
        });

        describe('timer.paused()', () => {
            it('should return correct key for paused timer', () => {
                expect(timer.paused('ABCDEF')).toBe('timer:ABCDEF:paused');
            });
        });
    });

    describe('lock keys', () => {
        describe('lock.hostTransfer()', () => {
            it('should return correct key for host transfer lock', () => {
                expect(lock.hostTransfer('ABCDEF')).toBe('lock:host-transfer:ABCDEF');
            });
        });

        describe('lock.timerRestart()', () => {
            it('should return correct key for timer restart lock', () => {
                expect(lock.timerRestart('ABCDEF')).toBe('lock:timer-restart:ABCDEF');
            });
        });

        describe('lock.roomCreate()', () => {
            it('should return correct key for room creation lock', () => {
                expect(lock.roomCreate('ABCDEF')).toBe('lock:room-create:ABCDEF');
            });
        });

        describe('lock.gameState()', () => {
            it('should return correct key for game state lock', () => {
                expect(lock.gameState('ABCDEF')).toBe('lock:game:ABCDEF');
            });
        });

        describe('lock.custom()', () => {
            it('should return correct key for custom lock', () => {
                expect(lock.custom('my-operation')).toBe('lock:my-operation');
                expect(lock.custom('player:update:123')).toBe('lock:player:update:123');
            });
        });
    });

    describe('session keys', () => {
        describe('session.attempts()', () => {
            it('should return correct key for validation attempts', () => {
                expect(session.attempts('192.168.1.1')).toBe('session:192.168.1.1:attempts');
            });

            it('should handle IPv6 addresses', () => {
                expect(session.attempts('::1')).toBe('session:::1:attempts');
            });
        });

        describe('session.validated()', () => {
            it('should return correct key for validated session', () => {
                expect(session.validated('session-123')).toBe('session:session-123:validated');
            });
        });
    });

    describe('scheduled keys', () => {
        describe('scheduled.playerCleanup()', () => {
            it('should return correct key for player cleanup set', () => {
                expect(scheduled.playerCleanup()).toBe('scheduled:player:cleanup');
            });
        });

        describe('scheduled.roomCleanup()', () => {
            it('should return correct key for room cleanup set', () => {
                expect(scheduled.roomCleanup()).toBe('scheduled:room:cleanup');
            });
        });
    });

    describe('wordlist keys', () => {
        describe('wordlist.data()', () => {
            it('should return correct key for word list data', () => {
                expect(wordlist.data('list-123')).toBe('wordlist:list-123');
            });
        });

        describe('wordlist.index()', () => {
            it('should return correct key for word list index', () => {
                expect(wordlist.index()).toBe('wordlist:index');
            });
        });
    });

    describe('history keys', () => {
        describe('history.roomGames()', () => {
            it('should return correct key for room game history', () => {
                expect(history.roomGames('ABCDEF')).toBe('history:ABCDEF:games');
            });
        });

        describe('history.gameReplay()', () => {
            it('should return correct key for game replay data', () => {
                expect(history.gameReplay('game-id-123')).toBe('history:game:game-id-123');
            });
        });
    });

    describe('rateLimit keys', () => {
        describe('rateLimit.counter()', () => {
            it('should return correct key for rate limit counter', () => {
                expect(rateLimit.counter('room:create', 'session-123'))
                    .toBe('ratelimit:room:create:session-123');
            });
        });

        describe('rateLimit.ip()', () => {
            it('should return correct key for IP-based rate limit', () => {
                expect(rateLimit.ip('192.168.1.1', 'game:start'))
                    .toBe('ratelimit:ip:192.168.1.1:game:start');
            });
        });

        describe('rateLimit.session()', () => {
            it('should return correct key for session-based rate limit', () => {
                expect(rateLimit.session('session-123', 'chat:message'))
                    .toBe('ratelimit:session:session-123:chat:message');
            });
        });
    });

    describe('patterns', () => {
        describe('patterns.allRooms()', () => {
            it('should return correct pattern for all rooms', () => {
                expect(patterns.allRooms()).toBe('room:*');
            });
        });

        describe('patterns.roomPlayers()', () => {
            it('should return correct pattern for room players', () => {
                expect(patterns.roomPlayers('ABCDEF')).toBe('room:ABCDEF:*');
            });
        });

        describe('patterns.allPlayers()', () => {
            it('should return correct pattern for all players', () => {
                expect(patterns.allPlayers()).toBe('player:*');
            });
        });

        describe('patterns.allGames()', () => {
            it('should return correct pattern for all games', () => {
                expect(patterns.allGames()).toBe('game:*');
            });
        });

        describe('patterns.allTimers()', () => {
            it('should return correct pattern for all timers', () => {
                expect(patterns.allTimers()).toBe('timer:*');
            });
        });

        describe('patterns.allLocks()', () => {
            it('should return correct pattern for all locks', () => {
                expect(patterns.allLocks()).toBe('lock:*');
            });
        });
    });

    describe('Key consistency', () => {
        it('should generate unique keys for different resources', () => {
            const roomKey = room.info('CODE01');
            const gameKey = game.state('CODE01');
            const timerKey = timer.state('CODE01');

            expect(roomKey).not.toBe(gameKey);
            expect(gameKey).not.toBe(timerKey);
            expect(roomKey).not.toBe(timerKey);
        });

        it('should generate unique keys for different codes', () => {
            expect(room.info('ROOM01')).not.toBe(room.info('ROOM02'));
            expect(game.state('GAME01')).not.toBe(game.state('GAME02'));
        });

        it('should generate parseable keys', () => {
            const code = 'TESTROOM';
            const key = room.info(code);
            expect(room.parseCode(key)).toBe(code);

            const sessionId = 'session-abc-123';
            const playerKey = player.data(sessionId);
            expect(player.parseSessionId(playerKey)).toBe(sessionId);
        });
    });
});
