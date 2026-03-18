// Barrel re-export — split into focused sub-modules for maintainability.
// All existing imports from './multiplayerUI.js' continue to work unchanged.

export {
    updateMpIndicator,
    copyRoomId,
    updatePlayerList,
    initPlayerListUI,
    closeKickConfirm,
    confirmKickPlayer,
    initNicknameEditUI,
} from './multiplayerUI-player.js';

export {
    updateRoomSettingsNavVisibility,
    syncGameModeUI,
    syncTurnTimerUI,
    confirmForfeit,
    closeForfeitConfirm,
    forfeitGame,
    updateForfeitButton,
} from './multiplayerUI-settings.js';

export {
    updateDuetUI,
    updateDuetInfoBar,
    updateSpectatorCount,
    updateRoomStats,
    handleSpectatorChatMessage,
    sendSpectatorChat,
    showReconnectionOverlay,
    hideReconnectionOverlay,
} from './multiplayerUI-status.js';
