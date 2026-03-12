import type { GameHistoryEntry, ReplayEvent, ReplayData } from './types';

import logger from '../../utils/logger';
import { incrementCounter, METRIC_NAMES } from '../../utils/metrics';
import { countCluesFromHistory } from './validation';
import { getGameById } from './storage';

/**
 * Get replay events for a specific game
 * Combines stored history with any additional event log data
 */
export async function getReplayEvents(roomCode: string, gameId: string): Promise<ReplayData | null> {
    if (!roomCode || !gameId) {
        return null;
    }

    try {
        // Get the game from history
        const game = await getGameById(roomCode, gameId);

        if (!game) {
            return null;
        }

        // Build structured replay data
        const { events, skippedCount } = buildReplayEvents(game);
        const replayData: ReplayData = {
            id: game.id,
            roomCode: game.roomCode,
            timestamp: game.timestamp,
            initialBoard: game.initialBoard,
            events,
            finalState: game.finalState,
            teamNames: game.teamNames,
            duration: game.endedAt - game.startedAt,
            totalMoves: game.history?.length || 0,
            totalClues: countCluesFromHistory(game.history),
            ...(skippedCount > 0 && { skippedEntries: skippedCount }),
        };

        return replayData;
    } catch (error) {
        logger.error('Failed to get replay events', {
            roomCode,
            gameId,
            error: (error as Error).message,
        });
        return null;
    }
}

/**
 * Build ordered replay events from game history
 */
interface BuildReplayResult {
    events: ReplayEvent[];
    skippedCount: number;
}

function buildReplayEvents(game: GameHistoryEntry): BuildReplayResult {
    const events: ReplayEvent[] = [];
    const history = game.history || [];
    let skippedCount = 0;

    // Convert history entries to replay events (skip corrupted entries)
    for (const entry of history) {
        if (!entry || typeof entry !== 'object' || !entry.action) {
            skippedCount++;
            continue;
        }

        const event: ReplayEvent = {
            timestamp: entry.timestamp || 0,
            type: entry.action,
            data: {},
        };

        switch (entry.action) {
            case 'clue':
                event.data = {
                    team: entry.team,
                    word: entry.word,
                    number: entry.number,
                    spymaster: entry.spymaster,
                    guessesAllowed: entry.guessesAllowed,
                };
                break;

            case 'reveal':
                event.data = {
                    index: entry.index,
                    word: entry.word,
                    type: entry.type,
                    team: entry.team,
                    player: entry.player,
                    guessNumber: entry.guessNumber,
                };
                break;

            case 'endTurn':
                event.data = {
                    fromTeam: entry.fromTeam,
                    toTeam: entry.toTeam,
                    player: entry.player,
                };
                break;

            case 'forfeit':
                event.data = {
                    forfeitingTeam: entry.forfeitingTeam,
                    winner: entry.winner,
                };
                break;

            default: {
                // Log unrecognized entry types so new types are caught early.
                // Still pass through all data for forward compatibility via
                // explicit field extraction (avoids unsafe double-cast).
                const { action: _action, ...rest } = entry;
                logger.warn(`Unrecognized game history entry type: ${_action}`);
                event.data = rest as Record<string, unknown>;
            }
        }

        events.push(event);
    }

    if (skippedCount > 0) {
        logger.warn('Skipped corrupted entries while building replay', {
            gameId: game.id,
            roomCode: game.roomCode,
            skippedCount,
            totalEntries: history.length,
        });
        incrementCounter(METRIC_NAMES.HISTORY_ENTRIES_DROPPED, skippedCount, { roomCode: game.roomCode });
    }

    // Sort by timestamp to ensure correct order
    events.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    return { events, skippedCount };
}
