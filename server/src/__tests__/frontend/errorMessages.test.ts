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
            ['RATE_LIMITED', 'Too many requests \u2014 wait a few seconds and try again'],
            ['NOT_YOUR_TURN', "It's not your team's turn \u2014 wait for the other team to finish"],
            ['NOT_CLICKER', 'Only the Clicker can reveal cards \u2014 select the Clicker role first'],
            ['NOT_SPYMASTER', 'Only spymasters can perform this action'],
            ['GAME_NOT_STARTED', 'Wait for the host to start the game'],
            ['GAME_OVER', 'The game has ended \u2014 click New Game to play again'],
            ['CARD_ALREADY_REVEALED', 'That card has already been revealed'],
            ['TEAM_WOULD_BE_EMPTY', 'Cannot leave \u2014 your team needs at least one player'],
            [
                'CANNOT_SWITCH_TEAM_DURING_TURN',
                "Cannot switch teams during your team's active turn \u2014 wait for the turn to end",
            ],
            [
                'CANNOT_CHANGE_ROLE_DURING_TURN',
                "Cannot change roles during your team's active turn \u2014 wait for the turn to end",
            ],
            ['SPYMASTER_CANNOT_CHANGE_TEAM', 'Spymasters cannot change teams during an active game'],
            ['MUST_JOIN_TEAM', 'Join a team first by clicking a team score, then select a role'],
            ['ROLE_TAKEN', 'That role is already taken \u2014 try the other role or wait for it to open'],
            ['ROOM_NOT_FOUND', 'Room not found \u2014 it may have expired. Check the Room ID or create a new room'],
            ['PLAYER_NOT_FOUND', 'Session expired \u2014 please refresh the page and rejoin'],
            ['INVALID_INPUT', 'Invalid request \u2014 please check your input and try again'],
            ['SERVER_ERROR', 'Server error \u2014 please try again in a moment'],
        ];

        test.each(codeExpectations)('maps code "%s" to user-friendly message', (code, expected) => {
            const result = getErrorMessage({ code, message: '' });
            expect(result).toBe(expected);
        });
    });

    describe('partial message matches', () => {
        test('matches "rate limit" in message', () => {
            const result = getErrorMessage({ code: '', message: 'You are rate limited' });
            expect(result).toBe('Too many requests \u2014 wait a few seconds and try again');
        });

        test('matches "rate limit" case-insensitively', () => {
            const result = getErrorMessage({ code: '', message: 'RATE LIMIT exceeded' });
            expect(result).toBe('Too many requests \u2014 wait a few seconds and try again');
        });

        test('matches "not your turn" in message', () => {
            const result = getErrorMessage({ code: '', message: 'This is not your turn to play' });
            expect(result).toBe("It's not your team's turn \u2014 wait for the other team to finish");
        });

        test('matches "must join a team" in message', () => {
            const result = getErrorMessage({ code: '', message: 'You must join a team first' });
            expect(result).toBe('Join a team first by clicking a team score, then select a role');
        });

        test('matches "already has a" in message (role taken)', () => {
            const result = getErrorMessage({ code: '', message: 'Team already has a spymaster' });
            expect(result).toBe('That role is already taken \u2014 try the other role or wait for it to open');
        });

        test('matches "another player is becoming" in message', () => {
            const result = getErrorMessage({ code: '', message: 'Another player is becoming spymaster' });
            expect(result).toBe('Someone else is selecting that role \u2014 wait a moment and try again');
        });
    });

    describe('fallback behavior', () => {
        test('returns original message when no mapping found', () => {
            const result = getErrorMessage({ code: 'UNKNOWN', message: 'Some specific error' });
            expect(result).toBe('Some specific error');
        });

        test('returns default message when both code and message are empty', () => {
            const result = getErrorMessage({ code: '', message: '' });
            expect(result).toBe('Something went wrong \u2014 please try again');
        });

        test('returns default when message is undefined', () => {
            const result = getErrorMessage({ code: '' } as any);
            expect(result).toBe('Something went wrong \u2014 please try again');
        });

        test('returns default when code is undefined', () => {
            const result = getErrorMessage({ message: '' } as any);
            expect(result).toBe('Something went wrong \u2014 please try again');
        });

        test('returns default for completely empty object', () => {
            const result = getErrorMessage({} as any);
            expect(result).toBe('Something went wrong \u2014 please try again');
        });
    });

    describe('priority: code match over message match', () => {
        test('exact code match takes priority over partial message match', () => {
            const result = getErrorMessage({ code: 'SERVER_ERROR', message: 'rate limit exceeded' });
            // Should match the code 'SERVER_ERROR', not the message pattern 'rate limit'
            expect(result).toBe('Server error \u2014 please try again in a moment');
        });
    });
});
