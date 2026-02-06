/**
 * Unit Tests for State Machine
 */

const {
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
} = require('../utils/stateMachine');

describe('Room States', () => {
    describe('ROOM_STATES enum', () => {
        test('has all required states', () => {
            expect(ROOM_STATES.CREATED).toBe('created');
            expect(ROOM_STATES.WAITING).toBe('waiting');
            expect(ROOM_STATES.PLAYING).toBe('playing');
            expect(ROOM_STATES.FINISHED).toBe('finished');
            expect(ROOM_STATES.CLOSED).toBe('closed');
        });

        test('has exactly 5 states', () => {
            expect(Object.keys(ROOM_STATES)).toHaveLength(5);
        });
    });

    describe('ROOM_ACTIONS enum', () => {
        test('has all required actions', () => {
            expect(ROOM_ACTIONS.INITIALIZE).toBe('initialize');
            expect(ROOM_ACTIONS.START_GAME).toBe('start_game');
            expect(ROOM_ACTIONS.END_GAME).toBe('end_game');
            expect(ROOM_ACTIONS.RESTART).toBe('restart');
            expect(ROOM_ACTIONS.CLOSE).toBe('close');
        });
    });

    describe('canTransitionRoom', () => {
        test('allows valid transitions', () => {
            expect(canTransitionRoom(ROOM_STATES.CREATED, ROOM_STATES.WAITING)).toBe(true);
            expect(canTransitionRoom(ROOM_STATES.WAITING, ROOM_STATES.PLAYING)).toBe(true);
            expect(canTransitionRoom(ROOM_STATES.PLAYING, ROOM_STATES.FINISHED)).toBe(true);
            expect(canTransitionRoom(ROOM_STATES.FINISHED, ROOM_STATES.WAITING)).toBe(true);
        });

        test('allows close transition from any non-closed state', () => {
            expect(canTransitionRoom(ROOM_STATES.CREATED, ROOM_STATES.CLOSED)).toBe(true);
            expect(canTransitionRoom(ROOM_STATES.WAITING, ROOM_STATES.CLOSED)).toBe(true);
            expect(canTransitionRoom(ROOM_STATES.PLAYING, ROOM_STATES.CLOSED)).toBe(true);
            expect(canTransitionRoom(ROOM_STATES.FINISHED, ROOM_STATES.CLOSED)).toBe(true);
        });

        test('disallows invalid transitions', () => {
            expect(canTransitionRoom(ROOM_STATES.CREATED, ROOM_STATES.PLAYING)).toBe(false);
            expect(canTransitionRoom(ROOM_STATES.WAITING, ROOM_STATES.FINISHED)).toBe(false);
            expect(canTransitionRoom(ROOM_STATES.PLAYING, ROOM_STATES.WAITING)).toBe(false);
            expect(canTransitionRoom(ROOM_STATES.FINISHED, ROOM_STATES.PLAYING)).toBe(false);
        });

        test('disallows transitions from closed state', () => {
            expect(canTransitionRoom(ROOM_STATES.CLOSED, ROOM_STATES.CREATED)).toBe(false);
            expect(canTransitionRoom(ROOM_STATES.CLOSED, ROOM_STATES.WAITING)).toBe(false);
            expect(canTransitionRoom(ROOM_STATES.CLOSED, ROOM_STATES.PLAYING)).toBe(false);
        });

        test('returns false for invalid state', () => {
            expect(canTransitionRoom('invalid', ROOM_STATES.WAITING)).toBe(false);
        });
    });

    describe('transitionRoom', () => {
        test('transitions from created to waiting', () => {
            const newState = transitionRoom(ROOM_STATES.CREATED, ROOM_ACTIONS.INITIALIZE);
            expect(newState).toBe(ROOM_STATES.WAITING);
        });

        test('transitions from waiting to playing', () => {
            const newState = transitionRoom(ROOM_STATES.WAITING, ROOM_ACTIONS.START_GAME);
            expect(newState).toBe(ROOM_STATES.PLAYING);
        });

        test('transitions from playing to finished', () => {
            const newState = transitionRoom(ROOM_STATES.PLAYING, ROOM_ACTIONS.END_GAME);
            expect(newState).toBe(ROOM_STATES.FINISHED);
        });

        test('transitions from finished to waiting (restart)', () => {
            const newState = transitionRoom(ROOM_STATES.FINISHED, ROOM_ACTIONS.RESTART);
            expect(newState).toBe(ROOM_STATES.WAITING);
        });

        test('transitions to closed from any state', () => {
            expect(transitionRoom(ROOM_STATES.CREATED, ROOM_ACTIONS.CLOSE)).toBe(ROOM_STATES.CLOSED);
            expect(transitionRoom(ROOM_STATES.WAITING, ROOM_ACTIONS.CLOSE)).toBe(ROOM_STATES.CLOSED);
            expect(transitionRoom(ROOM_STATES.PLAYING, ROOM_ACTIONS.CLOSE)).toBe(ROOM_STATES.CLOSED);
            expect(transitionRoom(ROOM_STATES.FINISHED, ROOM_ACTIONS.CLOSE)).toBe(ROOM_STATES.CLOSED);
        });

        test('throws StateTransitionError for invalid state', () => {
            expect(() => transitionRoom('invalid', ROOM_ACTIONS.INITIALIZE))
                .toThrow(StateTransitionError);
        });

        test('throws StateTransitionError for invalid action', () => {
            expect(() => transitionRoom(ROOM_STATES.CREATED, 'invalid'))
                .toThrow(StateTransitionError);
        });

        test('throws StateTransitionError for invalid transition', () => {
            expect(() => transitionRoom(ROOM_STATES.CREATED, ROOM_ACTIONS.START_GAME))
                .toThrow(StateTransitionError);
        });

        test('error contains useful information', () => {
            try {
                transitionRoom(ROOM_STATES.CREATED, ROOM_ACTIONS.START_GAME);
            } catch (error) {
                expect(error).toBeInstanceOf(StateTransitionError);
                expect(error.currentState).toBe(ROOM_STATES.CREATED);
                expect(error.action).toBe(ROOM_ACTIONS.START_GAME);
                expect(error.code).toBe('INVALID_STATE_TRANSITION');
                expect(error.message).toContain('initialize');
            }
        });

        test('accepts context for logging', () => {
            const context = { roomCode: 'ABC123' };
            const newState = transitionRoom(ROOM_STATES.CREATED, ROOM_ACTIONS.INITIALIZE, context);
            expect(newState).toBe(ROOM_STATES.WAITING);
        });
    });

    describe('getValidRoomActions', () => {
        test('returns valid actions for created state', () => {
            const actions = getValidRoomActions(ROOM_STATES.CREATED);
            expect(actions).toContain(ROOM_ACTIONS.INITIALIZE);
            expect(actions).toContain(ROOM_ACTIONS.CLOSE);
            expect(actions).toHaveLength(2);
        });

        test('returns valid actions for waiting state', () => {
            const actions = getValidRoomActions(ROOM_STATES.WAITING);
            expect(actions).toContain(ROOM_ACTIONS.START_GAME);
            expect(actions).toContain(ROOM_ACTIONS.CLOSE);
        });

        test('returns valid actions for playing state', () => {
            const actions = getValidRoomActions(ROOM_STATES.PLAYING);
            expect(actions).toContain(ROOM_ACTIONS.END_GAME);
            expect(actions).toContain(ROOM_ACTIONS.CLOSE);
        });

        test('returns valid actions for finished state', () => {
            const actions = getValidRoomActions(ROOM_STATES.FINISHED);
            expect(actions).toContain(ROOM_ACTIONS.RESTART);
            expect(actions).toContain(ROOM_ACTIONS.CLOSE);
        });

        test('returns empty array for closed state', () => {
            const actions = getValidRoomActions(ROOM_STATES.CLOSED);
            expect(actions).toHaveLength(0);
        });

        test('returns empty array for invalid state', () => {
            const actions = getValidRoomActions('invalid');
            expect(actions).toHaveLength(0);
        });
    });

    describe('isTerminalRoomState', () => {
        test('closed is terminal', () => {
            expect(isTerminalRoomState(ROOM_STATES.CLOSED)).toBe(true);
        });

        test('other states are not terminal', () => {
            expect(isTerminalRoomState(ROOM_STATES.CREATED)).toBe(false);
            expect(isTerminalRoomState(ROOM_STATES.WAITING)).toBe(false);
            expect(isTerminalRoomState(ROOM_STATES.PLAYING)).toBe(false);
            expect(isTerminalRoomState(ROOM_STATES.FINISHED)).toBe(false);
        });
    });

    describe('getPossibleRoomStates', () => {
        test('returns possible states from created', () => {
            const states = getPossibleRoomStates(ROOM_STATES.CREATED);
            expect(states).toContain(ROOM_STATES.WAITING);
            expect(states).toContain(ROOM_STATES.CLOSED);
        });

        test('returns empty array for closed state', () => {
            const states = getPossibleRoomStates(ROOM_STATES.CLOSED);
            expect(states).toHaveLength(0);
        });

        test('returns empty array for invalid state', () => {
            const states = getPossibleRoomStates('invalid');
            expect(states).toHaveLength(0);
        });
    });

    describe('isValidRoomState', () => {
        test('returns true for valid states', () => {
            expect(isValidRoomState(ROOM_STATES.CREATED)).toBe(true);
            expect(isValidRoomState(ROOM_STATES.WAITING)).toBe(true);
            expect(isValidRoomState(ROOM_STATES.PLAYING)).toBe(true);
            expect(isValidRoomState(ROOM_STATES.FINISHED)).toBe(true);
            expect(isValidRoomState(ROOM_STATES.CLOSED)).toBe(true);
        });

        test('returns false for invalid states', () => {
            expect(isValidRoomState('invalid')).toBe(false);
            expect(isValidRoomState('')).toBe(false);
            expect(isValidRoomState(null)).toBe(false);
            expect(isValidRoomState(undefined)).toBe(false);
        });
    });
});

