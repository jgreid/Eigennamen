/**
 * Game Socket Event Handlers
 *
 * ISSUE #44 FIX: Use SOCKET_EVENTS constants instead of hardcoded strings
 */

const gameService = require('../../services/gameService');
const playerService = require('../../services/playerService');
const roomService = require('../../services/roomService');
const eventLogService = require('../../services/eventLogService');
const gameHistoryService = require('../../services/gameHistoryService');
const { validateInput } = require('../../middleware/validation');
const { gameRevealSchema, gameClueSchema, gameStartSchema } = require('../../validators/schemas');
const logger = require('../../utils/logger');
const { ERROR_CODES, SOCKET_EVENTS } = require('../../config/constants');
const { createRateLimitedHandler } = require('../rateLimitHandler');
const {
    RoomError,
    PlayerError,
    GameStateError,
    ValidationError
} = require('../../errors/GameError');
const { auditGameStarted, auditGameEnded } = require('../../utils/audit');
const { withTimeout, TIMEOUTS } = require('../../utils/timeout');
const { getSocketFunctions } = require('../socketFunctionProvider');

module.exports = function gameHandlers(io, socket) {

    /**
     * Start a new game (host only)
     */
    socket.on(SOCKET_EVENTS.GAME_START, createRateLimitedHandler(socket, 'game:start', async (data = {}) => {
        try {
            if (!socket.roomCode) {
                throw RoomError.notFound(socket.roomCode);
            }

            const validated = validateInput(gameStartSchema, data);

            // Verify player is host
            const player = await playerService.getPlayer(socket.sessionId);
            if (!player || !player.isHost) {
                throw PlayerError.notHost();
            }

            // Stop any existing timer
            await getSocketFunctions().stopTurnTimer(socket.roomCode);

            // Wrap game creation in timeout to prevent hanging
            const gameSetupPromise = (async () => {
                // ISSUE #28 FIX: Check if game already exists and is in progress
                const existingGame = await gameService.getGame(socket.roomCode);
                if (existingGame && !existingGame.gameOver) {
                    throw RoomError.gameInProgress(socket.roomCode);
                }

                // Pass options to createGame (supports wordListId or wordList array)
                const game = await gameService.createGame(socket.roomCode, {
                    wordListId: validated.wordListId,
                    wordList: validated.wordList
                });

                // Get room for timer settings
                const room = await roomService.getRoom(socket.roomCode);

                // Get all players in room to send appropriate game state
                const players = await playerService.getPlayersInRoom(socket.roomCode);

                return { game, room, players };
            })();

            const { game, room, players } = await withTimeout(
                gameSetupPromise,
                TIMEOUTS.GAME_ACTION,
                'game:start'
            );

            // Send game state to each player (spymasters see card types)
            // Wrap each emit in try-catch to ensure all players get notified even if one fails
            for (const p of players) {
                try {
                    const gameState = gameService.getGameStateForPlayer(game, p);
                    io.to(`player:${p.sessionId}`).emit(SOCKET_EVENTS.GAME_STARTED, { game: gameState });
                } catch (emitError) {
                    logger.error(`Failed to emit game:started to player ${p.sessionId}:`, emitError);
                }
            }

            // Start turn timer if configured
            if (room && room.settings && room.settings.turnTimer) {
                await getSocketFunctions().startTurnTimer(socket.roomCode, room.settings.turnTimer);
            }

            // Log event for reconnection recovery
            await eventLogService.logEvent(
                socket.roomCode,
                eventLogService.EVENT_TYPES.GAME_STARTED,
                {
                    gameId: game.id,
                    firstTeam: game.currentTurn,
                    redTotal: game.redTotal,
                    blueTotal: game.blueTotal
                }
            );

            // Audit log game start
            const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
            auditGameStarted(socket.roomCode, socket.sessionId, players.length, clientIp);

            logger.info(`Game started in room ${socket.roomCode}`);

        } catch (error) {
            logger.error('Error starting game:', error);
            socket.emit(SOCKET_EVENTS.GAME_ERROR, {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));

    /**
     * Reveal a card (current team's clicker, or any team member if clicker disconnected)
     * PHASE 1 FIX: Allow any team member to reveal if clicker is disconnected
     */
    socket.on(SOCKET_EVENTS.GAME_REVEAL, createRateLimitedHandler(socket, 'game:reveal', async (data) => {
        try {
            if (!socket.roomCode) {
                throw RoomError.notFound(socket.roomCode);
            }

            const validated = validateInput(gameRevealSchema, data);

            // Get player data
            const player = await playerService.getPlayer(socket.sessionId);
            if (!player) {
                throw PlayerError.notFound(socket.sessionId);
            }

            // Verify player has a team assigned
            if (!player.team) {
                throw new ValidationError('You must join a team before revealing cards');
            }

            // Get current game to check turn
            const game = await gameService.getGame(socket.roomCode);
            if (!game) {
                throw GameStateError.noActiveGame();
            }

            // Verify it's the player's team's turn
            if (player.team !== game.currentTurn) {
                throw PlayerError.notYourTurn(player.team);
            }

            // PHASE 1 FIX: Allow reveal if player is clicker OR if clicker is disconnected
            const teamMembers = await playerService.getTeamMembers(socket.roomCode, game.currentTurn);
            const teamClicker = teamMembers.find(p => p.role === 'clicker');
            const clickerDisconnected = !teamClicker || !teamClicker.connected;

            // Player can reveal if they are the clicker, or if the clicker is disconnected
            if (player.role !== 'clicker' && !clickerDisconnected) {
                throw PlayerError.notClicker();
            }

            // Validate that the current team has connected players
            const connectedTeamMembers = teamMembers.filter(p => p.connected);
            if (connectedTeamMembers.length === 0) {
                throw new GameStateError(`No connected players on ${game.currentTurn} team`);
            }

            const result = await withTimeout(
                gameService.revealCard(socket.roomCode, validated.index, player.nickname),
                TIMEOUTS.GAME_ACTION,
                'game:reveal'
            );

            // Broadcast the reveal to all players
            io.to(`room:${socket.roomCode}`).emit(SOCKET_EVENTS.GAME_CARD_REVEALED, {
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

            // Log event for reconnection recovery
            await eventLogService.logEvent(
                socket.roomCode,
                eventLogService.EVENT_TYPES.CARD_REVEALED,
                {
                    index: result.index,
                    type: result.type,
                    word: result.word,
                    player: player.nickname,
                    team: player.team,
                    redScore: result.redScore,
                    blueScore: result.blueScore,
                    turnEnded: result.turnEnded,
                    gameOver: result.gameOver,
                    winner: result.winner
                }
            );

            // Handle turn ending (wrong guess, max guesses, or game over)
            if (result.turnEnded && !result.gameOver) {
                // Get room for timer settings
                const room = await roomService.getRoom(socket.roomCode);

                // Restart timer for new turn if configured
                if (room && room.settings && room.settings.turnTimer) {
                    await getSocketFunctions().startTurnTimer(socket.roomCode, room.settings.turnTimer);
                }
            }

            // If game is over, stop timer FIRST (prevent race condition), then reveal all card types
            // BUG-5 FIX: Timer must be stopped BEFORE emitting game:over to prevent
            // timer firing between game state check and stop
            if (result.gameOver) {
                // Stop timer immediately to prevent race condition
                await getSocketFunctions().stopTurnTimer(socket.roomCode);

                // Now safe to emit game:over
                io.to(`room:${socket.roomCode}`).emit(SOCKET_EVENTS.GAME_OVER, {
                    winner: result.winner,
                    reason: result.endReason,
                    types: result.allTypes
                });

                // Save completed game to history
                const completedGame = await gameService.getGame(socket.roomCode);
                if (completedGame) {
                    // Get room settings for team names
                    const roomForHistory = await roomService.getRoom(socket.roomCode);
                    const gameDataWithTeamNames = {
                        ...completedGame,
                        teamNames: roomForHistory?.settings?.teamNames || { red: 'Red', blue: 'Blue' }
                    };
                    await gameHistoryService.saveGameResult(socket.roomCode, gameDataWithTeamNames);
                }

                // Audit log game end
                const clientIpEnd = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
                auditGameEnded(socket.roomCode, socket.sessionId, clientIpEnd, result.winner, result.endReason, null);
            }

            logger.info(`Card ${validated.index} revealed in room ${socket.roomCode}`);

        } catch (error) {
            logger.error('Error revealing card:', error);
            socket.emit(SOCKET_EVENTS.GAME_ERROR, {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));

    /**
     * Give a clue (spymaster only)
     */
    socket.on(SOCKET_EVENTS.GAME_CLUE, createRateLimitedHandler(socket, 'game:clue', async (data) => {
        try {
            if (!socket.roomCode) {
                throw RoomError.notFound(socket.roomCode);
            }

            const validated = validateInput(gameClueSchema, data);

            // Verify player is spymaster
            const player = await playerService.getPlayer(socket.sessionId);
            if (!player || player.role !== 'spymaster') {
                throw PlayerError.notSpymaster();
            }

            const clue = await gameService.giveClue(
                socket.roomCode,
                player.team,
                validated.word,
                validated.number,
                player.nickname
            );

            // Broadcast to all players (include guessesAllowed)
            io.to(`room:${socket.roomCode}`).emit(SOCKET_EVENTS.GAME_CLUE_GIVEN, {
                team: clue.team,
                word: clue.word,
                number: clue.number,
                spymaster: clue.spymaster,
                guessesAllowed: clue.guessesAllowed,
                timestamp: clue.timestamp
            });

            // Log event for reconnection recovery
            await eventLogService.logEvent(
                socket.roomCode,
                eventLogService.EVENT_TYPES.CLUE_GIVEN,
                {
                    team: clue.team,
                    word: clue.word,
                    number: clue.number,
                    spymaster: clue.spymaster,
                    guessesAllowed: clue.guessesAllowed
                }
            );

            logger.info(`Clue given in room ${socket.roomCode}: ${clue.word} ${clue.number}`);

        } catch (error) {
            logger.error('Error giving clue:', error);
            socket.emit(SOCKET_EVENTS.GAME_ERROR, {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));

    /**
     * End the current turn (current team's clicker only)
     */
    socket.on(SOCKET_EVENTS.GAME_END_TURN, createRateLimitedHandler(socket, 'game:endTurn', async () => {
        try {
            if (!socket.roomCode) {
                throw RoomError.notFound(socket.roomCode);
            }

            // Verify player is the current team's clicker
            const player = await playerService.getPlayer(socket.sessionId);
            if (!player || player.role !== 'clicker') {
                throw PlayerError.notClicker();
            }

            // Get current game to check turn
            const game = await gameService.getGame(socket.roomCode);
            if (!game) {
                throw GameStateError.noActiveGame();
            }

            // Verify it's the clicker's team's turn
            if (player.team !== game.currentTurn) {
                throw PlayerError.notYourTurn(player.team);
            }

            const result = await gameService.endTurn(socket.roomCode, player.nickname);

            // Broadcast turn change
            // Note: nextTeam is included for frontend compatibility (legacy field name)
            io.to(`room:${socket.roomCode}`).emit(SOCKET_EVENTS.GAME_TURN_ENDED, {
                currentTurn: result.currentTurn,
                previousTurn: result.previousTurn,
                nextTeam: result.currentTurn
            });

            // Log event for reconnection recovery
            await eventLogService.logEvent(
                socket.roomCode,
                eventLogService.EVENT_TYPES.TURN_ENDED,
                {
                    currentTurn: result.currentTurn,
                    previousTurn: result.previousTurn,
                    player: player.nickname,
                    reason: 'manual'
                }
            );

            // Restart timer for new turn if configured
            const room = await roomService.getRoom(socket.roomCode);
            if (room && room.settings && room.settings.turnTimer) {
                await getSocketFunctions().startTurnTimer(socket.roomCode, room.settings.turnTimer);
            }

            logger.info(`Turn ended in room ${socket.roomCode}, now ${result.currentTurn}'s turn`);

        } catch (error) {
            logger.error('Error ending turn:', error);
            socket.emit(SOCKET_EVENTS.GAME_ERROR, {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));

    /**
     * Forfeit the game (host only - forfeits current turn's team)
     */
    socket.on(SOCKET_EVENTS.GAME_FORFEIT, createRateLimitedHandler(socket, 'game:forfeit', async () => {
        try {
            if (!socket.roomCode) {
                throw RoomError.notFound(socket.roomCode);
            }

            const player = await playerService.getPlayer(socket.sessionId);
            if (!player || !player.isHost) {
                throw PlayerError.notHost();
            }

            // Stop timer
            await getSocketFunctions().stopTurnTimer(socket.roomCode);

            // Forfeit is based on current turn's team, not player's team
            const result = await gameService.forfeitGame(socket.roomCode);

            io.to(`room:${socket.roomCode}`).emit(SOCKET_EVENTS.GAME_OVER, {
                winner: result.winner,
                forfeitingTeam: result.forfeitingTeam,
                reason: 'forfeit',
                types: result.allTypes
            });

            // Save completed game to history
            const completedGame = await gameService.getGame(socket.roomCode);
            if (completedGame) {
                // Get room settings for team names
                const roomForHistory = await roomService.getRoom(socket.roomCode);
                const gameDataWithTeamNames = {
                    ...completedGame,
                    teamNames: roomForHistory?.settings?.teamNames || { red: 'Red', blue: 'Blue' }
                };
                await gameHistoryService.saveGameResult(socket.roomCode, gameDataWithTeamNames);
            }

            // Audit log game end (forfeit)
            const forfeitIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
            auditGameEnded(socket.roomCode, socket.sessionId, forfeitIp, result.winner, 'forfeit', null);

            // Log event for reconnection recovery
            await eventLogService.logEvent(
                socket.roomCode,
                eventLogService.EVENT_TYPES.GAME_OVER,
                {
                    winner: result.winner,
                    forfeitingTeam: result.forfeitingTeam,
                    reason: 'forfeit'
                }
            );

            logger.info(`Game forfeited in room ${socket.roomCode}, ${result.forfeitingTeam} forfeited`);

        } catch (error) {
            logger.error('Error forfeiting game:', error);
            socket.emit(SOCKET_EVENTS.GAME_ERROR, {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));

    /**
     * Get game history (current game's move history)
     */
    socket.on(SOCKET_EVENTS.GAME_HISTORY, createRateLimitedHandler(socket, 'game:history', async () => {
        try {
            if (!socket.roomCode) {
                throw RoomError.notFound(socket.roomCode);
            }

            const history = await gameService.getGameHistory(socket.roomCode);
            socket.emit(SOCKET_EVENTS.GAME_HISTORY_DATA, { history });

        } catch (error) {
            logger.error('Error getting history:', error);
            socket.emit(SOCKET_EVENTS.GAME_ERROR, {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));

    /**
     * Get past games history for this room (for replay)
     */
    socket.on(SOCKET_EVENTS.GAME_GET_HISTORY, createRateLimitedHandler(socket, 'game:getHistory', async (data = {}) => {
        try {
            if (!socket.roomCode) {
                throw RoomError.notFound(socket.roomCode);
            }

            const limit = data.limit && Number.isInteger(data.limit) && data.limit > 0 && data.limit <= 50
                ? data.limit
                : 10;

            const history = await gameHistoryService.getGameHistory(socket.roomCode, limit);
            socket.emit(SOCKET_EVENTS.GAME_HISTORY_RESULT, { history });

            logger.debug(`Game history retrieved for room ${socket.roomCode}`, { count: history.length });

        } catch (error) {
            logger.error('Error getting game history:', error);
            socket.emit(SOCKET_EVENTS.GAME_ERROR, {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));

    /**
     * Get replay data for a specific game
     */
    socket.on(SOCKET_EVENTS.GAME_GET_REPLAY, createRateLimitedHandler(socket, 'game:getReplay', async (data = {}) => {
        try {
            if (!socket.roomCode) {
                throw RoomError.notFound(socket.roomCode);
            }

            const { gameId } = data;
            if (!gameId || typeof gameId !== 'string') {
                throw new ValidationError('Game ID is required for replay');
            }

            const replayData = await gameHistoryService.getReplayEvents(socket.roomCode, gameId);

            if (!replayData) {
                throw new GameStateError('Game not found in history');
            }

            socket.emit(SOCKET_EVENTS.GAME_REPLAY_DATA, { replay: replayData });

            logger.debug(`Replay data retrieved for game ${gameId} in room ${socket.roomCode}`);

        } catch (error) {
            logger.error('Error getting replay data:', error);
            socket.emit(SOCKET_EVENTS.GAME_ERROR, {
                code: error.code || ERROR_CODES.SERVER_ERROR,
                message: error.message
            });
        }
    }));
};
