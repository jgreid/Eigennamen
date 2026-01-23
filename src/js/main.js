/**
 * Main Application Entry Point
 *
 * Orchestrates all modules and handles the application lifecycle.
 * This is the only file that directly manipulates global state.
 *
 * @module main
 */

import { BOARD_SIZE, MAX_TEAM_NAME_LENGTH, MIN_CUSTOM_WORDS, ANIMATION } from './constants.js';
import {
  generateGameSeed,
  encodeWordsForURL,
  decodeWordsFromURL,
  sanitizeTeamName,
  parseWords,
} from './utils.js';
import {
  DEFAULT_WORDS,
  getGameState,
  getPlayerState,
  getWordListState,
  getTeamNames,
  subscribe,
  initGame,
  initGameWithWords,
  revealCard,
  endTurn,
  setCardRevealed,
  setCurrentTurn,
  checkGameOver,
  resetGameState,
  setIsHost,
  setSpymasterTeam,
  setClickerTeam,
  setPlayerTeam,
  resetPlayerRoles,
  setActiveWords,
  setWordListMode,
  setCustomWordsList,
  updateActiveWordsFromMode,
  setTeamName,
  setTeamNames,
  saveGameToHistory,
  loadGameHistory,
} from './state.js';
import {
  initCachedElements,
  showToast,
  openModal,
  closeModal,
  showErrorModal,
  resetBoardState,
  renderBoard,
  updateBoardIncremental,
  updateScoreboard,
  updateTeamNameDisplays,
  updateTurnIndicator,
  updateRoleBanner,
  updateControls,
  showGameOverModal,
  updateShareLink,
  copyShareLink,
  updateCharCounter,
  updateWordCount,
  announceToScreenReader,
} from './ui.js';
import { generate as generateQR, toCanvas as qrToCanvas } from './qrcode.js';

// ============ Application State ============

let newGameDebounce = false;

// ============ URL Management ============

/**
 * Update the browser URL with current game state
 */
function updateURL() {
  const gameState = getGameState();
  const teamNames = getTeamNames();

  const revealed = gameState.revealed.map(r => r ? '1' : '0').join('');
  const turn = gameState.currentTurn === 'blue' ? 'b' : 'r';

  let url = `${window.location.origin}${window.location.pathname}?game=${gameState.seed}&r=${revealed}&t=${turn}`;

  // Include custom words in URL if using them
  if (gameState.customWords && gameState.words.length === BOARD_SIZE) {
    url += `&w=${encodeWordsForURL(gameState.words)}`;
  }

  // Only include team names if they're not defaults
  if (teamNames.red !== 'Red') {
    url += `&rn=${encodeURIComponent(teamNames.red)}`;
  }
  if (teamNames.blue !== 'Blue') {
    url += `&bn=${encodeURIComponent(teamNames.blue)}`;
  }

  window.history.replaceState({}, '', url);
  updateShareLink(url);
  updateQRCode(url);
}

/**
 * Load game state from URL parameters
 */
function loadGameFromURL() {
  const params = new URLSearchParams(window.location.search);
  const seed = params.get('game');
  const revealed = params.get('r');
  const turn = params.get('t');
  const redName = params.get('rn');
  const blueName = params.get('bn');
  const encodedWords = params.get('w');

  // Load team names from URL
  if (redName) {
    try {
      const decoded = decodeURIComponent(redName);
      setTeamName('red', sanitizeTeamName(decoded, 'Red Team', MAX_TEAM_NAME_LENGTH));
    } catch (e) {
      setTeamName('red', 'Red Team');
    }
  }
  if (blueName) {
    try {
      const decoded = decodeURIComponent(blueName);
      setTeamName('blue', sanitizeTeamName(decoded, 'Blue Team', MAX_TEAM_NAME_LENGTH));
    } catch (e) {
      setTeamName('blue', 'Blue Team');
    }
  }

  if (seed) {
    let success = false;

    // Check if custom words are in URL
    if (encodedWords) {
      const boardWords = decodeWordsFromURL(encodedWords);
      if (boardWords && boardWords.length === BOARD_SIZE) {
        success = initGameWithWords(seed, boardWords);
      }
    }

    // Fall back to default words
    if (!success) {
      success = initGame(seed, DEFAULT_WORDS);
    }

    if (!success) return;

    // Restore revealed cards
    if (revealed) {
      for (let i = 0; i < revealed.length && i < BOARD_SIZE; i++) {
        if (revealed[i] === '1') {
          setCardRevealed(i, true);
        }
      }
    }

    // Restore turn
    if (turn === 'b') {
      setCurrentTurn('blue');
    } else if (turn === 'r') {
      setCurrentTurn('red');
    }

    // Check for game over conditions
    checkGameOver();

    // Joining via link = unaffiliated spectator
    setIsHost(false);
    setSpymasterTeam(null);
    setClickerTeam(null);
    setPlayerTeam(null);
  } else {
    newGame();
  }

  refreshUI();

  // Show game over modal if game is already over
  const gameState = getGameState();
  if (gameState.gameOver) {
    showGameOverModal(gameState, getTeamNames());
  }
}

