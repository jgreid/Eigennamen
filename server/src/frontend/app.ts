import { state, initCachedElements } from './state.js';
import { updateCharCounter } from './utils.js';
import { showErrorModal, showToast, closeError, closeModal, registerModalCloseHandler } from './ui.js';
import { loadNotificationPrefs, initNotificationPrefsUI } from './notifications.js';
import { setCardClickHandler, renderBoard } from './board.js';
import {
    confirmNewGame,
    newGame,
    closeConfirm,
    confirmEndTurn,
    closeEndTurnConfirm,
    endTurn,
    loadGameFromURL,
    closeGameOver,
    revealCard,
    abandonAndNewGame,
    forfeitAndNewGame,
} from './game.js';
import {
    updateRoleBanner,
    updateControls,
    setTeam,
    setSpymaster,
    setClicker,
    setSpymasterCurrent,
    setClickerCurrent,
} from './roles.js';
import {
    openMultiplayer,
    closeMultiplayer,
    initMultiplayerModal,
    initPlayerListUI,
    initNicknameEditUI,
    confirmForfeit,
    closeForfeitConfirm,
    forfeitGame,
    closeKickConfirm,
    confirmKickPlayer,
} from './multiplayer.js';
import {
    openGameHistory,
    closeGameHistory,
    setupHistoryEventDelegation,
    closeReplay,
    checkURLForReplayLoad,
    clearGameHistory,
} from './history.js';
import { isClientConnected } from './clientAccessor.js';
import {
    openSettings,
    closeSettings,
    openHelp,
    closeHelp,
    saveSettings,
    resetWords,
    initSettingsNav,
    loadLocalSettings,
    tryLoadWordlistFile,
    initSettingsListeners,
} from './settings.js';
import { initI18n, setLanguage } from './i18n.js';
import { initColorBlindMode, initKeyboardShortcuts } from './accessibility.js';
import { shouldShowSetupScreen, showSetupScreen, initSetupScreen, handleSetupAction } from './setupScreen.js';
import { logger } from './logger.js';

// Signal that the ES module loaded successfully
(window as Window & { __appModuleLoaded?: boolean }).__appModuleLoaded = true;

// iOS Safari requires a touchstart listener on the document (or an ancestor of
// interactive elements) for :active CSS states to fire on touch.  Without this,
// buttons receive no visual feedback and — in scroll containers with
// -webkit-overflow-scrolling — taps can be swallowed entirely by the gesture
// recogniser.  The listener is passive so it never blocks scrolling.
document.addEventListener('touchstart', function () {}, { passive: true });

// Global error handlers — surface uncaught errors to the user instead of
// silently losing them in the console (C1 from audit)
window.addEventListener('error', (event: ErrorEvent) => {
    const message = event.message || 'An unexpected error occurred';
    logger.error('Uncaught error:', message, event.filename, event.lineno);
    showToast(message, 'error');
});

window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason || 'Unhandled promise rejection');
    logger.error('Unhandled promise rejection:', message);
    showToast(message, 'error');
});

// Mobile background/foreground detection — when a mobile browser puts the
// page in the background (tab switch, home button, lock screen), WebSocket
// heartbeats stop and the server may consider the client dead.  On returning
// to foreground we check connectivity and request a full resync so the UI
// reflects changes that happened while backgrounded.
let lastVisibleTimestamp = Date.now();
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        lastVisibleTimestamp = Date.now();
        return;
    }
    // Returned to foreground
    const elapsed = Date.now() - lastVisibleTimestamp;

    // Only act if we were away for >2 seconds (avoids spurious triggers)
    if (elapsed < 2000) return;

    if (!state.isMultiplayerMode || !isClientConnected()) return;

    // Request a full resync from the server to catch missed events
    try {
        EigennamenClient.requestResync();
    } catch {
        // Non-critical — Socket.io will reconnect automatically if needed
        logger.debug('Foreground resync request failed (socket may be reconnecting)');
    }
});

