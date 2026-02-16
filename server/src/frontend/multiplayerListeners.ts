// ========== MULTIPLAYER LISTENERS ==========
// Thin orchestrator that registers all domain-specific socket event handlers.
// Each handler module is focused on a single domain (game, player, room, timer, chat).

import { registerGameHandlers } from './handlers/gameEventHandlers.js';
import { registerPlayerHandlers } from './handlers/playerEventHandlers.js';
import { registerRoomHandlers } from './handlers/roomEventHandlers.js';
import { registerTimerHandlers } from './handlers/timerEventHandlers.js';
import { registerChatAndErrorHandlers } from './handlers/chatEventHandlers.js';

// Re-export for backward compatibility
export { getErrorMessage } from './handlers/errorMessages.js';

export function setupMultiplayerListeners(): void {
    registerGameHandlers();
    registerPlayerHandlers();
    registerRoomHandlers();
    registerTimerHandlers();
    registerChatAndErrorHandlers();
}
