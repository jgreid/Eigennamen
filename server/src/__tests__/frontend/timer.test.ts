/**
 * Frontend Timer Module Tests
 *
 * Tests the timer display, countdown, and event handling functions.
 * Test environment: jsdom
 */

jest.mock('../../frontend/i18n', () => ({
    t: (key: string) => key,
    initI18n: async () => {},
    setLanguage: async () => {},
    getLanguage: () => 'en',
    translatePage: () => {},
    getLocalizedWordList: async () => null,
    LANGUAGES: { en: { name: 'English', flag: 'EN' } },
    DEFAULT_LANGUAGE: 'en',
}));

import {
    formatTimerValue,
    updateTimerDisplay,
    startTimerCountdown,
    stopTimerCountdown,
    handleTimerStarted,
    handleTimerStopped,
    handleTimerStatus
} from '../../frontend/timer';
import { state } from '../../frontend/state';

beforeEach(() => {
    jest.useFakeTimers();
    // Reset timer state
    state.timerState.active = false;
    state.timerState.endTime = null;
    state.timerState.duration = null;
    state.timerState.remainingSeconds = null;
    state.timerState.serverRemainingSeconds = null;
    state.timerState.countdownStartTime = null;
    state.timerState.intervalId = null;

    // Set up DOM
    document.body.innerHTML = `
        <div id="timer-display"><span id="timer-value">--:--</span></div>
        <div id="sr-announcements" aria-live="assertive"></div>
    `;
    state.cachedElements.timerDisplay = document.getElementById('timer-display');
    state.cachedElements.timerValue = document.getElementById('timer-value');
});

afterEach(() => {
    stopTimerCountdown();
    jest.useRealTimers();
});

describe('formatTimerValue', () => {
    test('returns --:-- for null', () => {
        expect(formatTimerValue(null)).toBe('--:--');
    });

    test('returns --:-- for undefined', () => {
        expect(formatTimerValue(undefined)).toBe('--:--');
    });

    test('returns --:-- for negative values', () => {
        expect(formatTimerValue(-1)).toBe('--:--');
        expect(formatTimerValue(-100)).toBe('--:--');
    });

    test('formats zero seconds', () => {
        expect(formatTimerValue(0)).toBe('0:00');
    });

    test('formats seconds under a minute', () => {
        expect(formatTimerValue(5)).toBe('0:05');
        expect(formatTimerValue(30)).toBe('0:30');
        expect(formatTimerValue(59)).toBe('0:59');
    });

    test('formats exact minutes', () => {
        expect(formatTimerValue(60)).toBe('1:00');
        expect(formatTimerValue(120)).toBe('2:00');
        expect(formatTimerValue(300)).toBe('5:00');
    });

    test('formats minutes and seconds', () => {
        expect(formatTimerValue(90)).toBe('1:30');
        expect(formatTimerValue(125)).toBe('2:05');
        expect(formatTimerValue(3661)).toBe('61:01');
    });

    test('pads single-digit seconds', () => {
        expect(formatTimerValue(61)).toBe('1:01');
        expect(formatTimerValue(9)).toBe('0:09');
    });
});

describe('updateTimerDisplay', () => {
    test('removes active class when timer is not active', () => {
        state.timerState.active = false;
        const display = document.getElementById('timer-display')!;
        display.classList.add('active');

        updateTimerDisplay();

        expect(display.classList.contains('active')).toBe(false);
        expect(document.getElementById('timer-value')!.textContent).toBe('--:--');
    });

    test('shows formatted time when active', () => {
        state.timerState.active = true;
        state.timerState.remainingSeconds = 90;

        updateTimerDisplay();

        const display = document.getElementById('timer-display')!;
        expect(display.classList.contains('active')).toBe(true);
        expect(document.getElementById('timer-value')!.textContent).toBe('1:30');
    });

    test('adds warning class when remaining <= warning threshold', () => {
        state.timerState.active = true;
        state.timerState.remainingSeconds = 25; // below 30s warning threshold

        updateTimerDisplay();

        const display = document.getElementById('timer-display')!;
        expect(display.classList.contains('warning')).toBe(true);
        expect(display.classList.contains('critical')).toBe(false);
    });

    test('adds critical class when remaining <= critical threshold', () => {
        state.timerState.active = true;
        state.timerState.remainingSeconds = 5; // below 10s critical threshold

        updateTimerDisplay();

        const display = document.getElementById('timer-display')!;
        expect(display.classList.contains('critical')).toBe(true);
        expect(display.classList.contains('warning')).toBe(false);
    });

    test('removes warning/critical when remaining is above thresholds', () => {
        state.timerState.active = true;
        state.timerState.remainingSeconds = 60;
        const display = document.getElementById('timer-display')!;
        display.classList.add('warning', 'critical');

        updateTimerDisplay();

        expect(display.classList.contains('warning')).toBe(false);
        expect(display.classList.contains('critical')).toBe(false);
    });

    test('shows --:-- when remainingSeconds is null', () => {
        state.timerState.active = true;
        state.timerState.remainingSeconds = null;

        updateTimerDisplay();

        const display = document.getElementById('timer-display')!;
        expect(display.classList.contains('active')).toBe(false);
        expect(document.getElementById('timer-value')!.textContent).toBe('--:--');
    });
});

