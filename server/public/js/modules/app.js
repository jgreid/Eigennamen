// ========== APP MODULE ==========
// Entry point - wires everything together

import { state, initCachedElements } from './state.js';
import { updateCharCounter } from './utils.js';
import { showErrorModal, closeError, openModal, closeModal, registerModalCloseHandler } from './ui.js';
import { loadNotificationPrefs, initNotificationPrefsUI } from './notifications.js';
import { setCardClickHandler, renderBoard } from './board.js';
import {
    confirmNewGame, newGame, closeConfirm, confirmEndTurn, closeEndTurnConfirm,
    endTurn, copyShareLink,
    closeGameOver, revealCard, updateScoreboard, updateTurnIndicator,
    setRoleCallbacks, showGameOverModal
} from './game.js';
import { updateRoleBanner, updateControls, setTeam, setSpymaster, setClicker, setSpymasterCurrent, setClickerCurrent } from './roles.js';
import {
    openMultiplayer, closeMultiplayer, initMultiplayerModal, initPlayerListUI,
    copyRoomCode, copyRoomId, updateRoomSettingsNavVisibility, updateRoomInfoDisplay,
    leaveMultiplayerMode
} from './multiplayer.js';
import { openGameHistory, closeGameHistory, setupHistoryEventDelegation, closeReplay } from './history.js';
import {
    openSettings, closeSettings, saveSettings, resetWords, initSettingsNav,
    loadLocalSettings, initSettingsListeners
} from './settings.js';

// Wire up the card click handler (board -> game callback injection)
setCardClickHandler(revealCard);

// Wire up the role callbacks (game -> roles callback injection to break circular dependency)
setRoleCallbacks(updateRoleBanner, updateControls);

// Register all modal close handlers
registerModalCloseHandler('settings-modal', closeSettings);
registerModalCloseHandler('confirm-modal', closeConfirm);
registerModalCloseHandler('confirm-end-turn-modal', closeEndTurnConfirm);
registerModalCloseHandler('game-over-modal', closeGameOver);
registerModalCloseHandler('error-modal', closeError);
registerModalCloseHandler('multiplayer-modal', closeMultiplayer);
registerModalCloseHandler('history-modal', () => closeModal('history-modal'));
registerModalCloseHandler('replay-modal', () => closeModal('replay-modal'));

// ========== EVENT LISTENER SETUP ==========
// Centralized event handling using event delegation for better testability
// and to avoid inline onclick handlers (security best practice)
function setupEventListeners() {
    // Use event delegation on document body for button actions
    document.body.addEventListener('click', function(e) {
        const target = e.target.closest('[data-action]');
        if (!target) return;

        const action = target.dataset.action;
        const team = target.dataset.team;

        switch (action) {
            // Main controls
            case 'confirm-new-game':
                confirmNewGame();
                break;
            case 'set-team':
                setTeam(team);
                break;
            case 'set-spymaster':
                setSpymaster(team);
                break;
            case 'set-spymaster-current':
                setSpymasterCurrent();
                break;
            case 'set-clicker':
                setClicker(team);
                break;
            case 'set-clicker-current':
                setClickerCurrent();
                break;
            case 'spectate':
                setTeam(null);
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
            case 'copy-room-code':
                copyRoomCode();
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
        settingsModal.addEventListener('input', function(e) {
            const target = e.target;
            if (target.dataset.counter && target.dataset.max) {
                updateCharCounter(target.id, target.dataset.counter, parseInt(target.dataset.max));
            }
        });
    }
}

// Initialize room settings UI handlers (for multiplayer host)
function initRoomSettingsUI() {
    updateRoomInfoDisplay();
}

async function init() {
    try {
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
        // Load notification preferences
        loadNotificationPrefs();
        initNotificationPrefsUI();
        // Initialize room settings UI (for multiplayer hosts)
        initRoomSettingsUI();
        // Set up event delegation for game history (prevents memory leaks)
        setupHistoryEventDelegation();
        // Initialize settings listeners (custom words textarea, radio buttons)
        initSettingsListeners();
        loadLocalSettings();

        // Unregister any stale service workers from previous versions
        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (const registration of registrations) {
                registration.unregister();
            }
        }

        // Auto-open multiplayer modal if not already in a room
        if (!state.isMultiplayerMode) {
            openMultiplayer();
        }
    } catch (e) {
        showErrorModal(
            'Failed to load the game. This might be due to corrupted data or a browser issue.',
            e.message || 'Unknown error'
        );
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
