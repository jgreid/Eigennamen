/**
 * Map server error codes to user-friendly messages
 */
export function getErrorMessage(error) {
    const code = error.code || '';
    const message = error.message || '';
    // Common error code mappings with actionable recovery hints
    const errorMessages = {
        RATE_LIMITED: 'Too many requests \u2014 wait a few seconds and try again',
        NOT_YOUR_TURN: "It's not your team's turn \u2014 wait for the other team to finish",
        NOT_CLICKER: 'Only the Clicker can reveal cards \u2014 select the Clicker role first',
        NOT_SPYMASTER: 'Only spymasters can perform this action',
        GAME_NOT_STARTED: 'Wait for the host to start the game',
        GAME_OVER: 'The game has ended \u2014 click New Game to play again',
        CARD_ALREADY_REVEALED: 'That card has already been revealed',
        TEAM_WOULD_BE_EMPTY: 'Cannot leave \u2014 your team needs at least one player',
        CANNOT_SWITCH_TEAM_DURING_TURN: "Cannot switch teams during your team's active turn \u2014 wait for the turn to end",
        CANNOT_CHANGE_ROLE_DURING_TURN: "Cannot change roles during your team's active turn \u2014 wait for the turn to end",
        SPYMASTER_CANNOT_CHANGE_TEAM: 'Spymasters cannot change teams during an active game',
        MUST_JOIN_TEAM: 'Join a team first by clicking a team score, then select a role',
        ROLE_TAKEN: 'That role is already taken \u2014 try the other role or wait for it to open',
        ROOM_NOT_FOUND: 'Room not found \u2014 it may have expired. Check the Room ID or create a new room',
        PLAYER_NOT_FOUND: 'Session expired \u2014 please refresh the page and rejoin',
        INVALID_INPUT: 'Invalid request \u2014 please check your input and try again',
        SERVER_ERROR: 'Server error \u2014 please try again in a moment',
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
        return 'Join a team first by clicking a team score, then select a role';
    }
    if (message.toLowerCase().includes('already has a')) {
        return 'That role is already taken \u2014 try the other role or wait for it to open';
    }
    if (message.toLowerCase().includes('another player is becoming')) {
        return 'Someone else is selecting that role \u2014 wait a moment and try again';
    }
    // Return original message if no mapping found
    return message || 'Something went wrong \u2014 please try again';
}
//# sourceMappingURL=errorMessages.js.map