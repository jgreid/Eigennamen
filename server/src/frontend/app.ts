import { state, initCachedElements } from './state.js';
import { updateCharCounter } from './utils.js';
import { showErrorModal, closeError, closeModal, registerModalCloseHandler } from './ui.js';
import { loadNotificationPrefs, initNotificationPrefsUI } from './notifications.js';
import { setCardClickHandler, renderBoard } from './board.js';
import {
    confirmNewGame, newGame, closeConfirm, confirmEndTurn, closeEndTurnConfirm,
    endTurn, copyLink, loadGameFromURL,
    closeGameOver, revealCard
} from './game.js';
import { updateRoleBanner, updateControls, setTeam, setSpymaster, setClicker, setSpymasterCurrent, setClickerCurrent } from './roles.js';
import {
    openMultiplayer, closeMultiplayer, initMultiplayerModal, initPlayerListUI,
    initNicknameEditUI,
    confirmForfeit, closeForfeitConfirm, forfeitGame,
    closeKickConfirm, confirmKickPlayer
} from './multiplayer.js';
import { openGameHistory, closeGameHistory, setupHistoryEventDelegation, closeReplay, checkURLForReplayLoad } from './history.js';
import { isClientConnected } from './clientAccessor.js';
import {
    openSettings, closeSettings, saveSettings, resetWords, initSettingsNav,
    loadLocalSettings, tryLoadWordlistFile, initSettingsListeners
} from './settings.js';
import { initI18n, setLanguage } from './i18n.js';
import { initColorBlindMode, initKeyboardShortcuts } from './accessibility.js';
import { logger } from './logger.js';

// Signal that the ES module loaded successfully
(window as Window & { __appModuleLoaded?: boolean }).__appModuleLoaded = true;

// Wire up the card click handler (board -> game callback injection)
setCardClickHandler(revealCard);

// Register all modal close handlers
registerModalCloseHandler('settings-modal', closeSettings);
registerModalCloseHandler('confirm-modal', closeConfirm);
registerModalCloseHandler('game-over-modal', closeGameOver);
registerModalCloseHandler('error-modal', closeError);
registerModalCloseHandler('multiplayer-modal', closeMultiplayer);
registerModalCloseHandler('confirm-forfeit-modal', closeForfeitConfirm);
registerModalCloseHandler('confirm-kick-modal', closeKickConfirm);
registerModalCloseHandler('history-modal', () => closeModal('history-modal'));
registerModalCloseHandler('replay-modal', () => closeModal('replay-modal'));

// Centralized event handling using event delegation for better testability
// and to avoid inline onclick handlers (security best practice)
function setupEventListeners(): void {
    // Use event delegation on document body for button actions
    document.body.addEventListener('click', function(e: Event) {
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
                setTeam(team ?? null);
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
            case 'spectate':
                // Spectate clears team affiliation and roles
                if (state.isMultiplayerMode && isClientConnected()) {
                    // In multiplayer, sync to server by setting team to null
                    setTeam(null);
                } else {
                    // Standalone mode: update local state directly
                    state.spymasterTeam = null;
                    state.clickerTeam = null;
                    state.playerTeam = null;
                    updateRoleBanner();
                    updateControls();
                    renderBoard();
                }
                break;
            case 'open-settings':
                openSettings();
                break;
            case 'open-history':
                openGameHistory();
                break;
            case 'confirm-end-turn':
                confirmEndTurn();
                break;
            case 'copy-link':
                copyLink();
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
            case 'confirm-yes-forfeit':
                forfeitGame();
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
            case 'close-history':
                closeGameHistory();
                break;
            case 'close-replay':
                closeReplay();
                break;
        }
    });

    // Character counter inputs - use event delegation on settings modal
    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal) {
        settingsModal.addEventListener('input', function(e: Event) {
            const target = e.target as HTMLElement;
            if (target.dataset.counter && target.dataset.max) {
                updateCharCounter(target.id, target.dataset.counter, parseInt(target.dataset.max));
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
        loadGameFromURL();
        // Initialize i18n (loads translations, translates page)
        await initI18n();
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
        showErrorModal(
            'Failed to load the game. This might be due to corrupted data or a browser issue.',
            message
        );
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
