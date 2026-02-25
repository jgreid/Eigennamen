/**
 * Store — public API for the state management system.
 *
 * Re-exports the core primitives so consumers import from one place:
 *   import { subscribe, batch } from './store/index.js';
 */

export { subscribe, emit, clearAllListeners, getListenerCount } from './eventBus.js';
export type { StateChangeEvent } from './eventBus.js';
export { batch, isBatching } from './batch.js';
export { createReactiveProxy } from './reactiveProxy.js';

// Selectors — derived state
export {
    isSpymaster, isClicker, hasTeam, hasRole,
    isPlayerTurn, isTeamOnTurn,
    showSpymasterView, gameInProgress,
    redRemaining, blueRemaining,
    currentTeamName, teamName,
    isCurrentTeamClickerUnavailable, isClickerFallback, canActAsClicker,
    isDuetMode, playerCount,
} from './selectors.js';