// ============ QR Code ============

/**
 * Update QR code displays with current URL
 * @param {string} [url] - URL to encode (defaults to current URL)
 */
function updateQRCode(url) {
  const canvas = document.getElementById('qr-canvas');
  const shareCanvas = document.getElementById('share-qr-canvas');
  const qrSection = document.getElementById('qr-section');
  const targetUrl = url || window.location.href;

  try {
    const matrix = generateQR(targetUrl);
    const qrOptions = {
      scale: 10,
      margin: 1,
      dark: '#1a1a2e',
      light: '#ffffff',
    };

    if (canvas) qrToCanvas(canvas, matrix, qrOptions);
    if (shareCanvas) qrToCanvas(shareCanvas, matrix, qrOptions);
    if (qrSection) qrSection.style.display = '';
  } catch (e) {
    // Hide QR section if URL is too long
    if (qrSection) qrSection.style.display = 'none';
  }
}

// ============ Game Actions ============

/**
 * Start a new game
 */
function newGame() {
  if (newGameDebounce) return;
  newGameDebounce = true;
  setTimeout(() => { newGameDebounce = false; }, ANIMATION.DEBOUNCE);

  const seed = generateGameSeed();
  const wordListState = getWordListState();

  if (initGame(seed, wordListState.activeWords)) {
    setIsHost(true);
    resetPlayerRoles();
    resetBoardState();
    updateURL();
    refreshUI();
  } else {
    showToast(`Not enough words! You need at least ${BOARD_SIZE} words to play.`, 'error');
  }
}

/**
 * Confirm starting a new game (shows modal if cards revealed)
 */
function confirmNewGame() {
  const gameState = getGameState();
  const cardsRevealed = gameState.revealed.filter(r => r).length;

  if (cardsRevealed === 0) {
    newGame();
  } else {
    openModal('confirm-modal');
  }
}

/**
 * Handle card click
 * @param {number} index - Card index
 */
function handleCardClick(index) {
  const gameState = getGameState();
  const playerState = getPlayerState();

  // Check if player can click cards
  if (!canClickCards(gameState, playerState)) {
    return;
  }

  const result = revealCard(index);
  if (!result) return;

  updateURL();
  updateBoardIncremental(getGameState(), getPlayerState(), getTeamNames());
  updateScoreboard(getGameState());
  updateTurnIndicator(getGameState(), getTeamNames());
  updateControls(getGameState(), getPlayerState());

  // Announce to screen readers
  const word = gameState.words[index];
  announceToScreenReader(`${word} revealed: ${result.type}`);

  if (result.gameOver) {
    saveGameToHistory();
    showGameOverModal(getGameState(), getTeamNames());
  }
}

/**
 * Check if player can click cards
 */
function canClickCards(gameState, playerState) {
  if (gameState.gameOver) return false;
  if (playerState.spymasterTeam) return false; // Spymasters can't click

  // Clickers can only click on their turn
  if (playerState.clickerTeam) {
    return playerState.clickerTeam === gameState.currentTurn;
  }

  // Spectators can click (for demo purposes)
  return true;
}

/**
 * Handle end turn action
 */