// Wire up the card click handler (board -> game callback injection)
setCardClickHandler(revealCard);

// Register all modal close handlers
registerModalCloseHandler('settings-modal', closeSettings);
registerModalCloseHandler('help-modal', closeHelp);
registerModalCloseHandler('confirm-modal', closeConfirm);
registerModalCloseHandler('confirm-end-turn-modal', closeEndTurnConfirm);
registerModalCloseHandler('game-over-modal', closeGameOver);
registerModalCloseHandler('error-modal', closeError);
registerModalCloseHandler('multiplayer-modal', closeMultiplayer);
registerModalCloseHandler('confirm-forfeit-modal', closeForfeitConfirm);
registerModalCloseHandler('confirm-kick-modal', closeKickConfirm);
registerModalCloseHandler('history-modal', () => closeModal('history-modal'));
registerModalCloseHandler('replay-modal', closeReplay);

// Centralized event handling using event delegation for better testability
// and to avoid inline onclick handlers (security best practice)
function setupEventListeners(): void {
    // Use event delegation on document body for button actions
    document.body.addEventListener('click', function (e: Event) {
        const target = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
        if (!target) return;

        const action = target.dataset.action;
        const team = target.dataset.team;

        switch (action) {
            // Main controls
            case 'confirm-new-game':
                confirmNewGame();
                break;
            case 'set-team':
                // Toggle: clicking your own team puts you in spectator mode
                if (team && state.playerTeam === team) {
                    if (state.isMultiplayerMode && isClientConnected()) {
                        setTeam(null);
                    } else {
                        state.spymasterTeam = null;
                        state.clickerTeam = null;
                        state.playerTeam = null;
                        updateRoleBanner();
                        updateControls();
                        renderBoard();
                    }
                } else {
                    setTeam(team ?? null);
                }
                break;
            case 'set-spymaster':
                setSpymaster(team || '');
                break;
            case 'set-spymaster-current':
                setSpymasterCurrent();
                break;
            case 'set-clicker':
                setClicker(team || '');
                break;
            case 'set-clicker-current':
                setClickerCurrent();
                break;
            case 'open-settings':
                openSettings();
                break;
            case 'open-help':
                openHelp();
                break;
            case 'close-help':
                closeHelp();
                break;
            case 'open-history':
                openGameHistory();
                break;
            case 'confirm-end-turn':
                confirmEndTurn();
                break;
            // Settings modal
            case 'save-settings':
                saveSettings();
                break;
            case 'reset-words':
                resetWords();
                break;
            case 'close-settings':
                closeSettings();
                break;

            // Confirm new game modal
            case 'confirm-yes-new-game':
                newGame();
                closeConfirm();
                break;
            case 'confirm-forfeit-red-new-game':
                forfeitAndNewGame('red');
                closeConfirm();
                break;
            case 'confirm-forfeit-blue-new-game':
                forfeitAndNewGame('blue');
                closeConfirm();
                break;
            case 'confirm-abandon-new-game':
                abandonAndNewGame();
                closeConfirm();
                break;
            case 'close-confirm':
                closeConfirm();
                break;

            // Confirm end turn modal
            case 'confirm-yes-end-turn':
                endTurn();
                closeEndTurnConfirm();
                break;
            case 'close-end-turn-confirm':
                closeEndTurnConfirm();
                break;

            // Confirm forfeit modal
            case 'confirm-forfeit':
                confirmForfeit();
                break;
            case 'confirm-forfeit-red':
                forfeitGame('red');
                closeForfeitConfirm();
                break;
            case 'confirm-forfeit-blue':
                forfeitGame('blue');
                closeForfeitConfirm();
                break;
            case 'close-forfeit-confirm':
                closeForfeitConfirm();
                break;

            // Confirm kick modal
            case 'confirm-yes-kick':
                confirmKickPlayer();
                break;
            case 'close-kick-confirm':
                closeKickConfirm();
                break;

            // Game over modal
            case 'game-over-new-game':
                newGame();
                closeGameOver();
                break;
            case 'close-game-over':
                closeGameOver();
                break;

            // Error modal
            case 'refresh-page':
                location.reload();
                break;
            case 'close-error':
                closeError();
                break;

            // Multiplayer modal
            case 'open-multiplayer':
                openMultiplayer();
                break;
            case 'close-multiplayer':
                closeMultiplayer();
                break;
            case 'play-offline':
                closeMultiplayer();
                break;

            // Game history modal
            case 'clear-history':
                clearGameHistory();
                break;
            case 'close-history':
                closeGameHistory();
                break;
            case 'close-replay':
                closeReplay();
                break;

            // Setup screen actions
            case 'setup-host':
            case 'setup-join':
            case 'setup-offline':
            case 'setup-back':
            case 'setup-join-submit':
            case 'setup-host-submit':
                handleSetupAction(action);
                break;
        }
    });

    // Character counter inputs - use event delegation on settings modal
    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal) {
        settingsModal.addEventListener('input', function (e: Event) {
            const target = e.target as HTMLElement;
            if (target.dataset.counter && target.dataset.max) {
                updateCharCounter(target.id, target.dataset.counter, parseInt(target.dataset.max, 10));
            }
        });
    }
}

