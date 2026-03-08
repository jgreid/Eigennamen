import { state } from '../state.js';
import { showToast, announceToScreenReader } from '../ui.js';
import { renderBoard } from '../board.js';
import {
    revealCardFromServer,
    showGameOver,
    closeGameOver,
    updateTurnIndicator,
    updateMatchScoreboard,
} from '../game.js';
import { updateRoleBanner, updateControls } from '../roles.js';
import { playNotificationSound, setTabNotification, checkAndNotifyTurn } from '../notifications.js';
import { updateDuetUI, updateDuetInfoBar, updateForfeitButton } from '../multiplayerUI.js';
import { syncGameStateFromServer } from '../multiplayerSync.js';
import type {
    GameStartedData,
    CardRevealedData,
    TurnEndedData,
    GameOverData,
    SpymasterViewData,
    RoundEndedData,
    MatchOverData,
} from '../multiplayerTypes.js';

export function registerGameHandlers(): void {
    EigennamenClient.on('gameStarted', (data: GameStartedData) => {
        // Close any stale game-over modal — after forfeit/abandon + new game,
        // the gameOver event opens this modal before the new game starts.
        // Without this, the modal covers the new game and forces the user
        // to interact through its "New Game" button (bypassing confirmNewGame).
        closeGameOver();

        // Clear loading state on all new game buttons (sidebar + game over modal)
        const newGameBtns = document.querySelectorAll('.btn-new-game') as NodeListOf<HTMLButtonElement>;
        newGameBtns.forEach((btn) => {
            btn.disabled = false;
            btn.classList.remove('loading');
        });
        // Clear debounce so the button is immediately usable
        state.newGameDebounce = false;

        // Full sync game state from server for new games
        if (data.game) {
            // Clear stale reveal tracking from previous game before syncing new state.
            // Without this, cards that were pending reveal in the old game would block
            // clicks on the same indices in the new game.
            state.revealTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
            state.revealTimeouts.clear();
            state.revealingCards.clear();
            state.revealTimestamps.clear();
            state.isRevealingCard = false;

            // Cancel any pending reveal rAF from the old game to prevent orphaned
            // callbacks from adding 'revealed' classes to the new game's board.
            if (state.pendingRevealRAF !== null) {
                cancelAnimationFrame(state.pendingRevealRAF);
                state.pendingRevealRAF = null;
            }
            // Bump the game generation so any rAFs that were already dispatched
            // (and thus uncancellable) will detect the stale generation and skip.
            state.gameGeneration = (state.gameGeneration ?? 0) + 1;

            syncGameStateFromServer(data.game);
            state.gameMode = data.gameMode || 'match';
            updateDuetUI(data.game);
            updateForfeitButton();
            if (data.isNextRound) {
                const round = data.game?.matchRound ?? 2;
                showToast(`Round ${round} started! Roles have been rotated.`, 'success', 5000);
            } else {
                const modeLabels: Record<string, string> = {
                    duet: 'Duet game started!',
                    match: 'Eigennamen started!',
                    classic: 'New game started!',
                };
                const label = modeLabels[data.gameMode || 'match'] || 'New game started!';
                showToast(`${label} Pick your team and role to play.`, 'success', 5000);
            }
        }
    });

    EigennamenClient.on('cardRevealed', (data: CardRevealedData) => {
        // Skip stale reveals during a full state resync
        if (state.resyncInProgress) return;
        // Clear per-card reveal tracking for the revealed card
        if (data.index !== undefined) {
            state.revealingCards.delete(data.index);
            state.revealTimestamps.delete(data.index);
            const revealTimeout = state.revealTimeouts.get(data.index);
            if (revealTimeout) {
                clearTimeout(revealTimeout);
                state.revealTimeouts.delete(data.index);
            }
        }
        state.isRevealingCard = state.revealingCards.size > 0;

        // Remove pending visual state from the revealed card
        if (data.index !== undefined) {
            const card = document.querySelector(`.card[data-index="${data.index}"]`);
            if (card) card.classList.remove('revealing');
        }

        if (data.index !== undefined) {
            revealCardFromServer(data.index, data);
            playNotificationSound('reveal');

            // Announce card reveal to screen readers
            const word = data.word || (state.gameState.words && state.gameState.words[data.index]) || '';
            const type = data.type || '';
            if (word) {
                announceToScreenReader(`Card revealed: ${word}. ${type} card.`);
            }
        }

        // Update Duet info if present
        if (data.timerTokens !== undefined || data.greenFound !== undefined) {
            updateDuetInfoBar(data.greenFound || 0, data.timerTokens);
        }

        // Update match mode scores if present
        if (data.redMatchScore !== undefined || data.blueMatchScore !== undefined) {
            if (typeof data.redMatchScore === 'number') state.gameState.redMatchScore = data.redMatchScore;
            if (typeof data.blueMatchScore === 'number') state.gameState.blueMatchScore = data.blueMatchScore;
            updateMatchScoreboard();
        }
    });

    EigennamenClient.on('turnEnded', (data: TurnEndedData) => {
        if (state.resyncInProgress) return;
        if (data.currentTurn) {
            const previousTurn = state.gameState.currentTurn;
            // Update turn locally
            state.gameState.currentTurn = data.currentTurn;

            // Reset clue and guess state for new turn
            state.gameState.currentClue = null;
            state.gameState.guessesUsed = 0;
            state.gameState.guessesAllowed = 0;

            updateTurnIndicator();
            updateRoleBanner();
            updateControls();
            // Re-render board so the no-click class updates for the new turn's team
            renderBoard();

            // Check and send notifications if it's now our turn
            checkAndNotifyTurn(data.currentTurn, previousTurn);

            // Announce turn change
            const newTeamName = data.currentTurn === 'red' ? state.teamNames.red : state.teamNames.blue;
            announceToScreenReader(`Turn ended. Now ${newTeamName}'s turn.`);
        }
    });

    EigennamenClient.on('gameOver', (data: GameOverData) => {
        // Sync all card types from server so non-spymasters can see the full board
        if (data.types && Array.isArray(data.types)) {
            state.gameState.types = data.types;
        }
        if (data.duetTypes && Array.isArray(data.duetTypes)) {
            state.gameState.duetTypes = data.duetTypes;
        }
        state.gameState.gameOver = true;
        state.gameState.winner = data.winner || null;

        if (state.gameMode === 'duet') {
            const duetWin = data.reason === 'completed';
            showGameOver(duetWin ? 'red' : null, data.reason);
        } else {
            showGameOver(data.winner || null, data.reason);
        }
        setTabNotification(false);
        playNotificationSound('gameOver');
        updateForfeitButton();
    });

    // Handle spymaster view (card types for spymasters)
    EigennamenClient.on('spymasterView', (data: SpymasterViewData) => {
        let changed = false;
        if (data.types && Array.isArray(data.types)) {
            state.gameState.types = data.types;
            changed = true;
        }
        if (data.cardScores && Array.isArray(data.cardScores)) {
            state.gameState.cardScores = data.cardScores;
            changed = true;
        }
        if (changed) {
            renderBoard();
        }
    });

    // Match mode: round ended (round over but match continues)
    EigennamenClient.on('game:roundEnded', (data: RoundEndedData) => {
        if (!data.roundResult) return;

        // Update cumulative match scores
        state.gameState.redMatchScore = data.redMatchScore ?? state.gameState.redMatchScore;
        state.gameState.blueMatchScore = data.blueMatchScore ?? state.gameState.blueMatchScore;
        state.gameState.matchRound = data.matchRound ?? state.gameState.matchRound;

        // Append round result to history
        if (!state.gameState.roundHistory) state.gameState.roundHistory = [];
        state.gameState.roundHistory.push(data.roundResult);

        updateMatchScoreboard();
        showRoundSummary(data.roundResult, data.redMatchScore, data.blueMatchScore);
    });

    // Match mode: match over (final round complete, overall winner determined)
    EigennamenClient.on('game:matchOver', (data: MatchOverData) => {
        if (!data.roundResult) return;

        state.gameState.redMatchScore = data.redMatchScore ?? state.gameState.redMatchScore;
        state.gameState.blueMatchScore = data.blueMatchScore ?? state.gameState.blueMatchScore;
        state.gameState.matchOver = true;
        state.gameState.matchWinner = data.matchWinner ?? null;

        if (!state.gameState.roundHistory) state.gameState.roundHistory = [];
        state.gameState.roundHistory.push(data.roundResult);

        updateMatchScoreboard();
        showMatchOverSummary(data);
        playNotificationSound('gameOver');
    });
}

/**
 * Show a round summary toast/modal for match mode.
 */
function showRoundSummary(
    roundResult: RoundEndedData['roundResult'],
    redMatchScore: number,
    blueMatchScore: number
): void {
    const roundWinner = roundResult.roundWinner;
    const winnerName = roundWinner === 'red' ? state.teamNames.red : state.teamNames.blue;
    const bonusText = roundResult.redBonusAwarded || roundResult.blueBonusAwarded ? ' (+7 bonus)' : '';

    const msg =
        `Round ${roundResult.roundNumber} complete! ${winnerName} wins${bonusText}. ` +
        `Match: ${state.teamNames.red} ${redMatchScore} - ${blueMatchScore} ${state.teamNames.blue}`;
    showToast(msg, 'info', 8000);
}

/**
 * Show the match-over summary.
 */
function showMatchOverSummary(data: MatchOverData): void {
    const winnerName = data.matchWinner === 'red' ? state.teamNames.red : state.teamNames.blue;
    const msg = `Match over! ${winnerName} wins ${data.redMatchScore} - ${data.blueMatchScore}!`;
    showToast(msg, 'success', 12000);
    announceToScreenReader(msg);
}
