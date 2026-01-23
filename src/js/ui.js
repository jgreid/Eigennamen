/**
 * UI Module
 *
 * Handles all DOM manipulation and UI updates for the Codenames game.
 * Provides a clean interface for other modules to update the UI.
 *
 * @module ui
 */

import { BOARD_SIZE, ANIMATION, CARD_FONT_THRESHOLDS } from './constants.js';
import { escapeHTML, getCardFontClass } from './utils.js';

// ============ Cached DOM Elements ============

const cachedElements = {
  board: null,
  roleBanner: null,
  turnIndicator: null,
  endTurnBtn: null,
  spymasterBtn: null,
  clickerBtn: null,
  redTeamBtn: null,
  blueTeamBtn: null,
  spectateBtn: null,
  redRemaining: null,
  blueRemaining: null,
  redTeamName: null,
  blueTeamName: null,
  shareLink: null,
  srAnnouncements: null,
  toastContainer: null,
};

/**
 * Initialize cached DOM elements
 * Should be called once on page load
 */
export function initCachedElements() {
  cachedElements.board = document.getElementById('board');
  cachedElements.roleBanner = document.getElementById('role-banner');
  cachedElements.turnIndicator = document.getElementById('turn-indicator');
  cachedElements.endTurnBtn = document.getElementById('btn-end-turn');
  cachedElements.spymasterBtn = document.getElementById('btn-spymaster');
  cachedElements.clickerBtn = document.getElementById('btn-clicker');
  cachedElements.redTeamBtn = document.getElementById('btn-team-red');
  cachedElements.blueTeamBtn = document.getElementById('btn-team-blue');
  cachedElements.spectateBtn = document.getElementById('btn-spectate');
  cachedElements.redRemaining = document.getElementById('red-remaining');
  cachedElements.blueRemaining = document.getElementById('blue-remaining');
  cachedElements.redTeamName = document.getElementById('red-team-name');
  cachedElements.blueTeamName = document.getElementById('blue-team-name');
  cachedElements.shareLink = document.getElementById('share-link');
  cachedElements.srAnnouncements = document.getElementById('sr-announcements');
  cachedElements.toastContainer = document.getElementById('toast-container');
}

/**
 * Get a cached element or query for it
 * @param {string} key - Element key
 * @returns {HTMLElement|null}
 */
export function getElement(key) {
  return cachedElements[key];
}

// ============ Screen Reader Announcements ============

let srAnnouncementTimeout = null;

/**
 * Announce a message to screen readers
 * @param {string} message - Message to announce
 */
export function announceToScreenReader(message) {
  const announcer = cachedElements.srAnnouncements;
  if (announcer) {
    if (srAnnouncementTimeout) clearTimeout(srAnnouncementTimeout);
    announcer.textContent = message;
    srAnnouncementTimeout = setTimeout(() => {
      announcer.textContent = '';
      srAnnouncementTimeout = null;
    }, 1000);
  }
}

// ============ Toast Notifications ============

const toastIcons = {
  error: '&#10060;',
  success: '&#10004;',
  warning: '&#9888;',
  info: '&#8505;',
};

/**
 * Show a toast notification
 * @param {string} message - Message to display
 * @param {string} [type='error'] - Type: 'error', 'success', 'warning', 'info'
 * @param {number} [duration=4000] - Duration in milliseconds
 * @returns {HTMLElement|null} The toast element
 */
export function showToast(message, type = 'error', duration = 4000) {
  const container = cachedElements.toastContainer || document.getElementById('toast-container');
  if (!container) return null;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  toast.innerHTML = `
    <span class="toast-icon">${toastIcons[type] || toastIcons.error}</span>
    <span class="toast-message">${escapeHTML(message)}</span>
    <button type="button" class="toast-close" data-action="dismiss-toast">&times;</button>
  `;

  container.appendChild(toast);

  // Add event listener for close button
  const closeBtn = toast.querySelector('[data-action="dismiss-toast"]');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => dismissToast(toast));
  }

  // Auto-dismiss after duration
  setTimeout(() => dismissToast(toast), duration);

  // Announce to screen readers
  announceToScreenReader(message);

  return toast;
}

/**
 * Dismiss a toast notification
 * @param {HTMLElement} toast - Toast element to dismiss
 */
