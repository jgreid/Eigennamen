/**
 * Redis Keys - Branch Coverage Tests
 *
 * Targets uncovered branches in lines 65-105 of redisKeys.ts.
 * The main uncovered branches are the null coalescing (??) fallback
 * in parseCode (line 65) and parseSessionId (line 105), plus ensuring
 * all key builder functions in the game and player sections are exercised.
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

describe('redisKeys - branch coverage', () => {
    describe('room.parseCode edge cases', () => {
        it('returns the room code when key matches room:{code}', () => {
            expect(room.parseCode('room:ABC')).toBe('ABC');
        });

        it('returns the room code from composite keys', () => {
            expect(room.parseCode('room:XYZ:settings')).toBe('XYZ');
            expect(room.parseCode('room:ROOM01:players')).toBe('ROOM01');
            expect(room.parseCode('room:A:team:red')).toBe('A');
        });

        it('returns null for non-room keys', () => {
            expect(room.parseCode('game:ABC')).toBeNull();
            expect(room.parseCode('player:abc')).toBeNull();
            expect(room.parseCode('')).toBeNull();
            expect(room.parseCode('room')).toBeNull();
            expect(room.parseCode('room:')).toBeNull();
        });

        it('returns null for keys that start with room but no colon', () => {
            expect(room.parseCode('roomABC')).toBeNull();
        });

        it('handles room key with special characters in code', () => {
            expect(room.parseCode('room:A1B2C3')).toBe('A1B2C3');
        });

        it('handles room key where code is a single character', () => {
            expect(room.parseCode('room:X')).toBe('X');
        });

        it('returns null when input is just "room:"', () => {
            // The regex [^:]+ requires at least one char after room:
            expect(room.parseCode('room:')).toBeNull();
        });
    });

    describe('player.parseSessionId edge cases', () => {
        it('returns the sessionId when key matches player:{sessionId}', () => {
            expect(player.parseSessionId('player:sess-123')).toBe('sess-123');
        });

        it('returns the sessionId from composite keys', () => {
            expect(player.parseSessionId('player:sess-123:room')).toBe('sess-123');
            expect(player.parseSessionId('player:abc:reconnect')).toBe('abc');
        });

        it('returns null for non-player keys', () => {
            expect(player.parseSessionId('room:ABCDEF')).toBeNull();
            expect(player.parseSessionId('game:ABCDEF')).toBeNull();
            expect(player.parseSessionId('timer:ABCDEF')).toBeNull();
            expect(player.parseSessionId('')).toBeNull();
            expect(player.parseSessionId('player')).toBeNull();
            expect(player.parseSessionId('player:')).toBeNull();
        });

        it('returns null for keys that start with player but no colon', () => {
            expect(player.parseSessionId('playerABC')).toBeNull();
        });

        it('handles UUID session IDs', () => {
            expect(player.parseSessionId('player:a1b2c3d4-e5f6-7890')).toBe('a1b2c3d4-e5f6-7890');
        });

        it('handles single character session IDs', () => {
            expect(player.parseSessionId('player:X')).toBe('X');
        });

        it('returns null when input is just "player:"', () => {
            expect(player.parseSessionId('player:')).toBeNull();
        });
    });

    describe('game key builders (lines 72-87)', () => {
        it('game.state returns correct format', () => {
            expect(game.state('CODE')).toBe('game:CODE');
            expect(game.state('')).toBe('game:');
        });

        it('game.history returns correct format', () => {
            expect(game.history('CODE')).toBe('game:CODE:history');
        });

        it('game.clue returns correct format', () => {
            expect(game.clue('CODE')).toBe('game:CODE:clue');
        });

        it('game.cards returns correct format', () => {
            expect(game.cards('CODE')).toBe('game:CODE:cards');
        });

        it('game.types returns correct format', () => {
            expect(game.types('CODE')).toBe('game:CODE:types');
        });

        it('all game key builders use GAME prefix', () => {
            const code = 'TEST';
            expect(game.state(code).startsWith(PREFIXES.GAME + ':')).toBe(true);
            expect(game.history(code).startsWith(PREFIXES.GAME + ':')).toBe(true);
            expect(game.clue(code).startsWith(PREFIXES.GAME + ':')).toBe(true);
            expect(game.cards(code).startsWith(PREFIXES.GAME + ':')).toBe(true);
            expect(game.types(code).startsWith(PREFIXES.GAME + ':')).toBe(true);
        });
    });

    describe('player key builders (lines 92-106)', () => {
        it('player.data returns correct format', () => {
            expect(player.data('sess')).toBe('player:sess');
            expect(player.data('')).toBe('player:');
        });

        it('player.room returns correct format', () => {
            expect(player.room('sess')).toBe('player:sess:room');
        });

        it('player.reconnectToken returns correct format', () => {
            expect(player.reconnectToken('sess')).toBe('player:sess:reconnect');
        });

        it('all player key builders use PLAYER prefix', () => {
            const sid = 'TEST-SESSION';
            expect(player.data(sid).startsWith(PREFIXES.PLAYER + ':')).toBe(true);
            expect(player.room(sid).startsWith(PREFIXES.PLAYER + ':')).toBe(true);
            expect(player.reconnectToken(sid).startsWith(PREFIXES.PLAYER + ':')).toBe(true);
        });
    });

    describe('room key builders (completeness)', () => {
        it('room.info returns correct format', () => {
            expect(room.info('R1')).toBe('room:R1');
        });

        it('room.settings returns correct format', () => {
            expect(room.settings('R1')).toBe('room:R1:settings');
        });

        it('room.players returns correct format', () => {
            expect(room.players('R1')).toBe('room:R1:players');
        });

        it('room.team returns correct format with color', () => {
            expect(room.team('R1', 'red')).toBe('room:R1:team:red');
            expect(room.team('R1', 'blue')).toBe('room:R1:team:blue');
        });

        it('room.host returns correct format', () => {
            expect(room.host('R1')).toBe('room:R1:host');
        });

        it('room.spectators returns correct format', () => {
            expect(room.spectators('R1')).toBe('room:R1:spectators');
        });

        it('room.activeRooms returns correct format', () => {
            expect(room.activeRooms()).toBe('room:active');
        });

        it('room.chat returns correct format', () => {
            expect(room.chat('R1')).toBe('room:R1:chat');
        });
    });

    describe('other key builders (completeness)', () => {
        it('timer keys', () => {
            expect(timer.state('C')).toBe('timer:C');
            expect(timer.paused('C')).toBe('timer:C:paused');
        });

        it('lock keys', () => {
            expect(lock.hostTransfer('C')).toBe('lock:host-transfer:C');
            expect(lock.timerRestart('C')).toBe('lock:timer-restart:C');
            expect(lock.roomCreate('C')).toBe('lock:room-create:C');
            expect(lock.gameState('C')).toBe('lock:game:C');
            expect(lock.custom('x')).toBe('lock:x');
        });

        it('session keys', () => {
            expect(session.attempts('1.2.3.4')).toBe('session:1.2.3.4:attempts');
            expect(session.validated('s1')).toBe('session:s1:validated');
        });

        it('scheduled keys', () => {
            expect(scheduled.playerCleanup()).toBe('scheduled:player:cleanup');
            expect(scheduled.roomCleanup()).toBe('scheduled:room:cleanup');
        });

        it('wordlist keys', () => {
            expect(wordlist.data('wl1')).toBe('wordlist:wl1');
            expect(wordlist.index()).toBe('wordlist:index');
        });

        it('history keys', () => {
            expect(history.roomGames('C')).toBe('history:C:games');
            expect(history.gameReplay('g1')).toBe('history:game:g1');
        });

        it('rateLimit keys', () => {
            expect(rateLimit.counter('evt', 'id')).toBe('ratelimit:evt:id');
            expect(rateLimit.ip('1.2.3.4', 'evt')).toBe('ratelimit:ip:1.2.3.4:evt');
            expect(rateLimit.session('s1', 'evt')).toBe('ratelimit:session:s1:evt');
        });

        it('pattern keys', () => {
            expect(patterns.allRooms()).toBe('room:*');
            expect(patterns.roomPlayers('C')).toBe('room:C:*');
            expect(patterns.allPlayers()).toBe('player:*');
            expect(patterns.allGames()).toBe('game:*');
            expect(patterns.allTimers()).toBe('timer:*');
            expect(patterns.allLocks()).toBe('lock:*');
        });
    });

    describe('parseCode and parseSessionId with regex match[1] ?? null branch', () => {
        // The ?? null branch in parseCode/parseSessionId is a safety fallback
        // for when regex match[1] might be undefined. With the current regex
        // patterns [^:]+, match[1] is always defined if the regex matches.
        // We test the boundary cases to ensure both branches of the ternary.

        it('parseCode: match is null when key does not start with room:', () => {
            // This exercises the : null branch (match is falsy)
            expect(room.parseCode('notroom:ABC')).toBeNull();
        });

        it('parseCode: match is truthy when key starts with room:', () => {
            // This exercises the match[1] ?? null branch (match is truthy)
            expect(room.parseCode('room:VALID')).toBe('VALID');
        });

        it('parseSessionId: match is null when key does not start with player:', () => {
            expect(player.parseSessionId('notplayer:abc')).toBeNull();
        });

        it('parseSessionId: match is truthy when key starts with player:', () => {
            expect(player.parseSessionId('player:VALID')).toBe('VALID');
        });
    });
});
