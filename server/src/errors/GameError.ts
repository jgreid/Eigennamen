/**
 * Custom Error Classes for Codenames Game
 *
 * Provides consistent error handling across the application with typed errors
 * that include error codes for client-side handling.
 */

import type { ErrorCode, SafeErrorCode } from '../types/errors';

// Import error codes from constants (will be typed when constants.ts is converted)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ERROR_CODES } = require('../config/constants');

/**
 * Error details that can be attached to game errors
 */
export interface GameErrorDetails {
    [key: string]: unknown;
    roomCode?: string;
    roomId?: string;
    sessionId?: string;
    team?: string;
    index?: number;
    max?: number;
    recoverable?: boolean;
    suggestion?: string;
    retryable?: boolean;
    operation?: string;
}

/**
 * Base game error class
 * Extends Error to provide code-based error identification for handlers
 */
export class GameError extends Error {
    public override readonly name: string = 'GameError';
    public readonly code: ErrorCode;
    public readonly details: GameErrorDetails | null;
    public readonly timestamp: number;

    /**
     * @param code - Error code from ERROR_CODES constants
     * @param message - Human-readable error message
     * @param details - Optional additional error details
     */
    constructor(code: ErrorCode, message: string, details: GameErrorDetails | null = null) {
        super(message);
        this.code = code;
        this.details = details;
        this.timestamp = Date.now();

        // Capture stack trace (excluding constructor)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }

    /**
     * Convert to plain object for serialization
     */
    toJSON(): {
        name: string;
        code: ErrorCode;
        message: string;
        details: GameErrorDetails | null;
        timestamp: number;
    } {
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
    static isGameError(error: unknown): error is GameError {
        return error instanceof GameError;
    }
}

/**
 * Room-related errors
 */
export class RoomError extends GameError {
    public override readonly name: string = 'RoomError';

    constructor(code: ErrorCode, message: string, details: GameErrorDetails | null = null) {
        super(code, message, details);
    }

    static notFound(roomCode: string): RoomError {
        return new RoomError(
            ERROR_CODES.ROOM_NOT_FOUND,
            'Room not found',
            { roomCode }
        );
    }

    static full(roomCode: string): RoomError {
        return new RoomError(
            ERROR_CODES.ROOM_FULL,
            'Room is full',
            { roomCode }
        );
    }

    static gameInProgress(roomCode: string): RoomError {
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
export class PlayerError extends GameError {
    public override readonly name: string = 'PlayerError';

    constructor(code: ErrorCode, message: string, details: GameErrorDetails | null = null) {
        super(code, message, details);
    }

    static notHost(): PlayerError {
        return new PlayerError(
            ERROR_CODES.NOT_HOST,
            'Only the host can perform this action'
        );
    }

    static notSpymaster(): PlayerError {
        return new PlayerError(
            ERROR_CODES.NOT_SPYMASTER,
            'Only spymasters can perform this action'
        );
    }

    static notClicker(): PlayerError {
        return new PlayerError(
            ERROR_CODES.NOT_CLICKER,
            'Only clickers can perform this action'
        );
    }

    static notYourTurn(team: string): PlayerError {
        return new PlayerError(
            ERROR_CODES.NOT_YOUR_TURN,
            "It's not your team's turn",
            { team }
        );
    }

    static notAuthorized(): PlayerError {
        return new PlayerError(
            ERROR_CODES.NOT_AUTHORIZED,
            'Not authorized to perform this action'
        );
    }

    static notFound(sessionId: string): PlayerError {
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
export class GameStateError extends GameError {
    public override readonly name: string = 'GameStateError';

    constructor(code: ErrorCode, message: string, details: GameErrorDetails | null = null) {
        super(code, message, details);
    }

    static cardAlreadyRevealed(index: number): GameStateError {
        return new GameStateError(
            ERROR_CODES.CARD_ALREADY_REVEALED,
            'Card already revealed',
            { index }
        );
    }

    static gameOver(): GameStateError {
        return new GameStateError(
            ERROR_CODES.GAME_OVER,
            'Game is already over'
        );
    }

    static noActiveGame(): GameStateError {
        return new GameStateError(
            ERROR_CODES.ROOM_NOT_FOUND,
            'No active game'
        );
    }

    static corrupted(roomCode: string, context: GameErrorDetails = {}): GameStateError {
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
}

/**
 * Validation errors
 */
export class ValidationError extends GameError {
    public override readonly name: string = 'ValidationError';

    constructor(message: string, details: GameErrorDetails | null = null) {
        super(ERROR_CODES.INVALID_INPUT, message, details);
    }

    static invalidCardIndex(index: number, max: number): ValidationError {
        return new ValidationError(
            `Invalid card index: must be 0-${max - 1}`,
            { index, max }
        );
    }

    static noGuessesRemaining(): ValidationError {
        return new ValidationError(
            'No guesses remaining this turn'
        );
    }

    static clueAlreadyGiven(): ValidationError {
        return new ValidationError(
            'A clue has already been given this turn'
        );
    }

    static invalidClue(reason: string): ValidationError {
        return new ValidationError(reason);
    }

    static invalidTeam(): ValidationError {
        return new ValidationError(
            'Spymaster must be on a team to give clues'
        );
    }
}

/**
 * Rate limiting errors
 */
export class RateLimitError extends GameError {
    public override readonly name: string = 'RateLimitError';

    constructor(message: string = 'Too many requests, please slow down', details: GameErrorDetails | null = null) {
        super(ERROR_CODES.RATE_LIMITED, message, details);
    }
}

/**
 * Server/internal errors
 */
export class ServerError extends GameError {
    public override readonly name: string = 'ServerError';

    constructor(message: string = 'An internal server error occurred', details: GameErrorDetails | null = null) {
        super(ERROR_CODES.SERVER_ERROR, message, details);
    }

    static concurrentModification(roomCode: string | null = null, operation: string | null = null): ServerError {
        return new ServerError(
            'Failed due to concurrent modifications, please try again',
            {
                roomCode: roomCode ?? undefined,
                operation: operation ?? undefined,
                retryable: true
            }
        );
    }
}

/**
 * Word list errors
 */
export class WordListError extends GameError {
    public override readonly name: string = 'WordListError';

    constructor(code: ErrorCode, message: string, details: GameErrorDetails | null = null) {
        super(code, message, details);
    }

    static notFound(id: string): WordListError {
        return new WordListError(
            ERROR_CODES.WORD_LIST_NOT_FOUND,
            'Word list not found',
            { id } as GameErrorDetails
        );
    }

    static notAuthorized(id: string): WordListError {
        return new WordListError(
            ERROR_CODES.NOT_AUTHORIZED,
            'Not authorized to modify this word list',
            { id } as GameErrorDetails
        );
    }
}

/**
 * Error codes that are safe to expose to clients.
 * Errors with codes NOT in this list will have their message replaced
 * with a generic message to prevent information disclosure.
 */
export const SAFE_ERROR_CODES: readonly SafeErrorCode[] = [
    'RATE_LIMITED', 'ROOM_NOT_FOUND', 'ROOM_FULL', 'NOT_HOST',
    'NOT_YOUR_TURN', 'GAME_OVER', 'INVALID_INPUT', 'CARD_ALREADY_REVEALED',
    'NOT_SPYMASTER', 'NOT_CLICKER', 'NOT_AUTHORIZED', 'SESSION_EXPIRED',
    'PLAYER_NOT_FOUND', 'GAME_IN_PROGRESS', 'VALIDATION_ERROR',
    'CANNOT_SWITCH_TEAM_DURING_TURN', 'CANNOT_CHANGE_ROLE_DURING_TURN',
    'SPYMASTER_CANNOT_CHANGE_TEAM',
    'GAME_NOT_STARTED'
] as const;

/**
 * Sanitized error for client emission
 */
export interface SanitizedError {
    code: string;
    message: string;
}

/**
 * Sanitize an error for client emission.
 * Only exposes the actual message for known-safe error codes.
 *
 * @param error - The error to sanitize
 * @returns Safe error payload
 */
export function sanitizeErrorForClient(error: unknown): SanitizedError {
    // Handle primitive types (string, number, etc.) thrown as errors
    if (error === null || typeof error !== 'object') {
        return {
            code: ERROR_CODES.SERVER_ERROR,
            message: 'An unexpected error occurred'
        };
    }

    const errorObj = error as Error | GameError | { code?: string; message?: string };
    const code = ('code' in errorObj ? errorObj.code : undefined) ?? ERROR_CODES.SERVER_ERROR;
    const isSafe = (SAFE_ERROR_CODES as readonly string[]).includes(code);
    return {
        code,
        message: isSafe ? (errorObj.message || 'An unexpected error occurred') : 'An unexpected error occurred'
    };
}

// Default export for CommonJS compatibility
module.exports = {
    GameError,
    RoomError,
    PlayerError,
    GameStateError,
    ValidationError,
    RateLimitError,
    ServerError,
    WordListError,
    SAFE_ERROR_CODES,
    sanitizeErrorForClient
};