export function dismissToast(toast) {
  if (!toast || toast.classList.contains('hiding')) return;
  toast.classList.add('hiding');
  setTimeout(() => {
    if (toast.parentElement) {
      toast.parentElement.removeChild(toast);
    }
  }, ANIMATION.TOAST_FADE);
}

// ============ Character Counter ============

/**
 * Update character counter for an input
 * @param {string} inputId - Input element ID
 * @param {string} counterId - Counter element ID
 * @param {number} maxLength - Maximum allowed length
 */
export function updateCharCounter(inputId, counterId, maxLength) {
  const input = document.getElementById(inputId);
  const counter = document.getElementById(counterId);
  if (!input || !counter) return;

  const length = input.value.length;
  counter.textContent = `${length}/${maxLength}`;

  counter.classList.remove('warning', 'limit');
  if (length >= maxLength) {
    counter.classList.add('limit');
  } else if (length >= maxLength * 0.8) {
    counter.classList.add('warning');
  }
}

// ============ Modal Management ============

let activeModal = null;
let previouslyFocusedElement = null;
let modalListenersActive = false;

/**
 * Handle modal keydown events (focus trap, escape to close)
 * @param {KeyboardEvent} e - Keyboard event
 */
function handleModalKeydown(e) {
  if (!activeModal) return;

  // Escape key closes modal
  if (e.key === 'Escape') {
    e.preventDefault();
    closeModal(activeModal.id);
    return;
  }

  // Tab key for focus trap
  if (e.key === 'Tab') {
    const focusableElements = activeModal.querySelectorAll(
      'button, input, textarea, select, [tabindex]:not([tabindex="-1"])'
    );
    if (focusableElements.length === 0) return;

    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

/**
 * Handle clicks on modal overlay to close
 * @param {MouseEvent} e - Click event
 */
function handleOverlayClick(e) {
  if (e.target.classList.contains('modal-overlay') && activeModal) {
    closeModal(activeModal.id);
  }
}

/**
 * Open a modal
 * @param {string} modalId - ID of the modal element
 */
export function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;

  previouslyFocusedElement = document.activeElement;
  activeModal = modal;
  modal.classList.add('active');

  // Add event listeners only when modal is open
  if (!modalListenersActive) {
    document.addEventListener('keydown', handleModalKeydown);
    document.addEventListener('click', handleOverlayClick);
    modalListenersActive = true;
  }

  // Focus first focusable element
  const focusableElements = modal.querySelectorAll(
    'button, input, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (focusableElements.length > 0) {
    setTimeout(() => focusableElements[0].focus(), 50);
  }
}

/**
 * Close a modal
 * @param {string} modalId - ID of the modal element
 */
export function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;

  modal.classList.remove('active');
  activeModal = null;

  // Remove event listeners when no modal is open
  if (modalListenersActive) {
    document.removeEventListener('keydown', handleModalKeydown);
    document.removeEventListener('click', handleOverlayClick);
    modalListenersActive = false;
  }

  // Restore focus
  if (previouslyFocusedElement) {
    previouslyFocusedElement.focus();
    previouslyFocusedElement = null;
  }
}

/**
 * Show error modal
 * @param {string} message - Error message
 * @param {string} [details] - Optional details
 */
export function showErrorModal(message, details = null) {
  const msgEl = document.getElementById('error-message');
  const detailsEl = document.getElementById('error-details');

  if (msgEl) msgEl.textContent = message;
  if (detailsEl) {
    if (details) {
      detailsEl.textContent = details;
      detailsEl.style.display = 'block';
    } else {
      detailsEl.style.display = 'none';
    }
  }

  openModal('error-modal');
}

// ============ Board Rendering ============

let boardInitialized = false;
let lastRenderedState = null;

/**
 * Reset board initialization flag (call before new game)
 */
export function resetBoardState() {
  boardInitialized = false;
  lastRenderedState = null;
}

/**
 * Render the game board
 * @param {Object} gameState - Current game state
 * @param {Object} playerState - Current player state
 * @param {Object} teamNames - Current team names
 */
