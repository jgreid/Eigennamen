/**
 * Botful-room cache (E3).
 *
 * The bot controller ticks on EVERY game mutation of EVERY room. Most rooms have
 * no bots, yet each of their mutations paid a full game-blob fetch + parse and a
 * team-roster read before discovering there was no bot to act (~80–120 wasted
 * Redis calls per bot-less game). This module records, per room, whether it has
 * any bot so the controller can skip a confirmed bot-less room for free.
 *
 * Tri-state: `true` (has ≥1 bot), `false` (confirmed none), absent (unknown).
 * The policy is "unknown → check once, then record", NOT default-deny: bots are
 * persistent Redis players, so after a process restart this cache is empty while
 * botful rooms still exist — an unknown room must still be checked, never skipped.
 *
 * Kept a leaf module (no service imports) so both botController and botService
 * can use it without an import cycle.
 */

const roomBotful = new Map<string, boolean>();

/** Bound the cache on a long-running server. A dropped entry just reverts a room
 *  to "unknown", so the next mutation re-checks it once — always safe. */
const MAX_TRACKED_ROOMS = 500;

function evictOldest(): void {
    while (roomBotful.size > MAX_TRACKED_ROOMS) {
        const oldest = roomBotful.keys().next().value;
        if (oldest === undefined) break;
        roomBotful.delete(oldest);
    }
}

/** True only when the room is CONFIRMED bot-less (skip it). Unknown → false. */
export function isKnownBotless(roomCode: string): boolean {
    return roomBotful.get(roomCode) === false;
}

/** Whether the room's botfulness has been resolved (true or false recorded). */
export function isBotfulnessKnown(roomCode: string): boolean {
    return roomBotful.has(roomCode);
}

/** Record a resolved botfulness (delete-before-set keeps Map order LRU-ish). */
export function recordBotful(roomCode: string, hasBot: boolean): void {
    roomBotful.delete(roomCode);
    roomBotful.set(roomCode, hasBot);
    evictOldest();
}

/** A bot was added — the room definitely has one now. */
export function noteRoomHasBot(roomCode: string): void {
    recordBotful(roomCode, true);
}

/** A bot was removed — we no longer know if any remain, so revert to unknown so
 *  the next tick re-resolves (the room may still hold other bots). */
export function noteBotRemoved(roomCode: string): void {
    roomBotful.delete(roomCode);
}

/** Drop everything (controller teardown / tests). */
export function clearBotRoomCache(): void {
    roomBotful.clear();
}
