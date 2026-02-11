// ========== MULTIPLAYER MODULE ==========
// Connection management, modal handling, and barrel re-exports
// Sub-modules: multiplayerUI.ts (UI), multiplayerSync.ts (state sync), multiplayerListeners.ts (events)
import { state } from './state.js';
import { safeGetItem, safeSetItem } from './utils.js';
import { showToast, openModal, closeModal } from './ui.js';
import { updateRoleBanner, updateControls } from './roles.js';
import { UI, validateNickname, validateRoomCode } from './constants.js';
import { logger } from './logger.js';
import { updateMpIndicator, updateRoomSettingsNavVisibility, updateRoomInfoDisplay, updateForfeitButton, copyRoomId } from './multiplayerUI.js';
import { syncLocalPlayerState, syncGameStateFromServer, resetMultiplayerState, getRoomCodeFromURL, updateURLWithRoomCode, clearRoomCodeFromURL } from './multiplayerSync.js';
import { setupMultiplayerListeners } from './multiplayerListeners.js';
// ========== BARREL RE-EXPORTS ==========
// Re-export sub-module functions so app.ts imports continue to work
export { copyRoomCode, updateRoomInfoDisplay, initPlayerListUI, initNicknameEditUI, confirmForfeit, closeForfeitConfirm, forfeitGame, closeKickConfirm, confirmKickPlayer, updateForfeitButton } from './multiplayerUI.js';
export { leaveMultiplayerMode, syncGameStateFromServer, syncLocalPlayerState, cleanupMultiplayerListeners, getRoomCodeFromURL, updateURLWithRoomCode, clearRoomCodeFromURL } from './multiplayerSync.js';
export { setupMultiplayerListeners } from './multiplayerListeners.js';
// ========== ABORT CONTROLLERS ==========
// Allows cancelling in-flight operations when user navigates away
let joinAbortController = null;
let createAbortController = null;
export function cancelJoinOperation() {
    if (joinAbortController) {
        joinAbortController.abort();
        joinAbortController = null;
    }
}
export function cancelCreateOperation() {
    if (createAbortController) {
        createAbortController.abort();
        createAbortController = null;
    }
}
export function cancelAllOperations() {
    cancelJoinOperation();
    cancelCreateOperation();
}
// ========== MODAL HANDLING ==========
export function openMultiplayer() {
    // Pre-fill nickname from storage
    const storedNickname = safeGetItem('codenames-nickname', '') ?? '';
    const joinNicknameEl = document.getElementById('join-nickname');
    if (joinNicknameEl)
        joinNicknameEl.value = storedNickname;
    const createNicknameEl = document.getElementById('create-nickname');
    if (createNicknameEl)
        createNicknameEl.value = storedNickname;
    // Reset forms
    document.getElementById('join-room-id').value = '';
    document.getElementById('create-room-id').value = '';
    setMpStatus('', '');
    clearFormErrors();
    // Reset to join mode
    setMpMode('join');
    openModal('multiplayer-modal');
}
export function closeMultiplayer() {
    cancelAllOperations();
    clearFormErrors();
    closeModal('multiplayer-modal');
}
export function setMpMode(mode) {
    state.currentMpMode = mode;
    // Update mode buttons
    document.querySelectorAll('.mode-btn').forEach((btn) => {
        const el = btn;
        el.classList.toggle('active', el.dataset.mode === mode);
    });
    // Show correct form
    document.getElementById('join-form').classList.toggle('active', mode === 'join');
    document.getElementById('create-form').classList.toggle('active', mode === 'create');
    // Update action button text
    const actionBtn = document.getElementById('btn-mp-action');
    actionBtn.textContent = mode === 'join' ? 'Join Game' : 'Create Game';
}
export function setMpStatus(message, type) {
    const statusEl = document.getElementById('mp-status');
    if (!statusEl)
        return;
    statusEl.textContent = message;
    statusEl.className = 'connection-status';
    if (type) {
        statusEl.classList.add(type);
    }
}
export function setFieldError(message, fieldId) {
    const errorEl = document.getElementById(fieldId);
    if (!errorEl)
        return;
    const formGroup = errorEl.closest('.form-group');
    errorEl.textContent = message;
    if (formGroup) {
        if (message) {
            formGroup.classList.add('error');
        }
        else {
            formGroup.classList.remove('error');
        }
    }
}
export function clearFormErrors() {
    ['join-error', 'join-nickname-error', 'create-error', 'create-nickname-error'].forEach(id => {
        setFieldError('', id);
    });
}
function setMpError(message) {
    setFieldError(message, state.currentMpMode === 'join' ? 'join-error' : 'create-error');
}
// ========== CONNECTION ACTIONS ==========
export async function handleMpAction() {
    const actionBtn = document.getElementById('btn-mp-action');
    if (!actionBtn)
        return;
    const originalText = actionBtn.textContent;
    actionBtn.disabled = true;
    actionBtn.textContent = state.currentMpMode === 'join' ? 'Joining...' : 'Creating...';
    actionBtn.classList.add('loading');
    try {
        if (state.currentMpMode === 'join') {
            await handleJoinGame();
        }
        else {
            await handleCreateGame();
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Connection failed';
        logger.error('Multiplayer action failed:', error);
        setMpStatus(message, 'error');
    }
    finally {
        actionBtn.disabled = false;
        actionBtn.textContent = originalText;
        actionBtn.classList.remove('loading');
    }
}
async function handleJoinGame() {
    clearFormErrors();
    const nickname = document.getElementById('join-nickname').value.trim();
    const roomIdInput = document.getElementById('join-room-id').value.trim();
    const urlRoomCode = getRoomCodeFromURL();
    const joinBtn = document.getElementById('btn-mp-action');
    const nicknameValidation = validateNickname(nickname);
    if (!nicknameValidation.valid) {
        setFieldError(nicknameValidation.error ?? '', 'join-nickname-error');
        return;
    }
    if (!/^[\p{L}\p{N}\s\-_]+$/u.test(nickname)) {
        setFieldError('Nickname can only contain letters, numbers, spaces, hyphens, and underscores', 'join-nickname-error');
        return;
    }
    // Use user input if provided, otherwise fall back to URL room code
    const roomId = roomIdInput || urlRoomCode;
    const roomValidation = validateRoomCode(roomId ?? '');
    if (!roomValidation.valid) {
        setFieldError(roomValidation.error ?? '', 'join-error');
        return;
    }
    cancelJoinOperation();
    joinAbortController = new AbortController();
    const signal = joinAbortController.signal;
    if (joinBtn)
        joinBtn.disabled = true;
    try {
        setMpStatus('Connecting...', 'connecting');
        if (!CodenamesClient.isConnected()) {
            await CodenamesClient.connect();
        }
        if (signal.aborted)
            return;
        setMpStatus('Joining game...', 'connecting');
        const normalizedRoomId = roomId.toLowerCase();
        const result = await CodenamesClient.joinRoom(normalizedRoomId, nickname);
        if (signal.aborted)
            return;
        state.currentRoomId = result.room?.code || normalizedRoomId;
        onMultiplayerJoined(result, false);
    }
    catch (error) {
        const err = error;
        if (err.name === 'AbortError' || signal.aborted)
            return;
        logger.error(`Join failed for room "${roomId}":`, error);
        if (err.code === 'ROOM_NOT_FOUND') {
            setMpStatus(`Room "${roomId}" not found - check the Room ID`, 'error');
            clearRoomCodeFromURL();
        }
        else if (err.code === 'ROOM_FULL') {
            setMpStatus('Room is full', 'error');
        }
        else if (err.code === 'INVALID_INPUT') {
            setMpStatus(err.message || 'Invalid input - check Room ID and nickname', 'error');
        }
        else if (err.message?.includes('connect')) {
            setMpStatus('Could not connect to server - check your connection and try again', 'error');
        }
        else {
            setMpStatus(err.message || 'Failed to join game - please try again', 'error');
        }
    }
    finally {
        if (joinBtn)
            joinBtn.disabled = false;
        joinAbortController = null;
    }
}
async function handleCreateGame() {
    clearFormErrors();
    const nickname = document.getElementById('create-nickname').value.trim();
    const roomId = document.getElementById('create-room-id').value.trim();
    const createBtn = document.getElementById('btn-mp-action');
    const nicknameValidation = validateNickname(nickname);
    if (!nicknameValidation.valid) {
        setFieldError(nicknameValidation.error ?? '', 'create-nickname-error');
        return;
    }
    if (!/^[\p{L}\p{N}\s\-_]+$/u.test(nickname)) {
        setFieldError('Nickname can only contain letters, numbers, spaces, hyphens, and underscores', 'create-nickname-error');
        return;
    }
    const roomValidation = validateRoomCode(roomId);
    if (!roomValidation.valid) {
        setFieldError(roomValidation.error ?? '', 'create-error');
        return;
    }
    cancelCreateOperation();
    createAbortController = new AbortController();
    const signal = createAbortController.signal;
    if (createBtn)
        createBtn.disabled = true;
    try {
        setMpStatus('Creating game...', 'connecting');
        if (!CodenamesClient.isConnected()) {
            await CodenamesClient.connect();
        }
        if (signal.aborted)
            return;
        const normalizedRoomId = roomId.toLowerCase();
        const result = await CodenamesClient.createRoom({
            roomId: normalizedRoomId,
            nickname: nickname
        });
        if (signal.aborted)
            return;
        state.currentRoomId = result.room?.code || normalizedRoomId;
        onMultiplayerJoined(result, true);
    }
    catch (error) {
        const err = error;
        if (err.name === 'AbortError' || signal.aborted)
            return;
        logger.error('Create failed:', error);
        if (err.code === 'ROOM_ALREADY_EXISTS') {
            setMpStatus('A room with this ID already exists. Try a different Room ID.', 'error');
        }
        else if (err.message?.includes('connect')) {
            setMpStatus('Could not connect to server - check your connection and try again', 'error');
        }
        else {
            setMpStatus(err.message || 'Failed to create game - please try again', 'error');
        }
    }
    finally {
        if (createBtn)
            createBtn.disabled = false;
        createAbortController = null;
    }
}
// ========== POST-JOIN SETUP ==========
export function onMultiplayerJoined(result, isHostParam = false) {
    // Detect room change and reset stale state
    const newRoomCode = result.room?.code;
    if (state.currentRoomId && newRoomCode && state.currentRoomId !== newRoomCode) {
        resetMultiplayerState();
    }
    state.isMultiplayerMode = true;
    safeSetItem('codenames-nickname', CodenamesClient.player?.nickname || '');
    // Set up multiplayer event listeners FIRST to avoid race condition
    // where game:started arrives before listeners are ready
    if (!state.multiplayerListenersSetup) {
        setupMultiplayerListeners();
        state.multiplayerListenersSetup = true;
    }
    // Store players list
    state.multiplayerPlayers = result.players || (result.player ? [result.player] : []);
    // Sync current player's team and role from server
    const currentPlayer = result.you || result.player || CodenamesClient.player || undefined;
    if (currentPlayer) {
        syncLocalPlayerState(currentPlayer);
    }
    // Update global isHost from parameter or player data
    state.isHost = isHostParam || CodenamesClient.player?.isHost || false;
    // Sync game state from server if available
    if (result.game) {
        syncGameStateFromServer(result.game);
    }
    // Update URL with room code for shareable links
    if (result.room?.code) {
        updateURLWithRoomCode(result.room.code);
    }
    // Update UI
    setMpStatus('Connected!', 'success');
    updateMpIndicator(result.room || null, state.multiplayerPlayers);
    updateRoomSettingsNavVisibility();
    updateRoomInfoDisplay();
    updateControls();
    updateRoleBanner();
    updateForfeitButton();
    // Close modal after brief delay and show appropriate message
    setTimeout(() => {
        closeMultiplayer();
        if (state.isHost && state.currentRoomId) {
            showToast(`Game created! Share Room ID: ${state.currentRoomId}`, 'success', 8000);
        }
        else {
            showToast('Connected to multiplayer game!', 'success');
        }
    }, UI.MP_JOIN_CLOSE_DELAY_MS);
}
// ========== MODAL INITIALIZATION ==========
export function initMultiplayerModal() {
    // Mode toggle buttons
    document.querySelectorAll('.mode-btn').forEach((btn) => {
        const el = btn;
        el.addEventListener('click', () => setMpMode(el.dataset.mode || 'join'));
    });
    // Action button
    document.getElementById('btn-mp-action').addEventListener('click', handleMpAction);
    // Enter key submits
    ['join-nickname', 'join-room-id', 'create-nickname', 'create-room-id'].forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter')
                    handleMpAction();
            });
        }
    });
    // Copy Room ID button
    const copyBtn = document.getElementById('btn-copy-room-id');
    if (copyBtn) {
        copyBtn.addEventListener('click', copyRoomId);
    }
    // Check for room code in URL after modal is initialized
    setTimeout(checkURLForRoomJoin, 100);
}
export function checkURLForRoomJoin() {
    const roomCode = getRoomCodeFromURL();
    const roomValidation = validateRoomCode(roomCode ?? '');
    if (roomCode && roomValidation.valid) {
        // Pre-fill nickname from storage
        const storedNickname = safeGetItem('codenames-nickname', '') ?? '';
        const joinNicknameInput = document.getElementById('join-nickname');
        if (joinNicknameInput)
            joinNicknameInput.value = storedNickname;
        // Pre-fill room ID from URL
        const joinRoomInput = document.getElementById('join-room-id');
        if (joinRoomInput)
            joinRoomInput.value = roomCode;
        // Show multiplayer modal in join mode
        setMpMode('join');
        openModal('multiplayer-modal');
        setMpStatus(`Room ID: ${roomCode} - Enter your nickname to join`, 'info');
    }
}
//# sourceMappingURL=multiplayer.js.map