describe('Game States', () => {
    describe('GAME_STATES enum', () => {
        test('has all required states', () => {
            expect(GAME_STATES.INITIALIZED).toBe('initialized');
            expect(GAME_STATES.CLUE_PHASE).toBe('clue_phase');
            expect(GAME_STATES.GUESS_PHASE).toBe('guess_phase');
            expect(GAME_STATES.TURN_ENDED).toBe('turn_ended');
            expect(GAME_STATES.GAME_OVER).toBe('game_over');
        });

        test('has exactly 5 states', () => {
            expect(Object.keys(GAME_STATES)).toHaveLength(5);
        });
    });

    describe('GAME_ACTIONS enum', () => {
        test('has all required actions', () => {
            expect(GAME_ACTIONS.START).toBe('start');
            expect(GAME_ACTIONS.GIVE_CLUE).toBe('give_clue');
            expect(GAME_ACTIONS.MAKE_GUESS).toBe('make_guess');
            expect(GAME_ACTIONS.END_TURN).toBe('end_turn');
            expect(GAME_ACTIONS.CONTINUE_GUESSING).toBe('continue_guessing');
            expect(GAME_ACTIONS.WIN).toBe('win');
            expect(GAME_ACTIONS.LOSE).toBe('lose');
            expect(GAME_ACTIONS.FORFEIT).toBe('forfeit');
            expect(GAME_ACTIONS.RESET).toBe('reset');
        });
    });

    describe('canTransitionGame', () => {
        test('allows valid transitions', () => {
            expect(canTransitionGame(GAME_STATES.INITIALIZED, GAME_STATES.CLUE_PHASE)).toBe(true);
            expect(canTransitionGame(GAME_STATES.CLUE_PHASE, GAME_STATES.GUESS_PHASE)).toBe(true);
            expect(canTransitionGame(GAME_STATES.GUESS_PHASE, GAME_STATES.TURN_ENDED)).toBe(true);
            expect(canTransitionGame(GAME_STATES.TURN_ENDED, GAME_STATES.CLUE_PHASE)).toBe(true);
        });

        test('allows game over transitions', () => {
            expect(canTransitionGame(GAME_STATES.GUESS_PHASE, GAME_STATES.GAME_OVER)).toBe(true);
            expect(canTransitionGame(GAME_STATES.TURN_ENDED, GAME_STATES.GAME_OVER)).toBe(true);
            expect(canTransitionGame(GAME_STATES.CLUE_PHASE, GAME_STATES.GAME_OVER)).toBe(true);
        });

        test('allows reset from any state', () => {
            expect(canTransitionGame(GAME_STATES.INITIALIZED, GAME_STATES.INITIALIZED)).toBe(true);
            expect(canTransitionGame(GAME_STATES.CLUE_PHASE, GAME_STATES.INITIALIZED)).toBe(true);
            expect(canTransitionGame(GAME_STATES.GUESS_PHASE, GAME_STATES.INITIALIZED)).toBe(true);
            expect(canTransitionGame(GAME_STATES.TURN_ENDED, GAME_STATES.INITIALIZED)).toBe(true);
            expect(canTransitionGame(GAME_STATES.GAME_OVER, GAME_STATES.INITIALIZED)).toBe(true);
        });

        test('disallows invalid transitions', () => {
            expect(canTransitionGame(GAME_STATES.INITIALIZED, GAME_STATES.GUESS_PHASE)).toBe(false);
            expect(canTransitionGame(GAME_STATES.CLUE_PHASE, GAME_STATES.TURN_ENDED)).toBe(false);
            expect(canTransitionGame(GAME_STATES.GAME_OVER, GAME_STATES.CLUE_PHASE)).toBe(false);
        });

        test('returns false for invalid state', () => {
            expect(canTransitionGame('invalid', GAME_STATES.CLUE_PHASE)).toBe(false);
        });
    });

    describe('transitionGame', () => {
        test('transitions from initialized to clue phase', () => {
            const newState = transitionGame(GAME_STATES.INITIALIZED, GAME_ACTIONS.START);
            expect(newState).toBe(GAME_STATES.CLUE_PHASE);
        });

        test('transitions from clue phase to guess phase', () => {
            const newState = transitionGame(GAME_STATES.CLUE_PHASE, GAME_ACTIONS.GIVE_CLUE);
            expect(newState).toBe(GAME_STATES.GUESS_PHASE);
        });

        test('allows continued guessing in guess phase', () => {
            const newState = transitionGame(GAME_STATES.GUESS_PHASE, GAME_ACTIONS.MAKE_GUESS);
            expect(newState).toBe(GAME_STATES.GUESS_PHASE);
        });

        test('transitions from guess phase to turn ended', () => {
            const newState = transitionGame(GAME_STATES.GUESS_PHASE, GAME_ACTIONS.END_TURN);
            expect(newState).toBe(GAME_STATES.TURN_ENDED);
        });

        test('transitions from turn ended to clue phase', () => {
            const newState = transitionGame(GAME_STATES.TURN_ENDED, GAME_ACTIONS.CONTINUE_GUESSING);
            expect(newState).toBe(GAME_STATES.CLUE_PHASE);
        });

        test('transitions to game over on win', () => {
            const newState = transitionGame(GAME_STATES.GUESS_PHASE, GAME_ACTIONS.WIN);
            expect(newState).toBe(GAME_STATES.GAME_OVER);
        });

        test('transitions to game over on lose', () => {
            const newState = transitionGame(GAME_STATES.GUESS_PHASE, GAME_ACTIONS.LOSE);
            expect(newState).toBe(GAME_STATES.GAME_OVER);
        });

        test('transitions to game over on forfeit', () => {
            const newState = transitionGame(GAME_STATES.CLUE_PHASE, GAME_ACTIONS.FORFEIT);
            expect(newState).toBe(GAME_STATES.GAME_OVER);
        });

        test('allows reset from game over', () => {
            const newState = transitionGame(GAME_STATES.GAME_OVER, GAME_ACTIONS.RESET);
            expect(newState).toBe(GAME_STATES.INITIALIZED);
        });

        test('throws StateTransitionError for invalid state', () => {
            expect(() => transitionGame('invalid', GAME_ACTIONS.START))
                .toThrow(StateTransitionError);
        });

        test('throws StateTransitionError for invalid action', () => {
            expect(() => transitionGame(GAME_STATES.INITIALIZED, 'invalid'))
                .toThrow(StateTransitionError);
        });

        test('throws StateTransitionError for invalid transition', () => {
            expect(() => transitionGame(GAME_STATES.INITIALIZED, GAME_ACTIONS.GIVE_CLUE))
                .toThrow(StateTransitionError);
        });

        test('error contains useful information', () => {
            try {
                transitionGame(GAME_STATES.INITIALIZED, GAME_ACTIONS.GIVE_CLUE);
            } catch (error) {
                expect(error).toBeInstanceOf(StateTransitionError);
                expect(error.currentState).toBe(GAME_STATES.INITIALIZED);
                expect(error.action).toBe(GAME_ACTIONS.GIVE_CLUE);
                expect(error.code).toBe('INVALID_STATE_TRANSITION');
            }
        });
    });

    describe('getValidGameActions', () => {
        test('returns valid actions for initialized state', () => {
            const actions = getValidGameActions(GAME_STATES.INITIALIZED);
            expect(actions).toContain(GAME_ACTIONS.START);
            expect(actions).toContain(GAME_ACTIONS.RESET);
        });

        test('returns valid actions for clue phase', () => {
            const actions = getValidGameActions(GAME_STATES.CLUE_PHASE);
            expect(actions).toContain(GAME_ACTIONS.GIVE_CLUE);
            expect(actions).toContain(GAME_ACTIONS.FORFEIT);
            expect(actions).toContain(GAME_ACTIONS.RESET);
        });

        test('returns valid actions for guess phase', () => {
            const actions = getValidGameActions(GAME_STATES.GUESS_PHASE);
            expect(actions).toContain(GAME_ACTIONS.MAKE_GUESS);
            expect(actions).toContain(GAME_ACTIONS.END_TURN);
            expect(actions).toContain(GAME_ACTIONS.WIN);
            expect(actions).toContain(GAME_ACTIONS.LOSE);
            expect(actions).toContain(GAME_ACTIONS.FORFEIT);
            expect(actions).toContain(GAME_ACTIONS.RESET);
        });

        test('returns valid actions for turn ended', () => {
            const actions = getValidGameActions(GAME_STATES.TURN_ENDED);
            expect(actions).toContain(GAME_ACTIONS.CONTINUE_GUESSING);
            expect(actions).toContain(GAME_ACTIONS.WIN);
            expect(actions).toContain(GAME_ACTIONS.LOSE);
            expect(actions).toContain(GAME_ACTIONS.RESET);
        });

        test('returns valid actions for game over', () => {
            const actions = getValidGameActions(GAME_STATES.GAME_OVER);
            expect(actions).toContain(GAME_ACTIONS.RESET);
            expect(actions).toHaveLength(1);
        });

        test('returns empty array for invalid state', () => {
            const actions = getValidGameActions('invalid');
            expect(actions).toHaveLength(0);
        });
    });

    describe('isTerminalGameState', () => {
        test('game over is terminal', () => {
            expect(isTerminalGameState(GAME_STATES.GAME_OVER)).toBe(true);
        });

        test('other states are not terminal', () => {
            expect(isTerminalGameState(GAME_STATES.INITIALIZED)).toBe(false);
            expect(isTerminalGameState(GAME_STATES.CLUE_PHASE)).toBe(false);
            expect(isTerminalGameState(GAME_STATES.GUESS_PHASE)).toBe(false);
            expect(isTerminalGameState(GAME_STATES.TURN_ENDED)).toBe(false);
        });
    });

    describe('getPossibleGameStates', () => {
        test('returns possible states from initialized', () => {
            const states = getPossibleGameStates(GAME_STATES.INITIALIZED);
            expect(states).toContain(GAME_STATES.CLUE_PHASE);
            expect(states).toContain(GAME_STATES.INITIALIZED);
        });

        test('returns possible states from guess phase', () => {
            const states = getPossibleGameStates(GAME_STATES.GUESS_PHASE);
            expect(states).toContain(GAME_STATES.GUESS_PHASE);
            expect(states).toContain(GAME_STATES.TURN_ENDED);
            expect(states).toContain(GAME_STATES.GAME_OVER);
            expect(states).toContain(GAME_STATES.INITIALIZED);
        });

        test('returns only initialized from game over (via reset)', () => {
            const states = getPossibleGameStates(GAME_STATES.GAME_OVER);
            expect(states).toContain(GAME_STATES.INITIALIZED);
            expect(states).toHaveLength(1);
        });

        test('returns empty array for invalid state', () => {
            const states = getPossibleGameStates('invalid');
            expect(states).toHaveLength(0);
        });
    });

    describe('isValidGameState', () => {
        test('returns true for valid states', () => {
            expect(isValidGameState(GAME_STATES.INITIALIZED)).toBe(true);
            expect(isValidGameState(GAME_STATES.CLUE_PHASE)).toBe(true);
            expect(isValidGameState(GAME_STATES.GUESS_PHASE)).toBe(true);
            expect(isValidGameState(GAME_STATES.TURN_ENDED)).toBe(true);
            expect(isValidGameState(GAME_STATES.GAME_OVER)).toBe(true);
        });

        test('returns false for invalid states', () => {
            expect(isValidGameState('invalid')).toBe(false);
            expect(isValidGameState('')).toBe(false);
            expect(isValidGameState(null)).toBe(false);
            expect(isValidGameState(undefined)).toBe(false);
        });
    });
});

