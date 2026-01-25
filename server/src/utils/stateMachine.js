/**
 * State Machine for Room and Game Lifecycle
 *
 * Provides explicit state definitions and transition validation for
 * room and game lifecycle management. Ensures state transitions
 * follow valid paths and provides debugging/logging support.
 */

const logger = require('./logger');

/**
 * Room lifecycle states
 * @enum {string}
 */
const ROOM_STATES = {
    /** Initial state after room creation */
    CREATED: 'created',
    /** Players joining and setting up teams */
    WAITING: 'waiting',
    /** Game in progress */
    PLAYING: 'playing',
    /** Game completed */
    FINISHED: 'finished',
    /** Room destroyed/closed */
    CLOSED: 'closed'
};

/**
 * Game lifecycle states
 * @enum {string}
 */
const GAME_STATES = {
    /** Game created, board generated */
    INITIALIZED: 'initialized',
    /** Spymaster giving clue */
    CLUE_PHASE: 'clue_phase',
    /** Team guessing based on clue */
    GUESS_PHASE: 'guess_phase',
    /** Turn just ended, transitioning to next turn */
    TURN_ENDED: 'turn_ended',
    /** Game completed (win/loss) */
    GAME_OVER: 'game_over'
};

/**
 * Room state transition actions
 * @enum {string}
 */
const ROOM_ACTIONS = {
    INITIALIZE: 'initialize',
    START_GAME: 'start_game',
    END_GAME: 'end_game',
    RESTART: 'restart',
    CLOSE: 'close'
};

/**
 * Game state transition actions
 * @enum {string}
 */
const GAME_ACTIONS = {
    START: 'start',
    GIVE_CLUE: 'give_clue',
    MAKE_GUESS: 'make_guess',
    END_TURN: 'end_turn',
    CONTINUE_GUESSING: 'continue_guessing',
    WIN: 'win',
    LOSE: 'lose',
    FORFEIT: 'forfeit',
    RESET: 'reset'
};

/**
 * Valid room state transitions
 * Maps current state -> action -> target state
 */
const ROOM_TRANSITIONS = {
    [ROOM_STATES.CREATED]: {
        [ROOM_ACTIONS.INITIALIZE]: ROOM_STATES.WAITING,
        [ROOM_ACTIONS.CLOSE]: ROOM_STATES.CLOSED
    },
    [ROOM_STATES.WAITING]: {
        [ROOM_ACTIONS.START_GAME]: ROOM_STATES.PLAYING,
        [ROOM_ACTIONS.CLOSE]: ROOM_STATES.CLOSED
    },
    [ROOM_STATES.PLAYING]: {
        [ROOM_ACTIONS.END_GAME]: ROOM_STATES.FINISHED,
        [ROOM_ACTIONS.CLOSE]: ROOM_STATES.CLOSED
    },
    [ROOM_STATES.FINISHED]: {
        [ROOM_ACTIONS.RESTART]: ROOM_STATES.WAITING,
        [ROOM_ACTIONS.CLOSE]: ROOM_STATES.CLOSED
    },
    [ROOM_STATES.CLOSED]: {
        // Terminal state - no transitions out
    }
};

/**
 * Valid game state transitions
 * Maps current state -> action -> target state
 */
const GAME_TRANSITIONS = {
    [GAME_STATES.INITIALIZED]: {
        [GAME_ACTIONS.START]: GAME_STATES.CLUE_PHASE,
        [GAME_ACTIONS.RESET]: GAME_STATES.INITIALIZED
    },
    [GAME_STATES.CLUE_PHASE]: {
        [GAME_ACTIONS.GIVE_CLUE]: GAME_STATES.GUESS_PHASE,
        [GAME_ACTIONS.FORFEIT]: GAME_STATES.GAME_OVER,
        [GAME_ACTIONS.RESET]: GAME_STATES.INITIALIZED
    },
    [GAME_STATES.GUESS_PHASE]: {
        [GAME_ACTIONS.MAKE_GUESS]: GAME_STATES.GUESS_PHASE,
        [GAME_ACTIONS.END_TURN]: GAME_STATES.TURN_ENDED,
        [GAME_ACTIONS.WIN]: GAME_STATES.GAME_OVER,
        [GAME_ACTIONS.LOSE]: GAME_STATES.GAME_OVER,
        [GAME_ACTIONS.FORFEIT]: GAME_STATES.GAME_OVER,
        [GAME_ACTIONS.RESET]: GAME_STATES.INITIALIZED
    },
    [GAME_STATES.TURN_ENDED]: {
        [GAME_ACTIONS.CONTINUE_GUESSING]: GAME_STATES.CLUE_PHASE,
        [GAME_ACTIONS.WIN]: GAME_STATES.GAME_OVER,
        [GAME_ACTIONS.LOSE]: GAME_STATES.GAME_OVER,
        [GAME_ACTIONS.RESET]: GAME_STATES.INITIALIZED
    },
    [GAME_STATES.GAME_OVER]: {
        [GAME_ACTIONS.RESET]: GAME_STATES.INITIALIZED
    }
};

