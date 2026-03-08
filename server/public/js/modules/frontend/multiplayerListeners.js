import { state } from './state.js';
import { getClient } from './clientAccessor.js';
import { registerGameHandlers } from './handlers/gameEventHandlers.js';
import { registerPlayerHandlers } from './handlers/playerEventHandlers.js';
import { registerRoomHandlers } from './handlers/roomEventHandlers.js';
import { registerTimerHandlers } from './handlers/timerEventHandlers.js';
import { registerChatAndErrorHandlers } from './handlers/chatEventHandlers.js';
/**
 * Register all multiplayer event listeners.
 * Idempotent — returns immediately if listeners are already registered,
 * preventing duplicate handlers from stacking up.
 */
export function setupMultiplayerListeners() {
    if (state.multiplayerListenersSetup)
        return;
    if (!getClient()) {
        console.error('setupMultiplayerListeners: EigennamenClient not loaded');
        return;
    }
    registerGameHandlers();
    registerPlayerHandlers();
    registerRoomHandlers();
    registerTimerHandlers();
    registerChatAndErrorHandlers();
    state.multiplayerListenersSetup = true;
}
//# sourceMappingURL=multiplayerListeners.js.map