async function init(): Promise<void> {
    try {
        // Remove loading placeholder
        const loadingEl = document.getElementById('board-loading');
        if (loadingEl) loadingEl.remove();

        // Initialize cached DOM elements first
        initCachedElements();
        // Display app version in sidebar and setup screen
        const versionStr = `v${__APP_VERSION__}`;
        const versionEl = document.getElementById('sidebar-version');
        if (versionEl) versionEl.textContent = versionStr;
        const setupVersionEl = document.getElementById('setup-version');
        if (setupVersionEl) setupVersionEl.textContent = versionStr;
        // Set up centralized event listeners
        setupEventListeners();
        // Initialize settings navigation
        initSettingsNav();
        // Initialize multiplayer modal
        initMultiplayerModal();
        // Initialize player list UI (kick buttons)
        initPlayerListUI();
        // Initialize nickname edit UI
        initNicknameEditUI();
        // Load notification preferences
        loadNotificationPrefs();
        initNotificationPrefsUI();
        // Set up event delegation for game history (prevents memory leaks)
        setupHistoryEventDelegation();
        // Initialize settings listeners (custom words textarea, radio buttons)
        initSettingsListeners();
        loadLocalSettings();
        await tryLoadWordlistFile();
        // Initialize i18n before loading game so t() calls in UI rendering work
        await initI18n();
        // Initialize setup screen listeners
        initSetupScreen();
        // Show setup screen or load game directly
        if (shouldShowSetupScreen()) {
            showSetupScreen();
        } else {
            // Ensure app layout is visible when skipping setup screen
            const appLayout = document.getElementById('app-layout');
            if (appLayout) appLayout.hidden = false;
            loadGameFromURL();
        }
        // Wire up language selector
        const langSelect = document.getElementById('language-select') as HTMLSelectElement | null;
        if (langSelect) {
            langSelect.value = state.language;
            langSelect.addEventListener('change', (e: Event) => {
                setLanguage((e.target as HTMLSelectElement).value);
            });
        }
        // Initialize accessibility features
        initColorBlindMode();
        initKeyboardShortcuts();
        // Check URL for shared replay link
        checkURLForReplayLoad();
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Unknown error';
        logger.error('Initialization failed:', message, e);
        // Show error modal to inform user
        showErrorModal('Failed to load the game. This might be due to corrupted data or a browser issue.', message);
    }
}

// Use addEventListener instead of window.onload to avoid
// overwriting existing handlers and follow modern best practices
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    // DOM already loaded (e.g., script loaded asynchronously)
    init();
}
