/**
 * Game Constants
 *
 * Re-exports from domain-specific config files for convenient imports:
 *   - gameConfig.ts     Board layout, game modes, teams, roles, internals, history, default words
 *   - rateLimits.ts     Rate limits for socket events and HTTP API
 *   - socketConfig.ts   Socket.io settings and event name constants
 *   - errorCodes.ts     Application error codes
 *   - securityConfig.ts Session security, validation, reserved names, locks, retry config
 *   - roomConfig.ts     Room settings, Redis TTLs, timer, player cleanup
 */

export * from './gameConfig';
export * from './rateLimits';
export * from './socketConfig';
export * from './errorCodes';
export * from './securityConfig';
export * from './roomConfig';
