import type { Team, Player } from '../../types';
import { getPlayersInRoom } from '../playerService';

/**
 * Spectator info
 */
export interface SpectatorInfo {
    sessionId: string;
    nickname: string;
    team: Team | null;
}

/**
 * Spectators response
 */
export interface SpectatorsResponse {
    count: number;
    spectators: SpectatorInfo[];
}

/**
 * Team statistics
 */
export interface TeamStats {
    total: number;
    spymaster: string | null;
    clicker: string | null;
}

/**
 * Room statistics
 */
export interface RoomStats {
    totalPlayers: number;
    spectatorCount: number;
    teams: {
        red: TeamStats;
        blue: TeamStats;
    };
}

/**
 * Get spectator count and list for a room
 * Spectators are players with role='spectator'
 */
export async function getSpectators(roomCode: string): Promise<SpectatorsResponse> {
    const players = await getPlayersInRoom(roomCode);
    const spectators = players.filter(p => p.role === 'spectator' && p.connected);
    return {
        count: spectators.length,
        spectators: spectators.map(s => ({
            sessionId: s.sessionId,
            nickname: s.nickname,
            team: s.team // team affiliation (can be null)
        }))
    };
}

/**
 * Get spectator count only (lightweight version)
 */
export async function getSpectatorCount(
    roomCode: string,
    existingPlayers?: Player[]
): Promise<number> {
    const players = existingPlayers || await getPlayersInRoom(roomCode);
    return players.filter(p => p.role === 'spectator' && p.connected).length;
}

/**
 * Get room player statistics
 * Returns counts by role and team for UI display
 */
export async function getRoomStats(
    roomCode: string,
    existingPlayers?: Player[]
): Promise<RoomStats> {
    const players = existingPlayers || await getPlayersInRoom(roomCode);
    const connected = players.filter(p => p.connected);

    const stats: RoomStats = {
        totalPlayers: connected.length,
        spectatorCount: 0,
        teams: {
            red: { total: 0, spymaster: null, clicker: null },
            blue: { total: 0, spymaster: null, clicker: null }
        }
    };

    for (const player of connected) {
        if (player.role === 'spectator') {
            stats.spectatorCount++;
        }

        if (player.team === 'red' || player.team === 'blue') {
            stats.teams[player.team].total++;
            if (player.role === 'spymaster') {
                stats.teams[player.team].spymaster = player.nickname;
            } else if (player.role === 'clicker') {
                stats.teams[player.team].clicker = player.nickname;
            }
        }
    }

    return stats;
}
