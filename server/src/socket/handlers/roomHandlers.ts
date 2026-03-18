import type { Server } from 'socket.io';
import type { GameSocket } from './types';

import roomMembershipHandlers from './roomHandlers/roomMembershipHandlers';
import roomSettingsHandlers from './roomHandlers/roomSettingsHandlers';
import roomSyncHandlers from './roomHandlers/roomSyncHandlers';
import roomReconnectionHandlers from './roomHandlers/roomReconnectionHandlers';
import { sendSpymasterViewIfNeeded } from './roomHandlerUtils';

/**
 * Register all room-related socket event handlers.
 * Delegates to focused sub-modules for maintainability.
 */
function roomHandlers(io: Server, socket: GameSocket): void {
    roomMembershipHandlers(io, socket);
    roomSettingsHandlers(io, socket);
    roomSyncHandlers(io, socket);
    roomReconnectionHandlers(io, socket);
}

export default roomHandlers;

// CommonJS interop — tests use require() which needs module.exports
module.exports = roomHandlers;
module.exports.default = roomHandlers;
module.exports.sendSpymasterViewIfNeeded = sendSpymasterViewIfNeeded;
