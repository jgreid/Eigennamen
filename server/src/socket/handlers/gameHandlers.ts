/**
 * Game Socket Event Handlers
 *
 * Migrated to use context handler architecture for consistent
 * validation, error handling, and socket room management.
 */

import type { Server } from 'socket.io';
import type { Player, GameState, Room, RevealResult, EndTurnResult, ForfeitResult } from '../../types';
import type { GameSocket, RoomContext, GameContext } from './types';

import type { ZodType } from 'zod';
import * as gameService from '../../services/gameService';
import * as playerService from '../../services/playerService';
import * as roomService from '../../services/roomService';
import { debouncedRefreshRoomTTL } from '../../services/roomService';
import * as gameHistoryService from '../../services/gameHistoryService';
import type { GameDataInput } from '../../services/gameHistoryService';
import { gameRevealSchema, gameStartSchema, gameHistoryLimitSchema, gameReplaySchema } from '../../validators/schemas';
import logger from '../../utils/logger';
import { ERROR_CODES, SOCKET_EVENTS } from '../../config/constants';
import { createHostHandler, createRoomHandler, createGameHandler } from '../contextHandler';
import {
    PlayerError,
    GameStateError,
    ValidationError,
    RoomError
} from '../../errors/GameError';
import { audit, AUDIT_EVENTS } from '../../utils/audit';
import { withTimeout, TIMEOUTS } from '../../utils/timeout';
import { getSocketFunctions } from '../socketFunctionProvider';
import { safeEmitToRoom, safeEmitToPlayers } from '../safeEmit';

/**
 * Game start input
 */
interface GameStartInput {
    wordListId?: string;
    wordList?: string[];
}

/**
 * Game reveal input
 */
interface GameRevealInput {
    index: number;
}

/**
 * Game history limit input
 */
interface GameHistoryLimitInput {
    limit?: number;
}

/**
 * Game replay input
 */
interface GameReplayInput {
    gameId: string;
}

// Result types (RevealResult, EndTurnResult, ForfeitResult) imported from ../../types

/**
 * Replay data
 */
interface ReplayData {
    id: string;
    roomCode: string;
    events: unknown[];
    initialBoard: unknown;
    finalState: unknown;
}

