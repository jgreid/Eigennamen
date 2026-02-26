import { state } from '../state.js';
import { showToast, announceToScreenReader } from '../ui.js';
import { renderBoard } from '../board.js';
import { revealCardFromServer, showGameOver, updateTurnIndicator } from '../game.js';
import { updateRoleBanner, updateControls } from '../roles.js';
import { playNotificationSound, setTabNotification, checkAndNotifyTurn } from '../notifications.js';
import {
    updateDuetUI, updateDuetInfoBar, updateForfeitButton
} from '../multiplayerUI.js';
import { syncGameStateFromServer } from '../multiplayerSync.js';
import type {
    GameStartedData, CardRevealedData, TurnEndedData,
    GameOverData, SpymasterViewData
} from '../multiplayerTypes.js';

export function registerGameHandlers(): void {
    EigennamenClient.on('gameStarted', (data: GameStartedData) => {
        // Clear loading state on new game button
        const newGameBtn = document.getElementById('btn-new-game') as HTMLButtonElement;
        if (newGameBtn) {
            newGameBtn.disabled = false;
            newGameBtn.classList.remove('loading');
        }

        // Full sync game state from server for new games
        if (data.game) {
            syncGameStateFromServer(data.game);
            state.gameMode = data.gameMode || 'classic';
            updateDuetUI(data.game);
            updateForfeitButton();
            const modeLabels: Record<string, string> = { blitz: 'Blitz game started!', duet: 'Duet game started!', classic: 'New game started!' };
            const label = modeLabels[data.gameMode || 'classic'] || 'New game started!';
            // All roles are reset to spectator on new game — guide players to pick a role
            showToast(`${label} Pick your team and role to play.`, 'success', 5000);
        }
    });

    EigennamenClient.on('cardRevealed', (data: CardRevealedData) => {
        // Skip stale reveals during a full state resync
        if (state.resyncInProgress) return;
        // Clear per-card reveal tracking for the revealed card
        if (data.index !== undefined) {
            state.revealingCards.delete(data.index);
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
        // Duet mode can have null winner (cooperative loss)
        if (data.winner || state.gameMode === 'duet') {
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
        }
    });

    // Handle spymaster view (card types for spymasters)
    EigennamenClient.on('spymasterView', (data: SpymasterViewData) => {
        if (data.types && Array.isArray(data.types)) {
            state.gameState.types = data.types;
            renderBoard();
        }
    });
}
