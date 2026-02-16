/**
 * Error Messages Tests
 *
 * Tests the getErrorMessage function that maps server error codes
 * to user-friendly messages.
 */

import { getErrorMessage } from '../../frontend/handlers/errorMessages';

describe('getErrorMessage', () => {
    describe('exact error code matches', () => {
        const codeExpectations: [string, string][] = [
            ['RATE_LIMITED', 'Please wait a moment before trying again'],
            ['NOT_YOUR_TURN', "It's not your team's turn"],
            ['NOT_CLICKER', 'Only the team clicker can reveal cards'],
            ['NOT_SPYMASTER', 'Only spymasters can perform this action'],
            ['GAME_NOT_STARTED', 'Wait for the host to start the game'],
            ['GAME_OVER', 'The game has ended - start a new game'],
            ['CARD_ALREADY_REVEALED', 'That card has already been revealed'],
            ['TEAM_WOULD_BE_EMPTY', 'Cannot leave - your team needs at least one player'],
            ['CANNOT_SWITCH_TEAM_DURING_TURN', 'Cannot switch teams during your active turn'],
            ['CANNOT_CHANGE_ROLE_DURING_TURN', 'Cannot change roles during your active turn'],
            ['SPYMASTER_CANNOT_CHANGE_TEAM', 'Spymasters cannot change teams during an active game'],
            ['MUST_JOIN_TEAM', 'Join a team first before selecting a role'],
            ['ROLE_TAKEN', 'That role is already taken by another player'],
            ['ROOM_NOT_FOUND', 'Room not found - it may have expired or you need to create it first'],
            ['PLAYER_NOT_FOUND', 'Session expired - please rejoin the room'],
            ['INVALID_INPUT', 'Invalid request - please try again'],
            ['SERVER_ERROR', 'Server error - please try again'],
        ];

        test.each(codeExpectations)('maps code "%s" to user-friendly message', (code, expected) => {
            const result = getErrorMessage({ code, message: '' });
            expect(result).toBe(expected);
        });
    });

    describe('partial message matches', () => {
        test('matches "rate limit" in message', () => {
            const result = getErrorMessage({ code: '', message: 'You are rate limited' });
            expect(result).toBe('Please wait a moment before trying again');
        });

        test('matches "rate limit" case-insensitively', () => {
            const result = getErrorMessage({ code: '', message: 'RATE LIMIT exceeded' });
            expect(result).toBe('Please wait a moment before trying again');
        });

        test('matches "not your turn" in message', () => {
            const result = getErrorMessage({ code: '', message: 'This is not your turn to play' });
            expect(result).toBe("It's not your team's turn");
        });

        test('matches "must join a team" in message', () => {
            const result = getErrorMessage({ code: '', message: 'You must join a team first' });
            expect(result).toBe('Join a team first before selecting a role');
        });

        test('matches "already has a" in message (role taken)', () => {
            const result = getErrorMessage({ code: '', message: 'Team already has a spymaster' });
            expect(result).toBe('That role is already taken on your team');
        });

        test('matches "another player is becoming" in message', () => {
            const result = getErrorMessage({ code: '', message: 'Another player is becoming spymaster' });
            expect(result).toBe('Someone else is selecting that role - please wait');
        });
    });

    describe('fallback behavior', () => {
        test('returns original message when no mapping found', () => {
            const result = getErrorMessage({ code: 'UNKNOWN', message: 'Some specific error' });
            expect(result).toBe('Some specific error');
        });

        test('returns default message when both code and message are empty', () => {
            const result = getErrorMessage({ code: '', message: '' });
            expect(result).toBe('An error occurred - please try again');
        });

        test('returns default when message is undefined', () => {
            const result = getErrorMessage({ code: '' } as any);
            expect(result).toBe('An error occurred - please try again');
        });

        test('returns default when code is undefined', () => {
            const result = getErrorMessage({ message: '' } as any);
            expect(result).toBe('An error occurred - please try again');
        });

        test('returns default for completely empty object', () => {
            const result = getErrorMessage({} as any);
            expect(result).toBe('An error occurred - please try again');
        });
    });

    describe('priority: code match over message match', () => {
        test('exact code match takes priority over partial message match', () => {
            const result = getErrorMessage({ code: 'SERVER_ERROR', message: 'rate limit exceeded' });
            // Should match the code 'SERVER_ERROR', not the message pattern 'rate limit'
            expect(result).toBe('Server error - please try again');
        });
    });
});
