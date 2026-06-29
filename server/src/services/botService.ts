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
import { RoomError, ValidationError, PlayerError } from '../errors/GameError';
import { tryParseJSON } from '../utils/parseJSON';
import * as playerService from './playerService';
import { hashString } from './game/boardGenerator';
import { strategyLabel } from '../bots/strategies/registry';
import { botConfigSchema } from '../validators/botSchemas';
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

    // Capacity check (bots count toward room capacity like any player).
    const players = await playerService.getPlayersInRoom(roomCode);
    if (players.length >= ROOM_MAX_PLAYERS) {
        throw RoomError.full(roomCode);
    }

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

    // Persist the player record.
    await withTimeout(
        redis.set(`player:${sessionId}`, JSON.stringify(player), { EX: REDIS_TTL.PLAYER }),
        TIMEOUTS.REDIS_OPERATION,
        `addBot-setPlayer-${sessionId}`
    );

    // Add to the room players set + the team set, mirroring a human join.
    const playersKey = `room:${roomCode}:players`;
    const teamKey = `room:${roomCode}:team:${opts.team}`;
    await Promise.all([
        withTimeout(redis.sAdd(playersKey, sessionId), TIMEOUTS.REDIS_OPERATION, `addBot-sAddPlayers-${sessionId}`),
        withTimeout(redis.sAdd(teamKey, sessionId), TIMEOUTS.REDIS_OPERATION, `addBot-sAddTeam-${sessionId}`),
        withTimeout(
            redis.set(botCfgKey(sessionId), JSON.stringify(config), { EX: REDIS_TTL.ROOM }),
            TIMEOUTS.REDIS_OPERATION,
            `addBot-setCfg-${sessionId}`
        ),
    ]);
    await Promise.all([
        withTimeout(
            redis.expire(playersKey, REDIS_TTL.ROOM),
            TIMEOUTS.REDIS_OPERATION,
            `addBot-expirePlayers-${sessionId}`
        ),
        withTimeout(redis.expire(teamKey, REDIS_TTL.ROOM), TIMEOUTS.REDIS_OPERATION, `addBot-expireTeam-${sessionId}`),
    ]);

    logger.info(`Bot ${nickname} (${sessionId}) added to room ${roomCode} as ${opts.team} ${opts.role}`);
    return player;
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
