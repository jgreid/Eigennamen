/**
 * Game Socket Event Handlers
 */

const gameService = require('../../services/gameService');
const playerService = require('../../services/playerService');
const { validateInput } = require('../../middleware/validation');
const { gameRevealSchema, gameClueSchema, gameStartSchema } = require('../../validators/schemas');
const logger = require('../../utils/logger');
const { ERROR_CODES } = require('../../config/constants');

module.exports = function gameHandlers(io, socket) {

    /**
     * Start a new game (host only)
     */
    socket.on('game:start', async (data = {}) => {
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

            const game = await gameService.createGame(socket.roomCode, validated.wordListId);

            // Get all players in room to send appropriate game state
            const players = await playerService.getPlayersInRoom(socket.roomCode);

            // Send game state to each player (spymasters see card types)
            for (const p of players) {
                const gameState = gameService.getGameStateForPlayer(game, p);
                io.to(`player:${p.sessionId}`).emit('game:started', { game: gameState });
            }

            logger.info(`Game started in room ${socket.roomCode}`);

        } catch (error) {
            logger.error('Error starting game:', error);
            socket.emit('game:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    });

    /**
     * Reveal a card (host only)
     */
    socket.on('game:reveal', async (data) => {
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

            const result = await gameService.revealCard(socket.roomCode, validated.index);

            // Broadcast the reveal to all players
            io.to(`room:${socket.roomCode}`).emit('game:cardRevealed', {
                index: result.index,
                type: result.type,
                redScore: result.redScore,
                blueScore: result.blueScore,
                currentTurn: result.currentTurn,
                gameOver: result.gameOver,
                winner: result.winner
            });

            // If game is over, reveal all card types
            if (result.gameOver) {
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
    });

    /**
     * Give a clue (spymaster only)
     */
    socket.on('game:clue', async (data) => {
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

            // Broadcast to all players
            io.to(`room:${socket.roomCode}`).emit('game:clueGiven', clue);

            logger.info(`Clue given in room ${socket.roomCode}: ${clue.word} ${clue.number}`);

        } catch (error) {
            logger.error('Error giving clue:', error);
            socket.emit('game:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    });

    /**
     * End the current turn (host only)
     */
    socket.on('game:endTurn', async () => {
        try {
            if (!socket.roomCode) {
                throw { code: ERROR_CODES.ROOM_NOT_FOUND, message: 'Not in a room' };
            }

            // Verify player is host
            const player = await playerService.getPlayer(socket.sessionId);
            if (!player || !player.isHost) {
                throw { code: ERROR_CODES.NOT_HOST, message: 'Only the host can end the turn' };
            }

            const result = await gameService.endTurn(socket.roomCode);

            // Broadcast turn change
            io.to(`room:${socket.roomCode}`).emit('game:turnEnded', {
                currentTurn: result.currentTurn
            });

            logger.info(`Turn ended in room ${socket.roomCode}, now ${result.currentTurn}'s turn`);

        } catch (error) {
            logger.error('Error ending turn:', error);
            socket.emit('game:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    });

    /**
     * Forfeit the game
     */
    socket.on('game:forfeit', async () => {
        try {
            if (!socket.roomCode) {
                throw { code: ERROR_CODES.ROOM_NOT_FOUND, message: 'Not in a room' };
            }

            const player = await playerService.getPlayer(socket.sessionId);
            if (!player || !player.isHost) {
                throw { code: ERROR_CODES.NOT_HOST, message: 'Only the host can forfeit' };
            }

            const result = await gameService.forfeitGame(socket.roomCode, player.team);

            io.to(`room:${socket.roomCode}`).emit('game:over', {
                winner: result.winner,
                reason: 'forfeit',
                types: result.allTypes
            });

            logger.info(`Game forfeited in room ${socket.roomCode}`);

        } catch (error) {
            logger.error('Error forfeiting game:', error);
            socket.emit('game:error', {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    });
};
