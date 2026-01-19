/**
 * Game Socket Event Handlers
 */

const gameService = require('../../services/gameService');
const playerService = require('../../services/playerService');
const roomService = require('../../services/roomService');
const { validateInput } = require('../../middleware/validation');
const { gameRevealSchema, gameClueSchema, gameStartSchema } = require('../../validators/schemas');
const logger = require('../../utils/logger');
const { ERROR_CODES } = require('../../config/constants');
const { startTurnTimer, stopTurnTimer, createRateLimitedHandler } = require('../index');

module.exports = function gameHandlers(io, socket) {

    /**
     * Start a new game (host only)
     */
    socket.on('game:start', createRateLimitedHandler(socket, 'game:start', async (data = {}) => {
        try {
            if (!socket.roomCode) {
                throw { code: ERROR_CODES.ROOM_NOT_FOUND, message: 'Not in a room' };
            }

            const validated = validateInput(gameStartSchema, data);

            // Verify player is host
            const player = await playerService.getPlayer(socket.sessionId);
            if (!player || !player.isHost) {
                throw { code: ERROR_CODES.NOT_HOST, message: 'Only the host can start the game' };
            }

            // Stop any existing timer
            await stopTurnTimer(socket.roomCode);

            // Pass options to createGame (supports wordListId or wordList array)
            const game = await gameService.createGame(socket.roomCode, {
                wordListId: validated.wordListId,
                wordList: validated.wordList
            });

            // Get room for timer settings
            const room = await roomService.getRoom(socket.roomCode);

            // Get all players in room to send appropriate game state
            const players = await playerService.getPlayersInRoom(socket.roomCode);

            // Send game state to each player (spymasters see card types)
            for (const p of players) {
                const gameState = gameService.getGameStateForPlayer(game, p);
                io.to(`player:${p.sessionId}`).emit('game:started', { game: gameState });
            }

            // Start turn timer if configured
            if (room && room.settings && room.settings.turnTimer) {
                await startTurnTimer(socket.roomCode, room.settings.turnTimer);
            }

            logger.info(`Game started in room ${socket.roomCode}`);

        } catch (error) {
            logger.error('Error starting game:', error);
            socket.emit('game:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));

    /**
     * Reveal a card (host only)
     */
    socket.on('game:reveal', createRateLimitedHandler(socket, 'game:reveal', async (data) => {
        try {
            if (!socket.roomCode) {
                throw { code: ERROR_CODES.ROOM_NOT_FOUND, message: 'Not in a room' };
            }

            const validated = validateInput(gameRevealSchema, data);

            // Verify player is host
            const player = await playerService.getPlayer(socket.sessionId);
            if (!player || !player.isHost) {
                throw { code: ERROR_CODES.NOT_HOST, message: 'Only the host can reveal cards' };
            }

            const result = await gameService.revealCard(
                socket.roomCode,
                validated.index,
                player.nickname
            );

            // Broadcast the reveal to all players
            io.to(`room:${socket.roomCode}`).emit('game:cardRevealed', {
                index: result.index,
                type: result.type,
                word: result.word,
                redScore: result.redScore,
                blueScore: result.blueScore,
                currentTurn: result.currentTurn,
                guessesUsed: result.guessesUsed,
                guessesAllowed: result.guessesAllowed,
                turnEnded: result.turnEnded,
                gameOver: result.gameOver,
                winner: result.winner
            });

            // Handle turn ending (wrong guess, max guesses, or game over)
            if (result.turnEnded && !result.gameOver) {
                // Get room for timer settings
                const room = await roomService.getRoom(socket.roomCode);

                // Restart timer for new turn if configured
                if (room && room.settings && room.settings.turnTimer) {
                    await startTurnTimer(socket.roomCode, room.settings.turnTimer);
                }
            }

            // If game is over, stop timer and reveal all card types
            if (result.gameOver) {
                await stopTurnTimer(socket.roomCode);

                io.to(`room:${socket.roomCode}`).emit('game:over', {
                    winner: result.winner,
                    reason: result.endReason,
                    types: result.allTypes
                });
            }

            logger.info(`Card ${validated.index} revealed in room ${socket.roomCode}`);

        } catch (error) {
            logger.error('Error revealing card:', error);
            socket.emit('game:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));

    /**
     * Give a clue (spymaster only)
     */
    socket.on('game:clue', createRateLimitedHandler(socket, 'game:clue', async (data) => {
        try {
            if (!socket.roomCode) {
                throw { code: ERROR_CODES.ROOM_NOT_FOUND, message: 'Not in a room' };
            }

            const validated = validateInput(gameClueSchema, data);

            // Verify player is spymaster
            const player = await playerService.getPlayer(socket.sessionId);
            if (!player || player.role !== 'spymaster') {
                throw { code: ERROR_CODES.NOT_SPYMASTER, message: 'Only spymasters can give clues' };
            }

            const clue = await gameService.giveClue(
                socket.roomCode,
                player.team,
                validated.word,
                validated.number,
                player.nickname
            );

            // Broadcast to all players (include guessesAllowed)
            io.to(`room:${socket.roomCode}`).emit('game:clueGiven', {
                team: clue.team,
                word: clue.word,
                number: clue.number,
                spymaster: clue.spymaster,
                guessesAllowed: clue.guessesAllowed,
                timestamp: clue.timestamp
            });

            logger.info(`Clue given in room ${socket.roomCode}: ${clue.word} ${clue.number}`);

        } catch (error) {
            logger.error('Error giving clue:', error);
            socket.emit('game:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));

    /**
     * End the current turn (host only)
     */
    socket.on('game:endTurn', createRateLimitedHandler(socket, 'game:endTurn', async () => {
        try {
            if (!socket.roomCode) {
                throw { code: ERROR_CODES.ROOM_NOT_FOUND, message: 'Not in a room' };
            }

            // Verify player is host
            const player = await playerService.getPlayer(socket.sessionId);
            if (!player || !player.isHost) {
                throw { code: ERROR_CODES.NOT_HOST, message: 'Only the host can end the turn' };
            }

            const result = await gameService.endTurn(socket.roomCode, player.nickname);

            // Broadcast turn change
            io.to(`room:${socket.roomCode}`).emit('game:turnEnded', {
                currentTurn: result.currentTurn,
                previousTurn: result.previousTurn
            });

            // Restart timer for new turn if configured
            const room = await roomService.getRoom(socket.roomCode);
            if (room && room.settings && room.settings.turnTimer) {
                await startTurnTimer(socket.roomCode, room.settings.turnTimer);
            }

            logger.info(`Turn ended in room ${socket.roomCode}, now ${result.currentTurn}'s turn`);

        } catch (error) {
            logger.error('Error ending turn:', error);
            socket.emit('game:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));

    /**
     * Forfeit the game (host only - forfeits current turn's team)
     */
    socket.on('game:forfeit', createRateLimitedHandler(socket, 'game:forfeit', async () => {
        try {
            if (!socket.roomCode) {
                throw { code: ERROR_CODES.ROOM_NOT_FOUND, message: 'Not in a room' };
            }

            const player = await playerService.getPlayer(socket.sessionId);
            if (!player || !player.isHost) {
                throw { code: ERROR_CODES.NOT_HOST, message: 'Only the host can forfeit' };
            }

            // Stop timer
            await stopTurnTimer(socket.roomCode);

            // Forfeit is based on current turn's team, not player's team
            const result = await gameService.forfeitGame(socket.roomCode);

            io.to(`room:${socket.roomCode}`).emit('game:over', {
                winner: result.winner,
                forfeitingTeam: result.forfeitingTeam,
                reason: 'forfeit',
                types: result.allTypes
            });

            logger.info(`Game forfeited in room ${socket.roomCode}, ${result.forfeitingTeam} forfeited`);

        } catch (error) {
            logger.error('Error forfeiting game:', error);
            socket.emit('game:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));

    /**
     * Get game history
     */
    socket.on('game:history', createRateLimitedHandler(socket, 'game:history', async () => {
        try {
            if (!socket.roomCode) {
                throw { code: ERROR_CODES.ROOM_NOT_FOUND, message: 'Not in a room' };
            }

            const history = await gameService.getGameHistory(socket.roomCode);
            socket.emit('game:historyData', { history });

        } catch (error) {
            logger.error('Error getting history:', error);
            socket.emit('game:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));
};
