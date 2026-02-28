import { state, BOARD_SIZE, FIRST_TEAM_CARDS, SECOND_TEAM_CARDS, NEUTRAL_CARDS, ASSASSIN_CARDS, DEFAULT_WORDS } from './state.js';
import { hashString, shuffleWithSeed, generateGameSeed, seededRandom, decodeWordsFromURL } from './utils.js';
import { showToast, openModal, closeModal, announceToScreenReader } from './ui.js';
import { renderBoard } from './board.js';
import { updateRoleBanner, updateControls } from './roles.js';
import { UI } from './constants.js';
import { t } from './i18n.js';
import { updateURL } from './url-state.js';
import { isClientConnected } from './clientAccessor.js';
import { checkGameOver, updateScoreboard, updateTurnIndicator } from './game/scoring.js';
import { showGameOverModal } from './game/reveal.js';

// Re-export sub-module APIs so existing consumers don't break
export { checkGameOver, updateScoreboard, updateTurnIndicator, updateMatchScoreboard } from './game/scoring.js';
export { revealCard, revealCardFromServer, showGameOverModal, showGameOver, closeGameOver } from './game/reveal.js';

// Re-export URL functions so existing consumers don't break
export { updateURL } from './url-state.js';

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
    if (state.isMultiplayerMode && isClientConnected()) {
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
        EigennamenClient.startGame({});
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
    if (state.isMultiplayerMode && isClientConnected()) {
        EigennamenClient.endTurn();
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
