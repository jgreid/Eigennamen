/**
 * Bot lifecycle: a bot is an ordinary Redis Player record (isBot:true) with no
 * socket. It joins the room's player + team sets exactly like a human so
 * getPlayersInRoom / getTeamMembers include it, and carries a small config blob
 * (bot:{sessionId}:cfg) the controller reads to pick a strategy. Bots stay
 * connected:true so the disconnect GC never reaps them.
 */
import type { Team, Role, Player, RedisClient } from '../types';

import { randomUUID } from 'crypto';
import { getRedis } from '../config/redis';
import logger from '../utils/logger';
import { withTimeout, TIMEOUTS } from '../utils/timeout';
import { REDIS_TTL, ROOM_MAX_PLAYERS } from '../config/constants';
import { RoomError, ValidationError, PlayerError, ServerError } from '../errors/GameError';
import { tryParseJSON } from '../utils/parseJSON';
import * as playerService from './playerService';
import { hashString } from './game/boardGenerator';
import { strategyLabel } from '../bots/strategies/registry';
import { botConfigSchema } from '../validators/botSchemas';
import { ATOMIC_JOIN_SCRIPT } from '../scripts';
import type { BotConfig } from '../bots/strategies/types';

export interface AddBotOptions {
    team: Team;
    role: Extract<Role, 'spymaster' | 'clicker'>;
    strategyId: string;
    skillPreset: string;
    nickname?: string;
}

const botCfgKey = (sessionId: string): string => `bot:${sessionId}:cfg`;

function shortId(): string {
    return randomUUID().replace(/-/g, '').slice(0, 4);
}

/**
 * Add a bot to a room as a fully-fledged player on a given team + role.
 * Returns the created bot Player.
 */
export async function addBot(roomCode: string, opts: AddBotOptions): Promise<Player> {
    const redis: RedisClient = getRedis();

    const sessionId = `bot-${randomUUID()}`;
    const nickname = opts.nickname?.trim() || `${strategyLabel(opts.strategyId)} Bot ${shortId()}`;

    const now = Date.now();
    const player: Player = {
        sessionId,
        roomCode,
        nickname,
        team: opts.team,
        role: opts.role,
        isHost: false,
        connected: true,
        isBot: true,
        createdAt: now,
        connectedAt: now,
        lastSeen: now,
    };

    const config: BotConfig = {
        strategyId: opts.strategyId,
        skillPreset: opts.skillPreset,
        seed: hashString(sessionId),
    };

    const playersKey = `room:${roomCode}:players`;
    const teamKey = `room:${roomCode}:team:${opts.team}`;

    // Atomic capacity check + player record + set insertion, using the SAME
    // primitive a human join uses. This serialises against concurrent bot:add
    // and room:join events so the room can never exceed ROOM_MAX_PLAYERS (the
    // previous read-then-write was a TOCTOU that two rapid adds could both pass).
    const result = (await withTimeout(
        redis.eval(ATOMIC_JOIN_SCRIPT, {
            keys: [playersKey, `room:${roomCode}`],
            arguments: [
                ROOM_MAX_PLAYERS.toString(),
                sessionId,
                JSON.stringify(player),
                `player:${sessionId}`,
                REDIS_TTL.PLAYER.toString(),
            ],
        }),
        TIMEOUTS.REDIS_OPERATION,
        `addBot-join-${sessionId}`
    )) as number;

    if (result === -2) {
        throw RoomError.notFound(roomCode);
    }
    if (result === 0) {
        throw RoomError.full(roomCode);
    }
    if (result !== 1) {
        // -1 (already a member) cannot happen for a fresh UUID; treat anything
        // other than success as a server error rather than leaving a half-bot.
        throw new ServerError(`Failed to add bot (join result ${result})`);
    }

    // Follow-up writes: team-set membership + the strategy config blob. If either
    // fails, roll the bot back so we never leave a player in the room set that the
    // controller can't drive (no cfg) or a seat with no team membership.
    try {
        await Promise.all([
            withTimeout(redis.sAdd(teamKey, sessionId), TIMEOUTS.REDIS_OPERATION, `addBot-sAddTeam-${sessionId}`),
            withTimeout(
                redis.set(botCfgKey(sessionId), JSON.stringify(config), { EX: REDIS_TTL.ROOM }),
                TIMEOUTS.REDIS_OPERATION,
                `addBot-setCfg-${sessionId}`
            ),
        ]);
        await withTimeout(
            redis.expire(teamKey, REDIS_TTL.ROOM),
            TIMEOUTS.REDIS_OPERATION,
            `addBot-expireTeam-${sessionId}`
        );
    } catch (err) {
        await rollbackBot(redis, roomCode, opts.team, sessionId);
        throw err;
    }

    logger.info(`Bot ${nickname} (${sessionId}) added to room ${roomCode} as ${opts.team} ${opts.role}`);
    return player;
}

/**
 * Best-effort cleanup of a partially-created bot. Each delete is independent and
 * swallows its own error — rollback must never mask the original failure.
 */
async function rollbackBot(redis: RedisClient, roomCode: string, team: Team, sessionId: string): Promise<void> {
    const ops: Promise<unknown>[] = [
        redis.sRem(`room:${roomCode}:players`, sessionId),
        redis.sRem(`room:${roomCode}:team:${team}`, sessionId),
        redis.del(`player:${sessionId}`),
        redis.del(botCfgKey(sessionId)),
    ];
    const settled = await Promise.allSettled(ops);
    for (const r of settled) {
        if (r.status === 'rejected') {
            logger.warn(`addBot rollback step failed for ${sessionId}`, { error: String(r.reason) });
        }
    }
}

/**
 * Remove a bot from a room. Throws if the session is not a bot in this room.
 */
export async function removeBot(roomCode: string, sessionId: string): Promise<void> {
    const redis: RedisClient = getRedis();

    const player = await playerService.getPlayer(sessionId);
    if (!player || player.roomCode !== roomCode) {
        throw PlayerError.notFound(sessionId);
    }
    if (!player.isBot) {
        throw new ValidationError('Target is not a bot');
    }

    await playerService.removePlayer(sessionId);
    await withTimeout(redis.del(botCfgKey(sessionId)), TIMEOUTS.REDIS_OPERATION, `removeBot-delCfg-${sessionId}`);

    logger.info(`Bot ${sessionId} removed from room ${roomCode}`);
}

/**
 * Read a bot's persisted config (null if missing/corrupt).
 */
export async function getBotConfig(sessionId: string): Promise<BotConfig | null> {
    const redis: RedisClient = getRedis();
    const raw = await withTimeout(
        redis.get(botCfgKey(sessionId)),
        TIMEOUTS.REDIS_OPERATION,
        `getBotConfig-${sessionId}`
    );
    if (!raw) return null;
    return tryParseJSON(raw, botConfigSchema, `bot config ${sessionId}`) as BotConfig | null;
}
