/**
 * UI Module for Codenames
 *
 * Handles all DOM manipulation and UI updates:
 * - DOM element caching
 * - Board rendering
 * - Scoreboard updates
 * - Modal management
 * - Toast notifications
 * - Screen reader announcements
 */

/**
 * DOM Element Cache Manager
 * Caches frequently accessed DOM elements for performance
 */
class ElementCache {
    constructor() {
        this.cache = {};
        this.initialized = false;
    }

    init() {
        if (this.initialized) return;

        this.cache = {
            board: document.getElementById('board'),
            roleBanner: document.getElementById('role-banner'),
            turnIndicator: document.getElementById('turn-indicator'),
            endTurnBtn: document.getElementById('btn-end-turn'),
            redSpyBtn: document.getElementById('btn-spymaster-red'),
            blueSpyBtn: document.getElementById('btn-spymaster-blue'),
            redClickerBtn: document.getElementById('btn-clicker-red'),
            blueClickerBtn: document.getElementById('btn-clicker-blue'),
            redTeamBtn: document.getElementById('btn-team-red'),
            blueTeamBtn: document.getElementById('btn-team-blue'),
            spectateBtn: document.getElementById('btn-spectate'),
            redRemaining: document.getElementById('red-remaining'),
            blueRemaining: document.getElementById('blue-remaining'),
            redTeamName: document.getElementById('red-team-name'),
            blueTeamName: document.getElementById('blue-team-name'),
            shareLink: document.getElementById('share-link'),
            wordSource: document.getElementById('word-source'),
            spymasterWarning: document.getElementById('spymaster-warning'),
            srAnnouncements: document.getElementById('sr-announcements'),
            srScoreAnnouncements: document.getElementById('sr-score-announcements'),
            srTurnAnnouncements: document.getElementById('sr-turn-announcements'),
            toastContainer: document.getElementById('toast-container')
        };

        this.initialized = true;
    }

    get(id) {
        if (!this.initialized) this.init();
        return this.cache[id] || document.getElementById(id);
    }

    refresh(id) {
        this.cache[id] = document.getElementById(id);
        return this.cache[id];
    }
}

/**
 * Screen Reader Announcer
 * Handles announcements to screen readers via aria-live regions
 */
class ScreenReaderAnnouncer {
    constructor(cache) {
        this.cache = cache;
        this.timeouts = {
            general: null,
            score: null,
            turn: null
        };
    }

    announce(message, type = 'general') {
        const elementMap = {
            general: 'srAnnouncements',
            score: 'srScoreAnnouncements',
            turn: 'srTurnAnnouncements'
        };

        const announcer = this.cache.get(elementMap[type]);
        if (!announcer) return;

        if (this.timeouts[type]) {
            clearTimeout(this.timeouts[type]);
        }

        announcer.textContent = message;

        this.timeouts[type] = setTimeout(() => {
            announcer.textContent = '';
            this.timeouts[type] = null;
        }, 1000);
    }

    announceScoreChange(message) {
        this.announce(message, 'score');
    }

    announceTurnChange(message) {
        this.announce(message, 'turn');
    }
}

/**
 * Toast Notification System
 */
class ToastManager {
    constructor(cache) {
        this.cache = cache;
    }

