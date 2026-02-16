// ========== TIMER EVENT HANDLERS ==========
// Socket event handlers for turn timer events

import { showToast } from '../ui.js';
import { handleTimerStarted, handleTimerStopped, handleTimerStatus } from '../timer.js';
import type { TimerEventData } from '../multiplayerTypes.js';

export function registerTimerHandlers(): void {
    CodenamesClient.on('timerStatus', (data: TimerEventData) => {
        handleTimerStatus(data);
    });

    CodenamesClient.on('timerStarted', (data: TimerEventData) => {
        handleTimerStarted(data);
    });

    CodenamesClient.on('timerStopped', (_data: unknown) => {
        handleTimerStopped();
    });

    CodenamesClient.on('timerExpired', (_data: unknown) => {
        handleTimerStopped();
        showToast('Turn time expired!', 'warning');
    });
}
