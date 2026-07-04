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

import { connectRedis, disconnectRedis } from '../../config/redis';
import * as roomService from '../../services/roomService';
import { joinRoom } from '../../services/room/membership';
import * as gameService from '../../services/gameService';
import * as playerService from '../../services/playerService';
import { setTeam, setRole } from '../../services/player/mutations';

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
    });
});
