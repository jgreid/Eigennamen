import { showToast } from '../ui.js';
import { logger } from '../logger.js';
import { handleChatMessage } from '../chat.js';
import { handleSpectatorChatMessage } from '../multiplayerUI.js';
import { revertAndClearRoleChange } from '../roles.js';
import { state } from '../state.js';
import { getErrorMessage } from './errorMessages.js';
export function registerChatAndErrorHandlers() {
    // Handle chat messages
    EigennamenClient.on('chatMessage', (data) => {
        handleChatMessage(data);
    });
    // Handle spectator chat messages
    EigennamenClient.on('spectatorChatMessage', (data) => {
        handleSpectatorChatMessage(data);
    });
    // Game history events
    EigennamenClient.on('historyResult', (data) => {
        // Import dynamically to avoid circular dependency
        import('../history.js')
            .then(({ renderGameHistory }) => {
            renderGameHistory(data.history || []);
        })
            .catch((err) => {
            logger.error('Failed to load history module:', err);
            showToast('Could not load game history', 'error');
        });
    });
    EigennamenClient.on('replayData', (data) => {
        import('../history.js')
            .then(({ renderReplayData }) => {
            renderReplayData(data);
        })
            .catch((err) => {
            logger.error('Failed to load history module:', err);
            showToast('Could not load replay data', 'error');
        });
    });
    // Error handling for game actions
    EigennamenClient.on('error', (error) => {
        // Log full error details for debugging
        logger.error('Multiplayer error:', JSON.stringify(error, null, 2));
        // Revert optimistic UI then clear role change state
        revertAndClearRoleChange();
        // Clear any in-progress card reveal flags
        state.revealingCards.clear();
        state.isRevealingCard = false;
        document.querySelectorAll('.card.revealing').forEach((c) => c.classList.remove('revealing'));
        // Map technical error codes to user-friendly messages
        showToast(getErrorMessage(error), 'error');
    });
}
//# sourceMappingURL=chatEventHandlers.js.map