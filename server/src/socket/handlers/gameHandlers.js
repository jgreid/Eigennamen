/**
 * Game Socket Event Handlers
 *
 * Migrated to use context handler architecture for consistent
 * validation, error handling, and socket room management.
 */

const gameService = require('../../services/gameService');
const playerService = require('../../services/playerService');
const roomService = require('../../services/roomService');
const gameHistoryService = require('../../services/gameHistoryService');
const { gameRevealSchema, gameClueSchema, gameStartSchema, gameHistoryLimitSchema, gameReplaySchema } = require('../../validators/schemas');
const logger = require('../../utils/logger');
const { ERROR_CODES, SOCKET_EVENTS } = require('../../config/constants');
const { createHostHandler, createRoomHandler, createGameHandler } = require('../contextHandler');
const {
    PlayerError,
    GameStateError,
    ValidationError,
    RoomError
} = require('../../errors/GameError');
const { auditGameStarted, auditGameEnded } = require('../../utils/audit');
const { withTimeout, TIMEOUTS } = require('../../utils/timeout');
const { getSocketFunctions } = require('../socketFunctionProvider');

module.exports = function gameHandlers(io, socket) {

    /**
     * Start a new game (host only)
     */
    socket.on(SOCKET_EVENTS.GAME_START, createHostHandler(socket, SOCKET_EVENTS.GAME_START, gameStartSchema,
        async (ctx, validated) => {
            // Stop any existing timer
            await getSocketFunctions().stopTurnTimer(ctx.roomCode);

            const gameSetupPromise = (async () => {
                // Check if game already exists and is in progress
                if (ctx.game && !ctx.game.gameOver) {
                    throw RoomError.gameInProgress(ctx.roomCode);
                }

                const game = await gameService.createGame(ctx.roomCode, {
                    wordListId: validated.wordListId,
                    wordList: validated.wordList
                });

                const [room, players] = await Promise.all([
                    roomService.getRoom(ctx.roomCode),
                    playerService.getPlayersInRoom(ctx.roomCode)
                ]);

                return { game, room, players };
            })();

            const { game, room, players } = await withTimeout(
                gameSetupPromise,
                TIMEOUTS.GAME_ACTION,
                'game:start'
            );

            // Send game state to each player (spymasters see card types)
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
                await getSocketFunctions().startTurnTimer(ctx.roomCode, room.settings.turnTimer);
            }

            // Audit log game start
            const clientIp = socket.clientIP || socket.handshake.address;
            auditGameStarted(ctx.roomCode, ctx.sessionId, players.length, clientIp);

            logger.info(`Game started in room ${ctx.roomCode}`);
        }
    ));

    /**
     * Reveal a card (current team's clicker, or any team member if clicker disconnected)
     */
    socket.on(SOCKET_EVENTS.GAME_REVEAL, createGameHandler(socket, SOCKET_EVENTS.GAME_REVEAL, gameRevealSchema,
        async (ctx, validated) => {
            if (!ctx.player.team) {
                throw new ValidationError('You must join a team before revealing cards');
            }

            if (ctx.player.team !== ctx.game.currentTurn) {
                throw PlayerError.notYourTurn(ctx.player.team);
            }

            // Allow reveal if player is clicker OR if clicker is disconnected
            const teamMembers = await playerService.getTeamMembers(ctx.roomCode, ctx.game.currentTurn);
            if (!teamMembers || !Array.isArray(teamMembers)) {
                throw new GameStateError(ERROR_CODES.SERVER_ERROR, 'Unable to retrieve team members');
            }
            const teamClicker = teamMembers.find(p => p.role === 'clicker');
            const clickerDisconnected = !teamClicker || !teamClicker.connected;

            if (ctx.player.role !== 'clicker' && !clickerDisconnected) {
                throw PlayerError.notClicker();
            }

            const connectedTeamMembers = teamMembers.filter(p => p.connected);
            if (connectedTeamMembers.length === 0) {
                throw new GameStateError(ERROR_CODES.SERVER_ERROR, `No connected players on ${ctx.game.currentTurn} team`);
            }

            const result = await withTimeout(
                gameService.revealCard(ctx.roomCode, validated.index, ctx.player.nickname),
                TIMEOUTS.GAME_ACTION,
                'game:reveal'
            );

            // Broadcast the reveal to all players
            io.to(`room:${ctx.roomCode}`).emit(SOCKET_EVENTS.GAME_CARD_REVEALED, {
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
                winner: result.winner,
                player: {
                    sessionId: ctx.player.sessionId,
                    nickname: ctx.player.nickname,
                    team: ctx.player.team
                }
            });

            // Handle turn ending
            if (result.turnEnded && !result.gameOver) {
                const room = await roomService.getRoom(ctx.roomCode);
                if (room && room.settings && room.settings.turnTimer) {
                    await getSocketFunctions().startTurnTimer(ctx.roomCode, room.settings.turnTimer);
                }
            }

            // If game is over, stop timer FIRST then reveal all card types
            if (result.gameOver) {
                await getSocketFunctions().stopTurnTimer(ctx.roomCode);

                io.to(`room:${ctx.roomCode}`).emit(SOCKET_EVENTS.GAME_OVER, {
                    winner: result.winner,
                    reason: result.endReason,
                    types: result.allTypes
                });

                // Save completed game to history
                const [completedGame, roomForHistory] = await Promise.all([
                    gameService.getGame(ctx.roomCode),
                    roomService.getRoom(ctx.roomCode)
                ]);
                if (completedGame) {
                    const gameDataWithTeamNames = {
                        ...completedGame,
                        teamNames: roomForHistory?.settings?.teamNames || { red: 'Red', blue: 'Blue' }
                    };
                    await gameHistoryService.saveGameResult(ctx.roomCode, gameDataWithTeamNames);
                }

                // Audit log game end
                const clientIpEnd = socket.clientIP || socket.handshake.address;
                auditGameEnded(ctx.roomCode, ctx.sessionId, clientIpEnd, result.winner, result.endReason, null);
            }

            logger.info(`Card ${validated.index} revealed in room ${ctx.roomCode}`);
        }
    ));

    /**
     * Give a clue (spymaster only)
     */
    socket.on(SOCKET_EVENTS.GAME_CLUE, createGameHandler(socket, SOCKET_EVENTS.GAME_CLUE, gameClueSchema,
        async (ctx, validated) => {
            if (!ctx.player || ctx.player.role !== 'spymaster') {
                throw PlayerError.notSpymaster();
            }

            const clue = await gameService.giveClue(
                ctx.roomCode,
                ctx.player.team,
                validated.word,
                validated.number,
                ctx.player.nickname
            );

            io.to(`room:${ctx.roomCode}`).emit(SOCKET_EVENTS.GAME_CLUE_GIVEN, {
                team: clue.team,
                word: clue.word,
                number: clue.number,
                spymaster: clue.spymaster,
                guessesAllowed: clue.guessesAllowed,
                timestamp: clue.timestamp
            });

            logger.info(`Clue given in room ${ctx.roomCode}: ${clue.word} ${clue.number}`);
        }
    ));

    /**
     * End the current turn (current team's clicker only)
     */
    socket.on(SOCKET_EVENTS.GAME_END_TURN, createGameHandler(socket, SOCKET_EVENTS.GAME_END_TURN, null,
        async (ctx) => {
            if (!ctx.player.team) {
                throw new ValidationError('You must join a team before ending the turn');
            }

            if (ctx.player.team !== ctx.game.currentTurn) {
                throw PlayerError.notYourTurn(ctx.player.team);
            }

            // Allow end turn if player is clicker OR if clicker is disconnected
            const teamMembers = await withTimeout(
                playerService.getTeamMembers(ctx.roomCode, ctx.game.currentTurn),
                TIMEOUTS.GAME_ACTION,
                'game:endTurn:getTeamMembers'
            );
            const teamClicker = teamMembers && Array.isArray(teamMembers)
                ? teamMembers.find(p => p.role === 'clicker')
                : null;
            const clickerDisconnected = !teamClicker || !teamClicker.connected;

            if (ctx.player.role !== 'clicker' && !clickerDisconnected) {
                throw PlayerError.notClicker();
            }

            // Cannot end turn before spymaster gives a clue
            if (!ctx.game.currentClue) {
                throw new GameStateError(ERROR_CODES.CLUE_NOT_GIVEN, 'Cannot end turn before a clue has been given');
            }

            const result = await withTimeout(
                gameService.endTurn(ctx.roomCode, ctx.player.nickname, ctx.player.team),
                TIMEOUTS.GAME_ACTION,
                'game:endTurn'
            );

            io.to(`room:${ctx.roomCode}`).emit(SOCKET_EVENTS.GAME_TURN_ENDED, {
                currentTurn: result.currentTurn,
                previousTurn: result.previousTurn
            });

            // Restart timer for new turn if configured
            const room = await roomService.getRoom(ctx.roomCode);
            if (room && room.settings && room.settings.turnTimer) {
                await getSocketFunctions().startTurnTimer(ctx.roomCode, room.settings.turnTimer);
            }

            logger.info(`Turn ended in room ${ctx.roomCode}, now ${result.currentTurn}'s turn`);
        }
    ));

    /**
     * Forfeit the game (host only)
     */
    socket.on(SOCKET_EVENTS.GAME_FORFEIT, createHostHandler(socket, SOCKET_EVENTS.GAME_FORFEIT, null,
        async (ctx) => {
            if (!ctx.game || ctx.game.gameOver) {
                throw GameStateError.noActiveGame();
            }

            // Stop timer
            await getSocketFunctions().stopTurnTimer(ctx.roomCode);

            const result = await gameService.forfeitGame(ctx.roomCode);

            io.to(`room:${ctx.roomCode}`).emit(SOCKET_EVENTS.GAME_OVER, {
                winner: result.winner,
                forfeitingTeam: result.forfeitingTeam,
                reason: 'forfeit',
                types: result.allTypes
            });

            // Save completed game to history
            const [completedGame, roomForHistory] = await Promise.all([
                gameService.getGame(ctx.roomCode),
                roomService.getRoom(ctx.roomCode)
            ]);
            if (completedGame) {
                const gameDataWithTeamNames = {
                    ...completedGame,
                    teamNames: roomForHistory?.settings?.teamNames || { red: 'Red', blue: 'Blue' }
                };
                await gameHistoryService.saveGameResult(ctx.roomCode, gameDataWithTeamNames);
            }

            // Audit log game end (forfeit)
            const forfeitIp = socket.clientIP || socket.handshake.address;
            auditGameEnded(ctx.roomCode, ctx.sessionId, forfeitIp, result.winner, 'forfeit', null);

            logger.info(`Game forfeited in room ${ctx.roomCode}, ${result.forfeitingTeam} forfeited`);
        }
    ));

    /**
     * Get game history (current game's move history)
     */
    socket.on(SOCKET_EVENTS.GAME_HISTORY, createRoomHandler(socket, SOCKET_EVENTS.GAME_HISTORY, null,
        async (ctx) => {
            const history = await gameService.getGameHistory(ctx.roomCode);
            socket.emit(SOCKET_EVENTS.GAME_HISTORY_DATA, { history });
        }
    ));

    /**
     * Get past games history for this room (for replay)
     */
    socket.on(SOCKET_EVENTS.GAME_GET_HISTORY, createRoomHandler(socket, SOCKET_EVENTS.GAME_GET_HISTORY, gameHistoryLimitSchema,
        async (ctx, validated) => {
            const history = await gameHistoryService.getGameHistory(ctx.roomCode, validated.limit);
            socket.emit(SOCKET_EVENTS.GAME_HISTORY_RESULT, { history });
            logger.debug(`Game history retrieved for room ${ctx.roomCode}`, { count: history.length });
        }
    ));

    /**
     * Get replay data for a specific game
     */
    socket.on(SOCKET_EVENTS.GAME_GET_REPLAY, createRoomHandler(socket, SOCKET_EVENTS.GAME_GET_REPLAY, gameReplaySchema,
        async (ctx, validated) => {
            const replayData = await gameHistoryService.getReplayEvents(ctx.roomCode, validated.gameId);

            if (!replayData) {
                throw new GameStateError(ERROR_CODES.GAME_NOT_STARTED, 'Game not found in history');
            }

            socket.emit(SOCKET_EVENTS.GAME_REPLAY_DATA, { replay: replayData });
            logger.debug(`Replay data retrieved for game ${validated.gameId} in room ${ctx.roomCode}`);
        }
    ));
};
