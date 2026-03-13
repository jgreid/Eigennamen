import { state } from '../state.js';
import { showToast, announceToScreenReader } from '../ui.js';
import { renderBoard } from '../board.js';
import { updateRoleBanner, updateControls, clearRoleChange } from '../roles.js';
import { playNotificationSound } from '../notifications.js';
import { logger } from '../logger.js';
import { updateMpIndicator } from '../multiplayerUI.js';
import { syncLocalPlayerState } from '../multiplayerSync.js';
import type {
    ServerPlayerData,
    PlayerJoinedData,
    PlayerLeftData,
    PlayerUpdatedData,
    PlayerDisconnectedData,
} from '../multiplayerTypes.js';

export function registerPlayerHandlers(): void {
    EigennamenClient.on('playerJoined', (data: PlayerJoinedData) => {
        if (state.resyncInProgress) return;
        if (data.players) {
            state.multiplayerPlayers = data.players;
        } else if (data.player) {
            // Add new player to list if not already present
            const exists = state.multiplayerPlayers.some(
                (p: ServerPlayerData) => p.sessionId === data.player!.sessionId
            );
            if (!exists) {
                state.multiplayerPlayers = [...state.multiplayerPlayers, data.player];
            }
        }
        updateMpIndicator({ code: EigennamenClient.getRoomCode() || '' }, state.multiplayerPlayers);
        showToast(`${data.player?.nickname || 'Someone'} joined`, 'success');
        playNotificationSound('join');
    });

    EigennamenClient.on('playerLeft', (data: PlayerLeftData) => {
        if (state.resyncInProgress) return;
        if (data.players) {
            state.multiplayerPlayers = data.players;
        } else if (data.sessionId) {
            // Remove player from list
            state.multiplayerPlayers = state.multiplayerPlayers.filter(
                (p: ServerPlayerData) => p.sessionId !== data.sessionId
            );
        }
        updateMpIndicator({ code: EigennamenClient.getRoomCode() || '' }, state.multiplayerPlayers);
        // Refresh controls and board — the departed player may have been the
        // active clicker, so remaining team members need their UI updated to
        // reflect fallback clicker permissions.
        updateControls();
        renderBoard();
        if (data.nickname) {
            showToast(`${data.nickname} left`, 'info');
        }
    });

    // Handle player state updates (role, team, nickname changes)
    EigennamenClient.on('playerUpdated', (data: PlayerUpdatedData) => {
        // Skip individual updates during a full state resync — the resync
        // data already contains the latest state for all players.
        if (state.resyncInProgress) return;
        if (data.sessionId && data.changes) {
            // Update player in local list
            state.multiplayerPlayers = state.multiplayerPlayers.map((p: ServerPlayerData) =>
                p.sessionId === data.sessionId ? ({ ...p, ...data.changes } as ServerPlayerData) : p
            );
            updateMpIndicator({ code: EigennamenClient.getRoomCode() || '' }, state.multiplayerPlayers);

            // Announce role/team changes to screen readers
            if (data.changes.role || data.changes.team !== undefined) {
                const changedPlayer = state.multiplayerPlayers.find(
                    (p: ServerPlayerData) => p.sessionId === data.sessionId
                );
                const name = changedPlayer?.nickname || 'A player';
                if (data.changes.role) {
                    announceToScreenReader(`${name} is now ${data.changes.role}.`);
                }
                if (data.changes.team !== undefined) {
                    const teamName = data.changes.team
                        ? data.changes.team === 'red'
                            ? state.teamNames?.red || 'Red'
                            : state.teamNames?.blue || 'Blue'
                        : 'spectators';
                    announceToScreenReader(`${name} joined ${teamName}.`);
                }
            }

            // If this is the current player, update local state variables
            if (data.sessionId === EigennamenClient.player?.sessionId) {
                let updatedPlayer = state.multiplayerPlayers.find(
                    (p: ServerPlayerData) => p.sessionId === data.sessionId
                );

                // Bug #8 fix: If player not in list, construct from changes and EigennamenClient.player
                if (!updatedPlayer) {
                    const basePlayer = EigennamenClient.player || {};
                    updatedPlayer = { ...basePlayer, ...data.changes } as ServerPlayerData;
                    if (updatedPlayer.sessionId) {
                        state.multiplayerPlayers = [...state.multiplayerPlayers, updatedPlayer];
                        updateMpIndicator({ code: EigennamenClient.getRoomCode() || '' }, state.multiplayerPlayers);
                    }
                }

                if (updatedPlayer) {
                    // Determine if this update confirms the in-flight role change operation.
                    // During a role change, skip syncLocalPlayerState for unrelated updates
                    // to avoid overwriting optimistic UI state (race condition fix).
                    const rc = state.roleChange;
                    const isConfirmingUpdate =
                        rc.phase !== 'idle' &&
                        ((rc.phase === 'changing_team' && data.changes.team !== undefined) ||
                            (rc.phase === 'changing_role' &&
                                (data.changes.role !== undefined || data.changes.team !== undefined)));

                    if (rc.phase === 'idle' || isConfirmingUpdate) {
                        syncLocalPlayerState(updatedPlayer);
                    }

                    if (isConfirmingUpdate || rc.phase === 'idle') {
                        clearRoleChange();
                    }
                    // If role change in progress but not confirmed by this update,
                    // leave state machine alone — ack callback handles success/failure

                    updateControls();
                    updateRoleBanner();
                    renderBoard();
                } else {
                    // Even if player not found, clear role change to prevent blocking
                    logger.warn('playerUpdated: current player not found in list, clearing role change state');
                    clearRoleChange();
                }
            }
        }
    });

    // Handle player disconnection (network issues)
    EigennamenClient.on('playerDisconnected', (data: PlayerDisconnectedData) => {
        if (state.resyncInProgress) return;
        // Mark player as disconnected in local list
        if (data.sessionId) {
            state.multiplayerPlayers = state.multiplayerPlayers.map((p: ServerPlayerData) =>
                p.sessionId === data.sessionId ? { ...p, connected: false } : p
            );
            updateMpIndicator({ code: EigennamenClient.getRoomCode() || '' }, state.multiplayerPlayers);
            // Update controls and board - clicker disconnecting enables other team members
            updateControls();
            renderBoard();
        }
        showToast(`${data.nickname || 'A player'} disconnected`, 'warning');
    });

    // Handle player reconnection
    EigennamenClient.on('playerReconnected', (data: PlayerDisconnectedData) => {
        if (state.resyncInProgress) return;
        // Mark player as connected in local list
        if (data.sessionId) {
            state.multiplayerPlayers = state.multiplayerPlayers.map((p: ServerPlayerData) =>
                p.sessionId === data.sessionId ? { ...p, connected: true } : p
            );
            updateMpIndicator({ code: EigennamenClient.getRoomCode() || '' }, state.multiplayerPlayers);
            // Update controls and board - clicker reconnecting restores normal behavior
            updateControls();
            renderBoard();
        }
        showToast(`${data.nickname || 'A player'} reconnected`, 'success');
    });
}
