import { state } from './state.js';
import { t } from './i18n.js';

import { UI } from './constants.js';

// Store timer IDs for toast auto-dismiss without extending HTMLDivElement
const toastTimers = new WeakMap<
    HTMLDivElement,
    { autoDismiss?: ReturnType<typeof setTimeout>; hide?: ReturnType<typeof setTimeout> }
>();

export function announceToScreenReader(message: string): void {
    const announcer = state.cachedElements.srAnnouncements;
    if (announcer) {
        if (state.srAnnouncementTimeout) clearTimeout(state.srAnnouncementTimeout);
        announcer.textContent = message;
        state.srAnnouncementTimeout = setTimeout(() => {
            announcer.textContent = '';
            state.srAnnouncementTimeout = null;
        }, UI.SR_ANNOUNCEMENT_MS);
    }
}

const MAX_TOASTS = 5;

export function showToast(message: string, type: string = 'error', duration: number = 4000): HTMLDivElement | null {
    const container = document.getElementById('toast-container');
    if (!container) return null;

    // Cap concurrent toasts to prevent unbounded DOM growth
    const existingToasts = container.querySelectorAll('.toast:not(.hiding)');
    if (existingToasts.length >= MAX_TOASTS) {
        // Dismiss the oldest toast to make room
        dismissToast(existingToasts[0] as HTMLDivElement);
    }

    // Validate type against allowed values to prevent arbitrary class/key injection
    const validTypes = ['error', 'success', 'warning', 'info'];
    const safeType = validTypes.includes(type) ? type : 'error';

    const toast = document.createElement('div');
    toast.className = `toast ${safeType}`;

    const icons: Record<string, string> = {
        error: '\u274C',
        success: '\u2714',
        warning: '\u26A0',
        info: '\u2139',
    };

    const iconSpan = document.createElement('span');
    iconSpan.className = 'toast-icon';
    iconSpan.textContent = icons[safeType]!;

    const msgSpan = document.createElement('span');
    msgSpan.className = 'toast-message';
    msgSpan.textContent = message;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'toast-close';
    closeBtn.dataset.action = 'dismiss-toast';
    closeBtn.setAttribute('aria-label', t('aria.dismissNotification'));
    closeBtn.textContent = '\u00D7';
    closeBtn.addEventListener('click', () => dismissToast(toast));

    toast.append(iconSpan, msgSpan, closeBtn);

    container.appendChild(toast);

    // Auto-dismiss after duration (store ID for cleanup in dismissToast)
    const timers = {
        autoDismiss: setTimeout(() => {
            dismissToast(toast);
        }, duration),
    };
    toastTimers.set(toast, timers);

    // Announce to screen readers with message type for context. The prefixes
    // were hardcoded English shipped to de/es/fr users (N18) — route through t().
    const typeLabel =
        safeType === 'error' ? t('a11y.errorPrefix') : safeType === 'warning' ? t('a11y.warningPrefix') : '';
    announceToScreenReader(typeLabel + message);

    return toast;
}

export function dismissToast(toast: HTMLDivElement): void {
    if (!toast || toast.classList.contains('hiding')) return;
    // Clear the auto-dismiss timer to prevent double-removal
    const timers = toastTimers.get(toast);
    if (timers?.autoDismiss) {
        clearTimeout(timers.autoDismiss);
        timers.autoDismiss = undefined;
    }
    toast.classList.add('hiding');
    const hideTimeout = setTimeout(() => {
        if (toast.parentElement) {
            toast.parentElement.removeChild(toast);
        }
        toastTimers.delete(toast);
    }, 300);
    if (timers) {
        timers.hide = hideTimeout;
    } else {
        toastTimers.set(toast, { hide: hideTimeout });
    }
}

export function showErrorModal(message: string, details: string | null = null): void {
    const msgEl = document.getElementById('error-message');
    const detailsEl = document.getElementById('error-details');

    if (msgEl) msgEl.textContent = message;
    if (detailsEl) {
        if (details) {
            detailsEl.textContent = details;
            (detailsEl as HTMLElement).hidden = false;
        } else {
            (detailsEl as HTMLElement).hidden = true;
        }
    }

    openModal('error-modal');
}

export function closeError(): void {
    closeModal('error-modal');
}

// Maps modal IDs to their close handler functions
const modalCloseHandlers: Map<string, () => void> = new Map();

export function registerModalCloseHandler(modalId: string, closeFn: () => void): void {
    modalCloseHandlers.set(modalId, closeFn);
}

function getModalCloseHandler(modalId: string): (() => void) | undefined {
    return modalCloseHandlers.get(modalId);
}

// Implement modal stack for proper focus management when stacking modals
// Each entry contains: { modal, previousFocus }
interface ModalStackEntry {
    modal: HTMLElement;
    previousFocus: Element | null;
}

const modalStack: ModalStackEntry[] = [];
const MAX_MODAL_STACK_SIZE = 10;

// Shared selector for focusable elements inside a modal. Excludes :disabled form
// controls — .focus() on a disabled element is a no-op, so focusing one (e.g. the
// replay modal's #replay-prev at step 0) silently leaves keyboard/SR focus behind
// the overlay. Kept in sync with the Tab focus-trap in handleModalKeydown. C8.
const MODAL_FOCUSABLE_SELECTOR =
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

