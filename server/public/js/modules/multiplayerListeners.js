// ========== MULTIPLAYER LISTENERS ==========
// Socket event listener setup for multiplayer mode
import { state } from './state.js';
import { showToast, announceToScreenReader } from './ui.js';
import { renderBoard } from './board.js';
import { revealCardFromServer, showGameOver, updateTurnIndicator } from './game.js';
import { updateRoleBanner, updateControls, clearRoleChange, revertAndClearRoleChange } from './roles.js';
import { handleTimerStarted, handleTimerStopped, handleTimerStatus } from './timer.js';
import { playNotificationSound, setTabNotification, checkAndNotifyTurn } from './notifications.js';
import { logger } from './logger.js';
import { handleChatMessage } from './chat.js';
import { updateMpIndicator, updateDuetUI, updateDuetInfoBar, updateForfeitButton, updateSpectatorCount, updateRoomStats, handleSpectatorChatMessage, updateRoomSettingsNavVisibility, showReconnectionOverlay, hideReconnectionOverlay, syncGameModeUI } from './multiplayerUI.js';
import { syncGameStateFromServer, syncLocalPlayerState, leaveMultiplayerMode, detectOfflineChanges, domListenerCleanup } from './multiplayerSync.js';
/**
 * Map server error codes to user-friendly messages
 */
