// ========== TIMER EVENT HANDLERS ==========
// Socket event handlers for turn timer events

import { showToast } from '../ui.js';
import { handleTimerStarted, handleTimerStopped, handleTimerStatus } from '../timer.js';
import type { TimerEventData } from '../multiplayerTypes.js';

export function registerTimerHandlers(): void {
    EigennamenClient.on('timerStatus', (data: TimerEventData) => {
        handleTimerStatus(data);
    });

    EigennamenClient.on('timerStarted', (data: TimerEventData) => {
        handleTimerStarted(data);
    });

    EigennamenClient.on('timerStopped', (_data: unknown) => {
        handleTimerStopped();
    });

    EigennamenClient.on('timerExpired', (_data: unknown) => {
        handleTimerStopped();
        showToast('Turn time expired!', 'warning');
    });
}