// Focus the first genuinely focusable element inside a container, preferring a
// visible one (offsetParent is null for display:none — and, under jsdom, for
// everything, so fall back to the first enabled candidate rather than emptying
// the list). Falls back to the container itself so the SR reading position always
// enters the dialog. C8.
function focusFirstFocusable(container: HTMLElement): void {
    const candidates = Array.from(container.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR));
    const visible = candidates.filter((el) => el.offsetParent !== null);
    const target = visible[0] ?? candidates[0] ?? container;
    if (target === container && !container.hasAttribute('tabindex')) {
        // Make the fallback container programmatically focusable.
        container.setAttribute('tabindex', '-1');
    }
    target.focus();
}

export function openModal(modalId: string): void {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    // Prevent unbounded stack growth (defensive — normal usage stays under 3)
    if (modalStack.length >= MAX_MODAL_STACK_SIZE) {
        const oldest = modalStack.shift();
        if (oldest) {
            oldest.modal.classList.remove('active');
            // Restore focus for the evicted modal to prevent focus traps on detached DOM
            if (
                oldest.previousFocus &&
                oldest.previousFocus instanceof HTMLElement &&
                document.contains(oldest.previousFocus)
            ) {
                oldest.previousFocus.focus();
            }
        }
    }

    // Prevent duplicate entries for the same modal
    const existingIndex = modalStack.findIndex((entry) => entry.modal === modal);
    if (existingIndex !== -1) {
        modalStack.splice(existingIndex, 1);
    }

    // Push current state onto modal stack before opening new modal
    // This preserves focus context when multiple modals are opened
    modalStack.push({
        modal: modal,
        previousFocus: document.activeElement,
    });

    state.activeModal = modal;
    modal.classList.add('active');

    // Prevent background scroll on mobile when modal is open
    if (modalStack.length === 1) {
        document.body.style.overflow = 'hidden';
    }

    // Add event listeners only when first modal is open (performance optimization)
    if (!state.modalListenersActive) {
        document.addEventListener('keydown', handleModalKeydown);
        document.addEventListener('click', handleOverlayClick);
        state.modalListenersActive = true;
    }

    // Focus the first focusable element, evaluated at focus time (inside the
    // setTimeout) so a control disabled at open — e.g. the replay modal's
    // #replay-prev at step 0 — is skipped rather than swallowing focus and
    // stranding keyboard/SR focus behind the overlay. C8.
    setTimeout(() => focusFirstFocusable(modal), 50);
}

export function closeModal(modalId: string): void {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    modal.classList.remove('active');

    // Pop modal from stack and restore previous focus
    // Find and remove this modal from the stack (it might not be at the top if closed out of order)
    const stackIndex = modalStack.findIndex((entry) => entry.modal === modal);
    let previousFocus: Element | null = null;

    if (stackIndex !== -1) {
        const entry = modalStack.splice(stackIndex, 1)[0]!;
        previousFocus = entry.previousFocus;
    }

    // Update activeModal to the next modal in stack (if any)
    if (modalStack.length > 0) {
        state.activeModal = modalStack[modalStack.length - 1]!.modal;
    } else {
        state.activeModal = null;

        // Re-enable background scroll when last modal closes
        document.body.style.overflow = '';

        // Remove event listeners when no modal is open (performance optimization)
        if (state.modalListenersActive) {
            document.removeEventListener('keydown', handleModalKeydown);
            document.removeEventListener('click', handleOverlayClick);
            state.modalListenersActive = false;
        }
    }

    // Restore focus to previously focused element
    if (previousFocus && typeof (previousFocus as HTMLElement).focus === 'function') {
        // If the previous focus element is inside another modal that's still open, focus it
        // Otherwise, only focus if no other modal is active
        const isInActiveModal = state.activeModal && state.activeModal.contains(previousFocus);
        if (isInActiveModal || !state.activeModal) {
            (previousFocus as HTMLElement).focus();
        } else if (state.activeModal) {
            // Focus the first genuinely focusable element in the now-active modal
            // (skips disabled controls, falls back to the modal). C8.
            focusFirstFocusable(state.activeModal);
        }
    }
}

// Focus trap handler
export function handleModalKeydown(e: KeyboardEvent): void {
    if (!state.activeModal) return;

    // Escape key closes modal via registry lookup
    if (e.key === 'Escape') {
        e.preventDefault();
        const closeHandler = getModalCloseHandler(state.activeModal.id);
        if (closeHandler) closeHandler();
        return;
    }

    // Tab key focus trapping
    if (e.key === 'Tab') {
        // Exclude disabled controls: .focus() on a disabled element is a no-op, so
        // if the first/last focusable element is disabled (e.g. the replay modal's
        // prev/next buttons at a boundary) Tab wrapping would stick and the trap
        // would break. :disabled only applies to form controls, which is exactly
        // what needs excluding here (anchors/[tabindex] are never :disabled).
        const focusableElements = state.activeModal.querySelectorAll(MODAL_FOCUSABLE_SELECTOR);
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0] as HTMLElement;
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

        // If focus has escaped the modal, bring it back
        const focusInModal = state.activeModal.contains(document.activeElement);
        if (!focusInModal) {
            e.preventDefault();
            firstElement.focus();
            return;
        }

        if (e.shiftKey && document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
        }
    }
}

// Click outside modal to close (on overlay) via registry lookup
export function handleOverlayClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (target.classList.contains('modal-overlay') && target.classList.contains('active')) {
        const closeHandler = getModalCloseHandler(target.id);
        if (closeHandler) closeHandler();
    }
}