function getErrorMessage(error) {
    const code = error.code || '';
    const message = error.message || '';
    // Common error code mappings
    const errorMessages = {
        'RATE_LIMITED': 'Please wait a moment before trying again',
        'NOT_YOUR_TURN': "It's not your team's turn",
        'NOT_CLICKER': 'Only the team clicker can reveal cards',
        'NOT_SPYMASTER': 'Only the spymaster can give clues',
        'GAME_NOT_STARTED': 'Wait for the host to start the game',
        'GAME_OVER': 'The game has ended - start a new game',
        'CARD_ALREADY_REVEALED': 'That card has already been revealed',
        'TEAM_WOULD_BE_EMPTY': 'Cannot leave - your team needs at least one player',
        'CANNOT_SWITCH_TEAM_DURING_TURN': 'Cannot switch teams during your active turn',
        'CANNOT_CHANGE_ROLE_DURING_TURN': 'Cannot change roles during your active turn',
        'SPYMASTER_CANNOT_CHANGE_TEAM': 'Spymasters cannot change teams during an active game',
        'MUST_JOIN_TEAM': 'Join a team first before selecting a role',
        'ROLE_TAKEN': 'That role is already taken by another player',
        'ROOM_NOT_FOUND': 'Room not found - it may have been closed',
        'PLAYER_NOT_FOUND': 'Session expired - please rejoin the room',
        'INVALID_INPUT': 'Invalid request - please try again',
        'SERVER_ERROR': 'Server error - please try again'
    };
    // Check for exact code match first
    if (errorMessages[code]) {
        return errorMessages[code];
    }
    // Check for partial matches in message
    if (message.toLowerCase().includes('rate limit')) {
        return errorMessages['RATE_LIMITED'];
    }
    if (message.toLowerCase().includes('not your turn')) {
        return errorMessages['NOT_YOUR_TURN'];
    }
    if (message.toLowerCase().includes('must join a team')) {
        return 'Join a team first before selecting a role';
    }
    if (message.toLowerCase().includes('already has a')) {
        return 'That role is already taken on your team';
    }
    if (message.toLowerCase().includes('another player is becoming')) {
        return 'Someone else is selecting that role - please wait';
    }
    // Return original message if no mapping found
    return message || 'An error occurred - please try again';
}
export function setupMultiplayerListeners() {
    // Game state updates
    CodenamesClient.on('gameStarted', (data) => {
        // Clear loading state on new game button
        const newGameBtn = document.getElementById('btn-new-game');
        if (newGameBtn) {
            newGameBtn.disabled = false;
            newGameBtn.classList.remove('loading');
        }
        // Full sync game state from server for new games
        if (data.game) {
            syncGameStateFromServer(data.game);
            state.gameMode = data.gameMode || 'classic';
            updateDuetUI(data.game);
            updateForfeitButton();
            const modeLabels = { blitz: 'Blitz game started!', duet: 'Duet game started!', classic: 'New game started!' };
            showToast(modeLabels[data.gameMode || 'classic'] || 'New game started!', 'success');
        }
    });
    CodenamesClient.on('cardRevealed', (data) => {
        // Clear per-card reveal tracking for the revealed card
        if (data.index !== undefined) {
            state.revealingCards.delete(data.index);
            const revealTimeout = state.revealTimeouts.get(data.index);
            if (revealTimeout) {
                clearTimeout(revealTimeout);
                state.revealTimeouts.delete(data.index);
            }
        }
        state.isRevealingCard = state.revealingCards.size > 0;
        // Remove pending visual state from the revealed card
        if (data.index !== undefined) {
            const card = document.querySelector(`.card[data-index="${data.index}"]`);
            if (card)
                card.classList.remove('revealing');
        }
        if (data.index !== undefined) {
            revealCardFromServer(data.index, data);
            playNotificationSound('reveal');
            // Announce card reveal to screen readers
            const word = data.word || (state.gameState.words && state.gameState.words[data.index]) || '';
            const type = data.type || '';
            if (word) {
                announceToScreenReader(`Card revealed: ${word}. ${type} card.`);
            }
        }
        // Update Duet info if present
        if (data.timerTokens !== undefined || data.greenFound !== undefined) {
            updateDuetInfoBar(data.greenFound || 0, data.timerTokens);
        }
    });
    CodenamesClient.on('turnEnded', (data) => {
        if (data.currentTurn) {
            const previousTurn = state.gameState.currentTurn;
            // Update turn locally
            state.gameState.currentTurn = data.currentTurn;
            // Reset clue and guess state for new turn
            state.gameState.currentClue = null;
            state.gameState.guessesUsed = 0;
            state.gameState.guessesAllowed = 0;
            updateTurnIndicator();
            updateRoleBanner();
            updateControls();
            // Check and send notifications if it's now our turn
            checkAndNotifyTurn(data.currentTurn, previousTurn);
            // Announce turn change
            const newTeamName = data.currentTurn === 'red' ? state.teamNames.red : state.teamNames.blue;
            announceToScreenReader(`Turn ended. Now ${newTeamName}'s turn.`);
        }
    });
    CodenamesClient.on('gameOver', (data) => {
        // Duet mode can have null winner (cooperative loss)
        if (data.winner || state.gameMode === 'duet') {
            // Sync all card types from server so non-spymasters can see the full board
            if (data.types && Array.isArray(data.types)) {
                state.gameState.types = data.types;
            }
            if (data.duetTypes && Array.isArray(data.duetTypes)) {
                state.gameState.duetTypes = data.duetTypes;
            }
            state.gameState.gameOver = true;
            state.gameState.winner = data.winner || null;
            if (state.gameMode === 'duet') {
                const duetWin = data.reason === 'completed';
                showGameOver(duetWin ? 'red' : null, data.reason);
            }
            else {
                showGameOver(data.winner || null, data.reason);
            }
            setTabNotification(false);
            playNotificationSound('gameOver');
            updateForfeitButton();
        }
    });
    // Handle clue given by spymaster
    CodenamesClient.on('clueGiven', (data) => {
        if (data.word && data.number !== undefined) {
            // Store current clue in game state for tracking guesses
            state.gameState.currentClue = {
                word: data.word,
                number: data.number,
                team: data.team || '',
                spymaster: data.spymaster,
                guessesAllowed: data.guessesAllowed
            };
            state.gameState.guessesUsed = 0;
            // Show clue as toast notification (visible for 5 seconds)
            const teamName = data.team === 'red' ? state.teamNames.red : state.teamNames.blue;
            showToast(`${teamName} clue: ${data.word} (${data.number})`, 'info', 5000);
            announceToScreenReader(`${teamName} spymaster gives clue: ${data.word}, ${data.number}`);
        }
    });
    // Handle spymaster view (card types for spymasters)
    CodenamesClient.on('spymasterView', (data) => {
        if (data.types && Array.isArray(data.types)) {
            state.gameState.types = data.types;
            renderBoard();
        }
    });
    // Player updates
    CodenamesClient.on('playerJoined', (data) => {
        if (data.players) {
            state.multiplayerPlayers = data.players;
        }
        else if (data.player) {
            // Add new player to list if not already present
            const exists = state.multiplayerPlayers.some((p) => p.sessionId === data.player.sessionId);
            if (!exists) {
                state.multiplayerPlayers = [...state.multiplayerPlayers, data.player];
            }
        }
        updateMpIndicator({ code: CodenamesClient.getRoomCode() || '' }, state.multiplayerPlayers);
        showToast(`${data.player?.nickname || 'Someone'} joined`, 'success');
        playNotificationSound('join');
    });
    CodenamesClient.on('playerLeft', (data) => {
        if (data.players) {
            state.multiplayerPlayers = data.players;
        }
        else if (data.sessionId) {
            // Remove player from list
            state.multiplayerPlayers = state.multiplayerPlayers.filter((p) => p.sessionId !== data.sessionId);
        }
        updateMpIndicator({ code: CodenamesClient.getRoomCode() || '' }, state.multiplayerPlayers);
        if (data.nickname) {
            showToast(`${data.nickname} left`, 'info');
        }
    });
    // Handle player state updates (role, team, nickname changes)
    CodenamesClient.on('playerUpdated', (data) => {
        if (data.sessionId && data.changes) {
            // Update player in local list
            state.multiplayerPlayers = state.multiplayerPlayers.map((p) => p.sessionId === data.sessionId ? { ...p, ...data.changes } : p);
            updateMpIndicator({ code: CodenamesClient.getRoomCode() || '' }, state.multiplayerPlayers);
            // Announce role/team changes to screen readers
            if (data.changes.role || data.changes.team !== undefined) {
                const changedPlayer = state.multiplayerPlayers.find((p) => p.sessionId === data.sessionId);
                const name = changedPlayer?.nickname || 'A player';
                if (data.changes.role) {
                    announceToScreenReader(`${name} is now ${data.changes.role}.`);
                }
                if (data.changes.team !== undefined) {
                    const teamName = data.changes.team
                        ? (data.changes.team === 'red' ? (state.teamNames?.red || 'Red') : (state.teamNames?.blue || 'Blue'))
                        : 'spectators';
                    announceToScreenReader(`${name} joined ${teamName}.`);
                }
            }
            // If this is the current player, update local state variables
            if (data.sessionId === CodenamesClient.player?.sessionId) {
                let updatedPlayer = state.multiplayerPlayers.find((p) => p.sessionId === data.sessionId);
                // Bug #8 fix: If player not in list, construct from changes and CodenamesClient.player
                if (!updatedPlayer) {
                    const basePlayer = CodenamesClient.player || {};
                    updatedPlayer = { ...basePlayer, ...data.changes };
                    if (updatedPlayer.sessionId) {
                        state.multiplayerPlayers = [...state.multiplayerPlayers, updatedPlayer];
                        updateMpIndicator({ code: CodenamesClient.getRoomCode() || '' }, state.multiplayerPlayers);
                    }
                }
                if (updatedPlayer) {
                    // Determine if this update confirms the in-flight role change operation.
                    // During a role change, skip syncLocalPlayerState for unrelated updates
                    // to avoid overwriting optimistic UI state (race condition fix).
                    const rc = state.roleChange;
                    const isConfirmingUpdate = rc.phase !== 'idle' && ((rc.phase === 'changing_team' && data.changes.team !== undefined) ||
                        (rc.phase === 'changing_role' && data.changes.role !== undefined) ||
                        (rc.phase === 'team_then_role' && data.changes.team !== undefined));
                    if (rc.phase === 'idle' || isConfirmingUpdate) {
                        syncLocalPlayerState(updatedPlayer);
                    }
                    // Check for pending role change after team change completed
                    if (rc.phase === 'team_then_role' && data.changes.team) {
                        // Team change completed, now send the queued role change
                        const roleToSet = rc.pendingRole;
                        const currentOpId = rc.operationId;
                        // Narrow revert: team change succeeded, only revert role on failure
                        const confirmedTeam = updatedPlayer.team;
                        state.roleChange = {
                            phase: 'changing_role',
                            target: rc.target,
                            operationId: currentOpId,
                            revertFn: () => {
                                state.playerTeam = confirmedTeam;
                                state.spymasterTeam = null;
                                state.clickerTeam = null;
                                updateRoleBanner();
                                updateControls();
                                renderBoard();
                            }
                        };
                        CodenamesClient.setRole(roleToSet);
                    }
                    else if (isConfirmingUpdate || rc.phase === 'idle') {
                        clearRoleChange();
                    }
                    // If role change in progress but not confirmed by this update,
                    // leave state machine alone — ack callback handles success/failure
                    updateControls();
                    updateRoleBanner();
                    renderBoard();
                }
                else {
                    // Even if player not found, clear role change to prevent blocking
                    logger.warn('playerUpdated: current player not found in list, clearing role change state');
                    clearRoleChange();
                }
            }
        }
    });
    // Handle player disconnection (network issues)
    CodenamesClient.on('playerDisconnected', (data) => {
        // Mark player as disconnected in local list
        if (data.sessionId) {
            state.multiplayerPlayers = state.multiplayerPlayers.map((p) => p.sessionId === data.sessionId ? { ...p, connected: false } : p);
            updateMpIndicator({ code: CodenamesClient.getRoomCode() || '' }, state.multiplayerPlayers);
            // Update controls and board - clicker disconnecting enables other team members
            updateControls();
            renderBoard();
        }
        showToast(`${data.nickname || 'A player'} disconnected`, 'warning');
    });
    // Handle player reconnection
    CodenamesClient.on('playerReconnected', (data) => {
        // Mark player as connected in local list
        if (data.sessionId) {
            state.multiplayerPlayers = state.multiplayerPlayers.map((p) => p.sessionId === data.sessionId ? { ...p, connected: true } : p);
            updateMpIndicator({ code: CodenamesClient.getRoomCode() || '' }, state.multiplayerPlayers);
            // Update controls and board - clicker reconnecting restores normal behavior
            updateControls();
            renderBoard();
        }
        showToast(`${data.nickname || 'A player'} reconnected`, 'success');
    });
    // Handle host change (when previous host disconnects)
    CodenamesClient.on('hostChanged', (data) => {
        // Update global isHost based on whether we became the new host
        const wasHost = state.isHost;
        state.isHost = data.newHostSessionId === CodenamesClient.player?.sessionId;
        // Update host status in players list
        if (data.newHostSessionId) {
            state.multiplayerPlayers = state.multiplayerPlayers.map((p) => ({
                ...p,
                isHost: p.sessionId === data.newHostSessionId
            }));
            updateMpIndicator({ code: CodenamesClient.getRoomCode() || '' }, state.multiplayerPlayers);
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
    // Timer events (for turn timers when enabled)
    CodenamesClient.on('timerStatus', (data) => {
        handleTimerStatus(data);
    });
    CodenamesClient.on('timerStarted', (data) => {
        handleTimerStarted(data);
    });
    CodenamesClient.on('timerStopped', (_data) => {
        handleTimerStopped();
    });
    CodenamesClient.on('timerExpired', (_data) => {
        handleTimerStopped();
        showToast('Turn time expired!', 'warning');
    });
    // Room warnings (non-fatal issues like stale stats)
    CodenamesClient.on('roomWarning', (data) => {
        if (data.code === 'STATS_STALE') {
            // Auto-request resync to get fresh data
            CodenamesClient.requestResync().catch(() => {
                // Resync failed, stats may remain stale - not critical
                logger.warn('Auto-resync after stale stats warning failed');
            });
        }
    });
    // Room resync (state recovery)
    CodenamesClient.on('roomResynced', (data) => {
        // Sync current player's state from server response
        const currentPlayer = data.you || CodenamesClient.player;
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
    });
    // Disconnect handling
    CodenamesClient.on('disconnected', () => {
        clearRoleChange();
        showToast('Disconnected from server', 'warning');
        // Show reconnection overlay if we were in a room
        if (state.isMultiplayerMode) {
            showReconnectionOverlay();
        }
    });
    // Show reconnection overlay when auto-rejoin is being attempted
    CodenamesClient.on('rejoining', () => {
        showReconnectionOverlay();
    });
    // Shared reconnection handler (used by both auto-rejoin and token-based reconnection)
    function handleReconnection(data) {
        hideReconnectionOverlay();
        const changes = detectOfflineChanges(data);
        const currentPlayer = data?.you || CodenamesClient.player;
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
    CodenamesClient.on('rejoined', handleReconnection);
    CodenamesClient.on('roomReconnected', handleReconnection);
    CodenamesClient.on('rejoinFailed', (data) => {
        // Hide reconnection overlay
        hideReconnectionOverlay();
        if (data.error?.code === 'ROOM_NOT_FOUND') {
            showToast('Previous game no longer exists', 'warning');
        }
        else {
            showToast('Could not rejoin previous game', 'warning');
        }
        // Reset multiplayer state properly
        leaveMultiplayerMode();
    });
    // Handle being kicked from the room
    CodenamesClient.on('kicked', (data) => {
        leaveMultiplayerMode();
        showToast(data.reason || 'You were kicked from the room', 'error', 5000);
    });
    // Handle another player being kicked
    CodenamesClient.on('playerKicked', (data) => {
        // Update player list
        state.multiplayerPlayers = state.multiplayerPlayers.filter((p) => p.sessionId !== data.sessionId);
        updateMpIndicator({ code: CodenamesClient.getRoomCode() || '' }, state.multiplayerPlayers);
        showToast(`${data.nickname} was kicked by the host`, 'info');
    });
    // Game history events
    CodenamesClient.on('historyResult', (data) => {
        // Import dynamically to avoid circular dependency
        import('./history.js').then(({ renderGameHistory }) => {
            renderGameHistory(data.games || []);
        }).catch((err) => {
            logger.error('Failed to load history module:', err);
            showToast('Could not load game history', 'error');
        });
    });
    CodenamesClient.on('replayData', (data) => {
        import('./history.js').then(({ renderReplayData }) => {
            renderReplayData(data);
        }).catch((err) => {
            logger.error('Failed to load history module:', err);
            showToast('Could not load replay data', 'error');
        });
    });
    // Error handling for game actions
    CodenamesClient.on('error', (error) => {
        // Log full error details for debugging
        logger.error('Multiplayer error:', JSON.stringify(error, null, 2));
        // Revert optimistic UI then clear role change state
        revertAndClearRoleChange();
        // Clear any in-progress card reveal flags
        state.revealingCards.clear();
        state.isRevealingCard = false;
        document.querySelectorAll('.card.revealing').forEach(c => c.classList.remove('revealing'));
        // Map technical error codes to user-friendly messages
        showToast(getErrorMessage(error), 'error');
    });
    // Handle room settings updates
    CodenamesClient.on('settingsUpdated', (data) => {
        if (data.settings) {
            // Update room info display
            updateRoomSettingsNavVisibility();
            // Sync game mode radio buttons
            if (data.settings.gameMode) {
                syncGameModeUI(data.settings.gameMode);
            }
            // Update multiplayer indicator
            updateMpIndicator({ code: CodenamesClient.getRoomCode() || '' }, state.multiplayerPlayers);
            showToast('Room settings updated', 'info');
        }
    });
    // Game mode radio button change handler — track for cleanup
    const gameModeRadios = document.querySelectorAll('input[name="gameMode"]');
    gameModeRadios.forEach(radio => {
        const handler = (e) => {
            if (!CodenamesClient?.player?.isHost)
                return;
            const gameMode = e.target.value;
            CodenamesClient.updateSettings({ gameMode });
        };
        radio.addEventListener('change', handler);
        domListenerCleanup.push({ element: radio, event: 'change', handler });
    });
    // Handle room stats updates (spectator count, team counts)
    CodenamesClient.on('statsUpdated', (data) => {
        if (data.stats) {
            updateSpectatorCount(data.stats.spectatorCount || 0);
            updateRoomStats(data.stats);
        }
    });
    // D-1: Handle chat messages
    CodenamesClient.on('chatMessage', (data) => {
        handleChatMessage(data);
    });
    // Handle spectator chat messages
    CodenamesClient.on('spectatorChatMessage', (data) => {
        handleSpectatorChatMessage(data);
    });
}
//# sourceMappingURL=multiplayerListeners.js.map