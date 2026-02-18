/**
 * Frontend Notifications Module Tests
 *
 * Tests notification preferences, tab notifications, and turn detection.
 * Test environment: jsdom
 */

jest.mock('../../frontend/i18n', () => ({
    t: (key: string) => {
        const translations: Record<string, string> = {
            'notifications.yourTurn': "It's Your Turn!",
            'chat.teamOnly': 'Team Only',
        };
        return translations[key] || key;
    },
    initI18n: async () => {},
    setLanguage: async () => {},
    getLanguage: () => 'en',
    translatePage: () => {},
    getLocalizedWordList: async () => null,
    LANGUAGES: { en: { name: 'English', flag: 'EN' } },
    DEFAULT_LANGUAGE: 'en',
}));

import {
    loadNotificationPrefs,
    saveNotificationPrefs,
    setTabNotification,
    checkAndNotifyTurn,
    playNotificationSound,
    playTone,
    initNotificationPrefsUI,
} from '../../frontend/notifications';
import { state } from '../../frontend/state';

// Mock Web Audio API
const mockOscillator = {
    type: '' as OscillatorType,
    frequency: { setValueAtTime: jest.fn() },
    connect: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
};

const _mockGainNode = {
    gain: {
        setValueAtTime: jest.fn(),
        linearRampToValueAtTime: jest.fn(),
        exponentialRampToValueAtTime: jest.fn(),
    },
    connect: jest.fn(),
};

const mockAudioContext = {
    createOscillator: jest.fn(() => ({ ...mockOscillator })),
    createGain: jest.fn(() => ({
        gain: {
            setValueAtTime: jest.fn(),
            linearRampToValueAtTime: jest.fn(),
            exponentialRampToValueAtTime: jest.fn(),
        },
        connect: jest.fn(),
    })),
    currentTime: 0,
    state: 'running',
    destination: {},
    resume: jest.fn(),
};

beforeEach(() => {
    state.notificationPrefs.soundEnabled = false;
    state.notificationPrefs.tabNotificationEnabled = false;
    state.audioContext = null;
    state.originalDocumentTitle = 'Eigennamen';
    state.clickerTeam = null;
    document.title = 'Eigennamen';

    // Reset localStorage
    localStorage.clear();

    // Mock AudioContext
    (window as any).AudioContext = jest.fn(() => ({ ...mockAudioContext }));
    (window as any).webkitAudioContext = jest.fn(() => ({ ...mockAudioContext }));

    document.body.innerHTML = `
        <input id="pref-sound-notifications" type="checkbox" />
        <input id="pref-tab-notification" type="checkbox" />
        <button id="btn-test-sound">Test</button>
    `;
});

// ========== NOTIFICATION PREFERENCES ==========

describe('loadNotificationPrefs', () => {
    test('loads sound enabled from localStorage', () => {
        localStorage.setItem('eigennamen-pref-sound', 'true');
        loadNotificationPrefs();
        expect(state.notificationPrefs.soundEnabled).toBe(true);
    });

    test('loads tab notification from localStorage', () => {
        localStorage.setItem('eigennamen-pref-tab-notification', 'true');
        loadNotificationPrefs();
        expect(state.notificationPrefs.tabNotificationEnabled).toBe(true);
    });

    test('defaults to false when not in localStorage', () => {
        loadNotificationPrefs();
        expect(state.notificationPrefs.soundEnabled).toBe(false);
        expect(state.notificationPrefs.tabNotificationEnabled).toBe(false);
    });

    test('updates checkbox elements to match state', () => {
        localStorage.setItem('eigennamen-pref-sound', 'true');
        loadNotificationPrefs();

        const checkbox = document.getElementById('pref-sound-notifications') as HTMLInputElement;
        expect(checkbox.checked).toBe(true);
    });
});

describe('saveNotificationPrefs', () => {
    test('saves preferences to localStorage', () => {
        state.notificationPrefs.soundEnabled = true;
        state.notificationPrefs.tabNotificationEnabled = true;

        saveNotificationPrefs();

        expect(localStorage.getItem('eigennamen-pref-sound')).toBe('true');
        expect(localStorage.getItem('eigennamen-pref-tab-notification')).toBe('true');
    });

    test('saves false values', () => {
        state.notificationPrefs.soundEnabled = false;
        saveNotificationPrefs();
        expect(localStorage.getItem('eigennamen-pref-sound')).toBe('false');
    });
});

// ========== TAB NOTIFICATIONS ==========

describe('setTabNotification', () => {
    test('sets tab title when it is your turn and enabled', () => {
        state.notificationPrefs.tabNotificationEnabled = true;

        setTabNotification(true);

        expect(document.title).toContain("It's Your Turn!");
    });

    test('restores original title when not your turn', () => {
        state.notificationPrefs.tabNotificationEnabled = true;
        document.title = '🔴 Something';

        setTabNotification(false);

        expect(document.title).toBe('Eigennamen');
    });

    test('restores original title when tab notifications disabled', () => {
        state.notificationPrefs.tabNotificationEnabled = false;

        setTabNotification(true);

        expect(document.title).toBe('Eigennamen');
    });
});

// ========== TURN DETECTION ==========

