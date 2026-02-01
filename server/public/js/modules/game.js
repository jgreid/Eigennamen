// ========== GAME MODULE ==========
// Core game logic (reveal, turns, scoring, board setup, URL, QR)

import { state, BOARD_SIZE, FIRST_TEAM_CARDS, SECOND_TEAM_CARDS, NEUTRAL_CARDS, ASSASSIN_CARDS, DEFAULT_WORDS, COPY_BUTTON_TEXT } from './state.js';
import { escapeHTML, hashString, shuffleWithSeed, generateGameSeed, seededRandom, encodeWordsForURL, decodeWordsFromURL } from './utils.js';
import { showToast, openModal, closeModal, announceToScreenReader, showErrorModal } from './ui.js';
import { renderBoard, updateBoardIncremental, updateSingleCard, canClickCards } from './board.js';
import { playNotificationSound } from './notifications.js';

// Helper function to set up the game board (card types, scores, etc.)
export function setupGameBoard(numericSeed) {
    // Randomly decide who goes first (gets more cards)
    const firstTeam = seededRandom(numericSeed + 1000) > 0.5 ? 'red' : 'blue';
    state.gameState.currentTurn = firstTeam;

    // Create card types: first team gets more cards, second team gets fewer
    let types = [];
    if (firstTeam === 'red') {
        types = Array(FIRST_TEAM_CARDS).fill('red').concat(Array(SECOND_TEAM_CARDS).fill('blue'));
        state.gameState.redTotal = FIRST_TEAM_CARDS;
        state.gameState.blueTotal = SECOND_TEAM_CARDS;
    } else {
        types = Array(SECOND_TEAM_CARDS).fill('red').concat(Array(FIRST_TEAM_CARDS).fill('blue'));
        state.gameState.redTotal = SECOND_TEAM_CARDS;
        state.gameState.blueTotal = FIRST_TEAM_CARDS;
    }
    types = types.concat(Array(NEUTRAL_CARDS).fill('neutral'), Array(ASSASSIN_CARDS).fill('assassin'));

    // Shuffle the types and reset game state
    state.gameState.types = shuffleWithSeed(types, numericSeed + 500);
    state.gameState.revealed = Array(BOARD_SIZE).fill(false);
    state.gameState.redScore = 0;
    state.gameState.blueScore = 0;
    state.gameState.gameOver = false;
    state.gameState.winner = null;
}

// Initialize game with specific board words (no shuffling needed - words are the board)
export function initGameWithWords(seed, boardWords) {
    if (boardWords.length !== BOARD_SIZE) {
        showToast(`Invalid game: need exactly ${BOARD_SIZE} words`, 'error');
        return false;
    }

    state.gameState.seed = seed;
    state.gameState.words = boardWords;
    state.gameState.customWords = true;

    setupGameBoard(hashString(seed));
    return true;
}

// Initialize game with a word list (selects random words for the board)
export function initGame(seed, wordList) {
    const words = wordList || state.activeWords;

    if (words.length < BOARD_SIZE) {
        showToast(`Not enough words! You need at least ${BOARD_SIZE} words to play. Please add more words in Settings.`, 'error');
        return false;
    }

    state.gameState.seed = seed;
    state.gameState.customWords = (words !== DEFAULT_WORDS && state.wordSource !== 'default');
    const numericSeed = hashString(seed);

    // Select random words using the provided word list
    const shuffledWords = shuffleWithSeed(words, numericSeed);
    state.gameState.words = shuffledWords.slice(0, BOARD_SIZE);

    setupGameBoard(numericSeed);
    return true;
}

export function newGame() {
    // Prevent rapid clicks
    if (state.newGameDebounce) return;
    state.newGameDebounce = true;
    setTimeout(() => { state.newGameDebounce = false; }, 500);

    // In multiplayer mode, request new game from server
    if (state.isMultiplayerMode && CodenamesClient.isConnected()) {
        // Server will generate and broadcast the game to all players
        CodenamesClient.startGame({});
        // Reset local state - will be synced when gameStarted event arrives
        state.spymasterTeam = null;
        state.clickerTeam = null;
        state.boardInitialized = false;
        return;
    }

    // Standalone mode: generate game locally
    const seed = generateGameSeed();
    if (initGame(seed, state.activeWords)) {
        state.isHost = true;
        state.spymasterTeam = null; // Reset spymaster role on new game
        state.clickerTeam = null; // Reset clicker role on new game
        // Keep playerTeam - team affiliation persists across games
        state.boardInitialized = false; // Force full board render for new game
        updateURL();
        renderBoard();
        updateScoreboard();
        updateTurnIndicator();
        updateRoleBanner();
        updateControls();
    }
}

