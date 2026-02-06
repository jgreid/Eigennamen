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
} as const;

type RoomState = typeof ROOM_STATES[keyof typeof ROOM_STATES];

/**
 * Game lifecycle states
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
} as const;

type GameState = typeof GAME_STATES[keyof typeof GAME_STATES];

/**
 * Room state transition actions
 */
const ROOM_ACTIONS = {
    INITIALIZE: 'initialize',
    START_GAME: 'start_game',
    END_GAME: 'end_game',
    RESTART: 'restart',
    CLOSE: 'close'
} as const;

type RoomAction = typeof ROOM_ACTIONS[keyof typeof ROOM_ACTIONS];

/**
 * Game state transition actions
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
} as const;

type GameAction = typeof GAME_ACTIONS[keyof typeof GAME_ACTIONS];

/**
 * Transition map type
 */
type TransitionMap<S extends string, A extends string> = {
    [state in S]?: {
        [action in A]?: S;
    };
};

/**
 * Valid room state transitions
 * Maps current state -> action -> target state
 */
const ROOM_TRANSITIONS: TransitionMap<RoomState, RoomAction> = {
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
const GAME_TRANSITIONS: TransitionMap<GameState, GameAction> = {
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
const TERMINAL_ROOM_STATES: RoomState[] = [ROOM_STATES.CLOSED];
const TERMINAL_GAME_STATES: GameState[] = [GAME_STATES.GAME_OVER];

/**
 * State transition error
 */
class StateTransitionError extends Error {
    public code: string;
    public currentState: string;
    public action: string;
    public targetState: string | null;

    /**
     * @param message - Error message
     * @param currentState - Current state
     * @param action - Attempted action
     * @param targetState - Target state (if known)
     */
    constructor(message: string, currentState: string, action: string, targetState: string | null = null) {
        super(message);
        this.name = 'StateTransitionError';
        this.code = 'INVALID_STATE_TRANSITION';
        this.currentState = currentState;
        this.action = action;
        this.targetState = targetState;
    }
}

/**
 * Transition context for logging
 */
interface TransitionContext {
    roomCode?: string;
    [key: string]: unknown;
}

/**
 * Check if a room state transition is valid
 * @param currentState - Current room state
 * @param targetState - Target room state
 * @returns True if transition is valid
 */
function canTransitionRoom(currentState: RoomState, targetState: RoomState): boolean {
    const transitions = ROOM_TRANSITIONS[currentState];
    if (!transitions) {
        return false;
    }
    return Object.values(transitions).includes(targetState);
}

/**
 * Check if a game state transition is valid
 * @param currentState - Current game state
 * @param targetState - Target game state
 * @returns True if transition is valid
 */
function canTransitionGame(currentState: GameState, targetState: GameState): boolean {
    const transitions = GAME_TRANSITIONS[currentState];
    if (!transitions) {
        return false;
    }
    return Object.values(transitions).includes(targetState);
}

/**
 * Transition room state based on action
 * @param currentState - Current room state
 * @param action - Action to perform
 * @param context - Optional context for logging
 * @returns New room state
 * @throws StateTransitionError If transition is invalid
 */
function transitionRoom(currentState: RoomState, action: RoomAction, context: TransitionContext = {}): RoomState {
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

    const newState = transitions[action]!;

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
 * @param currentState - Current game state
 * @param action - Action to perform
 * @param context - Optional context for logging
 * @returns New game state
 * @throws StateTransitionError If transition is invalid
 */
function transitionGame(currentState: GameState, action: GameAction, context: TransitionContext = {}): GameState {
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

    const newState = transitions[action]!;

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
 * @param state - Current room state
 * @returns Array of valid actions
 */
function getValidRoomActions(state: RoomState): RoomAction[] {
    const transitions = ROOM_TRANSITIONS[state];
    if (!transitions) {
        return [];
    }
    return Object.keys(transitions) as RoomAction[];
}

/**
 * Get valid actions for a game state
 * @param state - Current game state
 * @returns Array of valid actions
 */
function getValidGameActions(state: GameState): GameAction[] {
    const transitions = GAME_TRANSITIONS[state];
    if (!transitions) {
        return [];
    }
    return Object.keys(transitions) as GameAction[];
}

/**
 * Check if a room state is terminal (no further transitions possible)
 * @param state - Room state to check
 * @returns True if state is terminal
 */
function isTerminalRoomState(state: RoomState): boolean {
    return TERMINAL_ROOM_STATES.includes(state);
}

/**
 * Check if a game state is terminal (game over)
 * @param state - Game state to check
 * @returns True if state is terminal
 */
function isTerminalGameState(state: GameState): boolean {
    return TERMINAL_GAME_STATES.includes(state);
}

/**
 * Get all possible target states from a room state
 * @param state - Current room state
 * @returns Array of possible target states
 */
function getPossibleRoomStates(state: RoomState): RoomState[] {
    const transitions = ROOM_TRANSITIONS[state];
    if (!transitions) {
        return [];
    }
    return [...new Set(Object.values(transitions))] as RoomState[];
}

/**
 * Get all possible target states from a game state
 * @param state - Current game state
 * @returns Array of possible target states
 */
function getPossibleGameStates(state: GameState): GameState[] {
    const transitions = GAME_TRANSITIONS[state];
    if (!transitions) {
        return [];
    }
    return [...new Set(Object.values(transitions))] as GameState[];
}

/**
 * Validate that a state value is a valid room state
 * @param state - State to validate
 * @returns True if valid room state
 */
function isValidRoomState(state: string): state is RoomState {
    return Object.values(ROOM_STATES).includes(state as RoomState);
}

/**
 * Validate that a state value is a valid game state
 * @param state - State to validate
 * @returns True if valid game state
 */
function isValidGameState(state: string): state is GameState {
    return Object.values(GAME_STATES).includes(state as GameState);
}

/**
 * State history entry interface
 */
interface StateHistoryEntry {
    state: string;
    timestamp: number;
    action: string | null;
}

/**
 * State machine instance interface
 */
interface StateMachineInstance<S extends string, A extends string> {
    getState(): S;
    transition(action: A): S;
    canPerform(action: A): boolean;
    canTransitionTo(targetState: S): boolean;
    getValidActions(): A[];
    isTerminal(): boolean;
    getHistory(): StateHistoryEntry[];
    readonly states: Record<string, S>;
    readonly actions: Record<string, A>;
}

/**
 * Create a state machine instance for tracking state
 * Useful for encapsulating state management logic
 * @param type - 'room' or 'game'
 * @param initialState - Initial state
 * @param context - Context for logging
 * @returns State machine instance
 */
function createStateMachine(
    type: 'room',
    initialState: RoomState,
    context?: TransitionContext
): StateMachineInstance<RoomState, RoomAction>;
function createStateMachine(
    type: 'game',
    initialState: GameState,
    context?: TransitionContext
): StateMachineInstance<GameState, GameAction>;
function createStateMachine(
    type: 'room' | 'game',
    initialState: RoomState | GameState,
    context: TransitionContext = {}
): StateMachineInstance<RoomState, RoomAction> | StateMachineInstance<GameState, GameAction> {
    const isRoom = type === 'room';
    const states = isRoom ? ROOM_STATES : GAME_STATES;
    const actions = isRoom ? ROOM_ACTIONS : GAME_ACTIONS;
    const transitionFn = isRoom ? transitionRoom : transitionGame;
    const getValidActions = isRoom ? getValidRoomActions : getValidGameActions;
    const isTerminal = isRoom ? isTerminalRoomState : isTerminalGameState;
    const canTransitionFn = isRoom ? canTransitionRoom : canTransitionGame;
    const transitionsMap = isRoom ? ROOM_TRANSITIONS : GAME_TRANSITIONS;

    // Validate initial state
    if (!Object.values(states).includes(initialState as RoomState & GameState)) {
        throw new StateTransitionError(
            `Invalid initial ${type} state: ${initialState}`,
            initialState,
            'initialize'
        );
    }

    let currentState = initialState;
    const history: StateHistoryEntry[] = [{ state: initialState, timestamp: Date.now(), action: null }];

    return ({
        /**
         * Get current state
         * @returns Current state
         */
        getState(): RoomState & GameState {
            return currentState as RoomState & GameState;
        },

        /**
         * Perform a transition
         * @param action - Action to perform
         * @returns New state
         * @throws StateTransitionError If transition is invalid
         */
        transition(action: RoomAction & GameAction): RoomState & GameState {
            const newState = (transitionFn as (s: string, a: string, c: TransitionContext) => string)(
                currentState,
                action,
                context
            );
            history.push({ state: newState, timestamp: Date.now(), action });
            currentState = newState as RoomState & GameState;
            return newState as RoomState & GameState;
        },

        /**
         * Check if an action can be performed
         * @param action - Action to check
         * @returns True if action is valid
         */
        canPerform(action: RoomAction & GameAction): boolean {
            const transitions = transitionsMap[currentState as keyof typeof transitionsMap];
            return transitions !== undefined && (transitions as Record<string, string>)[action] !== undefined;
        },

        /**
         * Check if transition to target state is possible
         * @param targetState - Target state
         * @returns True if transition is valid
         */
        canTransitionTo(targetState: RoomState & GameState): boolean {
            return (canTransitionFn as (c: string, t: string) => boolean)(currentState, targetState);
        },

        /**
         * Get valid actions from current state
         * @returns Array of valid actions
         */
        getValidActions(): (RoomAction & GameAction)[] {
            return (getValidActions as (s: string) => string[])(currentState) as (RoomAction & GameAction)[];
        },

        /**
         * Check if current state is terminal
         * @returns True if terminal
         */
        isTerminal(): boolean {
            return (isTerminal as (s: string) => boolean)(currentState);
        },

        /**
         * Get state transition history
         * @returns Array of state history entries
         */
        getHistory(): StateHistoryEntry[] {
            return [...history];
        },

        /**
         * Get available state constants
         * @returns State constants
         */
        get states() {
            return states as Record<string, RoomState> | Record<string, GameState>;
        },

        /**
         * Get available action constants
         * @returns Action constants
         */
        get actions() {
            return actions as Record<string, RoomAction> | Record<string, GameAction>;
        }
    }) as StateMachineInstance<RoomState, RoomAction> | StateMachineInstance<GameState, GameAction>;
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

// ES6 exports for TypeScript imports
export {
    ROOM_STATES,
    GAME_STATES,
    ROOM_ACTIONS,
    GAME_ACTIONS,
    ROOM_TRANSITIONS,
    GAME_TRANSITIONS,
    StateTransitionError,
    canTransitionRoom,
    transitionRoom,
    getValidRoomActions,
    isTerminalRoomState,
    getPossibleRoomStates,
    isValidRoomState,
    canTransitionGame,
    transitionGame,
    getValidGameActions,
    isTerminalGameState,
    getPossibleGameStates,
    isValidGameState,
    createStateMachine
};

export type {
    RoomState,
    GameState,
    RoomAction,
    GameAction,
    TransitionContext,
    StateHistoryEntry,
    StateMachineInstance
};
