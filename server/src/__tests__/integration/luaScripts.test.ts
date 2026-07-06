/**
 * Real-Redis Lua Script Integration Tests
 *
 * Every other backend test mocks `config/redis`, so the 29 Lua atomic scripts
 * are never actually executed — the dedicated Lua test files
 * (`__tests__/scripts/luaScriptLogic.test.ts`) only assert on the script's
 * *source text*. This suite boots a real embedded Redis (the same
 * `REDIS_URL=memory` path used for local dev) and drives the real service
 * functions end-to-end, so the highest-risk scripts — atomicJoin, setRole,
 * safeTeamSwitch, hostTransfer, submitClue, revealCard, endTurn — are
 * exercised against real Redis, not a hand-written JS stand-in.
 *
 * See docs/HARDENING_PLAN.md P1-9.
 */
process.env['REDIS_URL'] = 'memory';

import { connectRedis, disconnectRedis, getRedis } from '../../config/redis';
import * as roomService from '../../services/roomService';
import { joinRoom } from '../../services/room/membership';
import * as gameService from '../../services/gameService';
import { executeGameTransaction } from '../../services/game/luaGameOps';
import * as playerService from '../../services/playerService';
import { setTeam, setRole } from '../../services/player/mutations';
import * as timerService from '../../services/timerService';
import * as gameHistoryService from '../../services/gameHistoryService';
import { checkValidationRateLimit } from '../../middleware/auth/sessionValidator';
import { acquire } from '../../utils/distributedLock';
import { SUBMIT_CLUE_SCRIPT, ATOMIC_SET_ROOM_STATUS_SCRIPT } from '../../scripts';
import { DUET_BOARD_CONFIG } from '../../config/constants';

const CONNECT_TIMEOUT_MS = 20000;

let roomCounter = 0;
function freshRoomCode(): string {
    roomCounter += 1;
    return `luait${roomCounter}`;
}

