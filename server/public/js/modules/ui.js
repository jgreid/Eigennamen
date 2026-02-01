// ========== UI MODULE ==========
// Toast, screen reader, error modal, modal system with registry pattern

import { state } from './state.js';
import { escapeHTML } from './utils.js';

// ========== SCREEN READER ANNOUNCEMENTS ==========
export function announceToScreenReader(message) {
    const announcer = state.cachedElements.srAnnouncements;
    if (announcer) {
        if (state.srAnnouncementTimeout) clearTimeout(state.srAnnouncementTimeout);
        announcer.textContent = message;
        state.srAnnouncementTimeout = setTimeout(() => {
            announcer.textContent = '';
            state.srAnnouncementTimeout = null;
        }, 1000);
    }
}

// ========== TOAST NOTIFICATION SYSTEM ==========
export function showToast(message, type = 'error', duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        error: '&#10060;',
        success: '&#10004;',
        warning: '&#9888;'
    };

    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.error}</span>
        <span class="toast-message">${escapeHTML(message)}</span>
        <button type="button" class="toast-close" data-action="dismiss-toast" aria-label="Dismiss notification">&times;</button>
    `;

    container.appendChild(toast);

    // Add event listener for toast close button
    const closeBtn = toast.querySelector('[data-action="dismiss-toast"]');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => dismissToast(toast));
    }

    // Auto-dismiss after duration
    setTimeout(() => {
        dismissToast(toast);
    }, duration);

    // Announce to screen readers
    announceToScreenReader(message);

    return toast;
}

export function dismissToast(toast) {
    if (!toast || toast.classList.contains('hiding')) return;
    toast.classList.add('hiding');
    setTimeout(() => {
        if (toast.parentElement) {
            toast.parentElement.removeChild(toast);
        }
    }, 300);
}

// ========== ERROR MODAL ==========
export function showErrorModal(message, details = null) {
    const msgEl = document.getElementById('error-message');
    const detailsEl = document.getElementById('error-details');

    if (msgEl) msgEl.textContent = message;
    if (detailsEl) {
        if (details) {
            detailsEl.textContent = details;
            detailsEl.style.display = 'block';
        } else {
            detailsEl.style.display = 'none';
        }
    }

    openModal('error-modal');
}

export function closeError() {
    closeModal('error-modal');
}

// ========== MODAL REGISTRY ==========
// Maps modal IDs to their close handler functions
const modalCloseHandlers = new Map();

export function registerModalCloseHandler(modalId, closeFn) {
    modalCloseHandlers.set(modalId, closeFn);
}

function getModalCloseHandler(modalId) {
    return modalCloseHandlers.get(modalId);
}

// ========== MODAL MANAGEMENT ==========
export function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    state.previouslyFocusedElement = document.activeElement;
    state.activeModal = modal;
    modal.classList.add('active');

    // Add event listeners only when modal is open (performance optimization)
    if (!state.modalListenersActive) {
        document.addEventListener('keydown', handleModalKeydown);
        document.addEventListener('click', handleOverlayClick);
        state.modalListenersActive = true;
    }

    // Focus first focusable element in modal
    const focusableElements = modal.querySelectorAll('button, input, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusableElements.length > 0) {
        setTimeout(() => focusableElements[0].focus(), 50);
    }
}

export function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    modal.classList.remove('active');
    state.activeModal = null;

    // Remove event listeners when no modal is open (performance optimization)
    if (state.modalListenersActive) {
        document.removeEventListener('keydown', handleModalKeydown);
        document.removeEventListener('click', handleOverlayClick);
        state.modalListenersActive = false;
    }

    // Restore focus to previously focused element
    if (state.previouslyFocusedElement) {
        state.previouslyFocusedElement.focus();
        state.previouslyFocusedElement = null;
    }
}

// Focus trap handler
export function handleModalKeydown(e) {
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
        const focusableElements = state.activeModal.querySelectorAll('button, input, textarea, [tabindex]:not([tabindex="-1"])');
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

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
export function handleOverlayClick(e) {
    if (e.target.classList.contains('modal-overlay') && e.target.classList.contains('active')) {
        const closeHandler = getModalCloseHandler(e.target.id);
        if (closeHandler) closeHandler();
    }
}
