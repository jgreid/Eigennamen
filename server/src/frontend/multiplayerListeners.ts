// ========== MULTIPLAYER LISTENERS ==========
// Thin orchestrator that registers all domain-specific socket event handlers.
// Each handler module is focused on a single domain (game, player, room, timer, chat).

import { state } from './state.js';
import { getClient } from './clientAccessor.js';
import { registerGameHandlers } from './handlers/gameEventHandlers.js';
import { registerPlayerHandlers } from './handlers/playerEventHandlers.js';
import { registerRoomHandlers } from './handlers/roomEventHandlers.js';
import { registerTimerHandlers } from './handlers/timerEventHandlers.js';
import { registerChatAndErrorHandlers } from './handlers/chatEventHandlers.js';

// Re-export for backward compatibility
export { getErrorMessage } from './handlers/errorMessages.js';

/**
 * Register all multiplayer event listeners.
 * Idempotent — returns immediately if listeners are already registered,
 * preventing duplicate handlers from stacking up.
 */
export function setupMultiplayerListeners(): void {
    if (state.multiplayerListenersSetup) return;
    if (!getClient()) {
        console.error('setupMultiplayerListeners: CodenamesClient not loaded');
        return;
    }
    registerGameHandlers();
    registerPlayerHandlers();
    registerRoomHandlers();
    registerTimerHandlers();
    registerChatAndErrorHandlers();
    state.multiplayerListenersSetup = true;
}
