/**
 * Player state actions — centralized mutations for player/role state.
 *
 * Wraps the existing validated setters from stateMutations.ts with
 * batch() for consistency with the rest of the store.
 */
import { state } from '../../state.js';
import { batch } from '../batch.js';
import { setPlayerRole as _setPlayerRole, clearPlayerRole as _clearPlayerRole } from '../../stateMutations.js';
/**
 * Set the player's role and team atomically.
 * Delegates to the validated setter in stateMutations.ts.
 */
export function setPlayerRole(role, team) {
    batch(() => {
        _setPlayerRole(role, team);
    });
}
/**
 * Clear all player role state to defaults.
 */
export function clearPlayerRole() {
    batch(() => {
        _clearPlayerRole();
    });
}
/**
 * Sync local player state from server player data.
 */
export function syncLocalPlayerState(player) {
    if (!player)
        return;
    setPlayerRole(player.role, player.team);
}
/**
 * Set host status.
 */
export function setHost(isHost) {
    state.isHost = isHost;
}
/**
 * Replace the entire player list.
 */
export function setPlayers(players) {
    state.multiplayerPlayers = players;
}
/**
 * Add a player to the list (if not already present).
 */
export function addPlayer(player) {
    if (!state.multiplayerPlayers.some(p => p.sessionId === player.sessionId)) {
        state.multiplayerPlayers = [...state.multiplayerPlayers, player];
    }
}
/**
 * Remove a player by session ID.
 */
export function removePlayer(sessionId) {
    state.multiplayerPlayers = state.multiplayerPlayers.filter(p => p.sessionId !== sessionId);
}
/**
 * Update a specific player in the list (by sessionId).
 */
export function updatePlayer(updated) {
    state.multiplayerPlayers = state.multiplayerPlayers.map(p => p.sessionId === updated.sessionId ? updated : p);
}
//# sourceMappingURL=playerActions.js.map