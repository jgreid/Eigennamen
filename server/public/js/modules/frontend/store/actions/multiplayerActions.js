/**
 * Multiplayer state actions — centralized mutations for room/multiplayer lifecycle.
 */
import { state } from '../../state.js';
import { batch } from '../batch.js';
/**
 * Set multiplayer mode as active after joining a room.
 */
export function joinedRoom(data) {
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
export function setMpMode(mode) {
    state.currentMpMode = mode;
}
/**
 * Set the resync guard flag.
 */
export function setResyncInProgress(value) {
    state.resyncInProgress = value;
}
/**
 * Update spectator count.
 */
export function setSpectatorCount(count) {
    state.spectatorCount = count;
}
//# sourceMappingURL=multiplayerActions.js.map