/**
 * Frontend UI Module Tests
 *
 * Tests toast notifications, screen reader announcements, modals, and error display.
 * Test environment: jsdom
 */

jest.mock('../../frontend/i18n', () => ({
    t: (key: string) => {
        // SR type prefixes are now i18n-routed (N18).
        if (key === 'a11y.errorPrefix') return 'Error: ';
        if (key === 'a11y.warningPrefix') return 'Warning: ';
        return key;
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
    announceToScreenReader,
    showToast,
    dismissToast,
    showErrorModal,
    openModal,
    closeModal,
    handleModalKeydown,
    handleOverlayClick,
    registerModalCloseHandler,
} from '../../frontend/ui';
import { state } from '../../frontend/state';

beforeEach(() => {
    jest.useFakeTimers();
    state.activeModal = null;
    state.modalListenersActive = false;
    state.srAnnouncementTimeout = null;

    document.body.innerHTML = `
        <div id="toast-container"></div>
        <div id="sr-announcements" aria-live="assertive"></div>
        <div id="error-modal" class="modal-overlay">
            <div id="error-message"></div>
            <div id="error-details"></div>
            <button id="close-error">Close</button>
        </div>
        <div id="test-modal" class="modal-overlay">
            <button id="test-btn-1">First</button>
            <input id="test-input" />
            <button id="test-btn-2">Second</button>
        </div>
    `;

    state.cachedElements.srAnnouncements = document.getElementById('sr-announcements');
});

afterEach(() => {
    jest.useRealTimers();
    // Close any open modals to properly clean up the module-level modal stack
    // Must happen while original DOM elements still exist (before next beforeEach rebuilds DOM)
    closeModal('error-modal');
    closeModal('test-modal');
    state.activeModal = null;
    state.modalListenersActive = false;
});

// ========== SCREEN READER ==========

describe('announceToScreenReader', () => {
    test('sets text content on announcer element', () => {
        announceToScreenReader('Card revealed as red');

        expect(state.cachedElements.srAnnouncements!.textContent).toBe('Card revealed as red');
    });

    test('clears announcement after timeout', () => {
        announceToScreenReader('Turn changed');

        jest.advanceTimersByTime(1100);

        expect(state.cachedElements.srAnnouncements!.textContent).toBe('');
    });

    test('replaces previous announcement', () => {
        announceToScreenReader('First');
        announceToScreenReader('Second');

        expect(state.cachedElements.srAnnouncements!.textContent).toBe('Second');
    });

    test('handles missing announcer element', () => {
        state.cachedElements.srAnnouncements = null;
        expect(() => announceToScreenReader('test')).not.toThrow();
    });
});

// ========== TOAST NOTIFICATIONS ==========

describe('showToast', () => {
    test('creates toast element in container', () => {
        const toast = showToast('Error occurred', 'error');

        expect(toast).not.toBeNull();
        const container = document.getElementById('toast-container')!;
        expect(container.children.length).toBe(1);
    });

    test('applies correct type class', () => {
        const toast = showToast('Success!', 'success')!;
        expect(toast.classList.contains('success')).toBe(true);

        const warningToast = showToast('Warning!', 'warning')!;
        expect(warningToast.classList.contains('warning')).toBe(true);
    });

    test('sanitizes invalid type to error', () => {
        const toast = showToast('Test', 'xss-attempt')!;
        expect(toast.classList.contains('error')).toBe(true);
        expect(toast.classList.contains('xss-attempt')).toBe(false);
    });

    test('escapes HTML in message', () => {
        const toast = showToast('<script>alert(1)</script>')!;
        const message = toast.querySelector('.toast-message')!;
        expect(message.textContent).toBe('<script>alert(1)</script>');
        expect(message.innerHTML).not.toContain('<script>');
    });

    test('includes close button', () => {
        const toast = showToast('Test')!;
        const closeBtn = toast.querySelector('[data-action="dismiss-toast"]');
        expect(closeBtn).not.toBeNull();
    });

    test('returns null when container is missing', () => {
        document.getElementById('toast-container')!.remove();
        const result = showToast('test');
        expect(result).toBeNull();
    });

    test('auto-dismisses after duration', () => {
        const toast = showToast('Auto dismiss', 'info', 2000)!;
        expect(toast.parentElement).not.toBeNull();

        jest.advanceTimersByTime(2100);

        expect(toast.classList.contains('hiding')).toBe(true);
    });

    test('announces to screen reader with type label for error', () => {
        showToast('Something went wrong', 'error');
        expect(state.cachedElements.srAnnouncements!.textContent).toBe('Error: Something went wrong');
    });

    test('announces to screen reader with type label for warning', () => {
        showToast('Be careful', 'warning');
        expect(state.cachedElements.srAnnouncements!.textContent).toBe('Warning: Be careful');
    });

    test('announces to screen reader without prefix for info/success', () => {
        showToast('Done', 'success');
        expect(state.cachedElements.srAnnouncements!.textContent).toBe('Done');
    });

    test('caps at MAX_TOASTS (5) by dismissing oldest', () => {
        const toasts = [];
        for (let i = 0; i < 6; i++) {
            toasts.push(showToast(`Toast ${i}`, 'info', 60000)!);
        }
        const container = document.getElementById('toast-container')!;
        // The 6th toast should have triggered dismissal of the 1st
        const nonHiding = container.querySelectorAll('.toast:not(.hiding)');
        expect(nonHiding.length).toBe(5);
        expect(toasts[0]!.classList.contains('hiding')).toBe(true);
    });
});

// C2: screen readers must hear each toast exactly once. showToast already routes
// text through #sr-announcements (asserted above), so the visual #toast-container
// must NOT also be a live region — otherwise every toast is announced twice.
describe('C2: toast container is not a second live region (index.html)', () => {
    const fs = require('fs');
    const path = require('path');
    const html: string = fs.readFileSync(path.join(__dirname, '../../../public/index.html'), 'utf-8');

    it('the toast container is visual-only (no role="alert" / aria-live)', () => {
        const tag = html.match(/<div[^>]*id="toast-container"[^>]*>/)?.[0];
        expect(tag).toBeDefined();
        expect(tag).not.toContain('role="alert"');
        expect(tag).not.toContain('aria-live');
    });

    it('#sr-announcements remains the dedicated live region', () => {
        const tag = html.match(/<div[^>]*id="sr-announcements"[^>]*>/)?.[0];
        expect(tag).toBeDefined();
        expect(tag).toContain('aria-live');
    });

    // N17: the pause overlay must not be a SECOND live region — the gamePaused
    // handler already announces via announceToScreenReader, so a role="alert"/
    // aria-live overlay would double every pause/resume announcement (and ×N
    // under N12's duplicate handlers). Passive status regions (turn indicator,
    // etc.) are fine; the pause overlay is handler-announced, so it must not be one.
    it('the pause overlay is not a live region (N17)', () => {
        const tag = html.match(/<div[^>]*id="pause-overlay"[^>]*>/)?.[0];
        expect(tag).toBeDefined();
        expect(tag).not.toContain('role="alert"');
        expect(tag).not.toContain('aria-live');
    });
});

describe('dismissToast', () => {
    test('adds hiding class', () => {
        const toast = showToast('Test')!;
        dismissToast(toast);
        expect(toast.classList.contains('hiding')).toBe(true);
    });

    test('removes toast from DOM after animation delay', () => {
        const toast = showToast('Test')!;
        dismissToast(toast);

        expect(toast.parentElement).not.toBeNull();
        jest.advanceTimersByTime(400);
        expect(toast.parentElement).toBeNull();
    });

    test('prevents double dismiss', () => {
        const toast = showToast('Test')!;
        dismissToast(toast);
        dismissToast(toast); // Should not throw

        jest.advanceTimersByTime(400);
        // Toast should still have been removed properly
    });
});

// ========== ERROR MODAL ==========

describe('showErrorModal', () => {
    test('sets error message text', () => {
        showErrorModal('Something broke');
        expect(document.getElementById('error-message')!.textContent).toBe('Something broke');
    });

    test('shows details when provided', () => {
        showErrorModal('Error', 'Stack trace here');
        const details = document.getElementById('error-details')!;
        expect(details.textContent).toBe('Stack trace here');
        expect((details as HTMLElement).hidden).toBe(false);
    });

    test('hides details when not provided', () => {
        showErrorModal('Error');
        const details = document.getElementById('error-details')!;
        expect((details as HTMLElement).hidden).toBe(true);
    });

    test('opens the error modal', () => {
        showErrorModal('Test');
        const modal = document.getElementById('error-modal')!;
        expect(modal.classList.contains('active')).toBe(true);
    });
});

// ========== MODAL MANAGEMENT ==========

describe('openModal', () => {
    test('adds active class to modal', () => {
        openModal('test-modal');
        expect(document.getElementById('test-modal')!.classList.contains('active')).toBe(true);
    });

    test('sets activeModal in state', () => {
        openModal('test-modal');
        expect(state.activeModal).toBe(document.getElementById('test-modal'));
    });

    test('activates modal listeners', () => {
        openModal('test-modal');
        expect(state.modalListenersActive).toBe(true);
    });

    test('handles non-existent modal ID', () => {
        expect(() => openModal('nonexistent')).not.toThrow();
        expect(state.activeModal).toBeNull();
    });

    // C8: focus must skip a control that is disabled at open (e.g. the replay
    // modal's #replay-prev at step 0). Focusing a disabled element is a no-op, so
    // the old code left keyboard/SR focus stranded behind the overlay.
    test('focuses the first ENABLED control, skipping a disabled one (C8)', () => {
        (document.getElementById('test-btn-1') as HTMLButtonElement).disabled = true;
        openModal('test-modal');
        jest.advanceTimersByTime(50);
        expect(document.activeElement).toBe(document.getElementById('test-input'));
    });

    test('focus lands inside the dialog even when all controls are disabled (C8)', () => {
        (document.getElementById('test-btn-1') as HTMLButtonElement).disabled = true;
        (document.getElementById('test-input') as HTMLInputElement).disabled = true;
        (document.getElementById('test-btn-2') as HTMLButtonElement).disabled = true;
        const modal = document.getElementById('test-modal')!;
        openModal('test-modal');
        jest.advanceTimersByTime(50);
        // Falls back to the modal itself (made focusable) so the SR reading
        // position enters the dialog rather than staying behind it.
        expect(modal.contains(document.activeElement)).toBe(true);
        expect(modal.getAttribute('tabindex')).toBe('-1');
    });
});

describe('closeModal', () => {
    test('removes active class from modal', () => {
        openModal('test-modal');
        closeModal('test-modal');
        expect(document.getElementById('test-modal')!.classList.contains('active')).toBe(false);
    });

    test('clears activeModal when last modal is closed', () => {
        openModal('test-modal');
        closeModal('test-modal');
        expect(state.activeModal).toBeNull();
    });

    test('removes modal listeners when last modal is closed', () => {
        openModal('test-modal');
        closeModal('test-modal');
        expect(state.modalListenersActive).toBe(false);
    });

    test('handles stacked modals - keeps previous active', () => {
        openModal('error-modal');
        openModal('test-modal');

        closeModal('test-modal');

        expect(state.activeModal).toBe(document.getElementById('error-modal'));
        expect(state.modalListenersActive).toBe(true);
    });
});

describe('handleModalKeydown', () => {
    test('calls close handler on Escape', () => {
        const closeFn = jest.fn();
        registerModalCloseHandler('test-modal', closeFn);
        openModal('test-modal');

        const event = new KeyboardEvent('keydown', { key: 'Escape' });
        Object.defineProperty(event, 'preventDefault', { value: jest.fn() });
        handleModalKeydown(event);

        expect(closeFn).toHaveBeenCalled();
    });

    test('does nothing when no modal is active', () => {
        state.activeModal = null;
        const event = new KeyboardEvent('keydown', { key: 'Escape' });
        expect(() => handleModalKeydown(event)).not.toThrow();
    });

    test('traps focus on Tab from last to first element', () => {
        openModal('test-modal');
        const lastBtn = document.getElementById('test-btn-2')!;
        lastBtn.focus();

        const event = new KeyboardEvent('keydown', { key: 'Tab' });
        Object.defineProperty(event, 'preventDefault', { value: jest.fn() });
        handleModalKeydown(event);

        expect(event.preventDefault).toHaveBeenCalled();
        expect(document.activeElement).toBe(document.getElementById('test-btn-1'));
    });

    test('traps focus on Shift+Tab from first to last element', () => {
        openModal('test-modal');
        const firstBtn = document.getElementById('test-btn-1')!;
        firstBtn.focus();

        const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true });
        Object.defineProperty(event, 'preventDefault', { value: jest.fn() });
        handleModalKeydown(event);

        expect(event.preventDefault).toHaveBeenCalled();
        expect(document.activeElement).toBe(document.getElementById('test-btn-2'));
    });
});

describe('handleOverlayClick', () => {
    test('calls close handler when clicking overlay background', () => {
        const closeFn = jest.fn();
        registerModalCloseHandler('test-modal', closeFn);
        openModal('test-modal');

        const overlay = document.getElementById('test-modal')!;
        const event = new MouseEvent('click');
        Object.defineProperty(event, 'target', { value: overlay });
        handleOverlayClick(event);

        expect(closeFn).toHaveBeenCalled();
    });

    test('does not close when clicking inside modal content', () => {
        const closeFn = jest.fn();
        registerModalCloseHandler('test-modal', closeFn);
        openModal('test-modal');

        const button = document.getElementById('test-btn-1')!;
        const event = new MouseEvent('click');
        Object.defineProperty(event, 'target', { value: button });
        handleOverlayClick(event);

        expect(closeFn).not.toHaveBeenCalled();
    });
});