function handleEndTurn() {
  const gameState = getGameState();
  const playerState = getPlayerState();

  // Only clickers on their turn can end turn
  if (!playerState.clickerTeam || playerState.clickerTeam !== gameState.currentTurn) {
    return;
  }

  closeModal('confirm-end-turn-modal');
  endTurn();
  updateURL();
  updateTurnIndicator(getGameState(), getTeamNames());
  updateControls(getGameState(), getPlayerState());

  const teamNames = getTeamNames();
  const newState = getGameState();
  const turnName = newState.currentTurn === 'red' ? teamNames.red : teamNames.blue;
  announceToScreenReader(`Turn ended. ${turnName}'s turn.`);
}

// ============ Role Management ============

/**
 * Set player's team
 * @param {string|null} team - 'red', 'blue', or null
 */
function setTeam(team) {
  const playerState = getPlayerState();

  // If changing team, clear roles
  if (team !== playerState.playerTeam) {
    setSpymasterTeam(null);
    setClickerTeam(null);
  }

  setPlayerTeam(team);
  updateRoleBanner(getPlayerState(), getTeamNames());
  updateControls(getGameState(), getPlayerState());
}

/**
 * Set player as spymaster for their team
 */
function setAsSpymaster() {
  const playerState = getPlayerState();
  if (!playerState.playerTeam) {
    showToast('Join a team first to become Spymaster', 'warning');
    return;
  }

  setSpymasterTeam(playerState.playerTeam);
  resetBoardState();
  renderBoard(getGameState(), getPlayerState(), getTeamNames());
  updateRoleBanner(getPlayerState(), getTeamNames());
  updateControls(getGameState(), getPlayerState());
}

/**
 * Set player as clicker for their team
 */
function setAsClicker() {
  const playerState = getPlayerState();
  if (!playerState.playerTeam) {
    showToast('Join a team first to become Clicker', 'warning');
    return;
  }

  setClickerTeam(playerState.playerTeam);
  resetBoardState();
  renderBoard(getGameState(), getPlayerState(), getTeamNames());
  updateRoleBanner(getPlayerState(), getTeamNames());
  updateControls(getGameState(), getPlayerState());
}

// ============ Settings ============

/**
 * Open settings modal
 */
function openSettings() {
  // Populate settings with current values
  const teamNames = getTeamNames();
  const wordListState = getWordListState();

  const redInput = document.getElementById('red-name-input');
  const blueInput = document.getElementById('blue-name-input');
  const customWordsInput = document.getElementById('custom-words');

  if (redInput) {
    redInput.value = teamNames.red;
    updateCharCounter('red-name-input', 'red-char-counter', MAX_TEAM_NAME_LENGTH);
  }
  if (blueInput) {
    blueInput.value = teamNames.blue;
    updateCharCounter('blue-name-input', 'blue-char-counter', MAX_TEAM_NAME_LENGTH);
  }
  if (customWordsInput) {
    customWordsInput.value = wordListState.customWordsList.join('\n');
    updateWordCount(wordListState.customWordsList.length);
  }

  // Set radio buttons
  const modeRadios = document.querySelectorAll('input[name="wordlist-mode"]');
  modeRadios.forEach(radio => {
    radio.checked = radio.value === wordListState.wordListMode;
  });

  updateQRCode(window.location.href);
  openModal('settings-modal');
}

/**
 * Save settings and apply changes
 */
