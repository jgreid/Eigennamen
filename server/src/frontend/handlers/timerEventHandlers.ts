import { showToast } from '../ui.js';
import { t } from '../i18n.js';
import { handleTimerStarted, handleTimerStopped, handleTimerStatus, handleTimerPaused } from '../timer.js';
import type { TimerEventData } from '../multiplayerTypes.js';

export function registerTimerHandlers(): void {
    EigennamenClient.on('timerStatus', (data: TimerEventData) => {
        handleTimerStatus(data);
    });

    EigennamenClient.on('timerStarted', (data: TimerEventData) => {
        handleTimerStarted(data);
    });

    // Timer frozen by a game pause — stop the local countdown so it doesn't
    // drift while the pause overlay is up.
    EigennamenClient.on('timerPaused', (_data: TimerEventData) => {
        handleTimerPaused();
    });

    // Timer resumed — restart the local countdown from the server's fresh
    // remaining time / end time (same shape handleTimerStarted expects).
    EigennamenClient.on('timerResumed', (data: TimerEventData) => {
        handleTimerStarted(data);
    });

    EigennamenClient.on('timerStopped', (_data: unknown) => {
        handleTimerStopped();
    });

    EigennamenClient.on('timerExpired', (_data: unknown) => {
        handleTimerStopped();
        showToast(t('timer.expired'), 'warning');
    });
}