export function renderBoard(gameState, playerState, teamNames) {
  const board = cachedElements.board || document.getElementById('board');
  if (!board) return;

  const isSpymaster = playerState.spymasterTeam !== null;
  const { words, types, revealed, gameOver } = gameState;

  // Build the board HTML
  let html = '';
  for (let i = 0; i < BOARD_SIZE; i++) {
    const word = words[i] || '';
    const type = types[i] || 'neutral';
    const isRevealed = revealed[i];
    const fontClass = getCardFontClass(word, CARD_FONT_THRESHOLDS);

    let classes = ['card'];
    if (isRevealed) {
      classes.push('revealed', type);
    } else if (isSpymaster) {
      classes.push(`spymaster-${type}`);
    }
    if (fontClass) classes.push(fontClass);

    const ariaLabel = buildCardAriaLabel(word, type, isRevealed, isSpymaster, teamNames);

    html += `
      <div class="${classes.join(' ')}"
           data-index="${i}"
           role="button"
           tabindex="0"
           aria-label="${escapeHTML(ariaLabel)}"
           aria-pressed="${isRevealed}">
        <span class="card-text">${escapeHTML(word)}</span>
        ${isSpymaster && !isRevealed ? `<span class="card-indicator ${type}"></span>` : ''}
      </div>
    `;
  }

  board.innerHTML = html;
  boardInitialized = true;
  lastRenderedState = {
    words: [...words],
    types: [...types],
    revealed: [...revealed],
    isSpymaster,
  };
}

/**
 * Update board incrementally (only changed cards)
 * @param {Object} gameState - Current game state
 * @param {Object} playerState - Current player state
 * @param {Object} teamNames - Current team names
 */
export function updateBoardIncremental(gameState, playerState, teamNames) {
  if (!boardInitialized || !lastRenderedState) {
    renderBoard(gameState, playerState, teamNames);
    return;
  }

  const board = cachedElements.board || document.getElementById('board');
  if (!board) return;

  const isSpymaster = playerState.spymasterTeam !== null;
  const { words, types, revealed, gameOver } = gameState;

  // Check if spymaster status changed - requires full re-render
  if (isSpymaster !== lastRenderedState.isSpymaster) {
    renderBoard(gameState, playerState, teamNames);
    return;
  }

  // Update only changed cards
  for (let i = 0; i < BOARD_SIZE; i++) {
    if (revealed[i] !== lastRenderedState.revealed[i]) {
      updateSingleCard(board, i, gameState, playerState, teamNames);
    }
  }

  lastRenderedState.revealed = [...revealed];
}

/**
 * Update a single card on the board
 * @param {HTMLElement} board - Board element
 * @param {number} index - Card index
 * @param {Object} gameState - Current game state
 * @param {Object} playerState - Current player state
 * @param {Object} teamNames - Current team names
 */
function updateSingleCard(board, index, gameState, playerState, teamNames) {
  const card = board.querySelector(`[data-index="${index}"]`);
  if (!card) return;

  const isSpymaster = playerState.spymasterTeam !== null;
  const { words, types, revealed } = gameState;
  const word = words[index];
  const type = types[index];
  const isRevealed = revealed[index];

  // Update classes
  card.classList.remove('revealed', 'red', 'blue', 'neutral', 'assassin');
  if (isRevealed) {
    card.classList.add('revealed', type);
  }

  // Update aria
  const ariaLabel = buildCardAriaLabel(word, type, isRevealed, isSpymaster, teamNames);
  card.setAttribute('aria-label', ariaLabel);
  card.setAttribute('aria-pressed', String(isRevealed));

  // Remove indicator if revealed
  if (isRevealed) {
    const indicator = card.querySelector('.card-indicator');
    if (indicator) indicator.remove();
  }
}

/**
 * Build aria-label for a card
 */
function buildCardAriaLabel(word, type, isRevealed, isSpymaster, teamNames) {
  let label = word;
  if (isRevealed) {
    if (type === 'red') label += `, ${teamNames.red} team card`;
    else if (type === 'blue') label += `, ${teamNames.blue} team card`;
    else if (type === 'neutral') label += ', neutral card';
    else if (type === 'assassin') label += ', assassin card';
  } else if (isSpymaster) {
    if (type === 'red') label += ` (${teamNames.red})`;
    else if (type === 'blue') label += ` (${teamNames.blue})`;
    else if (type === 'neutral') label += ' (neutral)';
    else if (type === 'assassin') label += ' (ASSASSIN)';
  }
  return label;
}

