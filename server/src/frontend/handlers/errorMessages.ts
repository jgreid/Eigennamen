import type { ServerErrorData } from '../multiplayerTypes.js';

/**
 * Map server error codes to user-friendly messages
 */
export function getErrorMessage(error: ServerErrorData): string {
    const code = error.code || '';
    const message = error.message || '';

    // Common error code mappings
    const errorMessages: Record<string, string> = {
        'RATE_LIMITED': 'Please wait a moment before trying again',
        'NOT_YOUR_TURN': "It's not your team's turn",
        'NOT_CLICKER': 'Only the team clicker can reveal cards',
        'NOT_SPYMASTER': 'Only spymasters can perform this action',
        'GAME_NOT_STARTED': 'Wait for the host to start the game',
        'GAME_OVER': 'The game has ended - start a new game',
        'CARD_ALREADY_REVEALED': 'That card has already been revealed',
        'TEAM_WOULD_BE_EMPTY': 'Cannot leave - your team needs at least one player',
        'CANNOT_SWITCH_TEAM_DURING_TURN': 'Cannot switch teams during your active turn',
        'CANNOT_CHANGE_ROLE_DURING_TURN': 'Cannot change roles during your active turn',
        'SPYMASTER_CANNOT_CHANGE_TEAM': 'Spymasters cannot change teams during an active game',
        'MUST_JOIN_TEAM': 'Join a team first before selecting a role',
        'ROLE_TAKEN': 'That role is already taken by another player',
        'ROOM_NOT_FOUND': 'Room not found - it may have expired or you need to create it first',
        'PLAYER_NOT_FOUND': 'Session expired - please rejoin the room',
        'INVALID_INPUT': 'Invalid request - please try again',
        'SERVER_ERROR': 'Server error - please try again'
    };

    // Check for exact code match first
    if (errorMessages[code]) {
        return errorMessages[code];
    }

    // Check for partial matches in message
    if (message.toLowerCase().includes('rate limit')) {
        return errorMessages['RATE_LIMITED'];
    }
    if (message.toLowerCase().includes('not your turn')) {
        return errorMessages['NOT_YOUR_TURN'];
    }
    if (message.toLowerCase().includes('must join a team')) {
        return 'Join a team first before selecting a role';
    }
    if (message.toLowerCase().includes('already has a')) {
        return 'That role is already taken on your team';
    }
    if (message.toLowerCase().includes('another player is becoming')) {
        return 'Someone else is selecting that role - please wait';
    }

    // Return original message if no mapping found
    return message || 'An error occurred - please try again';
}
