/**
 * Tests for player/stats.ts — Room statistics and spectator queries
 */

import { getSpectators, getSpectatorCount, getRoomStats } from '../../services/player/stats';
import * as playerService from '../../services/playerService';
import type { Player } from '../../types';

jest.mock('../../services/playerService');
const mockedGetPlayersInRoom = playerService.getPlayersInRoom as jest.MockedFunction<
    typeof playerService.getPlayersInRoom
>;

function makePlayer(overrides: Partial<Player> = {}): Player {
    return {
        sessionId: 'sess-' + Math.random().toString(36).slice(2, 8),
        roomCode: 'ROOM01',
        nickname: 'Player',
        team: null,
        role: 'spectator',
        isHost: false,
        connected: true,
        lastSeen: Date.now(),
        ...overrides,
    };
}

describe('player/stats', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ─── getSpectators ─────────────────────────────────────────

    describe('getSpectators', () => {
        it('returns connected spectators only', async () => {
            const spectator1 = makePlayer({
                sessionId: 's1',
                nickname: 'Alice',
                role: 'spectator',
                connected: true,
                team: null,
            });
            const spectator2 = makePlayer({
                sessionId: 's2',
                nickname: 'Bob',
                role: 'spectator',
                connected: true,
                team: 'red',
            });
            const disconnected = makePlayer({
                sessionId: 's3',
                nickname: 'Charlie',
                role: 'spectator',
                connected: false,
            });
            const nonSpectator = makePlayer({
                sessionId: 's4',
                nickname: 'Dave',
                role: 'clicker',
                team: 'blue',
                connected: true,
            });

            mockedGetPlayersInRoom.mockResolvedValue([spectator1, spectator2, disconnected, nonSpectator]);

            const result = await getSpectators('ROOM01');

            expect(result.count).toBe(2);
            expect(result.spectators).toHaveLength(2);
            expect(result.spectators[0]).toEqual({ sessionId: 's1', nickname: 'Alice', team: null });
            expect(result.spectators[1]).toEqual({ sessionId: 's2', nickname: 'Bob', team: 'red' });
        });

        it('returns empty list when no spectators exist', async () => {
            mockedGetPlayersInRoom.mockResolvedValue([
                makePlayer({ role: 'clicker', team: 'red', connected: true }),
                makePlayer({ role: 'spymaster', team: 'blue', connected: true }),
            ]);

            const result = await getSpectators('ROOM01');

            expect(result.count).toBe(0);
            expect(result.spectators).toEqual([]);
        });

        it('returns empty list when room is empty', async () => {
            mockedGetPlayersInRoom.mockResolvedValue([]);

            const result = await getSpectators('EMPTY');

            expect(result.count).toBe(0);
            expect(result.spectators).toEqual([]);
        });

        it('preserves team affiliation in spectator info', async () => {
            const redSpectator = makePlayer({
                sessionId: 's1',
                nickname: 'Alice',
                role: 'spectator',
                team: 'red',
                connected: true,
            });
            const blueSpectator = makePlayer({
                sessionId: 's2',
                nickname: 'Bob',
                role: 'spectator',
                team: 'blue',
                connected: true,
            });
            const nullTeamSpectator = makePlayer({
                sessionId: 's3',
                nickname: 'Charlie',
                role: 'spectator',
                team: null,
                connected: true,
            });

            mockedGetPlayersInRoom.mockResolvedValue([redSpectator, blueSpectator, nullTeamSpectator]);

            const result = await getSpectators('ROOM01');

            expect(result.spectators[0].team).toBe('red');
            expect(result.spectators[1].team).toBe('blue');
            expect(result.spectators[2].team).toBeNull();
        });
    });

    // ─── getSpectatorCount ─────────────────────────────────────

    describe('getSpectatorCount', () => {
        it('counts connected spectators from Redis when no players provided', async () => {
            mockedGetPlayersInRoom.mockResolvedValue([
                makePlayer({ role: 'spectator', connected: true }),
                makePlayer({ role: 'spectator', connected: true }),
                makePlayer({ role: 'spectator', connected: false }),
                makePlayer({ role: 'clicker', team: 'red', connected: true }),
            ]);

            const count = await getSpectatorCount('ROOM01');

            expect(count).toBe(2);
            expect(mockedGetPlayersInRoom).toHaveBeenCalledWith('ROOM01');
        });

        it('uses existingPlayers when provided (skips Redis)', async () => {
            const players = [
                makePlayer({ role: 'spectator', connected: true }),
                makePlayer({ role: 'clicker', team: 'blue', connected: true }),
            ];

            const count = await getSpectatorCount('ROOM01', players);

            expect(count).toBe(1);
            expect(mockedGetPlayersInRoom).not.toHaveBeenCalled();
        });

        it('returns 0 when no spectators', async () => {
            mockedGetPlayersInRoom.mockResolvedValue([makePlayer({ role: 'spymaster', team: 'red', connected: true })]);

            const count = await getSpectatorCount('ROOM01');

            expect(count).toBe(0);
        });

        it('does not count disconnected spectators', async () => {
            const players = [
                makePlayer({ role: 'spectator', connected: false }),
                makePlayer({ role: 'spectator', connected: false }),
            ];

            const count = await getSpectatorCount('ROOM01', players);

            expect(count).toBe(0);
        });
    });

    // ─── getRoomStats ──────────────────────────────────────────

    describe('getRoomStats', () => {
        it('counts all connected players and categorizes by team/role', async () => {
            mockedGetPlayersInRoom.mockResolvedValue([
                makePlayer({ team: 'red', role: 'spymaster', nickname: 'RedSpy', connected: true }),
                makePlayer({ team: 'red', role: 'clicker', nickname: 'RedClick', connected: true }),
                makePlayer({ team: 'red', role: 'guesser', nickname: 'RedGuess', connected: true }),
                makePlayer({ team: 'blue', role: 'spymaster', nickname: 'BlueSpy', connected: true }),
                makePlayer({ team: 'blue', role: 'clicker', nickname: 'BlueClick', connected: true }),
                makePlayer({ role: 'spectator', connected: true }),
                makePlayer({ role: 'spectator', connected: true }),
                makePlayer({ role: 'clicker', team: 'red', connected: false }), // disconnected
            ]);

            const stats = await getRoomStats('ROOM01');

            expect(stats.totalPlayers).toBe(7); // 8 total, 1 disconnected
            expect(stats.spectatorCount).toBe(2);
            expect(stats.teams.red.total).toBe(3);
            expect(stats.teams.red.spymaster).toBe('RedSpy');
            expect(stats.teams.red.clicker).toBe('RedClick');
            expect(stats.teams.blue.total).toBe(2);
            expect(stats.teams.blue.spymaster).toBe('BlueSpy');
            expect(stats.teams.blue.clicker).toBe('BlueClick');
        });

        it('uses existingPlayers when provided (skips Redis)', async () => {
            const players = [makePlayer({ team: 'red', role: 'spymaster', nickname: 'Alice', connected: true })];

            const stats = await getRoomStats('ROOM01', players);

            expect(stats.totalPlayers).toBe(1);
            expect(stats.teams.red.spymaster).toBe('Alice');
            expect(mockedGetPlayersInRoom).not.toHaveBeenCalled();
        });

        it('returns zeroed stats for empty room', async () => {
            mockedGetPlayersInRoom.mockResolvedValue([]);

            const stats = await getRoomStats('EMPTY');

            expect(stats.totalPlayers).toBe(0);
            expect(stats.spectatorCount).toBe(0);
            expect(stats.teams.red.total).toBe(0);
            expect(stats.teams.red.spymaster).toBeNull();
            expect(stats.teams.red.clicker).toBeNull();
            expect(stats.teams.blue.total).toBe(0);
            expect(stats.teams.blue.spymaster).toBeNull();
            expect(stats.teams.blue.clicker).toBeNull();
        });

        it('excludes disconnected players from all counts', async () => {
            mockedGetPlayersInRoom.mockResolvedValue([
                makePlayer({ team: 'red', role: 'spymaster', nickname: 'Ghost', connected: false }),
                makePlayer({ team: 'blue', role: 'clicker', nickname: 'Phantom', connected: false }),
                makePlayer({ role: 'spectator', connected: false }),
            ]);

            const stats = await getRoomStats('ROOM01');

            expect(stats.totalPlayers).toBe(0);
            expect(stats.spectatorCount).toBe(0);
            expect(stats.teams.red.total).toBe(0);
            expect(stats.teams.red.spymaster).toBeNull();
            expect(stats.teams.blue.total).toBe(0);
            expect(stats.teams.blue.clicker).toBeNull();
        });

        it('handles players with null team (spectators count but not in team totals)', async () => {
            mockedGetPlayersInRoom.mockResolvedValue([
                makePlayer({ team: null, role: 'spectator', connected: true }),
                makePlayer({ team: null, role: 'spectator', connected: true }),
                makePlayer({ team: 'red', role: 'guesser', nickname: 'RedG', connected: true }),
            ]);

            const stats = await getRoomStats('ROOM01');

            expect(stats.totalPlayers).toBe(3);
            expect(stats.spectatorCount).toBe(2);
            expect(stats.teams.red.total).toBe(1);
            expect(stats.teams.blue.total).toBe(0);
        });

        it('records only the last spymaster/clicker per team when multiple exist', async () => {
            // Edge case: if data has two spymasters for same team (shouldn't happen
            // in normal play, but stats should handle it gracefully)
            mockedGetPlayersInRoom.mockResolvedValue([
                makePlayer({ team: 'red', role: 'spymaster', nickname: 'First', connected: true }),
                makePlayer({ team: 'red', role: 'spymaster', nickname: 'Second', connected: true }),
            ]);

            const stats = await getRoomStats('ROOM01');

            // The last one wins (loop overwrites)
            expect(stats.teams.red.spymaster).toBe('Second');
            expect(stats.teams.red.total).toBe(2);
        });

        it('counts guesser role in team total but not as spymaster/clicker', async () => {
            mockedGetPlayersInRoom.mockResolvedValue([
                makePlayer({ team: 'blue', role: 'guesser', nickname: 'Guesser1', connected: true }),
                makePlayer({ team: 'blue', role: 'guesser', nickname: 'Guesser2', connected: true }),
            ]);

            const stats = await getRoomStats('ROOM01');

            expect(stats.teams.blue.total).toBe(2);
            expect(stats.teams.blue.spymaster).toBeNull();
            expect(stats.teams.blue.clicker).toBeNull();
        });
    });
});
