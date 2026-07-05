import type { Server } from 'socket.io';
import type { Player, GameState, Room, RevealResult, EndTurnResult, ForfeitResult } from '../../types';
import type { GameSocket, RoomContext, GameContext } from './types';

import { z, type ZodType } from 'zod';
import * as gameService from '../../services/gameService';
import * as playerService from '../../services/playerService';
import * as roomService from '../../services/roomService';
import { debouncedRefreshRoomTTL } from '../../services/roomService';
import * as gameHistoryService from '../../services/gameHistoryService';
import * as timerService from '../../services/timerService';
import {
    gameRevealSchema,
    gameClueSchema,
    gameStartSchema,
    gameHistoryLimitSchema,
    gameReplaySchema,
    gameForfeitSchema,
    gameReadySchema,
} from '../../validators/schemas';
import logger from '../../utils/logger';
import { ERROR_CODES, SOCKET_EVENTS } from '../../config/constants';
import { createHostHandler, createRoomHandler, createGameHandler } from '../contextHandler';
import { PlayerError, GameStateError, ValidationError, RoomError } from '../../errors/GameError';
import { audit, AUDIT_EVENTS } from '../../utils/audit';
import { withTimeout, TIMEOUTS } from '../../utils/timeout';
import { getSocketFunctions } from '../socketFunctionProvider';
import { safeEmitToRoom, safeEmitToPlayers } from '../safeEmit';
import { saveCompletedGameHistory, handleMatchRoundFinalization } from './gameHandlerUtils';
import { buildSpymasterViewPayload } from './roomHandlerUtils';
import { applyClue, applyReveal, applyEndTurn } from './gameActions';

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
 * Game clue input
 */
interface GameClueInput {
    word: string;
    number: number;
}

/**
 * Game history limit input
 */
interface GameHistoryLimitInput {
    limit?: number;
}

/**
 * Game forfeit input
 */
interface GameForfeitInput {
    team?: 'red' | 'blue';
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
    socket.on(
        SOCKET_EVENTS.GAME_START,
        createHostHandler(
            socket,
            SOCKET_EVENTS.GAME_START,
            gameStartSchema as ZodType<GameStartInput>,
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
                    const gameMode = room?.settings?.gameMode || 'match';

                    const game: GameState = await gameService.createGame(ctx.roomCode, {
                        wordListId: validated.wordListId,
                        wordList: validated.wordList,
                        gameMode,
                    });

                    // Prepare roles for the new game: seats are PRESERVED (humans
                    // and bots keep their team + role), so a player who set up as
                    // clicker/spymaster stays seated instead of being bumped to
                    // spectator and having to re-claim every game.
                    const players: Player[] = await playerService.resetRolesForNewGame(ctx.roomCode);

                    return { game, room, players };
                })();

                const { game, room, players } = await withTimeout(gameSetupPromise, TIMEOUTS.GAME_ACTION, 'game:start');

                // Include game mode in started event
                const gameMode = room?.settings?.gameMode || 'match';

                // Send game state to each player (all roles are now spectator)
                safeEmitToPlayers(io, players, SOCKET_EVENTS.GAME_STARTED, (p: Player) => ({
                    game: gameService.getGameStateForPlayer(game, p),
                    gameMode,
                }));

                // Give each seated spymaster/observer their perspective-correct
                // key immediately. getGameStateForPlayer masks a Duet BLUE
                // spymaster's board (their key lives in duetTypes, which the client
                // renders only after a game:spymasterView), and sendSpymasterViewIfNeeded
                // fires only on role-change/resync — never on start. Since seats are
                // preserved across games, a pre-seated blue spymaster would otherwise
                // never receive their key until a manual resync/reconnect.
                const spymasterViewers = players.filter((p: Player) => p.role === 'spymaster' || p.role === 'observer');
                if (spymasterViewers.length > 0) {
                    safeEmitToPlayers(io, spymasterViewers, SOCKET_EVENTS.GAME_SPYMASTER_VIEW, (p: Player) =>
                        buildSpymasterViewPayload(game, p)
                    );
                }

