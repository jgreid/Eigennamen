/**
 * Custom Error Classes for Codenames Game
 *
 * Provides consistent error handling across the application with typed errors
 * that include error codes for client-side handling.
 */

const { ERROR_CODES } = require('../config/constants');

/**
 * Base game error class
 * Extends Error to provide code-based error identification for handlers
 */
class GameError extends Error {
    /**
     * @param {string} code - Error code from ERROR_CODES constants
     * @param {string} message - Human-readable error message
     * @param {Object} details - Optional additional error details
     */
    constructor(code, message, details = null) {
        super(message);
        this.name = 'GameError';
        this.code = code;
        this.details = details;
        this.timestamp = Date.now();

        // Capture stack trace (excluding constructor)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, GameError);
        }
    }

    /**
     * Convert to plain object for serialization
     */
    toJSON() {
        return {
            name: this.name,
            code: this.code,
            message: this.message,
            details: this.details,
            timestamp: this.timestamp
        };
    }

    /**
     * Check if an error is a GameError
     */
    static isGameError(error) {
        return error instanceof GameError;
    }
}

/**
 * Room-related errors
 */
class RoomError extends GameError {
    constructor(code, message, details = null) {
        super(code, message, details);
        this.name = 'RoomError';
    }

    static notFound(roomCode) {
        return new RoomError(
            ERROR_CODES.ROOM_NOT_FOUND,
            'Room not found',
            { roomCode }
        );
    }

    static full(roomCode) {
        return new RoomError(
            ERROR_CODES.ROOM_FULL,
            'Room is full',
            { roomCode }
        );
    }

    static expired(roomCode) {
        return new RoomError(
            ERROR_CODES.ROOM_EXPIRED,
            'Room has expired',
            { roomCode }
        );
    }

    static gameInProgress(roomCode) {
        return new RoomError(
            ERROR_CODES.GAME_IN_PROGRESS,
            'A game is already in progress',
            { roomCode }
        );
    }
}

/**
 * Player/permission-related errors
 */
class PlayerError extends GameError {
    constructor(code, message, details = null) {
        super(code, message, details);
        this.name = 'PlayerError';
    }

    static notHost() {
        return new PlayerError(
            ERROR_CODES.NOT_HOST,
            'Only the host can perform this action'
        );
    }

    static notSpymaster() {
        return new PlayerError(
            ERROR_CODES.NOT_SPYMASTER,
            'Only spymasters can perform this action'
        );
    }

    static notClicker() {
        return new PlayerError(
            ERROR_CODES.NOT_CLICKER,
            'Only clickers can perform this action'
        );
    }

    static notYourTurn(team) {
        return new PlayerError(
            ERROR_CODES.NOT_YOUR_TURN,
            "It's not your team's turn",
            { team }
        );
    }

    static notAuthorized() {
        return new PlayerError(
            ERROR_CODES.NOT_AUTHORIZED,
            'Not authorized to perform this action'
        );
    }

    static notFound(sessionId) {
        return new PlayerError(
            ERROR_CODES.PLAYER_NOT_FOUND,
            'Player not found',
            { sessionId }
        );
    }
}

/**
 * Game state errors
 */
class GameStateError extends GameError {
    constructor(code, message, details = null) {
        super(code, message, details);
        this.name = 'GameStateError';
    }

    static cardAlreadyRevealed(index) {
        return new GameStateError(
            ERROR_CODES.CARD_ALREADY_REVEALED,
            'Card already revealed',
            { index }
        );
    }

    static gameOver() {
        return new GameStateError(
            ERROR_CODES.GAME_OVER,
            'Game is already over'
        );
    }

    static noActiveGame() {
        return new GameStateError(
            ERROR_CODES.ROOM_NOT_FOUND,
            'No active game'
        );
    }

    static corrupted(roomCode, context = {}) {
        return new GameStateError(
            ERROR_CODES.SERVER_ERROR,
            'Game data corrupted, please start a new game',
            {
                roomCode,
                recoverable: true,
                suggestion: 'Start a new game to continue playing',
                ...context
            }
        );
    }

    static invalidState(roomCode, expectedState, actualState) {
        return new GameStateError(
            ERROR_CODES.SERVER_ERROR,
            `Invalid game state: expected ${expectedState}, got ${actualState}`,
            { roomCode, expectedState, actualState }
        );
    }
}

/**
 * Validation errors
 */
class ValidationError extends GameError {
    constructor(message, details = null) {
        super(ERROR_CODES.INVALID_INPUT, message, details);
        this.name = 'ValidationError';
    }

    static invalidCardIndex(index, max) {
        return new ValidationError(
            `Invalid card index: must be 0-${max - 1}`,
            { index, max }
        );
    }

    static noGuessesRemaining() {
        return new ValidationError(
            'No guesses remaining this turn'
        );
    }

    static clueAlreadyGiven() {
        return new ValidationError(
            'A clue has already been given this turn'
        );
    }

    static noClueGiven() {
        return new ValidationError(
            'Spymaster must give a clue before guessing'
        );
    }

    static invalidClue(reason) {
        return new ValidationError(reason);
    }

    static invalidTeam() {
        return new ValidationError(
            'Spymaster must be on a team to give clues'
        );
    }
}

/**
 * Rate limiting errors
 */
class RateLimitError extends GameError {
    constructor(message = 'Too many requests, please slow down', details = null) {
        super(ERROR_CODES.RATE_LIMITED, message, details);
        this.name = 'RateLimitError';
    }
}

/**
 * Server/internal errors
 */
class ServerError extends GameError {
    constructor(message = 'An internal server error occurred', details = null) {
        super(ERROR_CODES.SERVER_ERROR, message, details);
        this.name = 'ServerError';
    }

    static concurrentModification(roomCode = null, operation = null) {
        return new ServerError(
            'Failed due to concurrent modifications, please try again',
            {
                roomCode,
                operation,
                retryable: true
            }
        );
    }

    static redisError(operation, roomCode = null, originalError = null) {
        return new ServerError(
            `Database operation failed: ${operation}`,
            {
                roomCode,
                operation,
                originalError: originalError?.message,
                retryable: true
            }
        );
    }

    static lockAcquisitionFailed(lockType, roomCode) {
        return new ServerError(
            `Another ${lockType} operation is in progress, please try again`,
            {
                roomCode,
                lockType,
                retryable: true
            }
        );
    }
}

/**
 * Word list errors
 */
class WordListError extends GameError {
    constructor(code, message, details = null) {
        super(code, message, details);
        this.name = 'WordListError';
    }

    static notFound(id) {
        return new WordListError(
            ERROR_CODES.WORD_LIST_NOT_FOUND,
            'Word list not found',
            { id }
        );
    }

    static notAuthorized(id) {
        return new WordListError(
            ERROR_CODES.NOT_AUTHORIZED,
            'Not authorized to modify this word list',
            { id }
        );
    }
}

module.exports = {
    GameError,
    RoomError,
    PlayerError,
    GameStateError,
    ValidationError,
    RateLimitError,
    ServerError,
    WordListError
};
