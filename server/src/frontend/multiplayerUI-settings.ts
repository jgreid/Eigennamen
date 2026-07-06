import { state } from './state.js';
import { showToast, openModal, closeModal } from './ui.js';
import { t } from './i18n.js';
import { getClient, isClientConnected } from './clientAccessor.js';

// Show/hide room settings based on multiplayer host status
export function updateRoomSettingsNavVisibility(): void {
    // Show/hide inline game mode section in the merged Game panel
    const gameModeSection = document.getElementById('settings-game-mode-section');
    if (gameModeSection) {
        const isHost = getClient()?.player?.isHost;
        gameModeSection.hidden = !(state.isMultiplayerMode && isHost);
    }
}

// Sync game mode UI with server state
export function syncGameModeUI(gameMode: string): void {
    if (!gameMode) return;
    const escapedMode = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(gameMode) : gameMode;
    const radio = document.querySelector(`input[name="gameMode"][value="${escapedMode}"]`) as HTMLInputElement;
    if (radio) radio.checked = true;
}

// Sync turn timer UI with server state
export function syncTurnTimerUI(turnTimer: number | null): void {
    const toggle = document.getElementById('turn-timer-toggle') as HTMLInputElement;
    const sliderContainer = document.getElementById('turn-timer-slider');
    const range = document.getElementById('turn-timer-range') as HTMLInputElement;
    const valueDisplay = document.getElementById('turn-timer-value');

    if (!toggle) return;

    if (turnTimer != null && turnTimer > 0) {
        toggle.checked = true;
        if (sliderContainer) sliderContainer.hidden = false;
        if (range) range.value = String(turnTimer);
        if (valueDisplay) valueDisplay.textContent = `${turnTimer}s`;
    } else {
        toggle.checked = false;
        if (sliderContainer) sliderContainer.hidden = true;
    }
}

/**
 * Show forfeit confirmation modal (host only, during active game)
 */
export function confirmForfeit(): void {
    if (!state.isMultiplayerMode || !isClientConnected()) {
        showToast(t('forfeit.multiplayerOnly'), 'warning');
        return;
    }
    if (!EigennamenClient.player?.isHost) {
        showToast(t('forfeit.hostOnly'), 'warning');
        return;
    }
    if (state.gameState.gameOver) {
        showToast(t('forfeit.gameAlreadyOver'), 'info');
        return;
    }
    openModal('confirm-forfeit-modal');
}

/**
 * Close the forfeit confirmation modal
 */
export function closeForfeitConfirm(): void {
    closeModal('confirm-forfeit-modal');
}

/**
 * Execute the forfeit action for a specific team
 */
export function forfeitGame(team: string): void {
    if (!state.isMultiplayerMode || !isClientConnected()) return;
    if (!EigennamenClient.player?.isHost) {
        showToast(t('forfeit.hostOnly'), 'warning');
        return;
    }
    if (state.gameState.gameOver) return;

    EigennamenClient.forfeit(team);
}

/**
 * Update forfeit button visibility based on game state.
 * The forfeit button lives inside the settings modal (Game tab).
 * Shows only for host during an active multiplayer game.
 */
export function updateForfeitButton(): void {
    const forfeitSection = document.getElementById('settings-forfeit-section');

    const shouldShow = !!(state.isMultiplayerMode && getClient()?.player?.isHost && !state.gameState.gameOver);

    if (forfeitSection) forfeitSection.hidden = !shouldShow;

    // The Pause control shares forfeit's visibility rule, so keep it in lockstep
    // here rather than threading a second call through every forfeit call site.
    updatePauseButton();
}

/**
 * Request pausing the active game (host only). The server broadcasts
 * game:paused, which drives the overlay via the gamePaused handler.
 */
export function pauseGame(): void {
    if (!state.isMultiplayerMode || !isClientConnected()) return;
    if (!EigennamenClient.player?.isHost) {
        showToast(t('forfeit.hostOnly'), 'warning');
        return;
    }
    if (state.gameState.gameOver || state.gamePaused) return;
    EigennamenClient.pauseGame();
}

/**
 * Request resuming a paused game (host only). Invoked from the Resume button on
 * the pause overlay (and mirrored by the settings control when reachable).
 */
export function resumeGame(): void {
    if (!state.isMultiplayerMode || !isClientConnected()) return;
    if (!EigennamenClient.player?.isHost) {
        showToast(t('forfeit.hostOnly'), 'warning');
        return;
    }
    EigennamenClient.resumeGame();
}

/**
 * Show/hide the settings-modal Pause button. Same visibility rule as forfeit
 * (host, active multiplayer game), but additionally hidden while already paused
 * since the overlay carries the Resume action.
 */
export function updatePauseButton(): void {
    const pauseSection = document.getElementById('settings-pause-section');
    if (!pauseSection) return;

    const shouldShow = !!(
        state.isMultiplayerMode &&
        getClient()?.player?.isHost &&
        !state.gameState.gameOver &&
        !state.gamePaused
    );

    pauseSection.hidden = !shouldShow;
}

/**
 * Reflect the current pause state in the UI: toggle the board pause overlay,
 * expose the host-only Resume button, set the "paused by" line, and re-sync the
 * settings Pause button. Called from the game:paused/resumed handlers and after
 * a resync into a paused game.
 */
export function renderPauseState(pausedBy?: string | null): void {
    const paused = state.gamePaused;
    const isHost = !!getClient()?.player?.isHost;

    const overlay = document.getElementById('pause-overlay');
    if (overlay) overlay.hidden = !paused;

    if (paused && pausedBy) {
        const byEl = document.getElementById('pause-overlay-by');
        if (byEl) byEl.textContent = t('game.pausedBy', { nickname: pausedBy });
    }

    const resumeBtn = document.getElementById('pause-resume-btn');
    if (resumeBtn) resumeBtn.hidden = !(paused && isHost);

    updatePauseButton();
}
