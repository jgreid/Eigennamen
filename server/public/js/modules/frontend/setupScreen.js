/**
 * Game Setup Screen — "Quickstart" landing page.
 *
 * Shown on initial load. Displays a 5×5 board-like grid with
 * action cards for Host, Join, and Solo. Clicking an action card
 * reveals a form to configure and start the game.
 */
import { state } from './state.js';
import { validateNickname, validateRoomCode } from './constants.js';
import { safeGetItem, safeSetItem } from './utils.js';
import { logger } from './logger.js';
import { setupMultiplayerListeners } from './multiplayerListeners.js';
import { onMultiplayerJoined } from './multiplayer.js';
import { getRoomCodeFromURL } from './multiplayerSync.js';
import { loadGameFromURL } from './game.js';
import { isClientConnected } from './clientAccessor.js';
/** Check whether the setup screen should be shown on load. */
export function shouldShowSetupScreen() {
    // Skip if there's a game encoded in the URL (standalone mode)
    const params = new URLSearchParams(window.location.search);
    if (params.has('game') || params.has('r') || params.has('t') || params.has('w')) {
        return false;
    }
    // Skip if there's a room code in the URL (direct join link)
    if (getRoomCodeFromURL()) {
        return false;
    }
    // Skip if there's a replay link
    if (params.has('replay')) {
        return false;
    }
    return true;
}
/** Show the setup screen and hide the app layout. */
export function showSetupScreen() {
    const setupScreen = document.getElementById('setup-screen');
    const appLayout = document.getElementById('app-layout');
    if (setupScreen)
        setupScreen.hidden = false;
    if (appLayout)
        appLayout.hidden = true;
    // Pre-fill nickname from storage
    const storedNickname = safeGetItem('eigennamen-nickname', '') ?? '';
    const joinNick = document.getElementById('setup-join-nickname');
    const hostNick = document.getElementById('setup-host-nickname');
    if (joinNick)
        joinNick.value = storedNickname;
    if (hostNick)
        hostNick.value = storedNickname;
}
/** Hide the setup screen and show the app layout. */
export function hideSetupScreen() {
    const setupScreen = document.getElementById('setup-screen');
    const appLayout = document.getElementById('app-layout');
    if (setupScreen)
        setupScreen.hidden = true;
    if (appLayout)
        appLayout.hidden = false;
}
/** Show the board grid and hide all forms. */
function showBoard() {
    const board = document.getElementById('setup-board');
    const joinForm = document.getElementById('setup-join-form');
    const hostForm = document.getElementById('setup-host-form');
    if (board)
        board.hidden = false;
    if (joinForm)
        joinForm.hidden = true;
    if (hostForm)
        hostForm.hidden = true;
    clearAllErrors();
}
/** Show the join form and hide the board grid. */
function showJoinForm() {
    const board = document.getElementById('setup-board');
    const joinForm = document.getElementById('setup-join-form');
    const hostForm = document.getElementById('setup-host-form');
    if (board)
        board.hidden = true;
    if (joinForm)
        joinForm.hidden = false;
    if (hostForm)
        hostForm.hidden = true;
    clearAllErrors();
    // Focus nickname input
    const nickInput = document.getElementById('setup-join-nickname');
    if (nickInput)
        setTimeout(() => nickInput.focus(), 50);
}
/** Show the host form and hide the board grid. */
function showHostForm() {
    const board = document.getElementById('setup-board');
    const joinForm = document.getElementById('setup-join-form');
    const hostForm = document.getElementById('setup-host-form');
    if (board)
        board.hidden = true;
    if (joinForm)
        joinForm.hidden = true;
    if (hostForm)
        hostForm.hidden = false;
    clearAllErrors();
    // Focus nickname input
    const nickInput = document.getElementById('setup-host-nickname');
    if (nickInput)
        setTimeout(() => nickInput.focus(), 50);
}
function clearAllErrors() {
    const errorIds = ['setup-join-nickname-error', 'setup-join-error', 'setup-host-nickname-error', 'setup-host-error'];
    for (const id of errorIds) {
        const el = document.getElementById(id);
        if (el)
            el.textContent = '';
    }
    const statusIds = ['setup-join-status', 'setup-host-status'];
    for (const id of statusIds) {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = '';
            el.className = 'connection-status';
        }
    }
}
function setFieldError(fieldId, message) {
    const el = document.getElementById(fieldId);
    if (!el)
        return;
    el.textContent = message;
    const formGroup = el.closest('.setup-form-group');
    if (formGroup) {
        formGroup.classList.toggle('error', !!message);
    }
}
function setStatus(elementId, message, type) {
    const el = document.getElementById(elementId);
    if (!el)
        return;
    el.textContent = message;
    el.className = 'connection-status';
    if (type)
        el.classList.add(type);
}
/** Handle the join form submission. */
async function handleJoinSubmit() {
    clearAllErrors();
    const nickEl = document.getElementById('setup-join-nickname');
    const roomEl = document.getElementById('setup-join-room-id');
    const btn = document.getElementById('setup-join-btn');
    const nickname = nickEl?.value.trim() ?? '';
    const roomId = roomEl?.value.trim() ?? '';
    const nickResult = validateNickname(nickname);
    if (!nickResult.valid) {
        setFieldError('setup-join-nickname-error', nickResult.error ?? '');
        return;
    }
    const roomResult = validateRoomCode(roomId);
    if (!roomResult.valid) {
        setFieldError('setup-join-error', roomResult.error ?? '');
        return;
    }
    if (btn) {
        btn.disabled = true;
        btn.classList.add('loading');
    }
    try {
        setStatus('setup-join-status', 'Connecting...', 'connecting');
        if (!EigennamenClient.isConnected()) {
            await EigennamenClient.connect();
        }
        setupMultiplayerListeners();
        setStatus('setup-join-status', 'Joining game...', 'connecting');
        const normalizedRoomId = roomId.toLocaleLowerCase('en-US');
        const result = await EigennamenClient.joinRoom(normalizedRoomId, nickname);
        safeSetItem('eigennamen-nickname', nickname);
        state.currentRoomId = result.room?.code || normalizedRoomId;
        hideSetupScreen();
        onMultiplayerJoined(result, false);
    }
    catch (error) {
        const err = error;
        logger.error('Setup join failed:', error);
        if (err.code === 'ROOM_NOT_FOUND') {
            setStatus('setup-join-status', `Room "${roomId}" not found. Try hosting a new game instead.`, 'error');
        }
        else if (err.code === 'ROOM_FULL') {
            setStatus('setup-join-status', 'Room is full.', 'error');
        }
        else if (err.message?.includes('connect')) {
            setStatus('setup-join-status', 'Could not connect to server. Please try again.', 'error');
        }
        else {
            setStatus('setup-join-status', err.message || 'Failed to join game.', 'error');
        }
    }
    finally {
        if (btn) {
            btn.disabled = false;
            btn.classList.remove('loading');
        }
    }
}
/** Handle the host form submission. */
async function handleHostSubmit() {
    clearAllErrors();
    const nickEl = document.getElementById('setup-host-nickname');
    const roomEl = document.getElementById('setup-host-room-id');
    const redNameEl = document.getElementById('setup-red-name');
    const blueNameEl = document.getElementById('setup-blue-name');
    const gameModeEl = document.querySelector('input[name="setup-gameMode"]:checked');
    const timerToggleEl = document.getElementById('setup-turn-timer-toggle');
    const timerRangeEl = document.getElementById('setup-turn-timer-range');
    const btn = document.getElementById('setup-host-btn');
    const nickname = nickEl?.value.trim() ?? '';
    const roomId = roomEl?.value.trim() ?? '';
    const nickResult = validateNickname(nickname);
    if (!nickResult.valid) {
        setFieldError('setup-host-nickname-error', nickResult.error ?? '');
        return;
    }
    const roomResult = validateRoomCode(roomId);
    if (!roomResult.valid) {
        setFieldError('setup-host-error', roomResult.error ?? '');
        return;
    }
    // Collect host settings
    const redName = redNameEl?.value.trim() || 'Red';
    const blueName = blueNameEl?.value.trim() || 'Blue';
    const gameMode = gameModeEl?.value || 'match';
    const timerEnabled = timerToggleEl?.checked ?? false;
    const timerSeconds = timerEnabled ? parseInt(timerRangeEl?.value ?? '120', 10) : 0;
    if (btn) {
        btn.disabled = true;
        btn.classList.add('loading');
    }
    try {
        setStatus('setup-host-status', 'Creating game...', 'connecting');
        if (!EigennamenClient.isConnected()) {
            await EigennamenClient.connect();
        }
        setupMultiplayerListeners();
        const normalizedRoomId = roomId.toLocaleLowerCase('en-US');
        const result = await EigennamenClient.createRoom({
            roomId: normalizedRoomId,
            nickname: nickname,
        });
        safeSetItem('eigennamen-nickname', nickname);
        state.currentRoomId = result.room?.code || normalizedRoomId;
        // Apply team names locally
        state.teamNames.red = redName;
        state.teamNames.blue = blueName;
        // Send settings to server
        if (isClientConnected()) {
            EigennamenClient.updateSettings({
                gameMode,
                timerSeconds: timerSeconds > 0 ? timerSeconds : undefined,
                teamNames: { red: redName, blue: blueName },
            });
        }
        hideSetupScreen();
        onMultiplayerJoined(result, true);
    }
    catch (error) {
        const err = error;
        logger.error('Setup create failed:', error);
        if (err.code === 'ROOM_ALREADY_EXISTS') {
            setStatus('setup-host-status', 'A room with that ID already exists. Try a different ID.', 'error');
        }
        else if (err.message?.includes('connect')) {
            setStatus('setup-host-status', 'Could not connect to server. Please try again.', 'error');
        }
        else {
            setStatus('setup-host-status', err.message || 'Failed to create game.', 'error');
        }
    }
    finally {
        if (btn) {
            btn.disabled = false;
            btn.classList.remove('loading');
        }
    }
}
/** Handle going to solo/offline mode. */
function handleOffline() {
    hideSetupScreen();
    loadGameFromURL();
}
/** Initialize setup screen event listeners. */
export function initSetupScreen() {
    // Timer toggle
    const timerToggle = document.getElementById('setup-turn-timer-toggle');
    const timerSlider = document.getElementById('setup-turn-timer-slider');
    if (timerToggle && timerSlider) {
        timerToggle.addEventListener('change', () => {
            timerSlider.hidden = !timerToggle.checked;
        });
    }
    // Timer range value display
    const timerRange = document.getElementById('setup-turn-timer-range');
    const timerValue = document.getElementById('setup-turn-timer-value');
    if (timerRange && timerValue) {
        timerRange.addEventListener('input', () => {
            timerValue.textContent = `${timerRange.value}s`;
        });
    }
    // Enter key submits forms
    const joinInputs = ['setup-join-nickname', 'setup-join-room-id'];
    for (const id of joinInputs) {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter')
                    handleJoinSubmit();
            });
        }
    }
    const hostInputs = ['setup-host-nickname', 'setup-host-room-id'];
    for (const id of hostInputs) {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter')
                    handleHostSubmit();
            });
        }
    }
}
/** Handle setup screen action buttons via event delegation. */
export function handleSetupAction(action) {
    switch (action) {
        case 'setup-host':
            showHostForm();
            break;
        case 'setup-join':
            showJoinForm();
            break;
        case 'setup-offline':
            handleOffline();
            break;
        case 'setup-back':
            showBoard();
            break;
        case 'setup-join-submit':
            handleJoinSubmit();
            break;
        case 'setup-host-submit':
            handleHostSubmit();
            break;
    }
}
//# sourceMappingURL=setupScreen.js.map