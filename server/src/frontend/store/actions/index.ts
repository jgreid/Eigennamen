/**
 * Actions barrel — re-exports all domain action modules.
 *
 * Usage:
 *   import { resetGame, setGameOver } from './store/actions/index.js';
 *   // or
 *   import * as gameActions from './store/actions/gameActions.js';
 */

export {
    resetGame,
    setGameOver,
    syncScores,
    syncBoardData,
    syncTurnAndMetadata,
    clearRevealTracking,
} from './gameActions.js';

export {
    setPlayerRole,
    clearPlayerRole,
    syncLocalPlayerState,
    setHost,
    setPlayers,
    addPlayer,
    removePlayer,
    updatePlayer,
} from './playerActions.js';

export { joinedRoom, setMpMode, setResyncInProgress, setSpectatorCount } from './multiplayerActions.js';

export { startTimer, stopTimer, tickTimer, setTimerInterval, setCountdownStartTime } from './timerActions.js';

export { setBoardInitialized, setColorBlindMode, setActiveModal, setLanguage, setGameMode } from './uiActions.js';

export { openReplay, stepReplay, setReplayPlaying, setReplayInterval, clearReplay } from './replayActions.js';

export { setTeamNames, setActiveWords, setWordSource } from './settingsActions.js';
