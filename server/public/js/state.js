/**
 * State Management Module for Codenames
 *
 * Implements a simple event-driven state container pattern.
 * Provides centralized state management with automatic UI updates on state changes.
 *
 * Architecture:
 * - Single source of truth for all game state
 * - Event emitter for state change notifications
 * - Immutable updates with shallow comparison
 */

// Event emitter for state changes
class EventEmitter {
    constructor() {
        this.listeners = new Map();
    }

    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
        return () => this.off(event, callback);
    }

    off(event, callback) {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            const index = callbacks.indexOf(callback);
            if (index !== -1) {
                callbacks.splice(index, 1);
            }
        }
    }

    emit(event, data) {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            callbacks.forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in event listener for ${event}:`, error);
                }
            });
        }
    }

    once(event, callback) {
        const unsubscribe = this.on(event, (data) => {
            unsubscribe();
            callback(data);
        });
        return unsubscribe;
    }
}

// State store with change detection
class StateStore extends EventEmitter {
    constructor(initialState = {}) {
        super();
        this._state = initialState;
        this._previousState = null;
    }

    get state() {
        return this._state;
    }

    // Get a specific slice of state
    get(key) {
        return this._state[key];
    }

    // Update state and emit change events
    set(updates, silent = false) {
        this._previousState = { ...this._state };
        this._state = { ...this._state, ...updates };

        if (!silent) {
            // Emit specific change events for changed properties
            Object.keys(updates).forEach(key => {
                if (this._previousState[key] !== this._state[key]) {
                    this.emit(`change:${key}`, {
                        value: this._state[key],
                        previous: this._previousState[key]
                    });
                }
            });

            // Emit general change event
            this.emit('change', {
                state: this._state,
                previous: this._previousState,
                changes: updates
            });
        }
    }

    // Reset to initial state
    reset(initialState) {
        this._previousState = this._state;
        this._state = { ...initialState };
        this.emit('reset', { state: this._state });
    }

    // Get previous state
    getPrevious() {
        return this._previousState;
    }

    // Check if a value has changed
    hasChanged(key) {
        return this._previousState && this._previousState[key] !== this._state[key];
    }
}

// Game State Store
const createGameStore = () => {
    return new StateStore({
        // Board state
        words: [],
        types: [],
        revealed: [],
        seed: null,
        customWords: false,

        // Game progress
        currentTurn: 'red',
        redScore: 0,
        blueScore: 0,
        redTotal: 9,
        blueTotal: 8,
        gameOver: false,
        winner: null
    });
};

// Player State Store
const createPlayerStore = () => {
    return new StateStore({
        isHost: false,
        spymasterTeam: null,
        clickerTeam: null,
        playerTeam: null
    });
};

// UI State Store
const createUIStore = () => {
    return new StateStore({
        colorblindMode: false,
        boardInitialized: false,
        activeModal: null,
        pendingUIUpdate: false
    });
};

// Settings Store
const createSettingsStore = () => {
    return new StateStore({
        teamNames: { red: 'Red', blue: 'Blue' },
        activeWords: null,
        wordSource: 'default'
    });
};

// Main application state manager
class AppState {
    constructor() {
        this.game = createGameStore();
        this.player = createPlayerStore();
        this.ui = createUIStore();
        this.settings = createSettingsStore();

        // Bind convenience methods
        this._setupChangeListeners();
    }

    _setupChangeListeners() {
        // Listen for game over condition
        this.game.on('change:redScore', ({ value }) => {
            if (value >= this.game.get('redTotal')) {
                this.game.set({ gameOver: true, winner: 'red' });
            }
        });

        this.game.on('change:blueScore', ({ value }) => {
            if (value >= this.game.get('blueTotal')) {
                this.game.set({ gameOver: true, winner: 'blue' });
            }
        });
    }

    // Helper to get full game state
    getGameState() {
        return { ...this.game.state };
    }

    // Helper to get full player state
    getPlayerState() {
        return { ...this.player.state };
    }

    // Check if current player can click cards
    canClickCards() {
        const { clickerTeam } = this.player.state;
        const { currentTurn, gameOver } = this.game.state;
        return clickerTeam && clickerTeam === currentTurn && !gameOver;
    }

    // Check if current player is spymaster
    isSpymaster() {
        return !!this.player.get('spymasterTeam');
    }

    // Get current team name
    getTeamName(team) {
        return this.settings.get('teamNames')[team] || team;
    }

    // Reset all state for new game
    resetForNewGame(gameState) {
        this.game.reset(gameState);
        this.player.set({
            spymasterTeam: null,
            clickerTeam: null
        });
        this.ui.set({ boardInitialized: false });
    }

    // Subscribe to all relevant changes for UI updates
    onUIUpdate(callback) {
        const unsubscribers = [
            this.game.on('change', callback),
            this.player.on('change', callback),
            this.settings.on('change:teamNames', callback)
        ];

        return () => unsubscribers.forEach(unsub => unsub());
    }

    // Serialize state for URL
    toURLParams() {
        const { seed, revealed, currentTurn, words, customWords } = this.game.state;
        const { teamNames } = this.settings.state;

        const params = new URLSearchParams();
        params.set('game', seed);
        params.set('r', revealed.map(r => r ? '1' : '0').join(''));
        params.set('t', currentTurn === 'blue' ? 'b' : 'r');

        if (customWords && words.length === 25) {
            params.set('w', encodeWordsForURL(words));
        }

        if (teamNames.red !== 'Red') {
            params.set('rn', teamNames.red);
        }
        if (teamNames.blue !== 'Blue') {
            params.set('bn', teamNames.blue);
        }

        return params;
    }

    // Load state from URL params
    fromURLParams(params) {
        const seed = params.get('game');
        const revealed = params.get('r');
        const turn = params.get('t');
        const redName = params.get('rn');
        const blueName = params.get('bn');
        const encodedWords = params.get('w');

        // Team names
        if (redName || blueName) {
            this.settings.set({
                teamNames: {
                    red: redName ? decodeURIComponent(redName).slice(0, 20) : 'Red',
                    blue: blueName ? decodeURIComponent(blueName).slice(0, 20) : 'Blue'
                }
            });
        }

        return { seed, revealed, turn, encodedWords };
    }
}

// Word encoding utilities
function escapeWordDelimiter(word) {
    return word.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

function unescapeWordDelimiter(word) {
    return word.replace(/\\\|/g, '|').replace(/\\\\/g, '\\');
}

function encodeWordsForURL(words) {
    return btoa(words.map(escapeWordDelimiter).join('|'))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function decodeWordsFromURL(encoded) {
    try {
        const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = atob(padded);
        const parts = [];
        let current = '';
        let i = 0;

        while (i < decoded.length) {
            if (decoded[i] === '\\' && i + 1 < decoded.length) {
                current += decoded[i] + decoded[i + 1];
                i += 2;
            } else if (decoded[i] === '|') {
                parts.push(current);
                current = '';
                i++;
            } else {
                current += decoded[i];
                i++;
            }
        }
        parts.push(current);

        return parts.map(unescapeWordDelimiter).filter(w => w.length > 0);
    } catch (e) {
        return null;
    }
}

// Export for ES modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        EventEmitter,
        StateStore,
        AppState,
        createGameStore,
        createPlayerStore,
        createUIStore,
        createSettingsStore,
        encodeWordsForURL,
        decodeWordsFromURL
    };
}

// Export for browser globals (when not using modules)
if (typeof window !== 'undefined') {
    window.CodenamesState = {
        EventEmitter,
        StateStore,
        AppState,
        createGameStore,
        createPlayerStore,
        createUIStore,
        createSettingsStore,
        encodeWordsForURL,
        decodeWordsFromURL
    };
}