// ============ Scoreboard Updates ============

/**
 * Update the scoreboard display
 * @param {Object} gameState - Current game state
 */
export function updateScoreboard(gameState) {
  const { redScore, blueScore, redTotal, blueTotal } = gameState;

  const redRemaining = cachedElements.redRemaining || document.getElementById('red-remaining');
  const blueRemaining = cachedElements.blueRemaining || document.getElementById('blue-remaining');

  if (redRemaining) {
    redRemaining.textContent = redTotal - redScore;
  }
  if (blueRemaining) {
    blueRemaining.textContent = blueTotal - blueScore;
  }
}

/**
 * Update team name displays
 * @param {Object} teamNames - Current team names
 */
export function updateTeamNameDisplays(teamNames) {
  const redNameEl = cachedElements.redTeamName || document.getElementById('red-team-name');
  const blueNameEl = cachedElements.blueTeamName || document.getElementById('blue-team-name');

  if (redNameEl) redNameEl.textContent = teamNames.red;
  if (blueNameEl) blueNameEl.textContent = teamNames.blue;
}

// ============ Turn Indicator ============

/**
 * Update turn indicator
 * @param {Object} gameState - Current game state
 * @param {Object} teamNames - Current team names
 */
export function updateTurnIndicator(gameState, teamNames) {
  const indicator = cachedElements.turnIndicator || document.getElementById('turn-indicator');
  if (!indicator) return;

  const { currentTurn, gameOver, winner } = gameState;

  if (gameOver) {
    const winnerName = winner === 'red' ? teamNames.red : teamNames.blue;
    indicator.textContent = `${winnerName} wins!`;
    indicator.className = `turn-indicator ${winner}`;
  } else {
    const turnName = currentTurn === 'red' ? teamNames.red : teamNames.blue;
    indicator.textContent = `${turnName}'s turn`;
    indicator.className = `turn-indicator ${currentTurn}`;
  }
}

// ============ Role Banner ============

/**
 * Update role banner display
 * @param {Object} playerState - Current player state
 * @param {Object} teamNames - Current team names
 */
export function updateRoleBanner(playerState, teamNames) {
  const banner = cachedElements.roleBanner || document.getElementById('role-banner');
  if (!banner) return;

  const { isHost, spymasterTeam, clickerTeam, playerTeam } = playerState;
  const hostBadge = isHost ? '<span class="host-badge">Host</span>' : '';

  if (spymasterTeam === 'red') {
    banner.className = 'role-banner spymaster-red';
    banner.innerHTML = `<strong>${escapeHTML(teamNames.red)}</strong> Spymaster${hostBadge}`;
  } else if (spymasterTeam === 'blue') {
    banner.className = 'role-banner spymaster-blue';
    banner.innerHTML = `<strong>${escapeHTML(teamNames.blue)}</strong> Spymaster${hostBadge}`;
  } else if (clickerTeam === 'red') {
    banner.className = 'role-banner clicker-red';
    banner.innerHTML = `<strong>${escapeHTML(teamNames.red)}</strong> Clicker${hostBadge}`;
  } else if (clickerTeam === 'blue') {
    banner.className = 'role-banner clicker-blue';
    banner.innerHTML = `<strong>${escapeHTML(teamNames.blue)}</strong> Clicker${hostBadge}`;
  } else if (playerTeam === 'red') {
    banner.className = 'role-banner spectator-red';
    banner.innerHTML = `<strong>${escapeHTML(teamNames.red)}</strong> Team${hostBadge}`;
  } else if (playerTeam === 'blue') {
    banner.className = 'role-banner spectator-blue';
    banner.innerHTML = `<strong>${escapeHTML(teamNames.blue)}</strong> Team${hostBadge}`;
  } else if (isHost) {
    banner.className = 'role-banner host';
    banner.innerHTML = `<span class="host-badge">Host</span> Spectator`;
  } else {
    banner.className = 'role-banner viewer';
    banner.innerHTML = `Spectator`;
  }
}

// ============ Control Buttons ============

/**
 * Update control button states
 * @param {Object} gameState - Current game state
 * @param {Object} playerState - Current player state
 */
