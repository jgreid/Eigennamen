import { showToast } from '../ui.js';
import { logger } from '../logger.js';
import { handleChatMessage } from '../chat.js';
import { handleSpectatorChatMessage } from '../multiplayerUI.js';
import { revertAndClearRoleChange } from '../roles.js';
import { state } from '../state.js';
import type {
    ChatMessageData, SpectatorChatData,
    HistoryResultData, ReplayData, ServerErrorData
} from '../multiplayerTypes.js';
import { getErrorMessage } from './errorMessages.js';

export function registerChatAndErrorHandlers(): void {
    // Handle chat messages
    EigennamenClient.on('chatMessage', (data: ChatMessageData) => {
        handleChatMessage(data);
    });

    // Handle spectator chat messages
    EigennamenClient.on('spectatorChatMessage', (data: SpectatorChatData) => {
        handleSpectatorChatMessage(data);
    });

    // Game history events
    EigennamenClient.on('historyResult', (data: HistoryResultData) => {
        // Import dynamically to avoid circular dependency
        import('../history.js').then(({ renderGameHistory }) => {
            renderGameHistory(data.games || []);
        }).catch((err: unknown) => {
            logger.error('Failed to load history module:', err);
            showToast('Could not load game history', 'error');
        });
    });

    EigennamenClient.on('replayData', (data: ReplayData) => {
        import('../history.js').then(({ renderReplayData }) => {
            renderReplayData(data);
        }).catch((err: unknown) => {
            logger.error('Failed to load history module:', err);
            showToast('Could not load replay data', 'error');
        });
    });

    // Error handling for game actions
    EigennamenClient.on('error', (error: ServerErrorData) => {
        // Log full error details for debugging
        logger.error('Multiplayer error:', JSON.stringify(error, null, 2));

        // Revert optimistic UI then clear role change state
        revertAndClearRoleChange();

        // Clear any in-progress card reveal flags
        state.revealingCards.clear();
        state.isRevealingCard = false;
        document.querySelectorAll('.card.revealing').forEach(c => c.classList.remove('revealing'));

        // Map technical error codes to user-friendly messages
        showToast(getErrorMessage(error), 'error');
    });
}