describe('checkAndNotifyTurn', () => {
    test('updates tab notification when turn changes to your team', () => {
        state.clickerTeam = 'red';
        state.notificationPrefs.tabNotificationEnabled = true;

        checkAndNotifyTurn('red', 'blue');

        expect(document.title).toContain("It's Your Turn!");
    });

    test('restores title when turn changes away from your team', () => {
        state.clickerTeam = 'red';
        state.notificationPrefs.tabNotificationEnabled = true;
        document.title = '🔴 Something';

        checkAndNotifyTurn('blue', 'red');

        expect(document.title).toBe('Eigennamen');
    });

    test('does nothing when no team assigned', () => {
        state.clickerTeam = null;
        const originalTitle = document.title;

        checkAndNotifyTurn('red', 'blue');

        expect(document.title).toBe(originalTitle);
    });

    test('does not play sound when sound is disabled', () => {
        state.clickerTeam = 'red';
        state.notificationPrefs.soundEnabled = false;

        // Should not throw even without audio context
        expect(() => checkAndNotifyTurn('red', 'blue')).not.toThrow();
    });
});

// ========== SOUND ==========

describe('playNotificationSound', () => {
    test('does nothing when sound is disabled', () => {
        state.notificationPrefs.soundEnabled = false;
        expect(() => playNotificationSound('turn')).not.toThrow();
    });

    test('handles missing audio context gracefully', () => {
        state.notificationPrefs.soundEnabled = true;
        // AudioContext constructor will work because of mock
        expect(() => playNotificationSound('turn')).not.toThrow();
    });

    test('accepts all sound types without error', () => {
        state.notificationPrefs.soundEnabled = true;
        const types = ['turn', 'reveal', 'gameOver', 'join', 'error'];
        for (const type of types) {
            expect(() => playNotificationSound(type)).not.toThrow();
        }
    });
});

describe('playTone', () => {
    test('creates oscillator and gain node with correct parameters', () => {
        const ctx = {
            createOscillator: jest.fn(() => ({
                type: 'sine' as OscillatorType,
                frequency: { setValueAtTime: jest.fn() },
                connect: jest.fn(),
                start: jest.fn(),
                stop: jest.fn(),
            })),
            createGain: jest.fn(() => ({
                gain: {
                    setValueAtTime: jest.fn(),
                    linearRampToValueAtTime: jest.fn(),
                    exponentialRampToValueAtTime: jest.fn(),
                },
                connect: jest.fn(),
            })),
            currentTime: 0,
            destination: {},
        } as unknown as AudioContext;

        playTone(ctx, 0, 440, 0.2, 0.3, 'sine');

        expect(ctx.createOscillator).toHaveBeenCalled();
        expect(ctx.createGain).toHaveBeenCalled();
    });
});

// ========== NOTIFICATION PREFS UI ==========

describe('initNotificationPrefsUI', () => {
    test('sound checkbox change updates state and saves prefs', () => {
        initNotificationPrefsUI();

        const checkbox = document.getElementById('pref-sound-notifications') as HTMLInputElement;
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));

        expect(state.notificationPrefs.soundEnabled).toBe(true);
        expect(localStorage.getItem('eigennamen-pref-sound')).toBe('true');
    });

    test('sound checkbox unchecked updates state to false', () => {
        state.notificationPrefs.soundEnabled = true;
        initNotificationPrefsUI();

        const checkbox = document.getElementById('pref-sound-notifications') as HTMLInputElement;
        checkbox.checked = false;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));

        expect(state.notificationPrefs.soundEnabled).toBe(false);
        expect(localStorage.getItem('eigennamen-pref-sound')).toBe('false');
    });

    test('sound checkbox checked=true initializes audio context', () => {
        initNotificationPrefsUI();

        const checkbox = document.getElementById('pref-sound-notifications') as HTMLInputElement;
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));

        // AudioContext constructor should have been called (via initAudioContext)
        expect((window as any).AudioContext).toHaveBeenCalled();
    });

    test('sound checkbox checked=false does not initialize audio context', () => {
        initNotificationPrefsUI();

        const checkbox = document.getElementById('pref-sound-notifications') as HTMLInputElement;
        checkbox.checked = false;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));

        // AudioContext should not be called when unchecking
        expect((window as any).AudioContext).not.toHaveBeenCalled();
    });

    test('tab checkbox change updates state and saves prefs', () => {
        initNotificationPrefsUI();

        const checkbox = document.getElementById('pref-tab-notification') as HTMLInputElement;
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));

        expect(state.notificationPrefs.tabNotificationEnabled).toBe(true);
        expect(localStorage.getItem('eigennamen-pref-tab-notification')).toBe('true');
    });

    test('tab checkbox unchecked updates state to false', () => {
        state.notificationPrefs.tabNotificationEnabled = true;
        initNotificationPrefsUI();

        const checkbox = document.getElementById('pref-tab-notification') as HTMLInputElement;
        checkbox.checked = false;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));

        expect(state.notificationPrefs.tabNotificationEnabled).toBe(false);
        expect(localStorage.getItem('eigennamen-pref-tab-notification')).toBe('false');
    });

    test('test sound button plays sound temporarily enabling it', () => {
        state.notificationPrefs.soundEnabled = false;
        initNotificationPrefsUI();

        const btn = document.getElementById('btn-test-sound')!;
        btn.click();

        // AudioContext should have been initialized for the test sound
        expect((window as any).AudioContext).toHaveBeenCalled();
        // Sound should be restored to original value (false) after test
        expect(state.notificationPrefs.soundEnabled).toBe(false);
    });

    test('test sound button restores original enabled state when was true', () => {
        state.notificationPrefs.soundEnabled = true;
        initNotificationPrefsUI();

        const btn = document.getElementById('btn-test-sound')!;
        btn.click();

        // Sound should remain true after test
        expect(state.notificationPrefs.soundEnabled).toBe(true);
    });

    test('handles missing DOM elements gracefully', () => {
        document.body.innerHTML = ''; // Remove all elements

        expect(() => initNotificationPrefsUI()).not.toThrow();
    });
});