                // Broadcast each player's role so all clients re-sync spymaster/
                // clicker state for the new game. Seats are preserved, so broadcast
                // the ACTUAL role rather than a hardcoded 'spectator' — otherwise
                // clients would show seated players (and bots) as spectators while
                // the server still treats them as their real role.
                for (const p of players) {
                    safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.PLAYER_UPDATED, {
                        sessionId: p.sessionId,
                        changes: { role: p.role ?? 'spectator', team: p.team },
                    });
                }

                // Start turn timer if configured
                if (room && room.settings && room.settings.turnTimer) {
                    await getSocketFunctions().startTurnTimer(ctx.roomCode, room.settings.turnTimer);
                }

                // Audit log game start
                const clientIp = socket.clientIP || socket.handshake.address;
                audit(AUDIT_EVENTS.GAME_STARTED, {
                    roomCode: ctx.roomCode,
                    sessionId: ctx.sessionId,
                    ip: clientIp,
                    metadata: { playerCount: players.length },
                });

                // Keep room alive during active games
                await debouncedRefreshRoomTTL(ctx.roomCode);

                logger.info(`Game started in room ${ctx.roomCode}`);
            }
        )
    );

    /**
     * Reveal a card (current team's clicker, or any team member if clicker disconnected)
     */
    socket.on(
        SOCKET_EVENTS.GAME_REVEAL,
        createGameHandler(
            socket,
            SOCKET_EVENTS.GAME_REVEAL,
            gameRevealSchema,
            async (ctx: GameContext, validated: GameRevealInput) => {
                if (ctx.game.paused) throw GameStateError.gamePaused();

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

                // Spymasters, advisors and observers can NEVER reveal cards, even
                // if the clicker is disconnected — only the clicker (or a fallback
                // teammate) acts. Advisors only suggest; observers only watch.
                if (
                    ctx.player.role === 'spymaster' ||
                    ctx.player.role === 'advisor' ||
                    ctx.player.role === 'observer'
                ) {
                    throw new ValidationError('Only the clicker can reveal cards');
                }

                if (ctx.player.role !== 'clicker' && !clickerDisconnected) {
                    throw PlayerError.notClicker();
                }

                // A turn starts with guessesAllowed=0, which is also the sentinel a
                // real clue-number-0 uses for "unlimited guesses" — so guessesAllowed
                // alone can't distinguish "no clue yet" from "unlimited guesses were
                // granted". Require an actual clue to be active before any reveal.
                if (!ctx.game.currentClue) {
                    throw GameStateError.noClueGiven();
                }

                const connectedTeamMembers = teamMembers.filter((p: Player) => p.connected);
                if (connectedTeamMembers.length === 0) {
                    throw new GameStateError(
                        ERROR_CODES.SERVER_ERROR,
                        `No connected players on ${ctx.game.currentTurn} team`
                    );
                }

                // Bug #4 fix: Pass player team to applyReveal for Lua-level turn validation.
                // applyReveal performs the reveal, broadcasts game:cardRevealed, handles
                // timer restart / game-over broadcast + history — shared with the bot path.
                const result: RevealResult = await applyReveal(
                    io,
                    ctx.roomCode,
                    {
                        sessionId: ctx.player.sessionId,
                        nickname: ctx.player.nickname,
                        team: ctx.player.team,
                        role: ctx.player.role,
                    },
                    validated.index
                );

                // Audit log game end (handler-specific — needs the socket's client IP)
                if (result.gameOver) {
                    const clientIpEnd = socket.clientIP || socket.handshake.address;
                    audit(AUDIT_EVENTS.GAME_ENDED, {
                        roomCode: ctx.roomCode,
                        sessionId: ctx.sessionId,
                        ip: clientIpEnd,
                        metadata: { winner: result.winner, endReason: result.endReason },
                    });
                }

                logger.info(`Card ${validated.index} revealed in room ${ctx.roomCode}`);
            }
        )
    );

    /**
     * Give a clue (current team's spymaster only)
     */
    socket.on(
        SOCKET_EVENTS.GAME_CLUE,
        createGameHandler(
            socket,
            SOCKET_EVENTS.GAME_CLUE,
            gameClueSchema as ZodType<GameClueInput>,
            async (ctx: GameContext, validated: GameClueInput) => {
                if (ctx.game.paused) throw GameStateError.gamePaused();

                if (!ctx.player.team) {
                    throw new ValidationError('You must join a team before giving a clue');
                }

                // Only the spymaster may give clues
                if (ctx.player.role !== 'spymaster') {
                    throw PlayerError.notSpymaster();
                }

                if (ctx.player.team !== ctx.game.currentTurn) {
                    throw PlayerError.notYourTurn(ctx.player.team);
                }

                await applyClue(
                    io,
                    ctx.roomCode,
                    {
                        sessionId: ctx.player.sessionId,
                        nickname: ctx.player.nickname,
                        team: ctx.player.team,
                        role: ctx.player.role,
                    },
                    validated.word,
                    validated.number
                );

                logger.info(`Clue given in room ${ctx.roomCode} by ${ctx.player.nickname}`);
            }
        )
    );

    /**
     * End the current turn (current team's clicker only)
     */
    socket.on(
        SOCKET_EVENTS.GAME_END_TURN,
        createGameHandler(socket, SOCKET_EVENTS.GAME_END_TURN, null, async (ctx: GameContext) => {
            if (ctx.game.paused) throw GameStateError.gamePaused();

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
            const teamClicker =
                teamMembers && Array.isArray(teamMembers)
                    ? teamMembers.find((p: Player) => p.role === 'clicker')
                    : null;
            const clickerDisconnected = !teamClicker || !teamClicker.connected;

            // Spymasters, advisors and observers can never end turns, even if the
            // clicker is disconnected — only the clicker (or a fallback teammate).
            if (ctx.player.role === 'spymaster' || ctx.player.role === 'advisor' || ctx.player.role === 'observer') {
                throw new ValidationError('Only the clicker can end the turn');
            }

            if (ctx.player.role !== 'clicker' && !clickerDisconnected) {
                throw PlayerError.notClicker();
            }

            const result: EndTurnResult = await applyEndTurn(io, ctx.roomCode, {
                sessionId: ctx.player.sessionId,
                nickname: ctx.player.nickname,
                team: ctx.player.team,
                role: ctx.player.role,
            });

            logger.info(`Turn ended in room ${ctx.roomCode}, now ${result.currentTurn}'s turn`);
        })
    );

    /**
     * Forfeit the game (host only)
     */
    socket.on(
        SOCKET_EVENTS.GAME_FORFEIT,
        createHostHandler(
            socket,
            SOCKET_EVENTS.GAME_FORFEIT,
            gameForfeitSchema as ZodType<GameForfeitInput>,
            async (ctx: RoomContext, validated: GameForfeitInput) => {
                if (!ctx.game || ctx.game.gameOver) {
                    throw GameStateError.noActiveGame();
                }
                if (ctx.game.paused) throw GameStateError.gamePaused();

                // Stop timer
                await getSocketFunctions().stopTurnTimer(ctx.roomCode);

                const result: ForfeitResult = await gameService.forfeitGame(ctx.roomCode, validated.team);

                // Duet mode: forfeit is a cooperative abandonment, not a team action
                const gameOverPayload: Record<string, unknown> = {
                    winner: result.winner,
                    reason: 'forfeit',
                    types: result.allTypes,
                };
                if (result.winner !== null) {
                    // Competitive mode: include which team forfeited
                    gameOverPayload.forfeitingTeam = result.forfeitingTeam;
                }
                safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.GAME_OVER, gameOverPayload);

                await saveCompletedGameHistory(ctx.roomCode);

                // Match mode: atomically finalize round and emit result
                await handleMatchRoundFinalization(io, ctx.roomCode);

                // Audit log game end (forfeit)
                const forfeitIp = socket.clientIP || socket.handshake.address;
                audit(AUDIT_EVENTS.GAME_ENDED, {
                    roomCode: ctx.roomCode,
                    sessionId: ctx.sessionId,
                    ip: forfeitIp,
                    metadata: { winner: result.winner, endReason: 'forfeit' },
                });

                logger.info(`Game forfeited in room ${ctx.roomCode}, ${result.forfeitingTeam} forfeited`);
            }
        )
    );

    /**
     * Start the next round in a match (host only)
     */
    socket.on(
        SOCKET_EVENTS.GAME_NEXT_ROUND,
        createHostHandler(socket, SOCKET_EVENTS.GAME_NEXT_ROUND, null, async (ctx: RoomContext) => {
            if (!ctx.game) {
                throw GameStateError.noActiveGame();
            }
            if (!ctx.game.gameOver) {
                throw RoomError.gameInProgress(ctx.roomCode);
            }
            if (ctx.game.gameMode !== 'match') {
                throw new ValidationError('Next round is only available in match mode');
            }
            if (ctx.game.matchOver) {
                throw new ValidationError('Match is already over');
            }

            // Stop any existing timer
            await getSocketFunctions().stopTurnTimer(ctx.roomCode);

            const room: Room | null = await roomService.getRoom(ctx.roomCode);

            const game: GameState = await gameService.startNextRound(ctx.roomCode, ctx.game, {
                gameMode: 'match',
                wordListId: room?.settings?.wordListId ?? undefined,
                // Prefer the full pool; fall back to the board words for pre-existing
                // games that predate wordPool persistence.
                wordList: ctx.game.wordPool ?? ctx.game.words,
            });

            // Preserve seats across the round (see resetRolesForNewGame): humans
            // and bots keep their team + role instead of dropping to spectator.
            const players: Player[] = await playerService.resetRolesForNewGame(ctx.roomCode);

            // Send game state to each player (all roles are now spectator)
            safeEmitToPlayers(io, players, SOCKET_EVENTS.GAME_STARTED, (p: Player) => ({
                game: gameService.getGameStateForPlayer(game, p),
                gameMode: 'match',
                isNextRound: true,
            }));

            // Broadcast each player's role so all clients re-sync for the round.
            // Seats are preserved across rounds, so broadcast the actual role
            // rather than a hardcoded 'spectator' to keep client rosters
            // consistent with server state.
            for (const p of players) {
                safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.PLAYER_UPDATED, {
                    sessionId: p.sessionId,
                    changes: { role: p.role ?? 'spectator', team: p.team },
                });
            }

            // Start turn timer if configured
            if (room && room.settings && room.settings.turnTimer) {
                await getSocketFunctions().startTurnTimer(ctx.roomCode, room.settings.turnTimer);
            }

            await debouncedRefreshRoomTTL(ctx.roomCode);

            logger.info(`Match round ${game.matchRound} started in room ${ctx.roomCode}`);
        })
    );

    /**
     * Abandon the current game without saving to history (host only)
     */
    socket.on(
        SOCKET_EVENTS.GAME_ABANDON,
        createHostHandler(socket, SOCKET_EVENTS.GAME_ABANDON, null, async (ctx: RoomContext) => {
            if (!ctx.game || ctx.game.gameOver) {
                throw GameStateError.noActiveGame();
            }

            // Stop timer
            await getSocketFunctions().stopTurnTimer(ctx.roomCode);

            // Mark game as over without saving history
            await gameService.abandonGame(ctx.roomCode);

            // Notify all players the game was abandoned
            safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.GAME_OVER, {
                winner: null,
                reason: 'abandoned',
                types: ctx.game.types,
            });

            // Audit log
            const clientIp = socket.clientIP || socket.handshake.address;
            audit(AUDIT_EVENTS.GAME_ENDED, {
                roomCode: ctx.roomCode,
                sessionId: ctx.sessionId,
                ip: clientIp,
                metadata: { endReason: 'abandoned' },
            });

            logger.info(`Game abandoned in room ${ctx.roomCode}`);
        })
    );

    /**
     * Clear all game history for this room (host only)
     */
    socket.on(
        SOCKET_EVENTS.GAME_CLEAR_HISTORY,
        createHostHandler(socket, SOCKET_EVENTS.GAME_CLEAR_HISTORY, null, async (ctx: RoomContext) => {
            const deletedCount = await gameHistoryService.clearRoomHistory(ctx.roomCode);

            safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.GAME_HISTORY_CLEARED, {
                deletedCount,
            });

            const clientIp = socket.clientIP || socket.handshake.address;
            audit(AUDIT_EVENTS.GAME_ENDED, {
                roomCode: ctx.roomCode,
                sessionId: ctx.sessionId,
                ip: clientIp,
                metadata: { action: 'clearHistory', deletedCount },
            });

            logger.info(`Game history cleared for room ${ctx.roomCode}, deleted ${deletedCount} entries`);
        })
    );

    /**
     * Initiate a ready check before starting a game (host only)
     */
    socket.on(
        SOCKET_EVENTS.GAME_READY_CHECK,
        createHostHandler(socket, SOCKET_EVENTS.GAME_READY_CHECK, gameReadySchema, async (ctx: RoomContext) => {
            if (ctx.game && !ctx.game.gameOver) {
                throw RoomError.gameInProgress(ctx.roomCode);
            }

            const players: Player[] = await playerService.getPlayersInRoom(ctx.roomCode);

            safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.GAME_READY_STATUS, {
                players: players.map((p: Player) => ({
                    sessionId: p.sessionId,
                    nickname: p.nickname,
                    ready: false,
                })),
                startedBy: ctx.player.nickname,
                timeout: 30,
            });

            logger.info(`Ready check initiated in room ${ctx.roomCode} by ${ctx.player.nickname}`);
        })
    );

    /**
     * Respond to a ready check
     */
    socket.on(
        SOCKET_EVENTS.GAME_READY,
        createRoomHandler(socket, SOCKET_EVENTS.GAME_READY, gameReadySchema, async (ctx: RoomContext) => {
            safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.GAME_READY_STATUS, {
                playerReady: {
                    sessionId: ctx.player.sessionId,
                    nickname: ctx.player.nickname,
                },
            });

            logger.info(`Player ${ctx.player.nickname} ready in room ${ctx.roomCode}`);
        })
    );

    /**
     * Get past games history for this room (for replay)
     */
    socket.on(
        SOCKET_EVENTS.GAME_GET_HISTORY,
        createRoomHandler(
            socket,
            SOCKET_EVENTS.GAME_GET_HISTORY,
            gameHistoryLimitSchema,
            async (ctx: RoomContext, validated: GameHistoryLimitInput) => {
                const history = await gameHistoryService.getGameHistory(ctx.roomCode, validated.limit);
                socket.emit(SOCKET_EVENTS.GAME_HISTORY_RESULT, { history });
                logger.debug(`Game history retrieved for room ${ctx.roomCode}`, { count: history.length });
            }
        )
    );

    /**
     * Get replay data for a specific game
     */
    socket.on(
        SOCKET_EVENTS.GAME_GET_REPLAY,
        createRoomHandler(
            socket,
            SOCKET_EVENTS.GAME_GET_REPLAY,
            gameReplaySchema,
            async (ctx: RoomContext, validated: GameReplayInput) => {
                const replayData: ReplayData | null = await gameHistoryService.getReplayEvents(
                    ctx.roomCode,
                    validated.gameId
                );

                if (!replayData) {
                    throw new GameStateError(ERROR_CODES.GAME_NOT_STARTED, 'Game not found in history');
                }

                socket.emit(SOCKET_EVENTS.GAME_REPLAY_DATA, { replay: replayData });
                logger.debug(`Replay data retrieved for game ${validated.gameId} in room ${ctx.roomCode}`);
            }
        )
    );

    /**
     * Typing indicator — broadcast to room that a player is typing
     */
    socket.on(
        SOCKET_EVENTS.GAME_TYPING,
        createGameHandler(socket, SOCKET_EVENTS.GAME_TYPING, z.object({}).strict(), async (ctx: GameContext) => {
            safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.GAME_TYPING, {
                sessionId: ctx.player.sessionId,
                nickname: ctx.player.nickname,
            });
        })
    );

    /**
     * Pause the game (host only, requires active game)
     */
    socket.on(
        SOCKET_EVENTS.GAME_PAUSE,
        createGameHandler(socket, SOCKET_EVENTS.GAME_PAUSE, null, async (ctx: GameContext) => {
            if (!ctx.player.isHost) throw PlayerError.notHost();

            await gameService.pauseGame(ctx.roomCode);
            await timerService.pauseTimer(ctx.roomCode);

            safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.GAME_PAUSED, {
                pausedBy: ctx.player.nickname,
            });

            logger.info(`Game paused in room ${ctx.roomCode} by ${ctx.player.nickname}`);
        })
    );

    /**
     * Resume the game (host only, requires active game)
     */
    socket.on(
        SOCKET_EVENTS.GAME_RESUME,
        createGameHandler(socket, SOCKET_EVENTS.GAME_RESUME, null, async (ctx: GameContext) => {
            if (!ctx.player.isHost) throw PlayerError.notHost();

            await gameService.resumeGame(ctx.roomCode);
            await timerService.resumeTimer(ctx.roomCode);

            safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.GAME_RESUMED, {
                resumedBy: ctx.player.nickname,
            });

            logger.info(`Game resumed in room ${ctx.roomCode} by ${ctx.player.nickname}`);
        })
    );
}

export default gameHandlers;

// CommonJS interop — tests use require() which needs module.exports
module.exports = gameHandlers;
module.exports.default = gameHandlers;