export function confirmNewGame() {
    const cardsRevealed = state.gameState.revealed.filter(r => r).length;
    if (cardsRevealed === 0) {
        newGame();
    } else {
        openModal('confirm-modal');
    }
}

export function closeConfirm() {
    closeModal('confirm-modal');
}

export function confirmEndTurn() {
    // Show confirmation before ending turn
    openModal('confirm-end-turn-modal');
}

export function closeEndTurnConfirm() {
    closeModal('confirm-end-turn-modal');
}

export function loadGameFromURL() {
    const params = new URLSearchParams(window.location.search);
    const seed = params.get('game');
    const revealed = params.get('r');
    const turn = params.get('t');
    const redName = params.get('rn');
    const blueName = params.get('bn');
    const encodedWords = params.get('w'); // Custom words encoded in URL

    // Load team names from URL with length and character validation (max 32 chars to match server)
    const teamNameRegex = /^[a-zA-Z0-9\s\-]+$/;
    const sanitizeTeamName = (name, defaultName) => {
        if (!name) return defaultName;
        // Only allow alphanumeric, spaces, and hyphens (matches server validation)
        const sanitized = name.slice(0, 32).replace(/[^a-zA-Z0-9\s\-]/g, '');
        return sanitized.length > 0 ? sanitized : defaultName;
    };

    if (redName) {
        try {
            const decoded = decodeURIComponent(redName);
            state.teamNames.red = sanitizeTeamName(decoded, 'Red Team');
        } catch (e) {
            // Malformed URL encoding - use default silently
            state.teamNames.red = 'Red Team';
        }
    }
    if (blueName) {
        try {
            const decoded = decodeURIComponent(blueName);
            state.teamNames.blue = sanitizeTeamName(decoded, 'Blue Team');
        } catch (e) {
            // Malformed URL encoding - use default silently
            state.teamNames.blue = 'Blue Team';
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

        // Fall back to default words if no custom words or decode failed
        if (!success) {
            success = initGame(seed, DEFAULT_WORDS);
        }

        if (!success) return;

        // Restore revealed cards
        if (revealed) {
            for (let i = 0; i < revealed.length && i < BOARD_SIZE; i++) {
                if (revealed[i] === '1') {
                    state.gameState.revealed[i] = true;
                    const type = state.gameState.types[i];
                    if (type === 'red') state.gameState.redScore++;
                    if (type === 'blue') state.gameState.blueScore++;
                }
            }
        }

        // Restore turn
        if (turn === 'b') {
            state.gameState.currentTurn = 'blue';
        } else if (turn === 'r') {
            state.gameState.currentTurn = 'red';
        }

        // Check for game over conditions
        checkGameOver();

        // Joining via link = unaffiliated spectator by default
        state.isHost = false;
        state.spymasterTeam = null;
        state.clickerTeam = null;
        state.playerTeam = null;

        state.boardInitialized = false; // Force full board render on initial load
        renderBoard();
        updateScoreboard();
        updateTurnIndicator();
        updateRoleBanner();
        updateControls();

        // Show game over modal if game is already over
        if (state.gameState.gameOver) {
            showGameOverModal();
        }
    } else {
        newGame();
    }
}

export function updateURL() {
    const revealed = state.gameState.revealed.map(r => r ? '1' : '0').join('');
    const turn = state.gameState.currentTurn === 'blue' ? 'b' : 'r';

    let url = `${window.location.origin}${window.location.pathname}?game=${state.gameState.seed}&r=${revealed}&t=${turn}`;

    // Include custom words in URL if using them
    if (state.gameState.customWords && state.gameState.words.length === BOARD_SIZE) {
        url += `&w=${encodeWordsForURL(state.gameState.words)}`;
    }

    // Only include team names if they're not defaults
    if (state.teamNames.red !== 'Red') {
        url += `&rn=${encodeURIComponent(state.teamNames.red)}`;
    }
    if (state.teamNames.blue !== 'Blue') {
        url += `&bn=${encodeURIComponent(state.teamNames.blue)}`;
    }

    window.history.replaceState({}, '', url);
    const shareLink = state.cachedElements.shareLink || document.getElementById('share-link');
    if (shareLink) shareLink.value = url;

    // Update QR code for easy sharing
    updateQRCode(url);
}

// Update QR code with current game URL
// Uses qrcode-generator library (CDN) for reliable QR code generation
export function updateQRCode(url) {
    const canvas = document.getElementById('qr-canvas');
    const shareCanvas = document.getElementById('share-qr-canvas');
    const qrSection = document.getElementById('qr-section');
    const shareLinkInput = document.getElementById('share-link-input');
    const targetUrl = url || window.location.href;

    // Update share link input
    if (shareLinkInput) {
        shareLinkInput.value = targetUrl;
    }

    // Check if qrcode-generator library is loaded
    if (typeof qrcode !== 'function') {
        console.warn('QR code library not loaded, hiding QR section');
        if (qrSection) qrSection.style.display = 'none';
        return;
    }

    try {
        // Create QR code with auto type number (0) and Medium error correction
        const qr = qrcode(0, 'M');
        qr.addData(targetUrl);
        qr.make();

        const moduleCount = qr.getModuleCount();
        const scale = 8;
        const margin = 2;
        const canvasSize = (moduleCount + margin * 2) * scale;
        const darkColor = '#1a1a2e';
        const lightColor = '#ffffff';

        // Helper function to draw QR to canvas
        function drawQRToCanvas(targetCanvas) {
            if (!targetCanvas) return;
            targetCanvas.width = canvasSize;
            targetCanvas.height = canvasSize;
            const ctx = targetCanvas.getContext('2d');

            // Fill background
            ctx.fillStyle = lightColor;
            ctx.fillRect(0, 0, canvasSize, canvasSize);

            // Draw modules
            ctx.fillStyle = darkColor;
            for (let row = 0; row < moduleCount; row++) {
                for (let col = 0; col < moduleCount; col++) {
                    if (qr.isDark(row, col)) {
                        ctx.fillRect(
                            (col + margin) * scale,
                            (row + margin) * scale,
                            scale,
                            scale
                        );
                    }
                }
            }
        }

        // Update both canvases
        drawQRToCanvas(canvas);
        drawQRToCanvas(shareCanvas);

        // Show QR section on success
        if (qrSection) qrSection.style.display = '';
    } catch (e) {
        console.error('QR code generation failed:', e);
        // Hide QR section if URL is too long or other error
        if (qrSection) qrSection.style.display = 'none';
    }
}

// Copy link to clipboard
export function copyShareLink() {
    const shareLinkInput = document.getElementById('share-link-input');
    const feedback = document.getElementById('copy-feedback');

    if (!shareLinkInput) return;

    navigator.clipboard.writeText(shareLinkInput.value).then(() => {
        if (feedback) {
            feedback.textContent = 'Link copied to clipboard!';
            setTimeout(() => { feedback.textContent = ''; }, 3000);
        }
    }).catch(() => {
        // Fallback for older browsers
        shareLinkInput.select();
        document.execCommand('copy');
        if (feedback) {
            feedback.textContent = 'Link copied to clipboard!';
            setTimeout(() => { feedback.textContent = ''; }, 3000);
        }
    });
}

export function revealCard(index) {
    // Provide specific feedback for why card click is blocked
    if (state.gameState.gameOver) {
        showToast('Game is over - start a new game to continue', 'warning');
        return;
    }
    if (state.gameState.revealed[index]) {
        // Card already revealed - silent return is OK here as it's visually obvious
        return;
    }
    if (!canClickCards()) {
        // Determine specific reason
        if (state.spymasterTeam) {
            showToast('Spymasters cannot reveal cards', 'warning');
        } else if (state.clickerTeam && state.clickerTeam !== state.gameState.currentTurn) {
            const currentTeamName = state.gameState.currentTurn === 'red' ? state.teamNames.red : state.teamNames.blue;
            showToast(`It's ${currentTeamName}'s turn`, 'warning');
        } else if (!state.clickerTeam && !state.playerTeam) {
            showToast('Join a team and become a clicker to reveal cards', 'warning');
        } else if (state.playerTeam && state.playerTeam !== state.gameState.currentTurn) {
            const currentTeamName = state.gameState.currentTurn === 'red' ? state.teamNames.red : state.teamNames.blue;
            showToast(`It's ${currentTeamName}'s turn`, 'warning');
        } else {
            showToast('Only the clicker can reveal cards', 'warning');
        }
        return;
    }

    // Check if spymaster has given a clue before allowing guesses
    if (state.isMultiplayerMode && !state.gameState.currentClue) {
        showToast('Wait for the spymaster to give a clue first', 'warning');
        return;
    }

    // In multiplayer mode, send reveal to server and let it broadcast
    if (state.isMultiplayerMode && CodenamesClient.isConnected()) {
        // Prevent double-click while waiting for server response
        if (state.isRevealingCard) {
            return;
        }
        state.isRevealingCard = true;

        // Add visual feedback - show card as "pending"
        const card = document.querySelector(`.card[data-index="${index}"]`);
        if (card) {
            card.classList.add('revealing');
        }

        CodenamesClient.revealCard(index);
        // Don't update local state - wait for server confirmation via cardRevealed event
        // isRevealingCard is cleared in cardRevealed or error handler
        return;
    }

    state.gameState.revealed[index] = true;
    const type = state.gameState.types[index];

    // Track for animation
    state.lastRevealedIndex = index;
    state.lastRevealedWasCorrect = (type === state.gameState.currentTurn);

    if (type === 'red') {
        state.gameState.redScore++;
    } else if (type === 'blue') {
        state.gameState.blueScore++;
    }

    // Check for assassin
    if (type === 'assassin') {
        state.gameState.gameOver = true;
        state.gameState.winner = state.gameState.currentTurn === 'red' ? 'blue' : 'red';
    }

    // Check for win by completing all words
    checkGameOver();

    // End turn if wrong guess (and game not over)
    if (!state.gameState.gameOver && type !== state.gameState.currentTurn) {
        state.gameState.currentTurn = state.gameState.currentTurn === 'red' ? 'blue' : 'red';
    }

    updateURL();

    // Batch DOM updates using requestAnimationFrame for better performance
    if (!state.pendingUIUpdate) {
        state.pendingUIUpdate = true;
        requestAnimationFrame(() => {
            updateSingleCard(index);  // Only update the revealed card
            updateBoardIncremental(); // Update board classes
            updateScoreboard();
            updateTurnIndicator();
            updateRoleBanner();
            updateControls();
            state.pendingUIUpdate = false;
        });
    }

    // Clear animation tracking after animation completes (800ms = 0.6s animation + 0.2s delay)
    setTimeout(() => {
        state.lastRevealedIndex = -1;
        state.lastRevealedWasCorrect = false;
    }, 800);

    // Screen reader announcement
    const word = state.gameState.words[index];
    const typeNames = { red: state.teamNames.red, blue: state.teamNames.blue, neutral: 'neutral', assassin: 'assassin' };
    const typeName = typeNames[type] || type;
    announceToScreenReader(`${word} revealed as ${typeName}`);

    if (state.gameState.gameOver) {
        showGameOverModal();
    }
}

/**
 * Reveal a card from server sync (bypasses local validation)
 * @param {number} index - Card index to reveal
 * @param {Object} serverData - Data from server including currentTurn, scores, etc.
 */
export function revealCardFromServer(index, serverData = {}) {
    if (state.gameState.revealed[index]) return; // Already revealed

    state.gameState.revealed[index] = true;
    const type = serverData.type || state.gameState.types[index];

    // Track for animation (same as local reveal)
    state.lastRevealedIndex = index;
    state.lastRevealedWasCorrect = (type === state.gameState.currentTurn);

    // Use server-provided scores if available, otherwise calculate locally
    if (typeof serverData.redScore === 'number') {
        state.gameState.redScore = serverData.redScore;
    } else if (type === 'red') {
        state.gameState.redScore++;
    }

    if (typeof serverData.blueScore === 'number') {
        state.gameState.blueScore = serverData.blueScore;
    } else if (type === 'blue') {
        state.gameState.blueScore++;
    }

    // Use server game over state if provided
    if (serverData.gameOver !== undefined) {
        state.gameState.gameOver = serverData.gameOver;
        state.gameState.winner = serverData.winner || null;
    } else {
        // Check for assassin locally
        if (type === 'assassin') {
            state.gameState.gameOver = true;
            state.gameState.winner = state.gameState.currentTurn === 'red' ? 'blue' : 'red';
        }
        // Check for win by completing all words
        checkGameOver();
    }

    // Use server-provided turn state (authoritative)
    if (serverData.currentTurn) {
        state.gameState.currentTurn = serverData.currentTurn;
    } else if (!state.gameState.gameOver && type !== state.gameState.currentTurn) {
        // Fallback: end turn if wrong guess (and game not over)
        state.gameState.currentTurn = state.gameState.currentTurn === 'red' ? 'blue' : 'red';
    }

    // Sync guess tracking from server
    if (typeof serverData.guessesUsed === 'number') {
        state.gameState.guessesUsed = serverData.guessesUsed;
    }
    if (typeof serverData.guessesAllowed === 'number') {
        state.gameState.guessesAllowed = serverData.guessesAllowed;
    }

    // Batch DOM updates using requestAnimationFrame for better performance
    requestAnimationFrame(() => {
        updateSingleCard(index);
        updateBoardIncremental();
        updateScoreboard();
        updateTurnIndicator();
        updateRoleBanner();
        updateControls();
    });
}

export function checkGameOver() {
    // Check for assassin reveal
    const assassinIndex = state.gameState.types.indexOf('assassin');
    if (assassinIndex >= 0 && state.gameState.revealed[assassinIndex]) {
        state.gameState.gameOver = true;
        if (!state.gameState.winner) {
            state.gameState.winner = state.gameState.currentTurn === 'red' ? 'blue' : 'red';
        }
        return;
    }

    // Check for completing all words
    if (state.gameState.redScore >= state.gameState.redTotal) {
        state.gameState.gameOver = true;
        state.gameState.winner = 'red';
    } else if (state.gameState.blueScore >= state.gameState.blueTotal) {
        state.gameState.gameOver = true;
        state.gameState.winner = 'blue';
    }
}

export function showGameOverModal() {
    // Instead of showing a modal, reveal the spymaster view to all players
    // so they can see the board and discuss before the next game.
    // The turn indicator already shows the winner at the top of the board.
    renderBoard();
}

// Alias for multiplayer listener compatibility
export const showGameOver = showGameOverModal;

export function closeGameOver() {
    closeModal('game-over-modal');
}

export function endTurn() {
    // Provide specific feedback for why end turn is blocked
    if (state.gameState.gameOver) {
        showToast('Game is over - start a new game to continue', 'warning');
        return;
    }
    if (!state.clickerTeam) {
        showToast('Only clickers can end the turn', 'warning');
        return;
    }
    if (state.clickerTeam !== state.gameState.currentTurn) {
        const currentTeamName = state.gameState.currentTurn === 'red' ? state.teamNames.red : state.teamNames.blue;
        showToast(`It's ${currentTeamName}'s turn - only their clicker can end it`, 'warning');
        return;
    }

    // In multiplayer mode, send end turn to server
    if (state.isMultiplayerMode && CodenamesClient.isConnected()) {
        CodenamesClient.endTurn();
        // Don't update local state - wait for server confirmation via turnEnded event
        return;
    }

    state.gameState.currentTurn = state.gameState.currentTurn === 'red' ? 'blue' : 'red';
    updateURL();
    updateTurnIndicator();
    updateRoleBanner();
    updateControls();

    // Announce turn change
    const newTeamName = state.gameState.currentTurn === 'red' ? state.teamNames.red : state.teamNames.blue;
    announceToScreenReader(`Turn ended. Now ${newTeamName}'s turn.`);
}

export function updateScoreboard() {
    const redRemaining = state.gameState.redTotal - state.gameState.redScore;
    const blueRemaining = state.gameState.blueTotal - state.gameState.blueScore;
    // Use cached elements with fallback
    const redRemainingEl = state.cachedElements.redRemaining || document.getElementById('red-remaining');
    const blueRemainingEl = state.cachedElements.blueRemaining || document.getElementById('blue-remaining');
    const redTeamNameEl = state.cachedElements.redTeamName || document.getElementById('red-team-name');
    const blueTeamNameEl = state.cachedElements.blueTeamName || document.getElementById('blue-team-name');
    if (redRemainingEl) redRemainingEl.textContent = redRemaining;
    if (blueRemainingEl) blueRemainingEl.textContent = blueRemaining;
    if (redTeamNameEl) redTeamNameEl.textContent = state.teamNames.red;
    if (blueTeamNameEl) blueTeamNameEl.textContent = state.teamNames.blue;
}

export function updateTurnIndicator() {
    const indicator = state.cachedElements.turnIndicator || document.getElementById('turn-indicator');
    if (!indicator) return;
    const currentTeamName = state.gameState.currentTurn === 'red' ? state.teamNames.red : state.teamNames.blue;
    const winnerTeamName = state.gameState.winner === 'red' ? state.teamNames.red : state.teamNames.blue;

    if (state.gameState.gameOver) {
        indicator.className = 'turn-indicator game-over';
        const assassinIndex = state.gameState.types.indexOf('assassin');
        if (state.gameState.revealed[assassinIndex]) {
            indicator.textContent = `${winnerTeamName} WINS! (Assassin revealed)`;
        } else {
            indicator.textContent = `${winnerTeamName} WINS!`;
        }
    } else {
        // Add 'your-turn' class if you're the clicker for the current team
        const isYourTurn = state.clickerTeam && state.clickerTeam === state.gameState.currentTurn;
        indicator.className = `turn-indicator ${state.gameState.currentTurn}-turn${isYourTurn ? ' your-turn' : ''}`;

        if (isYourTurn) {
            indicator.textContent = `${currentTeamName}'s Turn - Your move!`;
        } else {
            indicator.textContent = `${currentTeamName}'s Turn`;
        }
    }
}

export async function copyLink() {
    // Get URL from either share link input
    const input = state.cachedElements.shareLink || document.getElementById('share-link-input');
    const btn = document.querySelector('.btn-copy');
    const linkPanelBtn = document.querySelector('.btn-copy-link');
    const feedback = document.getElementById('copy-feedback');

    if (!input) return;

    // Clear any existing timeout to prevent flickering
    if (state.copyButtonTimeoutId) {
        clearTimeout(state.copyButtonTimeoutId);
        state.copyButtonTimeoutId = null;
    }

    const urlToCopy = input.value || window.location.href;

    try {
        await navigator.clipboard.writeText(urlToCopy);
        showToast('Link copied to clipboard!', 'success', 3000);
    } catch (err) {
        input.select();
        document.execCommand('copy');
        showToast('Link copied to clipboard!', 'success', 3000);
    }

    // Update feedback for both buttons
    if (btn) {
        btn.textContent = 'Copied!';
    }
    if (linkPanelBtn) {
        linkPanelBtn.querySelector('.copy-text').textContent = 'Copied!';
    }
    if (feedback) {
        feedback.textContent = 'Link copied to clipboard!';
    }

    state.copyButtonTimeoutId = setTimeout(() => {
        if (btn) btn.textContent = COPY_BUTTON_TEXT;
        if (linkPanelBtn) linkPanelBtn.querySelector('.copy-text').textContent = 'Copy';
        if (feedback) feedback.textContent = '';
        state.copyButtonTimeoutId = null;
    }, 3000);
}

// These are imported by roles.js — re-export updateRoleBanner and updateControls
// They are actually defined in roles.js but called from game.js.
// To break the circular dependency, game.js imports them lazily.
// We use a registry pattern: app.js sets these after importing both modules.

let _updateRoleBanner = () => {};
let _updateControls = () => {};

export function setRoleCallbacks(updateRoleBannerFn, updateControlsFn) {
    _updateRoleBanner = updateRoleBannerFn;
    _updateControls = updateControlsFn;
}

function updateRoleBanner() {
    _updateRoleBanner();
}

function updateControls() {
    _updateControls();
}