/**
 * Terminal states that cannot transition to any other state
 */
const TERMINAL_ROOM_STATES = [ROOM_STATES.CLOSED];
const TERMINAL_GAME_STATES = [GAME_STATES.GAME_OVER];

/**
 * State transition error
 */
class StateTransitionError extends Error {
    /**
     * @param {string} message - Error message
     * @param {string} currentState - Current state
     * @param {string} action - Attempted action
     * @param {string} targetState - Target state (if known)
     */
    constructor(message, currentState, action, targetState = null) {
        super(message);
        this.name = 'StateTransitionError';
        this.code = 'INVALID_STATE_TRANSITION';
        this.currentState = currentState;
        this.action = action;
        this.targetState = targetState;
    }
}

/**
 * Check if a room state transition is valid
 * @param {string} currentState - Current room state
 * @param {string} targetState - Target room state
 * @returns {boolean} True if transition is valid
 */
function canTransitionRoom(currentState, targetState) {
    const transitions = ROOM_TRANSITIONS[currentState];
    if (!transitions) {
        return false;
    }
    return Object.values(transitions).includes(targetState);
}

/**
 * Check if a game state transition is valid
 * @param {string} currentState - Current game state
 * @param {string} targetState - Target game state
 * @returns {boolean} True if transition is valid
 */
function canTransitionGame(currentState, targetState) {
    const transitions = GAME_TRANSITIONS[currentState];
    if (!transitions) {
        return false;
    }
    return Object.values(transitions).includes(targetState);
}

/**
 * Transition room state based on action
 * @param {string} currentState - Current room state
 * @param {string} action - Action to perform
 * @param {Object} context - Optional context for logging
 * @returns {string} New room state
 * @throws {StateTransitionError} If transition is invalid
 */
function transitionRoom(currentState, action, context = {}) {
    // Validate current state
    if (!Object.values(ROOM_STATES).includes(currentState)) {
        throw new StateTransitionError(
            `Invalid current room state: ${currentState}`,
            currentState,
            action
        );
    }

    // Validate action
    if (!Object.values(ROOM_ACTIONS).includes(action)) {
        throw new StateTransitionError(
            `Invalid room action: ${action}`,
            currentState,
            action
        );
    }

    // Check if transition exists
    const transitions = ROOM_TRANSITIONS[currentState];
    if (!transitions || !transitions[action]) {
        const validActions = getValidRoomActions(currentState);
        throw new StateTransitionError(
            `Invalid room transition: cannot perform '${action}' from state '${currentState}'. Valid actions: ${validActions.join(', ') || 'none'}`,
            currentState,
            action
        );
    }

    const newState = transitions[action];

    // Log the transition
    logger.debug('Room state transition', {
        ...context,
        from: currentState,
        to: newState,
        action: action
    });

    return newState;
}

/**
 * Transition game state based on action
 * @param {string} currentState - Current game state
 * @param {string} action - Action to perform
 * @param {Object} context - Optional context for logging
 * @returns {string} New game state
 * @throws {StateTransitionError} If transition is invalid
 */
function transitionGame(currentState, action, context = {}) {
    // Validate current state
    if (!Object.values(GAME_STATES).includes(currentState)) {
        throw new StateTransitionError(
            `Invalid current game state: ${currentState}`,
            currentState,
            action
        );
    }

    // Validate action
    if (!Object.values(GAME_ACTIONS).includes(action)) {
        throw new StateTransitionError(
            `Invalid game action: ${action}`,
            currentState,
            action
        );
    }

    // Check if transition exists
    const transitions = GAME_TRANSITIONS[currentState];
    if (!transitions || !transitions[action]) {
        const validActions = getValidGameActions(currentState);
        throw new StateTransitionError(
            `Invalid game transition: cannot perform '${action}' from state '${currentState}'. Valid actions: ${validActions.join(', ') || 'none'}`,
            currentState,
            action
        );
    }

    const newState = transitions[action];

    // Log the transition
    logger.debug('Game state transition', {
        ...context,
        from: currentState,
        to: newState,
        action: action
    });

    return newState;
}

/**
 * Get valid actions for a room state
 * @param {string} state - Current room state
 * @returns {string[]} Array of valid actions
 */
function getValidRoomActions(state) {
    const transitions = ROOM_TRANSITIONS[state];
    if (!transitions) {
        return [];
    }
    return Object.keys(transitions);
}

/**
 * Get valid actions for a game state
 * @param {string} state - Current game state
 * @returns {string[]} Array of valid actions
 */
function getValidGameActions(state) {
    const transitions = GAME_TRANSITIONS[state];
    if (!transitions) {
        return [];
    }
    return Object.keys(transitions);
}

/**
 * Check if a room state is terminal (no further transitions possible)
 * @param {string} state - Room state to check
 * @returns {boolean} True if state is terminal
 */