    show(message, type = 'error', duration = 4000) {
        const container = this.cache.get('toastContainer');
        if (!container) return null;

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
            <button class="toast-close" onclick="this.parentElement.remove()" aria-label="Dismiss notification">&times;</button>
        `;

        container.appendChild(toast);

        setTimeout(() => {
            this.dismiss(toast);
        }, duration);

        return toast;
    }

    dismiss(toast) {
        if (!toast || toast.classList.contains('hiding')) return;
        toast.classList.add('hiding');
        setTimeout(() => {
            if (toast.parentElement) {
                toast.parentElement.removeChild(toast);
            }
        }, 300);
    }
}

/**
 * Modal Manager
 * Handles modal dialogs with focus trapping and keyboard support
 */
class ModalManager {
    constructor() {
        this.activeModal = null;
        this.previouslyFocusedElement = null;
        this.boundKeydownHandler = this.handleKeydown.bind(this);
        this.boundClickHandler = this.handleOverlayClick.bind(this);
        this.closeHandlers = {};
    }

    registerCloseHandler(modalId, handler) {
        this.closeHandlers[modalId] = handler;
    }

    open(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;

        this.previouslyFocusedElement = document.activeElement;
        this.activeModal = modal;
        modal.classList.add('active');

        document.addEventListener('keydown', this.boundKeydownHandler);
        document.addEventListener('click', this.boundClickHandler);

        // Focus first focusable element
        const focusable = modal.querySelectorAll('button, input, textarea, [tabindex]:not([tabindex="-1"])');
        if (focusable.length > 0) {
            setTimeout(() => focusable[0].focus(), 50);
        }
    }

    close(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;

        modal.classList.remove('active');
        this.activeModal = null;

        document.removeEventListener('keydown', this.boundKeydownHandler);
        document.removeEventListener('click', this.boundClickHandler);

        if (this.previouslyFocusedElement) {
            this.previouslyFocusedElement.focus();
            this.previouslyFocusedElement = null;
        }
    }

    handleKeydown(e) {
        if (!this.activeModal) return;

        if (e.key === 'Escape') {
            e.preventDefault();
            const handler = this.closeHandlers[this.activeModal.id];
            if (handler) {
                handler();
            } else {
                this.close(this.activeModal.id);
            }
            return;
        }

        // Tab key focus trapping
        if (e.key === 'Tab') {
            const focusable = this.activeModal.querySelectorAll('button, input, textarea, [tabindex]:not([tabindex="-1"])');
            const first = focusable[0];
            const last = focusable[focusable.length - 1];

            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    }

    handleOverlayClick(e) {
        if (e.target.classList.contains('modal-overlay') && e.target.classList.contains('active')) {
            const handler = this.closeHandlers[e.target.id];
            if (handler) {
                handler();
            } else {
                this.close(e.target.id);
            }
        }
    }
}

/**
 * Board Renderer
 * Handles rendering and updating the game board
 */
class BoardRenderer {
    constructor(cache, announcer) {
        this.cache = cache;
        this.announcer = announcer;
        this.initialized = false;
    }

    init(onCardClick) {
        const board = this.cache.get('board');
        if (!board || board.hasAttribute('data-delegated')) return;

        // Event delegation for clicks
        board.addEventListener('click', (e) => {
            const card = e.target.closest('.card');
            if (!card || card.classList.contains('revealed')) return;
            const index = parseInt(card.dataset.index, 10);
            if (!isNaN(index)) onCardClick(index);
        });

        // Event delegation for keyboard navigation
        board.addEventListener('keydown', (e) => {
            const card = e.target.closest('.card');
            if (!card) return;
            const index = parseInt(card.dataset.index, 10);
            if (isNaN(index)) return;

            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (!card.classList.contains('revealed')) {
                    onCardClick(index);
                }
            } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();
                this.navigateCards(index, e.key);
            }
        });

        board.setAttribute('data-delegated', 'true');
    }

    render(gameState, playerState, forceFullRender = false) {
        const board = this.cache.get('board');
        if (!board) return;

        const isSpymaster = !!playerState.spymasterTeam;
        const canClick = playerState.clickerTeam &&
            playerState.clickerTeam === gameState.currentTurn &&
            !gameState.gameOver;

        // Update board classes
        let className = 'board';
        if (isSpymaster) className += ' spymaster-mode';
        if (!canClick) className += ' no-click';
        board.className = className;

        // Check if we can do incremental update
        if (this.initialized && !forceFullRender && board.children.length === 25) {
            this.updateIncremental(gameState, isSpymaster);
            return;
        }

        // Full render
        board.innerHTML = '';

        gameState.words.forEach((word, index) => {
            const card = document.createElement('div');
            card.className = 'card';
            card.textContent = word;
            card.dataset.index = index;

            const isRevealed = gameState.revealed[index];
            card.setAttribute('role', 'gridcell');
            card.setAttribute('tabindex', isRevealed ? '-1' : '0');
            card.setAttribute('aria-label', `${word}${isRevealed ? ', revealed as ' + gameState.types[index] : ''}`);

            if (isSpymaster) {
                card.classList.add(`spy-${gameState.types[index]}`);
            }

            if (isRevealed) {
                card.classList.add('revealed', gameState.types[index]);
            }

            board.appendChild(card);
        });

        this.initialized = true;
    }

    updateIncremental(gameState, isSpymaster) {
        const board = this.cache.get('board');
        const cards = board.children;

        for (let i = 0; i < cards.length; i++) {
            const card = cards[i];
            const isRevealed = gameState.revealed[i];
            const type = gameState.types[i];

            // Update spymaster classes
            card.classList.toggle(`spy-${type}`, isSpymaster && !isRevealed);

            // Update revealed state
            if (isRevealed && !card.classList.contains('revealed')) {
                card.classList.add('revealed', type);
                card.setAttribute('tabindex', '-1');
                card.setAttribute('aria-label', `${gameState.words[i]}, revealed as ${type}`);
            }
        }
    }

    updateSingleCard(gameState, index) {
        const board = this.cache.get('board');
        if (!board || index < 0 || index >= board.children.length) return;

        const card = board.children[index];
        const type = gameState.types[index];

        if (gameState.revealed[index]) {
            card.classList.add('revealed', type);
            card.setAttribute('tabindex', '-1');
            card.setAttribute('aria-label', `${gameState.words[index]}, revealed as ${type}`);
        }
    }

    navigateCards(currentIndex, direction) {
        const board = this.cache.get('board');
        if (!board) return;

        const gridSize = 5;
        let newIndex = currentIndex;

        switch (direction) {
            case 'ArrowUp':
                newIndex = currentIndex >= gridSize ? currentIndex - gridSize : currentIndex;
                break;
            case 'ArrowDown':
                newIndex = currentIndex < 20 ? currentIndex + gridSize : currentIndex;
                break;
            case 'ArrowLeft':
                newIndex = currentIndex % gridSize !== 0 ? currentIndex - 1 : currentIndex;
                break;
            case 'ArrowRight':
                newIndex = (currentIndex + 1) % gridSize !== 0 ? currentIndex + 1 : currentIndex;
                break;
        }

        if (newIndex !== currentIndex) {
            const cards = board.children;
            if (cards[newIndex]) {
                cards[newIndex].focus();
            }
        }
    }
}

/**
 * Utility: Escape HTML to prevent XSS
 */
function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Export for ES modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ElementCache,
        ScreenReaderAnnouncer,
        ToastManager,
        ModalManager,
        BoardRenderer,
        escapeHTML
    };
}

// Export for browser globals
if (typeof window !== 'undefined') {
    window.CodenamesUI = {
        ElementCache,
        ScreenReaderAnnouncer,
        ToastManager,
        ModalManager,
        BoardRenderer,
        escapeHTML
    };
}