export function updateControls(gameState, playerState) {
  const { currentTurn, gameOver } = gameState;
  const { clickerTeam, playerTeam, spymasterTeam } = playerState;

  // End turn button
  const endTurnBtn = document.getElementById('btn-end-turn');
  if (endTurnBtn) {
    const clickerCanAct = clickerTeam && clickerTeam === currentTurn && !gameOver;
    endTurnBtn.disabled = !clickerCanAct;
    endTurnBtn.classList.toggle('can-act', clickerCanAct);

    if (!clickerTeam) {
      endTurnBtn.title = 'Become a Clicker to end turns';
    } else if (clickerTeam !== currentTurn) {
      endTurnBtn.title = "Wait for your team's turn";
    } else if (gameOver) {
      endTurnBtn.title = 'Game is over';
    } else {
      endTurnBtn.title = "End your team's turn";
    }
  }

  // Team selection buttons
  const redTeamBtn = document.getElementById('btn-team-red');
  const blueTeamBtn = document.getElementById('btn-team-blue');
  const spectateBtn = document.getElementById('btn-spectate');

  if (redTeamBtn) {
    redTeamBtn.classList.toggle('selected', playerTeam === 'red');
    redTeamBtn.setAttribute('aria-pressed', String(playerTeam === 'red'));
  }
  if (blueTeamBtn) {
    blueTeamBtn.classList.toggle('selected', playerTeam === 'blue');
    blueTeamBtn.setAttribute('aria-pressed', String(playerTeam === 'blue'));
  }
  if (spectateBtn) {
    spectateBtn.classList.toggle('selected', !playerTeam);
    spectateBtn.setAttribute('aria-pressed', String(!playerTeam));
  }

  // Role buttons
  const spymasterBtn = document.getElementById('btn-spymaster');
  const clickerBtn = document.getElementById('btn-clicker');

  if (spymasterBtn) {
    spymasterBtn.classList.toggle('active', spymasterTeam !== null);
    spymasterBtn.disabled = !playerTeam;
  }
  if (clickerBtn) {
    clickerBtn.classList.toggle('active', clickerTeam !== null);
    clickerBtn.disabled = !playerTeam;
  }
}

// ============ Game Over Modal ============

/**
 * Show game over modal
 * @param {Object} gameState - Current game state
 * @param {Object} teamNames - Current team names
 */
export function showGameOverModal(gameState, teamNames) {
  const winnerDisplay = document.getElementById('winner-display');
  if (winnerDisplay) {
    const winnerName = gameState.winner === 'red' ? teamNames.red : teamNames.blue;
    winnerDisplay.textContent = `${winnerName} wins!`;
    winnerDisplay.className = `winner ${gameState.winner}`;
  }
  openModal('game-over-modal');
}

// ============ Share Link ============

/**
 * Update share link input
 * @param {string} url - URL to display
 */
export function updateShareLink(url) {
  const shareLink = cachedElements.shareLink || document.getElementById('share-link');
  const shareLinkInput = document.getElementById('share-link-input');

  if (shareLink) shareLink.value = url;
  if (shareLinkInput) shareLinkInput.value = url;
}

/**
 * Copy share link to clipboard
 * @returns {Promise<boolean>} Success status
 */
export async function copyShareLink() {
  const shareLinkInput = document.getElementById('share-link-input');
  const feedback = document.getElementById('copy-feedback');

  if (!shareLinkInput) return false;

  try {
    await navigator.clipboard.writeText(shareLinkInput.value);
    if (feedback) {
      feedback.textContent = 'Link copied to clipboard!';
      setTimeout(() => { feedback.textContent = ''; }, 3000);
    }
    return true;
  } catch (e) {
    // Fallback for older browsers
    shareLinkInput.select();
    document.execCommand('copy');
    if (feedback) {
      feedback.textContent = 'Link copied to clipboard!';
      setTimeout(() => { feedback.textContent = ''; }, 3000);
    }
    return true;
  }
}

// ============ Word Count ============

/**
 * Update word count display
 * @param {number} count - Number of words
 */
export function updateWordCount(count) {
  const wordCountEl = document.getElementById('word-count');
  if (wordCountEl) {
    wordCountEl.textContent = `${count} word${count !== 1 ? 's' : ''}`;
  }
}

// Default export
export default {
  initCachedElements,
  getElement,
  announceToScreenReader,
  showToast,
  dismissToast,
  updateCharCounter,
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
  updateWordCount,
};
