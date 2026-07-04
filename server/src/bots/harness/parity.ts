/**
 * Lua-vs-TS parity check (standalone — NOT part of the Jest suite, since it
 * spins up a real embedded Redis to execute the production Lua scripts).
 *
 * For each mode and seed it builds the SAME board two ways — the pure engine
 * (createEngineGame) and the real gameService.createGame (Lua-backed, now
 * seedable) — then drives an identical deterministic reveal sequence through
 * both and asserts the resulting state matches after every move. This is the
 * gold-standard guard that the pure rules the harness trains on cannot drift
 * from production. Run with:  REDIS_URL=memory npm run bots:parity
 *
 * Exit code 0 = parity holds; 1 = a divergence (printed) or setup failure.
 */
/* istanbul ignore file -- standalone tool, runs real Redis, not unit-tested */
/* eslint-disable no-await-in-loop -- intentionally sequential: each game runs to completion before the next */
import type { GameMode, GameState, Team } from '../../types';

import { connectRedis, getRedis, disconnectRedis } from '../../config/redis';
import { seededRandom, hashString } from '../../services/game/boardGenerator';
import * as gameService from '../../services/gameService';
import { createEngineGame, applyEngineClue, applyEngineReveal } from '../engine';

// A clue word guaranteed not to collide with any real board word (see
// isClueLegalForBoard in shared/gameRules.ts) — number=0 grants unlimited
// guesses so a fresh clue is only needed when the previous one's turn ended.
const PARITY_CLUE_WORD = 'PARITYCLUEZZZ';

const MODES: GameMode[] = ['classic', 'duet', 'match'];
const SEEDS_PER_MODE = Number(process.env.PARITY_SEEDS) || 200;
const ROOM = 'PARITY';

/** A seeded permutation of 0..24 — the reveal order both implementations follow. */
function revealOrder(seed: string): number[] {
    const order = Array.from({ length: 25 }, (_, i) => i);
    let s = hashString(seed);
    for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(seededRandom(s++) * (i + 1));
        [order[i], order[j]] = [order[j] as number, order[i] as number];
    }
    return order;
}

function snapshot(g: GameState): Record<string, unknown> {
    return {
        redScore: g.redScore,
        blueScore: g.blueScore,
        currentTurn: g.currentTurn,
        gameOver: g.gameOver,
        winner: g.winner ?? null,
        guessesUsed: g.guessesUsed ?? 0,
        revealed: [...g.revealed],
        greenFound: g.greenFound,
        timerTokens: g.timerTokens,
        redMatchScore: g.redMatchScore,
        blueMatchScore: g.blueMatchScore,
    };
}

function diff(a: Record<string, unknown>, b: Record<string, unknown>): string | null {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
        if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
            return `${k}: engine=${JSON.stringify(a[k])} lua=${JSON.stringify(b[k])}`;
        }
    }
    return null;
}

async function runOne(mode: GameMode, seed: string): Promise<string | null> {
    const redis = getRedis();
    // Minimal room so createGame/persistGameState succeed.
    await redis.set(
        `room:${ROOM}`,
        JSON.stringify({
            code: ROOM,
            hostSessionId: 'h',
            status: 'waiting',
            settings: { gameMode: mode },
            createdAt: 0,
        }),
        { EX: 600 }
    );
    await redis.del(`room:${ROOM}:game`);

    const engine = createEngineGame({ seed, gameMode: mode });
    const lua = await gameService.createGame(ROOM, { gameMode: mode, seed });

    // Boards must match up front.
    if (JSON.stringify(engine.types) !== JSON.stringify(lua.types)) return 'initial board types differ';
    if (JSON.stringify(engine.words) !== JSON.stringify(lua.words)) return 'initial board words differ';

    for (const index of revealOrder(seed)) {
        if (engine.gameOver) break;
        const team = engine.currentTurn as Team;
        if (!engine.currentClue) {
            applyEngineClue(engine, team, PARITY_CLUE_WORD, 0);
            await gameService.submitClue(ROOM, team, PARITY_CLUE_WORD, 0, 'bot');
        }
        applyEngineReveal(engine, index);
        await gameService.revealCard(ROOM, index, 'bot', team);
        const luaState = (await gameService.getGame(ROOM)) as GameState;
        const d = diff(snapshot(engine), snapshot(luaState));
        if (d) return `after reveal ${index}: ${d}`;
        if (luaState.gameOver) break;
    }
    return null;
}

async function main(): Promise<void> {
    process.env.REDIS_URL = process.env.REDIS_URL || 'memory';
    await connectRedis();
    let failures = 0;
    try {
        for (const mode of MODES) {
            let modeFail = 0;
            for (let i = 0; i < SEEDS_PER_MODE; i++) {
                const result = await runOne(mode, `parity:${mode}:${i}`);
                if (result) {
                    modeFail++;
                    failures++;
                    // eslint-disable-next-line no-console
                    if (modeFail <= 5) console.error(`[${mode} #${i}] DIVERGENCE — ${result}`);
                }
            }
            // eslint-disable-next-line no-console
            console.log(`${mode}: ${SEEDS_PER_MODE - modeFail}/${SEEDS_PER_MODE} seeds match`);
        }
    } finally {
        await disconnectRedis().catch(() => undefined);
    }
    if (failures > 0) {
        // eslint-disable-next-line no-console
        console.error(`\nPARITY FAILED: ${failures} divergence(s)`);
        process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.log('\nPARITY OK — engine matches Lua across all modes');
}

main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
});
