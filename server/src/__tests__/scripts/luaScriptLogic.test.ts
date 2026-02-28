/**
 * Lua Script Behavioral Contract Tests
 *
 * Verifies the logic patterns embedded in Lua script text to catch regressions.
 * Since Jest mocks Redis.eval, Lua scripts are never executed in unit tests.
 * These tests inspect the script source to ensure critical behavioral contracts
 * are preserved across refactors.
 */
import {
    REVEAL_CARD_SCRIPT,
    END_TURN_SCRIPT,
    SET_ROLE_SCRIPT,
    HOST_TRANSFER_SCRIPT,
    SAFE_TEAM_SWITCH_SCRIPT
} from '../../scripts';

describe('Lua Script Behavioral Contracts', () => {
    describe('revealCard.lua logic', () => {
        it('checks for game over before allowing reveal', () => {
            expect(REVEAL_CARD_SCRIPT).toContain('game.gameOver');
            expect(REVEAL_CARD_SCRIPT).toContain("error = 'GAME_OVER'");
        });

        it('validates player team matches currentTurn (Bug #4 defense-in-depth)', () => {
            expect(REVEAL_CARD_SCRIPT).toContain('game.currentTurn ~= playerTeam');
            expect(REVEAL_CARD_SCRIPT).toContain("error = 'NOT_YOUR_TURN'");
            // playerTeam is passed as ARGV[5]
            expect(REVEAL_CARD_SCRIPT).toContain('local playerTeam = ARGV[5]');
        });

        it('checks guessesAllowed vs guessesUsed', () => {
            expect(REVEAL_CARD_SCRIPT).toContain('game.guessesAllowed > 0');
            expect(REVEAL_CARD_SCRIPT).toContain('game.guessesUsed >= game.guessesAllowed');
            expect(REVEAL_CARD_SCRIPT).toContain("error = 'NO_GUESSES'");
        });

        it('uses 1-indexed Lua arrays (luaIndex = index + 1)', () => {
            expect(REVEAL_CARD_SCRIPT).toContain('local luaIndex = index + 1');
            expect(REVEAL_CARD_SCRIPT).toContain('game.revealed[luaIndex]');
            expect(REVEAL_CARD_SCRIPT).toContain('game.types[luaIndex]');
            expect(REVEAL_CARD_SCRIPT).toContain('game.words[luaIndex]');
        });

        it('assassin reveal sets gameOver and winner (opposite team wins in classic)', () => {
            // Classic mode: opposite team wins on assassin
            expect(REVEAL_CARD_SCRIPT).toContain("cardType == 'assassin'");
            expect(REVEAL_CARD_SCRIPT).toContain('game.gameOver = true');
            // In classic block: if red reveals assassin, blue wins; if blue reveals, red wins
            expect(REVEAL_CARD_SCRIPT).toContain("game.winner = 'blue'");
            expect(REVEAL_CARD_SCRIPT).toContain("game.winner = 'red'");
            expect(REVEAL_CARD_SCRIPT).toContain("endReason = 'assassin'");
        });

        it('red score increments only for red card, blue for blue', () => {
            expect(REVEAL_CARD_SCRIPT).toContain("cardType == 'red'");
            expect(REVEAL_CARD_SCRIPT).toContain('game.redScore = game.redScore + 1');
            expect(REVEAL_CARD_SCRIPT).toContain("cardType == 'blue'");
            expect(REVEAL_CARD_SCRIPT).toContain('game.blueScore = game.blueScore + 1');
        });

        it('turn ends on wrong guess in classic mode', () => {
            // In classic mode, if the card type does not match the current turn, turn ends
            expect(REVEAL_CARD_SCRIPT).toContain('cardType ~= previousTurn');
            // Turn switches from red to blue or vice versa
            expect(REVEAL_CARD_SCRIPT).toContain("game.currentTurn = 'blue'");
            expect(REVEAL_CARD_SCRIPT).toContain("game.currentTurn = 'red'");
        });

        it('turn ends on max guesses', () => {
            expect(REVEAL_CARD_SCRIPT).toContain('game.guessesUsed >= game.guessesAllowed');
            expect(REVEAL_CARD_SCRIPT).toContain("endReason = 'maxGuesses'");
            // When max guesses reached, clue and counters reset
            expect(REVEAL_CARD_SCRIPT).toContain('game.currentClue = cjson.null');
            expect(REVEAL_CARD_SCRIPT).toContain('game.guessesUsed = 0');
            expect(REVEAL_CARD_SCRIPT).toContain('game.guessesAllowed = 0');
        });

        it('duet mode: green cards increment greenFound, neutral costs timer token', () => {
            // Duet mode detection
            expect(REVEAL_CARD_SCRIPT).toContain("game.gameMode == 'duet'");
            // Green found increments for team-colored cards in duet
            expect(REVEAL_CARD_SCRIPT).toContain('game.greenFound = (game.greenFound or 0) + 1');
            // Neutral costs a timer token
            expect(REVEAL_CARD_SCRIPT).toContain("cardType == 'neutral'");
            expect(REVEAL_CARD_SCRIPT).toContain('game.timerTokens = math.max((game.timerTokens or 0) - 1, 0)');
            // Timer tokens reaching 0 triggers game over
            expect(REVEAL_CARD_SCRIPT).toContain('game.timerTokens <= 0');
            expect(REVEAL_CARD_SCRIPT).toContain("endReason = 'timerTokens'");
        });

        it('history entry includes action=reveal, index, word, type, team, player, guessNumber, timestamp', () => {
            expect(REVEAL_CARD_SCRIPT).toContain("action = 'reveal'");
            expect(REVEAL_CARD_SCRIPT).toContain('index = index');
            expect(REVEAL_CARD_SCRIPT).toContain('word = game.words[luaIndex]');
            expect(REVEAL_CARD_SCRIPT).toContain('type = cardType');
            expect(REVEAL_CARD_SCRIPT).toContain('team = previousTurn');
            expect(REVEAL_CARD_SCRIPT).toContain('player = playerNickname');
            expect(REVEAL_CARD_SCRIPT).toContain('guessNumber = game.guessesUsed');
            expect(REVEAL_CARD_SCRIPT).toContain('timestamp = timestamp');
        });

        it('state version increments', () => {
            expect(REVEAL_CARD_SCRIPT).toContain('game.stateVersion = (game.stateVersion or 0) + 1');
        });

        it('TTL is preserved on save', () => {
            expect(REVEAL_CARD_SCRIPT).toContain("redis.call('TTL', gameKey)");
            expect(REVEAL_CARD_SCRIPT).toContain('currentTTL > 0');
            expect(REVEAL_CARD_SCRIPT).toContain("'EX', currentTTL");
        });

        it('result includes allTypes when gameOver', () => {
            expect(REVEAL_CARD_SCRIPT).toContain('if game.gameOver then');
            expect(REVEAL_CARD_SCRIPT).toContain('result.allTypes = game.types');
        });

        it('result includes duet-specific fields (timerTokens, greenFound) in duet mode', () => {
            expect(REVEAL_CARD_SCRIPT).toContain('if isDuet then');
            expect(REVEAL_CARD_SCRIPT).toContain('result.timerTokens = game.timerTokens');
            expect(REVEAL_CARD_SCRIPT).toContain('result.greenFound = game.greenFound');
            expect(REVEAL_CARD_SCRIPT).toContain('result.allDuetTypes = game.duetTypes');
        });
    });

    describe('endTurn.lua logic', () => {
        it('validates game not over', () => {
            expect(END_TURN_SCRIPT).toContain('game.gameOver');
            expect(END_TURN_SCRIPT).toContain("error = 'GAME_OVER'");
        });

        it('validates expectedTeam matches currentTurn', () => {
            expect(END_TURN_SCRIPT).toContain('game.currentTurn ~= expectedTeam');
            expect(END_TURN_SCRIPT).toContain("error = 'NOT_YOUR_TURN'");
            expect(END_TURN_SCRIPT).toContain('local expectedTeam = ARGV[4]');
        });

        it('switches turn from red to blue and vice versa', () => {
            expect(END_TURN_SCRIPT).toContain("game.currentTurn == 'red'");
            expect(END_TURN_SCRIPT).toContain("game.currentTurn = 'blue'");
            expect(END_TURN_SCRIPT).toContain("game.currentTurn = 'red'");
        });

        it('resets currentClue, guessesUsed, guessesAllowed', () => {
            expect(END_TURN_SCRIPT).toContain('game.currentClue = cjson.null');
            expect(END_TURN_SCRIPT).toContain('game.guessesUsed = 0');
            expect(END_TURN_SCRIPT).toContain('game.guessesAllowed = 0');
        });

        it('adds history entry with action=endTurn', () => {
            expect(END_TURN_SCRIPT).toContain("action = 'endTurn'");
            expect(END_TURN_SCRIPT).toContain('fromTeam = previousTurn');
            expect(END_TURN_SCRIPT).toContain('toTeam = game.currentTurn');
            expect(END_TURN_SCRIPT).toContain('player = playerNickname');
            expect(END_TURN_SCRIPT).toContain('timestamp = timestamp');
        });

        it('returns previousTurn and currentTurn', () => {
            expect(END_TURN_SCRIPT).toContain('previousTurn = previousTurn');
            expect(END_TURN_SCRIPT).toContain('currentTurn = game.currentTurn');
        });

        it('increments stateVersion', () => {
            expect(END_TURN_SCRIPT).toContain('game.stateVersion = (game.stateVersion or 0) + 1');
        });

        it('preserves TTL', () => {
            expect(END_TURN_SCRIPT).toContain("redis.call('TTL', gameKey)");
            expect(END_TURN_SCRIPT).toContain('currentTTL > 0');
            expect(END_TURN_SCRIPT).toContain("'EX', currentTTL");
        });
    });

    describe('setRole.lua logic', () => {
        it('checks player exists', () => {
            expect(SET_ROLE_SCRIPT).toContain("redis.call('GET', playerKey)");
            expect(SET_ROLE_SCRIPT).toContain('if not playerData then');
            expect(SET_ROLE_SCRIPT).toContain('return nil');
        });

        it('requires team for spymaster/clicker roles', () => {
            expect(SET_ROLE_SCRIPT).toContain("newRole == 'spymaster' or newRole == 'clicker'");
            expect(SET_ROLE_SCRIPT).toContain('not player.team or player.team == cjson.null');
            expect(SET_ROLE_SCRIPT).toContain("reason = 'NO_TEAM'");
        });

        it('checks for role conflicts (same team, same role)', () => {
            expect(SET_ROLE_SCRIPT).toContain("redis.call('SMEMBERS', roomPlayersKey)");
            expect(SET_ROLE_SCRIPT).toContain('member.team == player.team and member.role == newRole');
            expect(SET_ROLE_SCRIPT).toContain("reason = 'ROLE_TAKEN'");
            expect(SET_ROLE_SCRIPT).toContain('existingNickname = member.nickname');
            // Bug #5 fix: disconnected players should not block role assignment
            expect(SET_ROLE_SCRIPT).toContain('member.connected');
        });

        it('returns success with player data on success', () => {
            expect(SET_ROLE_SCRIPT).toContain('{success = true, player = player, oldRole = oldRole}');
        });

        it('returns reason on failure', () => {
            expect(SET_ROLE_SCRIPT).toContain("{success = false, reason = 'INVALID_ROLE'}");
            expect(SET_ROLE_SCRIPT).toContain("{success = false, reason = 'NO_TEAM'}");
            expect(SET_ROLE_SCRIPT).toContain("reason = 'ROLE_TAKEN'");
        });
    });

    describe('hostTransfer.lua logic', () => {
        it('finds eligible host among room members', () => {
            // Script receives old and new host keys and validates both exist
            expect(HOST_TRANSFER_SCRIPT).toContain("redis.call('GET', oldHostKey)");
            expect(HOST_TRANSFER_SCRIPT).toContain("redis.call('GET', newHostKey)");
            expect(HOST_TRANSFER_SCRIPT).toContain("redis.call('GET', roomKey)");
            expect(HOST_TRANSFER_SCRIPT).toContain("reason = 'OLD_HOST_NOT_FOUND'");
            expect(HOST_TRANSFER_SCRIPT).toContain("reason = 'NEW_HOST_NOT_FOUND'");
            expect(HOST_TRANSFER_SCRIPT).toContain("reason = 'ROOM_NOT_FOUND'");
        });

        it('updates isHost flags', () => {
            expect(HOST_TRANSFER_SCRIPT).toContain('oldHost.isHost = false');
            expect(HOST_TRANSFER_SCRIPT).toContain('newHost.isHost = true');
        });

        it('returns new host session ID', () => {
            expect(HOST_TRANSFER_SCRIPT).toContain('room.hostSessionId = newHostSessionId');
            expect(HOST_TRANSFER_SCRIPT).toContain('local newHostSessionId = ARGV[1]');
            // Result includes the updated host data
            expect(HOST_TRANSFER_SCRIPT).toContain('success = true');
            expect(HOST_TRANSFER_SCRIPT).toContain('oldHost = oldHost');
            expect(HOST_TRANSFER_SCRIPT).toContain('newHost = newHost');
        });
    });

    describe('safeTeamSwitch.lua logic', () => {
        it('validates player exists', () => {
            expect(SAFE_TEAM_SWITCH_SCRIPT).toContain("redis.call('GET', playerKey)");
            expect(SAFE_TEAM_SWITCH_SCRIPT).toContain('if not playerData then');
            expect(SAFE_TEAM_SWITCH_SCRIPT).toContain('return nil');
        });

        it('clears role on team change', () => {
            // When switching teams, spymaster/clicker roles revert to spectator
            expect(SAFE_TEAM_SWITCH_SCRIPT).toContain('oldTeam ~= actualNewTeam');
            expect(SAFE_TEAM_SWITCH_SCRIPT).toContain("oldRole == 'spymaster' or oldRole == 'clicker'");
            expect(SAFE_TEAM_SWITCH_SCRIPT).toContain("player.role = 'spectator'");
        });

        it('updates team set membership', () => {
            // Removes from old team set
            expect(SAFE_TEAM_SWITCH_SCRIPT).toContain("redis.call('SREM', oldTeamKey, sessionId)");
            // Adds to new team set
            expect(SAFE_TEAM_SWITCH_SCRIPT).toContain("redis.call('SADD', newTeamKey, sessionId)");
            // Cleans up empty team sets
            expect(SAFE_TEAM_SWITCH_SCRIPT).toContain("redis.call('SCARD', oldTeamKey)");
            expect(SAFE_TEAM_SWITCH_SCRIPT).toContain("redis.call('DEL', oldTeamKey)");
        });
    });
});