describe('StateTransitionError', () => {
    test('creates error with all properties', () => {
        const error = new StateTransitionError(
            'Test error',
            'current',
            'action',
            'target'
        );
        expect(error.message).toBe('Test error');
        expect(error.name).toBe('StateTransitionError');
        expect(error.code).toBe('INVALID_STATE_TRANSITION');
        expect(error.currentState).toBe('current');
        expect(error.action).toBe('action');
        expect(error.targetState).toBe('target');
    });

    test('works without target state', () => {
        const error = new StateTransitionError(
            'Test error',
            'current',
            'action'
        );
        expect(error.targetState).toBeNull();
    });

    test('is instanceof Error', () => {
        const error = new StateTransitionError('Test', 'state', 'action');
        expect(error).toBeInstanceOf(Error);
    });
});

describe('createStateMachine', () => {
    describe('room state machine', () => {
        test('creates machine with initial state', () => {
            const machine = createStateMachine('room', ROOM_STATES.CREATED);
            expect(machine.getState()).toBe(ROOM_STATES.CREATED);
        });

        test('performs valid transitions', () => {
            const machine = createStateMachine('room', ROOM_STATES.CREATED);

            let newState = machine.transition(ROOM_ACTIONS.INITIALIZE);
            expect(newState).toBe(ROOM_STATES.WAITING);
            expect(machine.getState()).toBe(ROOM_STATES.WAITING);

            newState = machine.transition(ROOM_ACTIONS.START_GAME);
            expect(newState).toBe(ROOM_STATES.PLAYING);
            expect(machine.getState()).toBe(ROOM_STATES.PLAYING);
        });

        test('throws on invalid transition', () => {
            const machine = createStateMachine('room', ROOM_STATES.CREATED);
            expect(() => machine.transition(ROOM_ACTIONS.START_GAME))
                .toThrow(StateTransitionError);
        });

        test('canPerform checks action validity', () => {
            const machine = createStateMachine('room', ROOM_STATES.CREATED);
            expect(machine.canPerform(ROOM_ACTIONS.INITIALIZE)).toBe(true);
            expect(machine.canPerform(ROOM_ACTIONS.START_GAME)).toBe(false);
        });

        test('canTransitionTo checks target state validity', () => {
            const machine = createStateMachine('room', ROOM_STATES.CREATED);
            expect(machine.canTransitionTo(ROOM_STATES.WAITING)).toBe(true);
            expect(machine.canTransitionTo(ROOM_STATES.PLAYING)).toBe(false);
        });

        test('getValidActions returns valid actions', () => {
            const machine = createStateMachine('room', ROOM_STATES.CREATED);
            const actions = machine.getValidActions();
            expect(actions).toContain(ROOM_ACTIONS.INITIALIZE);
            expect(actions).toContain(ROOM_ACTIONS.CLOSE);
        });

        test('isTerminal checks terminal state', () => {
            const machine = createStateMachine('room', ROOM_STATES.CREATED);
            expect(machine.isTerminal()).toBe(false);

            machine.transition(ROOM_ACTIONS.CLOSE);
            expect(machine.isTerminal()).toBe(true);
        });

        test('tracks transition history', () => {
            const machine = createStateMachine('room', ROOM_STATES.CREATED);
            machine.transition(ROOM_ACTIONS.INITIALIZE);
            machine.transition(ROOM_ACTIONS.START_GAME);

            const history = machine.getHistory();
            expect(history).toHaveLength(3);
            expect(history[0].state).toBe(ROOM_STATES.CREATED);
            expect(history[0].action).toBeNull();
            expect(history[1].state).toBe(ROOM_STATES.WAITING);
            expect(history[1].action).toBe(ROOM_ACTIONS.INITIALIZE);
            expect(history[2].state).toBe(ROOM_STATES.PLAYING);
            expect(history[2].action).toBe(ROOM_ACTIONS.START_GAME);
        });

        test('exposes states constant', () => {
            const machine = createStateMachine('room', ROOM_STATES.CREATED);
            expect(machine.states).toBe(ROOM_STATES);
        });

        test('exposes actions constant', () => {
            const machine = createStateMachine('room', ROOM_STATES.CREATED);
            expect(machine.actions).toBe(ROOM_ACTIONS);
        });

        test('throws on invalid initial state', () => {
            expect(() => createStateMachine('room', 'invalid'))
                .toThrow(StateTransitionError);
        });

        test('accepts context for logging', () => {
            const machine = createStateMachine('room', ROOM_STATES.CREATED, {
                roomCode: 'ABC123'
            });
            expect(machine.getState()).toBe(ROOM_STATES.CREATED);
        });
    });

    describe('game state machine', () => {
        test('creates machine with initial state', () => {
            const machine = createStateMachine('game', GAME_STATES.INITIALIZED);
            expect(machine.getState()).toBe(GAME_STATES.INITIALIZED);
        });

        test('performs full game lifecycle', () => {
            const machine = createStateMachine('game', GAME_STATES.INITIALIZED);

            // Start game
            machine.transition(GAME_ACTIONS.START);
            expect(machine.getState()).toBe(GAME_STATES.CLUE_PHASE);

            // Give clue
            machine.transition(GAME_ACTIONS.GIVE_CLUE);
            expect(machine.getState()).toBe(GAME_STATES.GUESS_PHASE);

            // Make some guesses
            machine.transition(GAME_ACTIONS.MAKE_GUESS);
            expect(machine.getState()).toBe(GAME_STATES.GUESS_PHASE);

            // End turn
            machine.transition(GAME_ACTIONS.END_TURN);
            expect(machine.getState()).toBe(GAME_STATES.TURN_ENDED);

            // Continue to next turn
            machine.transition(GAME_ACTIONS.CONTINUE_GUESSING);
            expect(machine.getState()).toBe(GAME_STATES.CLUE_PHASE);

            // Give another clue and win
            machine.transition(GAME_ACTIONS.GIVE_CLUE);
            machine.transition(GAME_ACTIONS.WIN);
            expect(machine.getState()).toBe(GAME_STATES.GAME_OVER);
            expect(machine.isTerminal()).toBe(true);
        });

        test('allows reset from game over', () => {
            const machine = createStateMachine('game', GAME_STATES.GAME_OVER);
            machine.transition(GAME_ACTIONS.RESET);
            expect(machine.getState()).toBe(GAME_STATES.INITIALIZED);
        });

        test('exposes states constant', () => {
            const machine = createStateMachine('game', GAME_STATES.INITIALIZED);
            expect(machine.states).toBe(GAME_STATES);
        });

        test('exposes actions constant', () => {
            const machine = createStateMachine('game', GAME_STATES.INITIALIZED);
            expect(machine.actions).toBe(GAME_ACTIONS);
        });

        test('throws on invalid initial state', () => {
            expect(() => createStateMachine('game', 'invalid'))
                .toThrow(StateTransitionError);
        });
    });
});

describe('Transition Maps', () => {
    test('ROOM_TRANSITIONS is exported', () => {
        expect(ROOM_TRANSITIONS).toBeDefined();
        expect(typeof ROOM_TRANSITIONS).toBe('object');
    });

    test('GAME_TRANSITIONS is exported', () => {
        expect(GAME_TRANSITIONS).toBeDefined();
        expect(typeof GAME_TRANSITIONS).toBe('object');
    });

    test('all room states have transition maps', () => {
        Object.values(ROOM_STATES).forEach(state => {
            expect(ROOM_TRANSITIONS[state]).toBeDefined();
        });
    });

    test('all game states have transition maps', () => {
        Object.values(GAME_STATES).forEach(state => {
            expect(GAME_TRANSITIONS[state]).toBeDefined();
        });
    });
});
