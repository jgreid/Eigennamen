import { state } from '../state.js';
import { showToast } from '../ui.js';
import { updateRoleBanner, updateControls, revertAndClearRoleChange } from '../roles.js';
import { renderBoard } from '../board.js';
import { logger } from '../logger.js';
import { updateMpIndicator, updateForfeitButton, updateRoomSettingsNavVisibility, showReconnectionOverlay, hideReconnectionOverlay, syncGameModeUI } from '../multiplayerUI.js';
import { syncGameStateFromServer, syncLocalPlayerState, leaveMultiplayerMode, detectOfflineChanges, domListenerCleanup } from '../multiplayerSync.js';
import { updateSpectatorCount, updateRoomStats } from '../multiplayerUI.js';
import { getClient } from '../clientAccessor.js';
export function registerRoomHandlers() {
    // Handle host change (when previous host disconnects)
    EigennamenClient.on('hostChanged', (data) => {
        // Update global isHost based on whether we became the new host
        const wasHost = state.isHost;
        state.isHost = data.newHostSessionId === EigennamenClient.player?.sessionId;
        // Update host status in players list
        if (data.newHostSessionId) {
            state.multiplayerPlayers = state.multiplayerPlayers.map((p) => ({
                ...p,
                isHost: p.sessionId === data.newHostSessionId
            }));
            updateMpIndicator({ code: EigennamenClient.getRoomCode() || '' }, state.multiplayerPlayers);
        }
        // Update UI elements that depend on host status
        updateRoomSettingsNavVisibility();
        updateRoleBanner();
        updateForfeitButton();
        if (state.isHost && !wasHost) {
            showToast('You are now the host!', 'info');
        }
        else if (data.newHostNickname) {
            showToast(`${data.newHostNickname} is now the host`, 'info');
        }
    });
    // Room warnings (non-fatal issues like stale stats)
    EigennamenClient.on('roomWarning', (data) => {
        if (data.code === 'STATS_STALE') {
            // Auto-request resync to get fresh data
            EigennamenClient.requestResync().catch(() => {
                // Resync failed, stats may remain stale - not critical
                logger.warn('Auto-resync after stale stats warning failed');
            });
        }
    });
    // Room resync (state recovery)
    EigennamenClient.on('roomResynced', (data) => {
        // Guard: prevent individual update events from interleaving with
        // a full resync, which replaces all state atomically.
        state.resyncInProgress = true;
        try {
            // Sync current player's state from server response
            const currentPlayer = data.you || EigennamenClient.player;
            if (currentPlayer) {
                syncLocalPlayerState(currentPlayer);
            }
            if (data.game) {
                syncGameStateFromServer(data.game);
            }
            if (data.players) {
                state.multiplayerPlayers = data.players;
                updateMpIndicator(data.room || null, state.multiplayerPlayers);
            }
            // Update all UI elements
            updateControls();
            updateRoleBanner();
        }
        finally {
            state.resyncInProgress = false;
        }
    });
    // Disconnect handling
    EigennamenClient.on('disconnected', () => {
        // Use revertAndClearRoleChange (not clearRoleChange) so that buttons
        // are reverted from 'loading' state back to their previous DOM state.
        revertAndClearRoleChange();
        showToast('Disconnected from server', 'warning');
        // Show reconnection overlay if we were in a room
        if (state.isMultiplayerMode) {
            showReconnectionOverlay();
        }
    });
    // Show reconnection overlay when auto-rejoin is being attempted
    EigennamenClient.on('rejoining', () => {
        showReconnectionOverlay();
    });
    // Shared reconnection handler (used by both auto-rejoin and token-based reconnection)
    function handleReconnection(data) {
        hideReconnectionOverlay();
        // Guard: full state replacement — defer individual update events
        state.resyncInProgress = true;
        try {
            const changes = detectOfflineChanges(data);
            const currentPlayer = data?.you || EigennamenClient.player;
            if (currentPlayer) {
                syncLocalPlayerState(currentPlayer);
            }
            if (data?.game) {
                syncGameStateFromServer(data.game);
            }
            if (data?.players) {
                state.multiplayerPlayers = data.players;
                updateMpIndicator(data?.room || null, state.multiplayerPlayers);
            }
            updateControls();
            updateRoleBanner();
            updateForfeitButton();
            if (changes.length > 0) {
                showToast('Reconnected! ' + changes.join('. '), 'info', 6000);
            }
            else {
                showToast('Reconnected!', 'success');
            }
        }
        finally {
            state.resyncInProgress = false;
        }
    }
    EigennamenClient.on('rejoined', handleReconnection);
    EigennamenClient.on('roomReconnected', handleReconnection);
    EigennamenClient.on('rejoinFailed', (data) => {
        // Hide reconnection overlay
        hideReconnectionOverlay();
        if (data.error?.code === 'ROOM_NOT_FOUND') {
            showToast('Previous game no longer exists', 'warning');
        }
        else {
            showToast('Could not rejoin previous game', 'warning');
        }
        // Reset multiplayer state properly — wrapped in try/catch so that
        // if any part of cleanup throws, the UI is never left stuck in
        // multiplayer mode with a dead room code.
        try {
            leaveMultiplayerMode();
        }
        catch (e) {
            logger.error('leaveMultiplayerMode threw during rejoinFailed:', e);
            // Ensure critical state is always reset even if cleanup fails
            state.isMultiplayerMode = false;
            state.currentRoomId = null;
            state.multiplayerListenersSetup = false;
            state.multiplayerPlayers = [];
        }
    });
    // Handle being kicked from the room
    EigennamenClient.on('kicked', (data) => {
        leaveMultiplayerMode();
        showToast(data.reason || 'You were kicked from the room', 'error', 5000);
    });
    // Handle another player being kicked
    EigennamenClient.on('playerKicked', (data) => {
        // Update player list
        state.multiplayerPlayers = state.multiplayerPlayers.filter((p) => p.sessionId !== data.sessionId);
        updateMpIndicator({ code: EigennamenClient.getRoomCode() || '' }, state.multiplayerPlayers);
        // Refresh controls and board — kicked player may have held the active
        // clicker role, so remaining team members need UI updated for fallback.
        updateControls();
        renderBoard();
        showToast(`${data.nickname} was kicked by the host`, 'info');
    });
    // Handle room settings updates
    EigennamenClient.on('settingsUpdated', (data) => {
        if (data.settings) {
            // Update room info display
            updateRoomSettingsNavVisibility();
            // Sync game mode radio buttons
            if (data.settings.gameMode) {
                syncGameModeUI(data.settings.gameMode);
            }
            // Update multiplayer indicator
            updateMpIndicator({ code: EigennamenClient.getRoomCode() || '' }, state.multiplayerPlayers);
            showToast('Room settings updated', 'info');
        }
    });
    // Game mode radio button change handler — track for cleanup
    const gameModeRadios = document.querySelectorAll('input[name="gameMode"]');
    gameModeRadios.forEach(radio => {
        const handler = (e) => {
            if (!getClient()?.player?.isHost)
                return;
            const gameMode = e.target.value;
            EigennamenClient.updateSettings({ gameMode });
        };
        radio.addEventListener('change', handler);
        domListenerCleanup.push({ element: radio, event: 'change', handler });
    });
    // Handle room stats updates (spectator count, team counts)
    EigennamenClient.on('statsUpdated', (data) => {
        if (data.stats) {
            updateSpectatorCount(data.stats.spectatorCount || 0);
            updateRoomStats(data.stats);
        }
    });
}
//# sourceMappingURL=roomEventHandlers.js.map