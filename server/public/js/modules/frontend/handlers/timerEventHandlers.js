// ========== TIMER EVENT HANDLERS ==========
// Socket event handlers for turn timer events
import { showToast } from '../ui.js';
import { handleTimerStarted, handleTimerStopped, handleTimerStatus } from '../timer.js';
export function registerTimerHandlers() {
    EigennamenClient.on('timerStatus', (data) => {
        handleTimerStatus(data);
    });
    EigennamenClient.on('timerStarted', (data) => {
        handleTimerStarted(data);
    });
    EigennamenClient.on('timerStopped', (_data) => {
        handleTimerStopped();
    });
    EigennamenClient.on('timerExpired', (_data) => {
        handleTimerStopped();
        showToast('Turn time expired!', 'warning');
    });
}
//# sourceMappingURL=timerEventHandlers.js.map