function gameHandlers(io: Server, socket: GameSocket): void {

    /**
     * Start a new game (host only)
     */
    socket.on(SOCKET_EVENTS.GAME_START, createHostHandler(socket, SOCKET_EVENTS.GAME_START, gameStartSchema as ZodType<GameStartInput>,
        async (ctx: RoomContext, validated: GameStartInput) => {
            // Stop any existing timer
            await getSocketFunctions().stopTurnTimer(ctx.roomCode);

            const gameSetupPromise = (async () => {
                // Check if game already exists and is in progress
                if (ctx.game && !ctx.game.gameOver) {
                    throw RoomError.gameInProgress(ctx.roomCode);
                }

                // Fetch room first to get gameMode for game creation
                const room: Room | null = await roomService.getRoom(ctx.roomCode);
                const gameMode = room?.settings?.gameMode || 'classic';

                const game: GameState = await gameService.createGame(ctx.roomCode, {
                    wordListId: validated.wordListId,
                    wordList: validated.wordList,
                    gameMode
                });

                // Reset all player roles to spectator for the new game
                // Team membership is preserved, but roles must be re-chosen
                const players: Player[] = await playerService.resetRolesForNewGame(ctx.roomCode);

                return { game, room, players };
            })();

            const { game, room, players } = await withTimeout(
                gameSetupPromise,
                TIMEOUTS.GAME_ACTION,
                'game:start'
            );

            // Include game mode in started event
            const gameMode = room?.settings?.gameMode || 'classic';

            // Send game state to each player (all roles are now spectator)
            safeEmitToPlayers(io, players, SOCKET_EVENTS.GAME_STARTED, (p: Player) => ({
                game: gameService.getGameStateForPlayer(game, p),
                gameMode
            }));

            // Broadcast role resets so all clients clear spymaster/clicker state
            for (const p of players) {
                safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.PLAYER_UPDATED, {
                    sessionId: p.sessionId,
                    changes: { role: 'spectator', team: p.team }
                });
            }

            // Start turn timer if configured
            if (room && room.settings && room.settings.turnTimer) {
                await getSocketFunctions().startTurnTimer(ctx.roomCode, room.settings.turnTimer);
            }

            // Audit log game start
            const clientIp = socket.clientIP || socket.handshake.address;
            audit(AUDIT_EVENTS.GAME_STARTED, { roomCode: ctx.roomCode, sessionId: ctx.sessionId, ip: clientIp, metadata: { playerCount: players.length } });

            // Keep room alive during active games
            await debouncedRefreshRoomTTL(ctx.roomCode);

            logger.info(`Game started in room ${ctx.roomCode}`);
        }
    ));

    /**
     * Reveal a card (current team's clicker, or any team member if clicker disconnected)
     */
    socket.on(SOCKET_EVENTS.GAME_REVEAL, createGameHandler(socket, SOCKET_EVENTS.GAME_REVEAL, gameRevealSchema,
        async (ctx: GameContext, validated: GameRevealInput) => {
            if (!ctx.player.team) {
                throw new ValidationError('You must join a team before revealing cards');
            }

            if (ctx.player.team !== ctx.game.currentTurn) {
                throw PlayerError.notYourTurn(ctx.player.team);
            }

            // Allow reveal if player is clicker OR if clicker is disconnected (but never spymaster)
            const teamMembers: Player[] = await playerService.getTeamMembers(ctx.roomCode, ctx.game.currentTurn);
            if (!teamMembers || !Array.isArray(teamMembers)) {
                throw new GameStateError(ERROR_CODES.SERVER_ERROR, 'Unable to retrieve team members');
            }
            const teamClicker = teamMembers.find((p: Player) => p.role === 'clicker');
            const clickerDisconnected = !teamClicker || !teamClicker.connected;

            // Bug #3 fix: Spymasters can never reveal cards, even if clicker is disconnected
            if (ctx.player.role === 'spymaster') {
                throw new ValidationError('Spymasters cannot reveal cards - they can only give clues');
            }

            if (ctx.player.role !== 'clicker' && !clickerDisconnected) {
                throw PlayerError.notClicker();
            }

            const connectedTeamMembers = teamMembers.filter((p: Player) => p.connected);
            if (connectedTeamMembers.length === 0) {
                throw new GameStateError(ERROR_CODES.SERVER_ERROR, `No connected players on ${ctx.game.currentTurn} team`);
            }

            // Bug #4 fix: Pass player team to revealCard for Lua-level turn validation
            const result: RevealResult = await withTimeout(
                gameService.revealCard(ctx.roomCode, validated.index, ctx.player.nickname, ctx.player.team),
                TIMEOUTS.GAME_ACTION,
                'game:reveal'
            );

            // Broadcast the reveal to all players
            const revealPayload: Record<string, unknown> = {
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
            };
            // Include Duet-specific fields if present
            if (result.timerTokens !== undefined) revealPayload.timerTokens = result.timerTokens;
            if (result.greenFound !== undefined) revealPayload.greenFound = result.greenFound;
            safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.GAME_CARD_REVEALED, revealPayload);

            // Handle turn ending
            if (result.turnEnded && !result.gameOver) {
                const room: Room | null = await roomService.getRoom(ctx.roomCode);
                if (room && room.settings && room.settings.turnTimer) {
                    await getSocketFunctions().startTurnTimer(ctx.roomCode, room.settings.turnTimer);
                }
            }

            // If game is over, stop timer FIRST then reveal all card types
            if (result.gameOver) {
                await getSocketFunctions().stopTurnTimer(ctx.roomCode);

                const gameOverPayload: Record<string, unknown> = {
                    winner: result.winner,
                    reason: result.endReason,
                    types: result.allTypes
                };
                if (result.allDuetTypes) gameOverPayload.duetTypes = result.allDuetTypes;
                if (result.greenFound !== undefined) gameOverPayload.greenFound = result.greenFound;
                if (result.timerTokens !== undefined) gameOverPayload.timerTokens = result.timerTokens;
                safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.GAME_OVER, gameOverPayload);

                // Save completed game to history (non-critical — don't break the game-over flow)
                try {
                    const [completedGame, roomForHistory] = await Promise.all([
                        gameService.getGame(ctx.roomCode),
                        roomService.getRoom(ctx.roomCode)
                    ]) as [GameState | null, Room | null];
                    if (completedGame) {
                        const gameDataWithTeamNames = {
                            ...completedGame,
                            winner: completedGame.winner ?? undefined,
                            teamNames: roomForHistory?.settings?.teamNames || { red: 'Red', blue: 'Blue' }
                        } as GameDataInput;
                        await gameHistoryService.saveGameResult(ctx.roomCode, gameDataWithTeamNames);
                    }
                } catch (historyError) {
                    logger.error(`Failed to save game history for room ${ctx.roomCode}:`, historyError);
                }

                // Audit log game end
                const clientIpEnd = socket.clientIP || socket.handshake.address;
                audit(AUDIT_EVENTS.GAME_ENDED, { roomCode: ctx.roomCode, sessionId: ctx.sessionId, ip: clientIpEnd, metadata: { winner: result.winner, endReason: result.endReason } });
            }

            // Keep room alive during active games
            await debouncedRefreshRoomTTL(ctx.roomCode);

            logger.info(`Card ${validated.index} revealed in room ${ctx.roomCode}`);
        }
    ));

    /**
     * End the current turn (current team's clicker only)
     */
    socket.on(SOCKET_EVENTS.GAME_END_TURN, createGameHandler(socket, SOCKET_EVENTS.GAME_END_TURN, null,
        async (ctx: GameContext) => {
            if (!ctx.player.team) {
                throw new ValidationError('You must join a team before ending the turn');
            }

            if (ctx.player.team !== ctx.game.currentTurn) {
                throw PlayerError.notYourTurn(ctx.player.team);
            }

            // Allow end turn if player is clicker OR if clicker is disconnected (but never spymaster)
            const teamMembers: Player[] = await withTimeout(
                playerService.getTeamMembers(ctx.roomCode, ctx.game.currentTurn),
                TIMEOUTS.GAME_ACTION,
                'game:endTurn:getTeamMembers'
            );
            const teamClicker = teamMembers && Array.isArray(teamMembers)
                ? teamMembers.find((p: Player) => p.role === 'clicker')
                : null;
            const clickerDisconnected = !teamClicker || !teamClicker.connected;

            // Bug #3 fix: Spymasters can never end turns, even if clicker is disconnected
            if (ctx.player.role === 'spymaster') {
                throw new ValidationError('Spymasters cannot end turns - only clickers can');
            }

            if (ctx.player.role !== 'clicker' && !clickerDisconnected) {
                throw PlayerError.notClicker();
            }

            const result: EndTurnResult = await withTimeout(
                gameService.endTurn(ctx.roomCode, ctx.player.nickname, ctx.player.team),
                TIMEOUTS.GAME_ACTION,
                'game:endTurn'
            );

            safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.GAME_TURN_ENDED, {
                currentTurn: result.currentTurn,
                previousTurn: result.previousTurn
            });

            // Restart timer for new turn if configured
            const room: Room | null = await roomService.getRoom(ctx.roomCode);
            if (room && room.settings && room.settings.turnTimer) {
                await getSocketFunctions().startTurnTimer(ctx.roomCode, room.settings.turnTimer);
            }

            // Keep room alive during active games
            await debouncedRefreshRoomTTL(ctx.roomCode);

            logger.info(`Turn ended in room ${ctx.roomCode}, now ${result.currentTurn}'s turn`);
        }
    ));

    /**
     * Forfeit the game (host only)
     */
    socket.on(SOCKET_EVENTS.GAME_FORFEIT, createHostHandler(socket, SOCKET_EVENTS.GAME_FORFEIT, null,
        async (ctx: RoomContext) => {
            if (!ctx.game || ctx.game.gameOver) {
                throw GameStateError.noActiveGame();
            }

            // Stop timer
            await getSocketFunctions().stopTurnTimer(ctx.roomCode);

            const result: ForfeitResult = await gameService.forfeitGame(ctx.roomCode);

            safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.GAME_OVER, {
                winner: result.winner,
                forfeitingTeam: result.forfeitingTeam,
                reason: 'forfeit',
                types: result.allTypes
            });

            // Save completed game to history (non-critical — don't break the forfeit flow)
            try {
                const [completedGame, roomForHistory] = await Promise.all([
                    gameService.getGame(ctx.roomCode),
                    roomService.getRoom(ctx.roomCode)
                ]) as [GameState | null, Room | null];
                if (completedGame) {
                    const gameDataWithTeamNames = {
                        ...completedGame,
                        winner: completedGame.winner ?? undefined,
                        teamNames: roomForHistory?.settings?.teamNames || { red: 'Red', blue: 'Blue' }
                    } as GameDataInput;
                    await gameHistoryService.saveGameResult(ctx.roomCode, gameDataWithTeamNames);
                }
            } catch (historyError) {
                logger.error(`Failed to save forfeit game history for room ${ctx.roomCode}:`, historyError);
            }

            // Audit log game end (forfeit)
            const forfeitIp = socket.clientIP || socket.handshake.address;
            audit(AUDIT_EVENTS.GAME_ENDED, { roomCode: ctx.roomCode, sessionId: ctx.sessionId, ip: forfeitIp, metadata: { winner: result.winner, endReason: 'forfeit' } });

            logger.info(`Game forfeited in room ${ctx.roomCode}, ${result.forfeitingTeam} forfeited`);
        }
    ));

    /**
     * Get game history (current game's move history)
     */
    socket.on(SOCKET_EVENTS.GAME_HISTORY, createRoomHandler(socket, SOCKET_EVENTS.GAME_HISTORY, null,
        async (ctx: RoomContext) => {
            const history = await gameService.getGameHistory(ctx.roomCode);
            socket.emit(SOCKET_EVENTS.GAME_HISTORY_DATA, { history });
        }
    ));

    /**
     * Get past games history for this room (for replay)
     */
    socket.on(SOCKET_EVENTS.GAME_GET_HISTORY, createRoomHandler(socket, SOCKET_EVENTS.GAME_GET_HISTORY, gameHistoryLimitSchema,
        async (ctx: RoomContext, validated: GameHistoryLimitInput) => {
            const history = await gameHistoryService.getGameHistory(ctx.roomCode, validated.limit);
            socket.emit(SOCKET_EVENTS.GAME_HISTORY_RESULT, { history });
            logger.debug(`Game history retrieved for room ${ctx.roomCode}`, { count: history.length });
        }
    ));

    /**
     * Get replay data for a specific game
     */
    socket.on(SOCKET_EVENTS.GAME_GET_REPLAY, createRoomHandler(socket, SOCKET_EVENTS.GAME_GET_REPLAY, gameReplaySchema,
        async (ctx: RoomContext, validated: GameReplayInput) => {
            const replayData: ReplayData | null = await gameHistoryService.getReplayEvents(ctx.roomCode, validated.gameId);

            if (!replayData) {
                throw new GameStateError(ERROR_CODES.GAME_NOT_STARTED, 'Game not found in history');
            }

            socket.emit(SOCKET_EVENTS.GAME_REPLAY_DATA, { replay: replayData });
            logger.debug(`Replay data retrieved for game ${validated.gameId} in room ${ctx.roomCode}`);
        }
    ));
}

export default gameHandlers;

// CommonJS interop — tests use require() which needs module.exports
module.exports = gameHandlers;
module.exports.default = gameHandlers;