function saveSettings() {
  const redInput = document.getElementById('red-name-input');
  const blueInput = document.getElementById('blue-name-input');
  const customWordsInput = document.getElementById('custom-words');
  const modeRadio = document.querySelector('input[name="wordlist-mode"]:checked');

  // Save team names
  if (redInput) {
    const name = sanitizeTeamName(redInput.value.trim(), 'Red', MAX_TEAM_NAME_LENGTH);
    setTeamName('red', name || 'Red');
  }
  if (blueInput) {
    const name = sanitizeTeamName(blueInput.value.trim(), 'Blue', MAX_TEAM_NAME_LENGTH);
    setTeamName('blue', name || 'Blue');
  }

  // Save word list settings
  if (customWordsInput) {
    const words = parseWords(customWordsInput.value);
    setCustomWordsList(words);
  }

  if (modeRadio) {
    const mode = modeRadio.value;

    // Validate custom-only mode
    const wordListState = getWordListState();
    if (mode === 'custom' && wordListState.customWordsList.length < MIN_CUSTOM_WORDS) {
      showToast(`Need at least ${MIN_CUSTOM_WORDS} custom words for "Custom only" mode`, 'error');
      return;
    }

    setWordListMode(mode);
  }

  updateActiveWordsFromMode();

  // Update UI
  updateURL();
  updateTeamNameDisplays(getTeamNames());
  updateRoleBanner(getPlayerState(), getTeamNames());
  updateScoreboard(getGameState());
  updateTurnIndicator(getGameState(), getTeamNames());

  closeModal('settings-modal');
  showToast('Settings saved!', 'success', 2000);
}

/**
 * Reset custom words to empty
 */
function resetWords() {
  const customWordsInput = document.getElementById('custom-words');
  if (customWordsInput) {
    customWordsInput.value = '';
    updateWordCount(0);
  }
  setCustomWordsList([]);
}

// ============ Settings Navigation ============

/**
 * Switch settings panel
 * @param {string} panelId - Panel ID to show
 */
function switchSettingsPanel(panelId) {
  // Update nav items
  const navItems = document.querySelectorAll('.settings-nav-item');
  navItems.forEach(item => {
    item.classList.toggle('active', item.dataset.panel === panelId);
  });

  // Update panels
  const panels = document.querySelectorAll('.settings-panel');
  panels.forEach(panel => {
    panel.classList.toggle('active', panel.id === `panel-${panelId}`);
  });

  // Show/hide reset button
  const resetBtn = document.getElementById('btn-reset-words');
  if (resetBtn) {
    resetBtn.style.display = panelId === 'words' ? 'block' : 'none';
  }
}

/**
 * Initialize settings navigation
 */
function initSettingsNav() {
  const navItems = document.querySelectorAll('.settings-nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const panelId = item.dataset.panel;
      if (panelId) switchSettingsPanel(panelId);
    });
  });
}

// ============ Local Storage ============

/**
 * Load settings from localStorage
 */
function loadLocalSettings() {
  try {
    const saved = localStorage.getItem('codenames_settings');
    if (saved) {
      const settings = JSON.parse(saved);

      if (settings.wordListMode) {
        setWordListMode(settings.wordListMode);
      }
      if (settings.customWords) {
        setCustomWordsList(settings.customWords);
      }

      updateActiveWordsFromMode();
    }
  } catch (e) {
    console.warn('Could not load settings:', e);
  }

  // Load game history
  loadGameHistory();
}

/**
 * Save settings to localStorage
 */
function saveLocalSettings() {
  try {
    const wordListState = getWordListState();
    const settings = {
      wordListMode: wordListState.wordListMode,
      customWords: wordListState.customWordsList,
    };
    localStorage.setItem('codenames_settings', JSON.stringify(settings));
  } catch (e) {
    console.warn('Could not save settings:', e);
  }
}

// ============ Word List File Loading ============

/**
 * Try to load wordlist.txt file
 */
async function tryLoadWordlistFile() {
  try {
    const response = await fetch('wordlist.txt');
    if (response.ok) {
      const text = await response.text();
      const words = parseWords(text);
      if (words.length > 0) {
        setCustomWordsList(words);
        updateActiveWordsFromMode();
      }
    }
  } catch (e) {
    // wordlist.txt not found or couldn't be loaded - that's fine
  }
}

// ============ Event Listeners ============

/**
 * Set up all event listeners
 */
