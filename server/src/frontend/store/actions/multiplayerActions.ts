/**
 * Multiplayer state actions — centralized mutations for room/multiplayer lifecycle.
 */

import { state } from '../../state.js';
import { batch } from '../batch.js';
import type { ServerPlayerData } from '../../multiplayerTypes.js';

/**
 * Set multiplayer mode as active after joining a room.
 */
export function joinedRoom(data: {
    roomId: string;
    isHost: boolean;
    players: ServerPlayerData[];
    mpMode: string;
}): void {
    batch(() => {
        state.isMultiplayerMode = true;
        state.currentRoomId = data.roomId;
        state.isHost = data.isHost;
        state.multiplayerPlayers = data.players;
        state.currentMpMode = data.mpMode;
    });
}

/**
 * Set the multiplayer join/create mode.
 */
export function setMpMode(mode: string): void {
    state.currentMpMode = mode;
}

/**
 * Set the resync guard flag.
 */
export function setResyncInProgress(value: boolean): void {
    state.resyncInProgress = value;
}

/**
 * Update spectator count.
 */
export function setSpectatorCount(count: number): void {
    state.spectatorCount = count;
}
