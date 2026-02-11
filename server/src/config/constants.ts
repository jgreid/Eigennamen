/**
 * Game Constants
 *
 * Barrel export for all configuration constants.
 * Domain-specific values are organized in:
 *   - gameConfig.ts     Board layout, game modes, teams, roles
 *   - rateLimits.ts     Rate limits for socket events and HTTP API
 *   - socketConfig.ts   Socket.io settings and event name constants
 *   - errorCodes.ts     Application error codes
 *   - securityConfig.ts Session security, validation, reserved names, locks
 *   - roomConfig.ts     Room settings, Redis TTLs, timer, player cleanup
 */

export * from './gameConfig';
export * from './rateLimits';
export * from './socketConfig';
export * from './errorCodes';
export * from './securityConfig';
export * from './roomConfig';
