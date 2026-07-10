import { state } from '../state.js';
import { showToast, announceToScreenReader } from '../ui.js';
import { t } from '../i18n.js';
import { renderBoard } from '../board.js';
import { updateRoleBanner, updateControls, clearRoleChange } from '../roles.js';
import { playNotificationSound } from '../notifications.js';
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
            const exists = state.multiplayerPlayers.some((p: ServerPlayerData) => p.playerId === data.player!.playerId);
            if (!exists) {
                state.multiplayerPlayers = [...state.multiplayerPlayers, data.player];
            }
        }
        updateMpIndicator({ code: EigennamenClient.getRoomCode() || '' }, state.multiplayerPlayers);
        showToast(
            t('multiplayer.playerJoined', { name: data.player?.nickname || t('multiplayer.someone') }),
            'success'
        );
        playNotificationSound('join');
    });

    EigennamenClient.on('playerLeft', (data: PlayerLeftData) => {
        if (state.resyncInProgress) return;
        if (data.players) {
            state.multiplayerPlayers = data.players;
        } else if (data.playerId) {
            // Remove player from list
            state.multiplayerPlayers = state.multiplayerPlayers.filter(
                (p: ServerPlayerData) => p.playerId !== data.playerId
            );
        }
        updateMpIndicator({ code: EigennamenClient.getRoomCode() || '' }, state.multiplayerPlayers);
        // Refresh controls and board — the departed player may have been the
        // active clicker, so remaining team members need their UI updated to
        // reflect fallback clicker permissions.
        updateControls();
        renderBoard();
        if (data.nickname) {
            showToast(t('multiplayer.playerLeft', { name: data.nickname }), 'info');
        }
    });

    // Handle player state updates (role, team, nickname changes)
    EigennamenClient.on('playerUpdated', (data: PlayerUpdatedData) => {
        // Skip individual updates during a full state resync — the resync
        // data already contains the latest state for all players.
        if (state.resyncInProgress) return;
        if (data.playerId && data.changes) {
            // Update player in local list
            state.multiplayerPlayers = state.multiplayerPlayers.map((p: ServerPlayerData) =>
                p.playerId === data.playerId ? ({ ...p, ...data.changes } as ServerPlayerData) : p
            );
            updateMpIndicator({ code: EigennamenClient.getRoomCode() || '' }, state.multiplayerPlayers);

            // Announce role/team changes to screen readers
            if (data.changes.role || data.changes.team !== undefined) {
                const changedPlayer = state.multiplayerPlayers.find(
                    (p: ServerPlayerData) => p.playerId === data.playerId
                );
                const name = changedPlayer?.nickname || t('a11y.aPlayer');
                if (data.changes.role) {
                    // SR announcement was hardcoded English — spoken on every game
                    // start via per-player player:updated, so de/es/fr users heard
                    // English. Route through t(); translate the role too. (N18)
                    announceToScreenReader(t('a11y.playerNowRole', { name, role: t(`roles.${data.changes.role}`) }));
                }
                if (data.changes.team !== undefined) {
                    const teamName = data.changes.team
                        ? data.changes.team === 'red'
                            ? state.teamNames?.red || 'Red'
                            : state.teamNames?.blue || 'Blue'
                        : t('a11y.spectatorsLabel');
                    announceToScreenReader(t('a11y.playerJoinedTeam', { name, team: teamName }));
                }
            }

            // If this is the current player, update local state variables
            if (data.playerId === EigennamenClient.player?.playerId) {
                let updatedPlayer = state.multiplayerPlayers.find(
                    (p: ServerPlayerData) => p.playerId === data.playerId
                );

                // Bug #8 fix: If player not in list, construct from changes and EigennamenClient.player
                if (!updatedPlayer) {
                    const basePlayer = EigennamenClient.player || {};
                    updatedPlayer = { ...basePlayer, ...data.changes } as ServerPlayerData;
                    if (updatedPlayer.playerId) {
                        state.multiplayerPlayers = [...state.multiplayerPlayers, updatedPlayer];
                        updateMpIndicator({ code: EigennamenClient.getRoomCode() || '' }, state.multiplayerPlayers);
                    }
                }

                // updatedPlayer is always set here (the outer guard requires the
                // current player, and it is reconstructed above if missing).
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
            }
        }
    });

    // Handle player disconnection (network issues)
    EigennamenClient.on('playerDisconnected', (data: PlayerDisconnectedData) => {
        if (state.resyncInProgress) return;
        // Mark player as disconnected in local list
        if (data.playerId) {
            state.multiplayerPlayers = state.multiplayerPlayers.map((p: ServerPlayerData) =>
                p.playerId === data.playerId ? { ...p, connected: false } : p
            );
            updateMpIndicator({ code: EigennamenClient.getRoomCode() || '' }, state.multiplayerPlayers);
            // Update controls and board - clicker disconnecting enables other team members
            updateControls();
            renderBoard();
        }
        showToast(t('multiplayer.playerDisconnected', { name: data.nickname || t('multiplayer.aPlayer') }), 'warning');
    });

    // Handle player reconnection
    EigennamenClient.on('playerReconnected', (data: PlayerDisconnectedData) => {
        if (state.resyncInProgress) return;
        // Mark player as connected in local list
        if (data.playerId) {
            state.multiplayerPlayers = state.multiplayerPlayers.map((p: ServerPlayerData) =>
                p.playerId === data.playerId ? { ...p, connected: true } : p
            );
            updateMpIndicator({ code: EigennamenClient.getRoomCode() || '' }, state.multiplayerPlayers);
            // Update controls and board - clicker reconnecting restores normal behavior
            updateControls();
            renderBoard();
        }
        showToast(t('multiplayer.playerReconnected', { name: data.nickname || t('multiplayer.aPlayer') }), 'success');
    });
}
