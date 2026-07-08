/**
 * Shared "apply a game action and broadcast it" helpers.
 *
 * These are the single source of truth for performing a clue / reveal / endTurn
 * and telling the room about it. Both the socket handlers (human players) and
 * the botController (server-side bots) call them, so a bot's moves produce the
 * exact same broadcasts a human's would — no second code path to drift.
 *
 * Validation (role/turn/permission) and audit logging stay with the caller; the
 * service functions invoked here re-validate game state atomically.
 */
import type { Server } from 'socket.io';
import type { Team, Role, Room, RevealResult, EndTurnResult, ClueResult } from '../../types';

import * as gameService from '../../services/gameService';
import * as roomService from '../../services/roomService';
import { debouncedRefreshRoomTTL } from '../../services/roomService';
import { SOCKET_EVENTS } from '../../config/constants';
import { getSocketFunctions } from '../socketFunctionProvider';
import { safeEmitToRoom } from '../safeEmit';
import { withTimeout, TIMEOUTS } from '../../utils/timeout';
import { saveCompletedGameHistory, handleMatchRoundFinalization } from './gameHandlerUtils';

/** Who is performing the action (human player or bot). */
export interface GameActor {
    sessionId: string;
    nickname: string;
    team: Team;
    role?: Role;
}

async function maybeRestartTurnTimer(roomCode: string): Promise<void> {
    const room: Room | null = await roomService.getRoom(roomCode);
    if (room && room.settings && room.settings.turnTimer) {
        await getSocketFunctions().startTurnTimer(roomCode, room.settings.turnTimer);
    }
}

/** Submit a clue and broadcast game:clueGiven. */
export async function applyClue(
    io: Server,
    roomCode: string,
    actor: GameActor,
    word: string,
    clueNumber: number
): Promise<ClueResult> {
    const result = await withTimeout(
        gameService.submitClue(roomCode, actor.team, word, clueNumber, actor.nickname),
        TIMEOUTS.GAME_ACTION,
        'game:clue'
    );

    safeEmitToRoom(io, roomCode, SOCKET_EVENTS.GAME_CLUE_GIVEN, {
        word: result.word,
        number: result.number,
        team: result.team,
        guessesAllowed: result.guessesAllowed,
        spymaster: { sessionId: actor.sessionId, nickname: actor.nickname },
    });

    await debouncedRefreshRoomTTL(roomCode);
    return result;
}

/** Reveal a card and broadcast game:cardRevealed (+ game:over on game end). */
export async function applyReveal(
    io: Server,
    roomCode: string,
    actor: GameActor,
    index: number
): Promise<RevealResult> {
    const result = await withTimeout(
        gameService.revealCard(roomCode, index, actor.nickname, actor.team),
        TIMEOUTS.GAME_ACTION,
        'game:reveal'
    );

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
        player: { sessionId: actor.sessionId, nickname: actor.nickname, team: actor.team },
    };
    if (result.timerTokens !== undefined) revealPayload.timerTokens = result.timerTokens;
    if (result.greenFound !== undefined) revealPayload.greenFound = result.greenFound;
    if (result.cardScore !== undefined) revealPayload.cardScore = result.cardScore;
    if (result.redMatchScore !== undefined) revealPayload.redMatchScore = result.redMatchScore;
    if (result.blueMatchScore !== undefined) revealPayload.blueMatchScore = result.blueMatchScore;
    safeEmitToRoom(io, roomCode, SOCKET_EVENTS.GAME_CARD_REVEALED, revealPayload);

    if (result.turnEnded && !result.gameOver) {
        await maybeRestartTurnTimer(roomCode);
    }

    if (result.gameOver) {
        await getSocketFunctions().stopTurnTimer(roomCode);

        // Finalize the match round BEFORE broadcasting GAME_OVER. The client's
        // auto "New game" (frontend/game.ts) fires the moment it receives GAME_OVER
        // (gameOver && !matchOver). If finalization hasn't run yet, that
        // startNextRound persists round N+1 first, after which the `!gameOver`
        // guard in finalizeMatchRound makes round N's finalization a silent no-op —
        // dropping the ROUND_WIN_BONUS, reusing the round number, and never emitting
        // roundEnded/matchOver. Finalizing first banks the round before any client
        // can react, so the nextRound it triggers sees the corrected state. (N2b)
        await handleMatchRoundFinalization(io, roomCode);

        const gameOverPayload: Record<string, unknown> = {
            winner: result.winner,
            reason: result.endReason,
            types: result.allTypes,
        };
        if (result.allDuetTypes) gameOverPayload.duetTypes = result.allDuetTypes;
        if (result.greenFound !== undefined) gameOverPayload.greenFound = result.greenFound;
        if (result.timerTokens !== undefined) gameOverPayload.timerTokens = result.timerTokens;
        safeEmitToRoom(io, roomCode, SOCKET_EVENTS.GAME_OVER, gameOverPayload);

        await saveCompletedGameHistory(roomCode);
    }

    await debouncedRefreshRoomTTL(roomCode);
    return result;
}

/** End the current turn and broadcast game:turnEnded. */
export async function applyEndTurn(io: Server, roomCode: string, actor: GameActor): Promise<EndTurnResult> {
    const result = await withTimeout(
        gameService.endTurn(roomCode, actor.nickname, actor.team),
        TIMEOUTS.GAME_ACTION,
        'game:endTurn'
    );

    safeEmitToRoom(io, roomCode, SOCKET_EVENTS.GAME_TURN_ENDED, {
        currentTurn: result.currentTurn,
        previousTurn: result.previousTurn,
    });

    await maybeRestartTurnTimer(roomCode);
    await debouncedRefreshRoomTTL(roomCode);
    return result;
}