describe('Real-Redis Lua script integration', () => {
    beforeAll(async () => {
        await connectRedis();
    }, CONNECT_TIMEOUT_MS);

    afterAll(async () => {
        await disconnectRedis();
    }, CONNECT_TIMEOUT_MS);

    describe('atomicJoin.lua', () => {
        it('creates a room with the host seated atomically', async () => {
            const code = freshRoomCode();
            const { room, player } = await roomService.createRoom(code, 'host-1', { nickname: 'Host' });

            expect(room.hostSessionId).toBe('host-1');
            expect(player.sessionId).toBe('host-1');
            expect(player.isHost).toBe(true);

            const players = await playerService.getPlayersInRoom(code);
            expect(players).toHaveLength(1);
        });

        it('adds a second player to the room set atomically', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });

            const { players } = await joinRoom(code, 'p2', 'Player2');

            expect(players.map((p) => p.sessionId).sort()).toEqual(['host-1', 'p2']);
            const persisted = await playerService.getPlayersInRoom(code);
            expect(persisted).toHaveLength(2);
        });

        it('rejects joining a room that does not exist', async () => {
            await expect(joinRoom('no-such-room', 'p1', 'Ghost')).rejects.toMatchObject({
                code: 'ROOM_NOT_FOUND',
            });
        });
    });

    describe('setRole.lua', () => {
        it('assigns a role and rejects a duplicate connected role on the same team', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });
            await joinRoom(code, 'p2', 'Player2');
            await setTeam('host-1', 'red');
            await setTeam('p2', 'red');

            const p1 = await setRole('host-1', 'clicker');
            expect(p1.role).toBe('clicker');

            await expect(setRole('p2', 'clicker')).rejects.toThrow();
        });

        it('allows a role held by a disconnected player to be reassigned', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });
            await joinRoom(code, 'p2', 'Player2');
            await setTeam('host-1', 'red');
            await setTeam('p2', 'red');
            await setRole('host-1', 'clicker');

            await playerService.updatePlayer('host-1', { connected: false });

            const p2 = await setRole('p2', 'clicker');
            expect(p2.role).toBe('clicker');
        });
    });

    describe('safeTeamSwitch.lua', () => {
        it('demotes a spymaster to spectator when switching teams', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });
            await setTeam('host-1', 'red');
            await setRole('host-1', 'spymaster');

            const switched = await setTeam('host-1', 'blue');

            expect(switched.team).toBe('blue');
            expect(switched.role).toBe('spectator');
        });
    });

    describe('hostTransfer (atomicHostTransfer)', () => {
        it('atomically moves host status from one player to another', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });
            await joinRoom(code, 'p2', 'Player2');

            const result = await playerService.atomicHostTransfer('host-1', 'p2', code);
            expect(result.success).toBe(true);

            const oldHost = await playerService.getPlayer('host-1');
            const newHost = await playerService.getPlayer('p2');
            expect(oldHost?.isHost).toBe(false);
            expect(newHost?.isHost).toBe(true);
        });
    });

    describe('submitClue.lua + revealCard.lua + endTurn.lua (full turn cycle)', () => {
        it('rejects a reveal before any clue has been given (P0-2 regression)', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });
            const game = await gameService.createGame(code, { gameMode: 'classic', seed: `${code}-seed` });

            await expect(gameService.revealCard(code, 0, 'Host', game.currentTurn)).rejects.toMatchObject({
                code: 'NO_CLUE_GIVEN',
            });
        });

        it('rejects a clue that matches a word on the board', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });
            const game = await gameService.createGame(code, { gameMode: 'classic', seed: `${code}-seed` });

            await expect(
                gameService.submitClue(code, game.currentTurn, game.words[0] as string, 1, 'Spymaster')
            ).rejects.toThrow();
        });

        it('submits a legal clue (number+1 guesses), reveals a card, and ends the turn on a wrong guess', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });
            const game = await gameService.createGame(code, { gameMode: 'classic', seed: `${code}-seed` });
            const team = game.currentTurn;

            const clueResult = await gameService.submitClue(code, team, 'ZZZLUAINTEGRATIONZZZ', 1, 'Spymaster');
            expect(clueResult.guessesAllowed).toBe(2);

            const midGame = await gameService.getGame(code);
            expect(midGame?.currentClue).toMatchObject({ word: 'ZZZLUAINTEGRATIONZZZ', number: 1 });

            // Reveal a card belonging to the OTHER team to force turnEnded=true
            const otherIndex = game.types.findIndex((t) => t !== team && t !== 'assassin');
            expect(otherIndex).toBeGreaterThanOrEqual(0);

            const revealResult = await gameService.revealCard(code, otherIndex, 'Clicker', team);
            expect(revealResult.turnEnded).toBe(true);

            const afterGame = await gameService.getGame(code);
            expect(afterGame?.currentTurn).not.toBe(team);
            expect(afterGame?.currentClue).toBeNull();
            expect(afterGame?.guessesAllowed).toBe(0);
        });

        it('ends the game with the correct winner when the assassin is revealed', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });
            const game = await gameService.createGame(code, { gameMode: 'classic', seed: `${code}-seed` });
            const team = game.currentTurn;

            await gameService.submitClue(code, team, 'ZZZASSASSINCLUEZZZ', 1, 'Spymaster');
            const assassinIndex = game.types.indexOf('assassin');

            const result = await gameService.revealCard(code, assassinIndex, 'Clicker', team);

            expect(result.gameOver).toBe(true);
            expect(result.winner).toBe(team === 'red' ? 'blue' : 'red');
        });

        it('endTurn.lua resets currentClue/guessesUsed/guessesAllowed and flips currentTurn', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });
            const game = await gameService.createGame(code, { gameMode: 'classic', seed: `${code}-seed` });
            const team = game.currentTurn;

            await gameService.submitClue(code, team, 'ZZZENDTURNCLUEZZZ', 2, 'Spymaster');
            const endResult = await gameService.endTurn(code, 'Player', team);

            expect(endResult.currentTurn).not.toBe(team);

            const afterGame = await gameService.getGame(code);
            expect(afterGame?.currentClue).toBeNull();
            expect(afterGame?.guessesUsed).toBe(0);
            expect(afterGame?.guessesAllowed).toBe(0);
        });

        it('rejects endTurn from the team that does not currently hold the turn', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });
            const game = await gameService.createGame(code, { gameMode: 'classic', seed: `${code}-seed` });
            const notTheTurn = game.currentTurn === 'red' ? 'blue' : 'red';

            await expect(gameService.endTurn(code, 'Player', notTheTurn)).rejects.toMatchObject({
                code: 'NOT_YOUR_TURN',
            });
        });

        it('submitClue.lua clamps an out-of-range clue number to CLUE_NUMBER_MAX (P1-8 defense-in-depth)', async () => {
            // gameService.submitClue's own shape check (P1-8) already rejects an
            // out-of-range number before Lua ever sees it — this exercises the
            // Lua script directly (as a future non-gameService caller would) to
            // prove its own clamp holds independently, matching the existing
            // nil-guard convention for the lower bound.
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });
            const game = await gameService.createGame(code, { gameMode: 'classic', seed: `${code}-seed` });
            const team = game.currentTurn;

            const redis = getRedis();
            const raw = await redis.eval(SUBMIT_CLUE_SCRIPT, {
                keys: [`room:${code}:game`],
                arguments: ['ZZZLUACLAMPCLUEZZZ', '999', 'Spymaster', team, Date.now().toString(), '100', '86400'],
            });
            const result = JSON.parse(raw as string);

            expect(result.number).toBe(9);
            expect(result.guessesAllowed).toBe(10);
        });
    });

    describe('revealCard.lua (duet mode)', () => {
        it('counts a green revealed from the acting team perspective toward greenFound', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });
            const game = await gameService.createGame(code, { gameMode: 'duet', seed: `${code}-duet` });
            const team = game.currentTurn;

            // A card that is an agent from the acting team's own perspective.
            const perspective = team === 'blue' ? (game.duetTypes ?? []) : game.types;
            const greenIndex = perspective.findIndex((t) => t === team);
            expect(greenIndex).toBeGreaterThanOrEqual(0);

            // Clue number 2 → 3 guesses, so a single correct green keeps the turn.
            await gameService.submitClue(code, team, 'ZZZDUETGREENZZZ', 2, 'Spymaster');
            const result = await gameService.revealCard(code, greenIndex, 'Clicker', team);

            expect(result.gameOver).toBe(false);
            expect(result.greenFound).toBe(1);
            expect(result.turnEnded).toBe(false);
        });

        it('spends a timer token and switches turn on a both-sides bystander without ending the game', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });
            const game = await gameService.createGame(code, { gameMode: 'duet', seed: `${code}-duet` });
            const team = game.currentTurn;

            // A card that is a bystander from BOTH perspectives: revealing it costs
            // a token and passes the turn, but strands no green.
            const bystanderIndex = game.types.findIndex((t, i) => t === 'neutral' && game.duetTypes?.[i] === 'neutral');
            expect(bystanderIndex).toBeGreaterThanOrEqual(0);

            await gameService.submitClue(code, team, 'ZZZDUETBYSTANDZZZ', 1, 'Spymaster');
            const result = await gameService.revealCard(code, bystanderIndex, 'Clicker', team);

            expect(result.gameOver).toBe(false);
            expect(result.turnEnded).toBe(true);
            expect(result.currentTurn).not.toBe(team);
            expect(result.timerTokens).toBe(DUET_BOARD_CONFIG.timerTokens - 1);
        });

        it('ends the game as an unreachable co-op loss when a cross-perspective green is spent as a bystander (A6)', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });
            const game = await gameService.createGame(code, { gameMode: 'duet', seed: `${code}-duet` });
            const team = game.currentTurn;

            // Find a card that is a bystander from the acting team's perspective but
            // a green from the OTHER team's — revealing it permanently consumes a
            // green nobody can score anymore, so the co-op win becomes impossible.
            let deadGreenIndex = -1;
            for (let i = 0; i < game.types.length; i++) {
                const mine = team === 'blue' ? game.duetTypes?.[i] : game.types[i];
                const theirs = team === 'blue' ? game.types[i] : game.duetTypes?.[i];
                const theirsIsGreen = theirs === 'red' || theirs === 'blue';
                if (mine === 'neutral' && theirsIsGreen) {
                    deadGreenIndex = i;
                    break;
                }
            }
            expect(deadGreenIndex).toBeGreaterThanOrEqual(0);

            await gameService.submitClue(code, team, 'ZZZDUETDEADZZZ', 1, 'Spymaster');
            const result = await gameService.revealCard(code, deadGreenIndex, 'Clicker', team);

            expect(result.gameOver).toBe(true);
            expect(result.winner).toBeNull();
            expect(result.endReason).toBe('unreachable');

            const afterGame = await gameService.getGame(code);
            expect(afterGame?.gameOver).toBe(true);
        });
    });

    describe('reconnection token scripts (generate / validate / invalidate / cleanupOrphaned)', () => {
        it('atomicGenerateReconnectToken issues a token and returns the same one on a repeat call', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });

            const token = await playerService.generateReconnectionToken('host-1');
            expect(token).toBeTruthy();
            expect(await playerService.getExistingReconnectionToken('host-1')).toBe(token);

            // The Lua script's NX branch must return the existing token, not mint a
            // second one (the TOCTOU fix this script exists for).
            const again = await playerService.generateReconnectionToken('host-1');
            expect(again).toBe(token);
        });

        it('returns null when generating a token for a non-existent player', async () => {
            expect(await playerService.generateReconnectionToken('ghost-session')).toBeNull();
        });

        it('atomicValidateReconnectToken consumes a valid token exactly once', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });
            const token = (await playerService.generateReconnectionToken('host-1')) as string;

            const first = await playerService.validateRoomReconnectToken(token, 'host-1');
            expect(first.valid).toBe(true);
            expect(first.tokenData?.sessionId).toBe('host-1');

            // Consumed — a second validation must fail (single-use guarantee).
            const second = await playerService.validateRoomReconnectToken(token, 'host-1');
            expect(second.valid).toBe(false);
            expect(second.reason).toBe('TOKEN_EXPIRED_OR_INVALID');
        });

        it('rejects a token presented with the wrong session id without consuming it', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });
            const token = (await playerService.generateReconnectionToken('host-1')) as string;

            const mismatch = await playerService.validateRoomReconnectToken(token, 'someone-else');
            expect(mismatch.valid).toBe(false);
            expect(mismatch.reason).toBe('SESSION_MISMATCH');

            // The rightful owner can still consume it (mismatch must not delete it).
            const owner = await playerService.validateRoomReconnectToken(token, 'host-1');
            expect(owner.valid).toBe(true);
        });

        it('invalidateToken removes a token so it can no longer be validated', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });
            const token = (await playerService.generateReconnectionToken('host-1')) as string;

            await playerService.invalidateRoomReconnectToken('host-1');
            expect(await playerService.getExistingReconnectionToken('host-1')).toBeNull();

            const result = await playerService.validateRoomReconnectToken(token, 'host-1');
            expect(result.valid).toBe(false);
        });

        it('cleanupOrphanedToken deletes tokens whose player is gone but keeps live ones', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });
            await joinRoom(code, 'p2', 'Player2');
            const liveToken = (await playerService.generateReconnectionToken('host-1')) as string;
            await playerService.generateReconnectionToken('p2');

            // Orphan p2's token by deleting the underlying player key.
            await getRedis().del('player:p2');

            const cleaned = await playerService.cleanupOrphanedReconnectionTokens();
            expect(cleaned).toBeGreaterThanOrEqual(1);

            // p2's orphaned session token is gone; host-1's (player still present) survives.
            expect(await playerService.getExistingReconnectionToken('p2')).toBeNull();
            expect(await playerService.getExistingReconnectionToken('host-1')).toBe(liveToken);
        });
    });

    describe('atomicSetSocketMapping.lua + atomicRemovePlayer.lua', () => {
        it('maps a socket to an existing player and reads it back', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });

            const ok = await playerService.setSocketMapping('host-1', 'socket-abc', '10.0.0.1');
            expect(ok).toBe(true);
            expect(await playerService.getSocketId('host-1')).toBe('socket-abc');
        });

        it('refuses to map a socket to a non-existent player', async () => {
            expect(await playerService.setSocketMapping('ghost-session', 'socket-xyz')).toBe(false);
        });

        it('removePlayer drops the player from the room and team sets', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });
            await joinRoom(code, 'p2', 'Player2');
            await setTeam('p2', 'red');

            await playerService.removePlayer('p2');

            expect(await playerService.getPlayer('p2')).toBeNull();
            const remaining = await playerService.getPlayersInRoom(code);
            expect(remaining.map((p) => p.sessionId)).toEqual(['host-1']);
        });
    });

    describe('safeCleanupOrphans.lua (via getPlayersInRoom)', () => {
        it('prunes a session id left in the room set with no backing player key', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });
            await joinRoom(code, 'p2', 'Player2');

            // Orphan p2: delete the player hash but leave it in the room's set.
            await getRedis().del('player:p2');

            const players = await playerService.getPlayersInRoom(code);
            expect(players.map((p) => p.sessionId)).toEqual(['host-1']);

            // The orphan must actually be removed from the set, not just filtered out.
            const setMembers = await getRedis().sMembers(`room:${code}:players`);
            expect(setMembers).not.toContain('p2');
        });
    });

    describe('atomicCleanupDisconnectedPlayer.lua (via processScheduledCleanups)', () => {
        it('removes a scheduled disconnected player but spares one who reconnected', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });
            await joinRoom(code, 'gone', 'Gone');
            await joinRoom(code, 'back', 'Back');

            // 'gone' is disconnected; 'back' reconnected (still connected).
            await playerService.updatePlayer('gone', { connected: false });

            // Schedule both as due-now (score 0) so processScheduledCleanups dequeues them.
            const redis = getRedis();
            await redis.zAdd('scheduled:player:cleanup', [
                { score: 0, value: JSON.stringify({ sessionId: 'gone', roomCode: code }) },
                { score: 0, value: JSON.stringify({ sessionId: 'back', roomCode: code }) },
            ]);

            const cleaned = await playerService.processScheduledCleanups();
            expect(cleaned).toBeGreaterThanOrEqual(1);

            // The disconnected player is gone; the reconnected one is kept (the
            // TOCTOU guard the script exists for).
            expect(await playerService.getPlayer('gone')).toBeNull();
            expect(await playerService.getPlayer('back')).not.toBeNull();
        });
    });

    describe('timer scripts (status / addTime / pause / resume)', () => {
        afterEach(() => {
            // startTimer/addTime/resume arm real setTimeout handles; clear them so
            // Jest doesn't hang on open handles between cases.
            timerService.cleanupAllTimers();
        });

        it('atomicTimerStatus reports remaining time for an active timer', async () => {
            const code = freshRoomCode();
            await timerService.startTimer(code, 100);

            const status = await timerService.getTimerStatus(code);
            expect(status).not.toBeNull();
            expect(status?.remainingSeconds).toBeGreaterThan(90);
            expect(status?.remainingSeconds).toBeLessThanOrEqual(100);
        });

        it('atomicTimerStatus returns null for a room with no timer', async () => {
            expect(await timerService.getTimerStatus(freshRoomCode())).toBeNull();
        });

        it('atomicAddTime extends the remaining time', async () => {
            const code = freshRoomCode();
            await timerService.startTimer(code, 60);

            const updated = await timerService.addTime(code, 30);
            expect(updated).not.toBeNull();
            expect(updated?.remainingSeconds).toBeGreaterThan(80);

            const status = await timerService.getTimerStatus(code);
            expect(status?.remainingSeconds).toBeGreaterThan(80);
        });

        it('atomicPauseTimer then atomicResumeTimer preserves remaining time', async () => {
            const code = freshRoomCode();
            await timerService.startTimer(code, 100);

            const paused = await timerService.pauseTimer(code);
            expect(paused).not.toBeNull();
            expect(paused?.remainingSeconds).toBeGreaterThan(90);

            const resumed = await timerService.resumeTimer(code);
            expect(resumed).not.toBeNull();
            expect(resumed?.remainingSeconds).toBeGreaterThan(90);
        });

        it('atomicPauseTimer returns null for a room with no timer', async () => {
            expect(await timerService.pauseTimer(freshRoomCode())).toBeNull();
        });
    });

    describe('atomicRateLimit.lua (via checkValidationRateLimit)', () => {
        it('increments the per-IP counter and blocks once the ceiling is exceeded', async () => {
            const ip = `198.51.100.${(roomCounter % 250) + 1}-${freshRoomCode()}`;

            const first = await checkValidationRateLimit(ip);
            expect(first.allowed).toBe(true);
            expect(first.attempts).toBe(1);

            const second = await checkValidationRateLimit(ip);
            expect(second.attempts).toBe(2);

            // MAX_VALIDATION_ATTEMPTS_PER_IP is 20 — drive past it and confirm the
            // script's increment (and the caller's ceiling) actually blocks.
            let last = second;
            for (let i = 0; i < 20; i++) {
                last = await checkValidationRateLimit(ip);
            }
            expect(last.attempts).toBeGreaterThan(20);
            expect(last.allowed).toBe(false);
        });
    });

    describe('extendLock.lua', () => {
        it('extends a held lock and refuses to extend one no longer owned', async () => {
            const lock = await acquire('d3-extend-lock', { lockTimeout: 2000 });
            expect(lock.acquired).toBe(true);

            // Owner can extend.
            expect(await lock.extend?.(5000)).toBe(true);

            // After release the key is gone, so the same owner can no longer extend it.
            expect(await lock.release?.()).toBe(true);
            expect(await lock.extend?.(5000)).toBe(false);
        });
    });

    describe('room scripts (atomicUpdateSettings / atomicRefreshTtl / atomicSetRoomStatus)', () => {
        it('atomicUpdateSettings persists whitelisted room settings', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });

            const updated = await roomService.updateSettings(code, 'host-1', { gameMode: 'duet' });
            expect(updated.gameMode).toBe('duet');

            const room = await roomService.getRoom(code);
            expect(room?.settings.gameMode).toBe('duet');
        });

        it('atomicRefreshTtl bumps the room key TTL back toward the full window', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });

            const redis = getRedis();
            // Knock the TTL down, then confirm the refresh script restores it.
            await redis.expire(`room:${code}`, 60);
            await roomService.refreshRoomTTL(code);

            const ttl = await redis.ttl(`room:${code}`);
            expect(ttl).toBeGreaterThan(60);
        });

        it('atomicSetRoomStatus updates status and returns OK (nil for a missing room)', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });
            const redis = getRedis();

            const ok = await redis.eval(ATOMIC_SET_ROOM_STATUS_SCRIPT, {
                keys: [`room:${code}`],
                arguments: ['playing', '86400'],
            });
            expect(ok).toBe('OK');
            const room = await roomService.getRoom(code);
            expect(room?.status).toBe('playing');

            const missing = await redis.eval(ATOMIC_SET_ROOM_STATUS_SCRIPT, {
                keys: ['room:does-not-exist'],
                arguments: ['playing', '86400'],
            });
            expect(missing).toBeNull();
        });
    });

    describe('atomicSaveGameHistory.lua', () => {
        it('persists a completed game and lists it back from the room index', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });
            const game = await gameService.createGame(code, { gameMode: 'classic', seed: `${code}-seed` });

            const entry = await gameHistoryService.saveGameResult(code, {
                ...game,
                gameOver: true,
                winner: 'red',
            });
            expect(entry).not.toBeNull();

            const history = await gameHistoryService.getGameHistory(code);
            expect(history.length).toBe(1);
            expect(history[0]?.id).toBe(entry?.id);
        });

        it('getHistoryStats reports real oldest/newest scores after two saves (D4)', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });
            const game = await gameService.createGame(code, { gameMode: 'classic', seed: `${code}-stats` });

            const older = await gameHistoryService.saveGameResult(code, {
                ...game,
                id: `${code}-older`,
                gameOver: true,
                winner: 'red',
            });
            const newer = await gameHistoryService.saveGameResult(code, {
                ...game,
                id: `${code}-newer`,
                gameOver: true,
                winner: 'blue',
            });
            expect(older).not.toBeNull();
            expect(newer).not.toBeNull();

            const stats = await gameHistoryService.getHistoryStats(code);
            expect(stats.count).toBe(2);
            // Pre-D4-fix these were always null: getHistoryStats passed WITHSCORES to
            // zRange, which node-redis v5 silently ignores, so no scores came back.
            expect(stats.oldest).not.toBeNull();
            expect(stats.newest).not.toBeNull();
            expect(Number.isFinite(stats.oldest?.timestamp)).toBe(true);
            expect(Number.isFinite(stats.newest?.timestamp)).toBe(true);
            expect(stats.newest?.timestamp).toBeGreaterThanOrEqual(stats.oldest?.timestamp as number);
        });
    });

    describe('WATCH/MULTI optimistic-lock retry (B3)', () => {
        it('retries a dirty WATCH conflict and still commits the mutation', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });
            await gameService.createGame(code, { gameMode: 'classic', seed: `${code}-b3` });
            const gameKey = `room:${code}:game`;
            const redis = getRedis();

            let calls = 0;
            const result = await executeGameTransaction(
                gameKey,
                async (g) => {
                    calls++;
                    if (calls === 1) {
                        // Dirty the WATCHed key AFTER watch()+get() but before exec().
                        // node-redis v5 makes exec() throw WatchError; the fix must
                        // treat that as the retry signal (pre-fix it propagated and
                        // the write was lost).
                        const raw = (await redis.get(gameKey)) as string;
                        await redis.set(gameKey, raw);
                    }
                    g.redScore = (g.redScore ?? 0) + 1;
                    return g.redScore;
                },
                'b3-retry'
            );

            expect(calls).toBeGreaterThanOrEqual(2); // proves it retried
            expect(result).toBe(1);
            const after = await gameService.getGame(code);
            expect(after?.redScore).toBe(1); // committed exactly once, not lost
        });

        it('throws concurrent-modification when every attempt hits a dirty WATCH', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });
            await gameService.createGame(code, { gameMode: 'classic', seed: `${code}-b3x` });
            const gameKey = `room:${code}:game`;
            const redis = getRedis();

            await expect(
                executeGameTransaction(
                    gameKey,
                    async (g) => {
                        const raw = (await redis.get(gameKey)) as string;
                        await redis.set(gameKey, raw); // dirty on every attempt
                        g.redScore = (g.redScore ?? 0) + 1;
                        return g.redScore;
                    },
                    'b3-exhaust'
                )
            ).rejects.toThrow(/concurrent/i);
        });
    });

    describe('ensureRoomHasHost (A10 lazy host repair)', () => {
        it('promotes a connected human when the recorded host record is gone', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });
            await joinRoom(code, 'p2', 'Player2');

            // Simulate the host being reaped by grace-period cleanup / key-TTL
            // expiry: the room still records host-1, but the player record is gone.
            await getRedis().del('player:host-1');

            const newHost = await roomService.ensureRoomHasHost(code);
            expect(newHost).toBe('p2');

            const room = await roomService.getRoom(code);
            expect(room?.hostSessionId).toBe('p2');
            const p2 = await playerService.getPlayer('p2');
            expect(p2?.isHost).toBe(true);
        });

        it('is a no-op when the host record still exists', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });
            await joinRoom(code, 'p2', 'Player2');

            const result = await roomService.ensureRoomHasHost(code);
            expect(result).toBe('host-1');
            const room = await roomService.getRoom(code);
            expect(room?.hostSessionId).toBe('host-1');
        });

        it('returns null when no connected human remains to promote', async () => {
            const code = freshRoomCode();
            await roomService.createRoom(code, 'host-1', { nickname: 'Host' });
            await joinRoom(code, 'p2', 'Player2');
            await playerService.updatePlayer('p2', { connected: false });
            await getRedis().del('player:host-1');

            expect(await roomService.ensureRoomHasHost(code)).toBeNull();
        });
    });

    describe('processScheduledCleanups tears down bot-only rooms (B9)', () => {
        it('removes a room once its last human is cleaned up, even if a bot remains', async () => {
            // Wire the real room-cleanup fn so the sweep can tear down.
            playerService.registerRoomCleanup(roomService.cleanupRoom);

            const code = freshRoomCode();
            await roomService.createRoom(code, 'human-1', { nickname: 'Human' });

            // Seat a bot as a first-class player in the room.
            const redis = getRedis();
            const botId = `bot-${code}`;
            await redis.set(
                `player:${botId}`,
                JSON.stringify({
                    sessionId: botId,
                    roomCode: code,
                    nickname: 'Bot',
                    team: 'red',
                    role: 'clicker',
                    isHost: false,
                    connected: true,
                    isBot: true,
                    lastSeen: Date.now(),
                    createdAt: Date.now(),
                })
            );
            await redis.sAdd(`room:${code}:players`, botId);

            // The last human disconnects and its cleanup is due.
            await playerService.updatePlayer('human-1', { connected: false });
            await redis.zAdd('scheduled:player:cleanup', [
                { score: 0, value: JSON.stringify({ sessionId: 'human-1', roomCode: code }) },
            ]);

            await playerService.processScheduledCleanups();

            // Human gone, and with only a bot left the room was torn down (pre-B9 it
            // lingered because the bot counted as an occupant).
            expect(await playerService.getPlayer('human-1')).toBeNull();
            expect(await roomService.getRoom(code)).toBeNull();
        });
    });
});
