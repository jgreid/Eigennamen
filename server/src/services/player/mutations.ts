/**
 * Player Mutations - Write operations for player team, role, and nickname
 *
 * Uses Lua scripts for atomic updates with conflict prevention.
 * Imported by playerService.ts and re-exported for backward compatibility.
 */

import type { Team, Role, Player, RedisClient } from '../../types';

import { getRedis } from '../../config/redis';
import logger from '../../utils/logger';
import { withTimeout, TIMEOUTS } from '../../utils/timeout';
import { REDIS_TTL } from '../../config/constants';
import { ServerError, ValidationError } from '../../errors/GameError';
import { parseJSON } from '../../utils/parseJSON';
import { sanitizeHtml } from '../../utils/sanitize';
import { SAFE_TEAM_SWITCH_SCRIPT, SET_ROLE_SCRIPT } from '../../scripts';
import { luaResultSchema } from './schemas';
import { getPlayer, updatePlayer } from '../playerService';

/**
 * Set player's team (atomic operation with optional empty-team check)
 *
 * Uses a single Lua script that handles both simple team changes and
 * safe team switches (preventing a team from becoming empty during active games).
 */
export async function setTeam(
    sessionId: string,
    team: Team | null,
    checkEmpty: boolean = false
): Promise<Player> {
    const redis: RedisClient = getRedis();

    // Get player to determine room code and old team for the Lua script
    const existingPlayer = await getPlayer(sessionId);
    if (!existingPlayer) {
        throw new ServerError('Player not found');
    }

    const oldTeam = existingPlayer.team;
    const roomCode = existingPlayer.roomCode;

    if (!roomCode) {
        throw new ServerError('Player is not associated with a room');
    }

    const teamValue = team === null || team === undefined ? '__NULL__' : team;
    const teamSetKey = oldTeam ? `room:${roomCode}:team:${oldTeam}` : 'nonexistent:key';

    const result = await withTimeout(
        redis.eval(
            SAFE_TEAM_SWITCH_SCRIPT,
            {
                keys: [`player:${sessionId}`, teamSetKey, roomCode],
                arguments: [
                    teamValue,
                    sessionId,
                    REDIS_TTL.PLAYER.toString(),
                    Date.now().toString(),
                    checkEmpty.toString()
                ]
            }
        ),
        TIMEOUTS.REDIS_OPERATION,
        `setTeam-lua-${sessionId}`
    ) as string | null;

    if (!result) {
        throw new ServerError('Player not found');
    }

    try {
        const parsed = parseJSON(result, luaResultSchema, `setTeam lua for ${sessionId}`);

        if (parsed.success === false) {
            if (parsed.reason === 'TEAM_WOULD_BE_EMPTY') {
                throw new ValidationError(`Cannot leave team ${oldTeam} - your team cannot be empty during an active game`);
            }
            // Defense-in-depth: Invalid team caught by Lua validation
            if (parsed.reason === 'INVALID_TEAM') {
                throw new ValidationError('Invalid team specified');
            }
            throw new ServerError('Failed to update player team');
        }

        if (!parsed.player) {
            throw new ServerError('Lua script returned success without player data');
        }
        logger.debug(`Player ${sessionId} team set to ${team}`);
        return parsed.player;
    } catch (e) {
        if (e instanceof ValidationError) {
            throw e;
        }
        logger.error('Failed to parse player data after team change', { sessionId, error: (e as Error).message });
        throw new ServerError('Failed to update player team');
    }
}

/**
 * Set player's role with atomic check to prevent race conditions
 * Uses Lua script for truly atomic role assignment
 * Enforces one spymaster and one clicker per team
 */
export async function setRole(sessionId: string, role: Role): Promise<Player> {
    const redis: RedisClient = getRedis();

    const player = await getPlayer(sessionId);
    if (!player) {
        throw new ServerError('Player not found');
    }

    if (!player.roomCode) {
        throw new ServerError('Player is not associated with a room');
    }

    // For spectator role, no need for atomic check - just update
    if (role === 'spectator') {
        return updatePlayer(sessionId, { role });
    }

    // Atomic Lua script handles team requirement and role-taken checks
    const result = await withTimeout(
        redis.eval(
            SET_ROLE_SCRIPT,
            {
                keys: [`player:${sessionId}`, `room:${player.roomCode}:players`],
                arguments: [
                    role,
                    sessionId,
                    REDIS_TTL.PLAYER.toString(),
                    Date.now().toString()
                ]
            }
        ),
        TIMEOUTS.REDIS_OPERATION,
        `setRole-lua-${sessionId}`
    ) as string | null;

    if (!result) {
        throw new ServerError('Player not found');
    }

    try {
        const parsed = parseJSON(result, luaResultSchema, `setRole lua for ${sessionId}`);

        if (parsed.success === false) {
            if (parsed.reason === 'ROLE_TAKEN') {
                throw new ValidationError(`${player.team} team already has a ${role} (${sanitizeHtml(parsed.existingNickname ?? '')})`);
            }
            if (parsed.reason === 'NO_TEAM') {
                throw new ValidationError('Must join a team before becoming ' + role);
            }
            // Defense-in-depth: Invalid role caught by Lua validation
            if (parsed.reason === 'INVALID_ROLE') {
                throw new ValidationError('Invalid role specified');
            }
            throw new ServerError('Failed to update player role');
        }

        if (!parsed.player) {
            throw new ServerError('Lua script returned success without player data');
        }
        logger.debug(`Player ${sessionId} role set to ${role}`);
        return parsed.player;
    } catch (e) {
        if (e instanceof ValidationError) {
            throw e;
        }
        logger.error('Failed to parse player data after role change', { sessionId, error: (e as Error).message });
        throw new ServerError('Failed to update player role');
    }
}

/**
 * Set player's nickname
 * Defense-in-depth validation for nickname
 */
export async function setNickname(sessionId: string, nickname: string): Promise<Player> {
    // Zod schema already validates and trims the nickname at the handler level;
    // defense-in-depth check here prevents empty nicknames if called from other paths.
    const trimmed = (nickname || '').trim();
    if (trimmed.length === 0) {
        throw new ValidationError('Nickname cannot be empty');
    }
    return updatePlayer(sessionId, { nickname: trimmed });
}
