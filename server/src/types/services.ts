/**
 * Service Type Definitions
 *
 * Shared types used across services and socket handlers.
 */

/**
 * Timer callback function
 */
export type TimerCallback = (roomCode: string) => void | Promise<void>;
