// ========== GAME MODULE ==========
// Core game logic (reveal, turns, scoring, board setup, URL, QR)

import { state, BOARD_SIZE, FIRST_TEAM_CARDS, SECOND_TEAM_CARDS, NEUTRAL_CARDS, ASSASSIN_CARDS, DEFAULT_WORDS, COPY_BUTTON_TEXT } from './state.js';
import { hashString, shuffleWithSeed, generateGameSeed, seededRandom, encodeWordsForURL, decodeWordsFromURL, copyToClipboard } from './utils.js';
import { showToast, openModal, closeModal, announceToScreenReader } from './ui.js';
import { renderBoard, updateBoardIncremental, updateSingleCard, canClickCards } from './board.js';
import { updateRoleBanner, updateControls } from './roles.js';
import { UI } from './constants.js';
import { logger } from './logger.js';
import { t } from './i18n.js';

// Helper function to set up the game board (card types, scores, etc.)
export function setupGameBoard(numericSeed: number): void {
    // Randomly decide who goes first (gets more cards)
    const firstTeam = seededRandom(numericSeed + 1000) > 0.5 ? 'red' : 'blue';
    state.gameState.currentTurn = firstTeam;

    // Create card types: first team gets more cards, second team gets fewer
    let types: string[] = [];
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
export function initGameWithWords(seed: string, boardWords: string[]): boolean {
    if (boardWords.length !== BOARD_SIZE) {
        showToast(t('game.invalidWordCount', { count: BOARD_SIZE }), 'error');
        return false;
    }

    state.gameState.seed = seed;
    state.gameState.words = boardWords;
    state.gameState.customWords = true;

    setupGameBoard(hashString(seed));
    return true;
}

// Initialize game with a word list (selects random words for the board)
export function initGame(seed: string, wordList?: string[]): boolean {
    // Use localized words when available and word source includes defaults
    let words = wordList || state.activeWords;
    if (!wordList && state.localizedDefaultWords && (state.wordSource === 'default' || state.wordSource === 'combined')) {
        words = [...new Set([...state.localizedDefaultWords, ...state.activeWords])];
    }

    if (words.length < BOARD_SIZE) {
        showToast(t('game.notEnoughWords', { count: BOARD_SIZE }), 'error');
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

export function newGame(): void {
    // Prevent rapid clicks
    if (state.newGameDebounce) return;
    state.newGameDebounce = true;
    setTimeout(() => { state.newGameDebounce = false; }, UI.NEW_GAME_DEBOUNCE_MS);

    // In multiplayer mode, request new game from server
    if (state.isMultiplayerMode && CodenamesClient && CodenamesClient.isConnected()) {
        // Show loading state on new game button
        const newGameBtn = document.getElementById('btn-new-game') as HTMLButtonElement | null;
        if (newGameBtn) {
            newGameBtn.disabled = true;
            newGameBtn.classList.add('loading');
            // Safety timeout to re-enable button if server doesn't respond
            setTimeout(() => {
                newGameBtn.disabled = false;
                newGameBtn.classList.remove('loading');
            }, UI.NEW_GAME_SAFETY_TIMEOUT_MS);
        }
        // Don't clear the board here — wait for the server to confirm
        // the new game via the gameStarted event.  Clearing prematurely
        // causes a blank board if the server rejects the request (e.g.
        // because a game is already in progress).  The gameStarted
        // listener calls syncGameStateFromServer() which handles the
        // full state reset and board render.
        CodenamesClient.startGame({});
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

export function confirmNewGame(): void {
    const cardsRevealed = state.gameState.revealed.filter(r => r).length;
    if (cardsRevealed === 0) {
        newGame();
    } else {
        openModal('confirm-modal');
    }
}

export function closeConfirm(): void {
    closeModal('confirm-modal');
}

export function confirmEndTurn(): void {
    // Show confirmation before ending turn
    openModal('confirm-end-turn-modal');
}

export function closeEndTurnConfirm(): void {
    closeModal('confirm-end-turn-modal');
}

export function loadGameFromURL(): void {
    const params = new URLSearchParams(window.location.search);
    const seed = params.get('game');
    const revealed = params.get('r');
    const turn = params.get('t');
    const redName = params.get('rn');
    const blueName = params.get('bn');
    const encodedWords = params.get('w'); // Custom words encoded in URL

    // Load team names from URL with length and character validation (max 32 chars to match server)
    const sanitizeTeamName = (name: string | null, defaultName: string): string => {
        if (!name) return defaultName;
        // Only allow alphanumeric, spaces, and hyphens (matches server validation)
        const sanitized = name.slice(0, 32).replace(/[^a-zA-Z0-9\s\-]/g, '');
        return sanitized.length > 0 ? sanitized : defaultName;
    };

    if (redName) {
        try {
            const decoded = decodeURIComponent(redName);
            state.teamNames.red = sanitizeTeamName(decoded, 'Red Team');
        } catch {
            // Malformed URL encoding - use default silently
            state.teamNames.red = 'Red Team';
        }
    }
    if (blueName) {
        try {
            const decoded = decodeURIComponent(blueName);
            state.teamNames.blue = sanitizeTeamName(decoded, 'Blue Team');
        } catch {
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

export function updateURL(): void {
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
    if (shareLink) (shareLink as HTMLInputElement).value = url;

    // Update QR code for easy sharing
    updateQRCode(url);
}

// Update QR code with current game URL
// Uses qrcode-generator library (CDN) for reliable QR code generation
export function updateQRCode(url?: string): void {
    const canvas = document.getElementById('qr-canvas') as HTMLCanvasElement | null;
    const shareCanvas = document.getElementById('share-qr-canvas') as HTMLCanvasElement | null;
    const qrSection = document.getElementById('qr-section');
    const shareLinkInput = document.getElementById('share-link-input') as HTMLInputElement | null;
    const targetUrl = url || window.location.href;

    // Update share link input
    if (shareLinkInput) {
        shareLinkInput.value = targetUrl;
    }

    // Check if qrcode-generator library is loaded
    if (typeof qrcode !== 'function') {
        logger.debug('QR code library not loaded, hiding QR section');
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
        function drawQRToCanvas(targetCanvas: HTMLCanvasElement | null): void {
            if (!targetCanvas) return;
            targetCanvas.width = canvasSize;
            targetCanvas.height = canvasSize;
            const ctx = targetCanvas.getContext('2d');

            // Fill background
            ctx!.fillStyle = lightColor;
            ctx!.fillRect(0, 0, canvasSize, canvasSize);

            // Draw modules
            ctx!.fillStyle = darkColor;
            for (let row = 0; row < moduleCount; row++) {
                for (let col = 0; col < moduleCount; col++) {
                    if (qr.isDark(row, col)) {
                        ctx!.fillRect(
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
        logger.error('QR code generation failed:', e);
        // Hide QR section if URL is too long or other error
        if (qrSection) qrSection.style.display = 'none';
    }
}

export function revealCard(index: number): void {
    // Bounds check: prevent out-of-bounds array access
    if (typeof index !== 'number' || index < 0 || index >= state.gameState.words.length) {
        logger.error(`revealCard: invalid index ${index}`);
        return;
    }
    // Provide specific feedback for why card click is blocked
    if (state.gameState.gameOver) {
        showToast(t('game.gameOverStartNew'), 'warning');
        return;
    }
    if (state.gameState.revealed[index]) {
        // Card already revealed - silent return is OK here as it's visually obvious
        return;
    }
    if (!canClickCards()) {
        // Determine specific reason
        if (state.spymasterTeam) {
            showToast(t('game.spymasterCannotReveal'), 'warning');
        } else if (state.clickerTeam && state.clickerTeam !== state.gameState.currentTurn) {
            const currentTeamName = state.gameState.currentTurn === 'red' ? state.teamNames.red : state.teamNames.blue;
            showToast(t('game.notYourTurn', { team: currentTeamName }), 'warning');
        } else if (!state.clickerTeam && !state.playerTeam) {
            showToast(t('game.joinTeamToClick'), 'warning');
        } else if (state.playerTeam && state.playerTeam !== state.gameState.currentTurn) {
            const currentTeamName = state.gameState.currentTurn === 'red' ? state.teamNames.red : state.teamNames.blue;
            showToast(t('game.notYourTurn', { team: currentTeamName }), 'warning');
        } else {
            showToast(t('game.onlyClickerCanReveal'), 'warning');
        }
        return;
    }

    // In multiplayer mode, send reveal to server and let it broadcast
    if (state.isMultiplayerMode && CodenamesClient && CodenamesClient.isConnected()) {
        // Prevent double-click on same card while waiting for server response
        if (state.revealingCards.has(index)) {
            return;
        }
        state.revealingCards.add(index);
        state.isRevealingCard = state.revealingCards.size > 0;

        // Per-card safety timeout: if server doesn't respond in time,
        // clear only this card's pending state (not all cards)
        const timeoutId = setTimeout(() => {
            if (state.revealingCards.has(index)) {
                state.revealingCards.delete(index);
                state.isRevealingCard = state.revealingCards.size > 0;
                const pendingCard = document.querySelector(`.card[data-index="${index}"]`);
                if (pendingCard) (pendingCard as HTMLElement).classList.remove('revealing');
            }
        }, UI.CARD_REVEAL_TIMEOUT_MS);
        state.revealTimeouts.set(index, timeoutId);

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

    // Clear animation tracking after animation completes (animation duration + buffer)
    setTimeout(() => {
        state.lastRevealedIndex = -1;
        state.lastRevealedWasCorrect = false;
    }, UI.ANIMATION_CLEAR_MS);

    // Screen reader announcement
    const word = state.gameState.words[index];
    const typeNames: Record<string, string> = { red: state.teamNames.red, blue: state.teamNames.blue, neutral: 'neutral', assassin: 'assassin' };
    const typeName = typeNames[type] || type;
    announceToScreenReader(t('game.wordRevealedAs', { word, type: typeName }));

    if (state.gameState.gameOver) {
        showGameOverModal();
    }
}

/**
 * Reveal a card from server sync (bypasses local validation)
 * @param index - Card index to reveal
 * @param serverData - Data from server including currentTurn, scores, etc.
 */
export function revealCardFromServer(index: number, serverData: Record<string, any> = {}): void {
    // Bounds check: reject invalid index to prevent array growth from malformed server data
    if (typeof index !== 'number' || index < 0 || index >= state.gameState.words.length) {
        logger.error(`revealCardFromServer: invalid index ${index} (board size: ${state.gameState.words.length})`);
        return;
    }
    if (state.gameState.revealed[index]) return; // Already revealed

    state.gameState.revealed[index] = true;
    // Use server-provided type; fall back to local only if non-null (spymasters have types,
    // non-spymasters have null for unrevealed cards — using null causes wrong scoring)
    const type = serverData.type || state.gameState.types[index] || 'neutral';

    // Bug fix: Update the types array with the revealed type from server
    // This is critical for non-spymasters who have null for unrevealed cards
    if (serverData.type) {
        state.gameState.types[index] = serverData.type;
    }

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

    // Clear clue state when a reveal causes the turn to end (wrong guess, max guesses)
    // The server clears currentClue on turn change but the cardRevealed event only
    // includes a turnEnded flag — no separate turnEnded event is emitted for this path.
    if (serverData.turnEnded && !state.gameState.gameOver) {
        state.gameState.currentClue = null;
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

export function checkGameOver(): void {
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

export function showGameOverModal(_winner?: string | null, _reason?: string): void {
    // Instead of showing a modal, reveal the spymaster view to all players
    // so they can see the board and discuss before the next game.
    // The turn indicator already shows the winner at the top of the board.
    renderBoard();
}

// Alias for multiplayer listener compatibility
export const showGameOver = showGameOverModal;

export function closeGameOver(): void {
    closeModal('game-over-modal');
}

export function endTurn(): void {
    // Provide specific feedback for why end turn is blocked
    if (state.gameState.gameOver) {
        showToast(t('game.gameOverStartNew'), 'warning');
        return;
    }
    if (!state.clickerTeam) {
        showToast(t('game.onlyClickerCanEndTurn'), 'warning');
        return;
    }
    if (state.clickerTeam !== state.gameState.currentTurn) {
        const currentTeamName = state.gameState.currentTurn === 'red' ? state.teamNames.red : state.teamNames.blue;
        showToast(t('game.notYourTurn', { team: currentTeamName }), 'warning');
        return;
    }

    // In multiplayer mode, send end turn to server
    if (state.isMultiplayerMode && CodenamesClient && CodenamesClient.isConnected()) {
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
    announceToScreenReader(t('game.turnEndedAnnounce', { team: newTeamName }));
}

export function updateScoreboard(): void {
    const redRemaining = state.gameState.redTotal - state.gameState.redScore;
    const blueRemaining = state.gameState.blueTotal - state.gameState.blueScore;
    // Use cached elements with fallback
    const redRemainingEl = state.cachedElements.redRemaining || document.getElementById('red-remaining');
    const blueRemainingEl = state.cachedElements.blueRemaining || document.getElementById('blue-remaining');
    const redTeamNameEl = state.cachedElements.redTeamName || document.getElementById('red-team-name');
    const blueTeamNameEl = state.cachedElements.blueTeamName || document.getElementById('blue-team-name');
    if (redRemainingEl) redRemainingEl.textContent = String(redRemaining);
    if (blueRemainingEl) blueRemainingEl.textContent = String(blueRemaining);
    if (redTeamNameEl) redTeamNameEl.textContent = state.teamNames.red;
    if (blueTeamNameEl) blueTeamNameEl.textContent = state.teamNames.blue;
}

export function updateTurnIndicator(): void {
    const indicator = state.cachedElements.turnIndicator || document.getElementById('turn-indicator');
    if (!indicator) return;
    const turnText = indicator.querySelector('.turn-text');
    if (!turnText) return;
    const currentTeamName = state.gameState.currentTurn === 'red' ? state.teamNames.red : state.teamNames.blue;
    const winnerTeamName = state.gameState.winner === 'red' ? state.teamNames.red : state.teamNames.blue;

    if (state.gameState.gameOver) {
        indicator.className = 'turn-indicator game-over';
        if (state.gameMode === 'duet') {
            if (state.gameState.winner) {
                turnText.textContent = t('game.duetVictory');
            } else {
                const assassinIndex = state.gameState.types.indexOf('assassin');
                if (state.gameState.revealed[assassinIndex]) {
                    turnText.textContent = t('game.duetGameOverAssassin');
                } else {
                    turnText.textContent = t('game.duetGameOverTimeout');
                }
            }
        } else {
            const assassinIndex = state.gameState.types.indexOf('assassin');
            if (state.gameState.revealed[assassinIndex]) {
                turnText.textContent = t('game.winnerAssassin', { team: winnerTeamName });
            } else {
                turnText.textContent = t('game.winner', { team: winnerTeamName });
            }
        }
    } else {
        const isYourTurn = state.clickerTeam && state.clickerTeam === state.gameState.currentTurn;
        indicator.className = `turn-indicator ${state.gameState.currentTurn}-turn${isYourTurn ? ' your-turn' : ''}`;

        if (isYourTurn) {
            turnText.textContent = t('game.yourTurnGo', { team: currentTeamName });
        } else {
            turnText.textContent = t('game.teamsTurn', { team: currentTeamName });
        }
    }
}

export async function copyLink(): Promise<void> {
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

    const urlToCopy = (input as HTMLInputElement).value || window.location.href;

    const copied = await copyToClipboard(urlToCopy);
    if (copied) {
        showToast(t('toast.linkCopied'), 'success', 3000);
    } else {
        showToast(t('toast.failedToCopy'), 'warning', 3000);
    }

    // Update feedback for both buttons
    if (btn) {
        btn.textContent = t('game.copiedShort');
    }
    if (linkPanelBtn) {
        linkPanelBtn.querySelector('.copy-text')!.textContent = t('game.copiedShort');
    }
    if (feedback) {
        feedback.textContent = t('toast.linkCopied');
    }

    state.copyButtonTimeoutId = setTimeout(() => {
        if (btn) btn.textContent = COPY_BUTTON_TEXT;
        if (linkPanelBtn) linkPanelBtn.querySelector('.copy-text')!.textContent = t('game.copy');
        if (feedback) feedback.textContent = '';
        state.copyButtonTimeoutId = null;
    }, 3000);
}

// updateRoleBanner and updateControls are imported directly from roles.ts.
// No circular dependency exists: roles.ts imports from state, utils, ui, board
// but does NOT import from game.ts.
