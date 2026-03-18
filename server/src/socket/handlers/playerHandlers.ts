import type { Server } from 'socket.io';
import type { GameSocket } from './types';

import playerRoleHandlers from './playerHandlers/playerRoleHandlers';
import playerAttributeHandlers from './playerHandlers/playerAttributeHandlers';
import playerModerationHandlers from './playerHandlers/playerModerationHandlers';
import spectatorHandlers from './playerHandlers/spectatorHandlers';

/**
 * Register all player-related socket event handlers.
 * Delegates to focused sub-modules for maintainability.
 */
function playerHandlers(io: Server, socket: GameSocket): void {
    playerRoleHandlers(io, socket);
    playerAttributeHandlers(io, socket);
    playerModerationHandlers(io, socket);
    spectatorHandlers(io, socket);
}

export default playerHandlers;

// CommonJS interop — tests use require() which needs module.exports
module.exports = playerHandlers;
module.exports.default = playerHandlers;