describe('handleTimerStarted', () => {
    test('activates timer with duration and remaining', () => {
        handleTimerStarted({ duration: 60, remainingSeconds: 58 });

        expect(state.timerState.active).toBe(true);
        expect(state.timerState.duration).toBe(60);
        expect(state.timerState.serverRemainingSeconds).toBe(58);
        expect(state.timerState.remainingSeconds).toBe(58);
    });

    test('uses durationSeconds as fallback', () => {
        handleTimerStarted({ durationSeconds: 90 });

        expect(state.timerState.duration).toBe(90);
        expect(state.timerState.serverRemainingSeconds).toBe(90);
    });

    test('stores endTime', () => {
        const endTime = Date.now() + 60000;
        handleTimerStarted({ endTime, duration: 60, remainingSeconds: 60 });

        expect(state.timerState.endTime).toBe(endTime);
    });
});

describe('handleTimerStopped', () => {
    test('deactivates timer and clears all state', () => {
        state.timerState.active = true;
        state.timerState.endTime = Date.now();
        state.timerState.remainingSeconds = 30;
        state.timerState.serverRemainingSeconds = 30;
        state.timerState.countdownStartTime = 1000;

        handleTimerStopped();

        expect(state.timerState.active).toBe(false);
        expect(state.timerState.endTime).toBeNull();
        expect(state.timerState.remainingSeconds).toBeNull();
        expect(state.timerState.serverRemainingSeconds).toBeNull();
        expect(state.timerState.countdownStartTime).toBeNull();
    });
});

describe('handleTimerStatus', () => {
    test('starts timer when data indicates active', () => {
        handleTimerStatus({ active: true, remainingSeconds: 45, duration: 60 });

        expect(state.timerState.active).toBe(true);
        expect(state.timerState.serverRemainingSeconds).toBe(45);
        expect(state.timerState.duration).toBe(60);
    });

    test('starts timer when remainingSeconds > 0 even if active is not set', () => {
        handleTimerStatus({ remainingSeconds: 30 });

        expect(state.timerState.active).toBe(true);
        expect(state.timerState.serverRemainingSeconds).toBe(30);
    });

    test('stops timer when data indicates inactive', () => {
        state.timerState.active = true;
        state.timerState.remainingSeconds = 10;

        handleTimerStatus({ active: false, remainingSeconds: 0 });

        expect(state.timerState.active).toBe(false);
        expect(state.timerState.remainingSeconds).toBeNull();
    });

    test('stops timer for null/undefined data fields', () => {
        state.timerState.active = true;

        handleTimerStatus({});

        expect(state.timerState.active).toBe(false);
    });

    test('uses remaining as fallback for remainingSeconds', () => {
        handleTimerStatus({ active: true, remaining: 20 });

        expect(state.timerState.serverRemainingSeconds).toBe(20);
    });
});

describe('stopTimerCountdown', () => {
    test('clears interval when running', () => {
        state.timerState.intervalId = setInterval(() => {}, 1000);
        expect(state.timerState.intervalId).not.toBeNull();

        stopTimerCountdown();

        expect(state.timerState.intervalId).toBeNull();
    });

    test('handles no interval gracefully', () => {
        state.timerState.intervalId = null;
        expect(() => stopTimerCountdown()).not.toThrow();
    });
});