function isTerminalRoomState(state) {
    return TERMINAL_ROOM_STATES.includes(state);
}

/**
 * Check if a game state is terminal (game over)
 * @param {string} state - Game state to check
 * @returns {boolean} True if state is terminal
 */
function isTerminalGameState(state) {
    return TERMINAL_GAME_STATES.includes(state);
}

/**
 * Get all possible target states from a room state
 * @param {string} state - Current room state
 * @returns {string[]} Array of possible target states
 */
function getPossibleRoomStates(state) {
    const transitions = ROOM_TRANSITIONS[state];
    if (!transitions) {
        return [];
    }
    return [...new Set(Object.values(transitions))];
}

/**
 * Get all possible target states from a game state
 * @param {string} state - Current game state
 * @returns {string[]} Array of possible target states
 */
function getPossibleGameStates(state) {
    const transitions = GAME_TRANSITIONS[state];
    if (!transitions) {
        return [];
    }
    return [...new Set(Object.values(transitions))];
}

/**
 * Validate that a state value is a valid room state
 * @param {string} state - State to validate
 * @returns {boolean} True if valid room state
 */
function isValidRoomState(state) {
    return Object.values(ROOM_STATES).includes(state);
}

/**
 * Validate that a state value is a valid game state
 * @param {string} state - State to validate
 * @returns {boolean} True if valid game state
 */
function isValidGameState(state) {
    return Object.values(GAME_STATES).includes(state);
}

/**
 * Create a state machine instance for tracking state
 * Useful for encapsulating state management logic
 * @param {string} type - 'room' or 'game'
 * @param {string} initialState - Initial state
 * @param {Object} context - Context for logging
 * @returns {Object} State machine instance
 */
function createStateMachine(type, initialState, context = {}) {
    const isRoom = type === 'room';
    const states = isRoom ? ROOM_STATES : GAME_STATES;
    const actions = isRoom ? ROOM_ACTIONS : GAME_ACTIONS;
    const transitionFn = isRoom ? transitionRoom : transitionGame;
    const getValidActions = isRoom ? getValidRoomActions : getValidGameActions;
    const isTerminal = isRoom ? isTerminalRoomState : isTerminalGameState;
    const canTransition = isRoom ? canTransitionRoom : canTransitionGame;

    // Validate initial state
    if (!Object.values(states).includes(initialState)) {
        throw new StateTransitionError(
            `Invalid initial ${type} state: ${initialState}`,
            initialState,
            'initialize'
        );
    }

    let currentState = initialState;
    const history = [{ state: initialState, timestamp: Date.now(), action: null }];

    return {
        /**
         * Get current state
         * @returns {string} Current state
         */
        getState() {
            return currentState;
        },

        /**
         * Perform a transition
         * @param {string} action - Action to perform
         * @returns {string} New state
         * @throws {StateTransitionError} If transition is invalid
         */
        transition(action) {
            const newState = transitionFn(currentState, action, context);
            history.push({ state: newState, timestamp: Date.now(), action });
            currentState = newState;
            return newState;
        },

        /**
         * Check if an action can be performed
         * @param {string} action - Action to check
         * @returns {boolean} True if action is valid
         */
        canPerform(action) {
            const transitions = isRoom ? ROOM_TRANSITIONS : GAME_TRANSITIONS;
            return transitions[currentState] && transitions[currentState][action] !== undefined;
        },

        /**
         * Check if transition to target state is possible
         * @param {string} targetState - Target state
         * @returns {boolean} True if transition is valid
         */
        canTransitionTo(targetState) {
            return canTransition(currentState, targetState);
        },

        /**
         * Get valid actions from current state
         * @returns {string[]} Array of valid actions
         */
        getValidActions() {
            return getValidActions(currentState);
        },

        /**
         * Check if current state is terminal
         * @returns {boolean} True if terminal
         */
        isTerminal() {
            return isTerminal(currentState);
        },

        /**
         * Get state transition history
         * @returns {Array} Array of state history entries
         */
        getHistory() {
            return [...history];
        },

        /**
         * Get available state constants
         * @returns {Object} State constants
         */
        get states() {
            return states;
        },

        /**
         * Get available action constants
         * @returns {Object} Action constants
         */
        get actions() {
            return actions;
        }
    };
}

module.exports = {
    // State enums
    ROOM_STATES,
    GAME_STATES,
    ROOM_ACTIONS,
    GAME_ACTIONS,

    // Transition maps (for advanced use cases)
    ROOM_TRANSITIONS,
    GAME_TRANSITIONS,

    // Error class
    StateTransitionError,

    // Room transition functions
    canTransitionRoom,
    transitionRoom,
    getValidRoomActions,
    isTerminalRoomState,
    getPossibleRoomStates,
    isValidRoomState,

    // Game transition functions
    canTransitionGame,
    transitionGame,
    getValidGameActions,
    isTerminalGameState,
    getPossibleGameStates,
    isValidGameState,

    // Factory function
    createStateMachine
};
