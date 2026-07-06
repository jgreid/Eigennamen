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
import * as playerService from '../../services/playerService';
import { setTeam, setRole } from '../../services/player/mutations';
import { SUBMIT_CLUE_SCRIPT } from '../../scripts';
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
});