function setupEventListeners() {
  // Board click delegation
  const board = document.getElementById('board');
  if (board) {
    board.addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (card && !card.classList.contains('revealed')) {
        const index = parseInt(card.dataset.index, 10);
        if (!isNaN(index)) {
          handleCardClick(index);
        }
      }
    });

    // Keyboard navigation
    board.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const card = e.target.closest('.card');
        if (card && !card.classList.contains('revealed')) {
          e.preventDefault();
          const index = parseInt(card.dataset.index, 10);
          if (!isNaN(index)) {
            handleCardClick(index);
          }
        }
      }
    });
  }

  // Button click delegation
  document.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;

    switch (action) {
      case 'new-game':
        confirmNewGame();
        break;
      case 'confirm-yes-new-game':
        closeModal('confirm-modal');
        newGame();
        break;
      case 'close-confirm':
        closeModal('confirm-modal');
        break;
      case 'end-turn':
        openModal('confirm-end-turn-modal');
        break;
      case 'confirm-yes-end-turn':
        handleEndTurn();
        break;
      case 'close-end-turn-confirm':
        closeModal('confirm-end-turn-modal');
        break;
      case 'team-red':
        setTeam('red');
        break;
      case 'team-blue':
        setTeam('blue');
        break;
      case 'spectate':
        setTeam(null);
        break;
      case 'spymaster':
        setAsSpymaster();
        break;
      case 'clicker':
        setAsClicker();
        break;
      case 'open-settings':
        openSettings();
        break;
      case 'close-settings':
        closeModal('settings-modal');
        break;
      case 'save-settings':
        saveSettings();
        saveLocalSettings();
        break;
      case 'reset-words':
        resetWords();
        break;
      case 'copy-link':
        copyShareLink();
        break;
      case 'game-over-new-game':
        closeModal('game-over-modal');
        newGame();
        break;
      case 'close-game-over':
        closeModal('game-over-modal');
        break;
      case 'refresh-page':
        window.location.reload();
        break;
      case 'close-error':
        closeModal('error-modal');
        break;
    }
  });

  // Input event listeners
  const redNameInput = document.getElementById('red-name-input');
  const blueNameInput = document.getElementById('blue-name-input');
  const customWordsInput = document.getElementById('custom-words');

  if (redNameInput) {
    redNameInput.addEventListener('input', () => {
      updateCharCounter('red-name-input', 'red-char-counter', MAX_TEAM_NAME_LENGTH);
    });
  }

  if (blueNameInput) {
    blueNameInput.addEventListener('input', () => {
      updateCharCounter('blue-name-input', 'blue-char-counter', MAX_TEAM_NAME_LENGTH);
    });
  }

  if (customWordsInput) {
    customWordsInput.addEventListener('input', () => {
      const words = parseWords(customWordsInput.value);
      updateWordCount(words.length);
    });
  }

  // Word list mode radio buttons
  const modeRadios = document.querySelectorAll('input[name="wordlist-mode"]');
  modeRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      const errorEl = document.getElementById('word-error');
      if (errorEl) {
        const wordListState = getWordListState();
        const needsValidation = radio.value === 'custom' &&
          wordListState.customWordsList.length < MIN_CUSTOM_WORDS;
        errorEl.style.display = needsValidation ? 'block' : 'none';
      }
    });
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Escape to close modals is handled by modal system
    // Add any global shortcuts here
  });
}

// ============ UI Refresh ============

/**
 * Refresh all UI elements with current state
 */
function refreshUI() {
  const gameState = getGameState();
  const playerState = getPlayerState();
  const teamNames = getTeamNames();

  resetBoardState();
  renderBoard(gameState, playerState, teamNames);
  updateScoreboard(gameState);
  updateTurnIndicator(gameState, teamNames);
  updateTeamNameDisplays(teamNames);
  updateRoleBanner(playerState, teamNames);
  updateControls(gameState, playerState);
}

// ============ Initialization ============

/**
 * Initialize the application
 */
async function init() {
  try {
    initCachedElements();
    setupEventListeners();
    initSettingsNav();
    loadLocalSettings();
    await tryLoadWordlistFile();
    loadGameFromURL();
    updateQRCode(window.location.href);
  } catch (e) {
    showErrorModal(
      'Failed to load the game. This might be due to corrupted data or a browser issue.',
      e.message || 'Unknown error'
    );
  }
}

// Start the application
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Export for testing
export {
  init,
  newGame,
  handleCardClick,
  handleEndTurn,
  setTeam,
  setAsSpymaster,
  setAsClicker,
  openSettings,
  saveSettings,
  loadGameFromURL,
  updateURL,
  refreshUI,
};
