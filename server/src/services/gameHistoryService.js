/**
 * Game History Service
 *
 * Stores completed game results and provides replay functionality.
 * Uses Redis with 30-day TTL for game history storage.
 */

const { getRedis } = require('../config/redis');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

// Configuration
const GAME_HISTORY_TTL = 30 * 24 * 60 * 60; // 30 days in seconds
const GAME_HISTORY_KEY_PREFIX = 'gameHistory:';
const GAME_HISTORY_INDEX_PREFIX = 'gameHistoryIndex:';
const MAX_HISTORY_PER_ROOM = 100; // Maximum games to keep per room

/**
 * Save a completed game result
 * @param {string} roomCode - Room code where game was played
 * @param {Object} gameData - Complete game data to save
 * @returns {Promise<Object>} Saved game history entry
 */
async function saveGameResult(roomCode, gameData) {
    const redis = getRedis();

    if (!roomCode || !gameData) {
        logger.warn('saveGameResult called with missing parameters', { roomCode, hasGameData: !!gameData });
        return null;
    }

    // Generate a unique history ID if game doesn't have one
    const historyId = gameData.id || uuidv4();
    const timestamp = Date.now();

    // Build the history entry with replay data
    const historyEntry = {
        id: historyId,
        roomCode,
        timestamp,
        startedAt: gameData.createdAt || timestamp,
        endedAt: timestamp,

        // Initial board state for replay
        initialBoard: {
            words: gameData.words,
            types: gameData.types,
            seed: gameData.seed,
            firstTeam: getFirstTeam(gameData)
        },

        // Final scores and winner
        finalState: {
            redScore: gameData.redScore,
            blueScore: gameData.blueScore,
            redTotal: gameData.redTotal,
            blueTotal: gameData.blueTotal,
            winner: gameData.winner,
            gameOver: gameData.gameOver
        },

        // All clues given during the game
        clues: gameData.clues || [],

        // Game history (reveals, clues, end turns)
        history: gameData.history || [],

        // Team names (if available from room settings)
        teamNames: gameData.teamNames || { red: 'Red', blue: 'Blue' },

        // Metadata
        wordListId: gameData.wordListId || null,
        stateVersion: gameData.stateVersion || 1
    };

    try {
        const gameKey = `${GAME_HISTORY_KEY_PREFIX}${roomCode}:${historyId}`;
        const indexKey = `${GAME_HISTORY_INDEX_PREFIX}${roomCode}`;

        // Use pipeline for atomic operations
        const pipeline = redis.multi();

        // Store the game history entry
        pipeline.set(gameKey, JSON.stringify(historyEntry), { EX: GAME_HISTORY_TTL });

        // Add to sorted set index (score = timestamp for ordering)
        pipeline.zAdd(indexKey, { score: timestamp, value: historyId });

        // Trim index to keep only the most recent games
        pipeline.zRemRangeByRank(indexKey, 0, -(MAX_HISTORY_PER_ROOM + 1));

        // Set TTL on index
        pipeline.expire(indexKey, GAME_HISTORY_TTL);

        await pipeline.exec();

        logger.info('Game result saved to history', {
            roomCode,
            gameId: historyId,
            winner: gameData.winner,
            redScore: gameData.redScore,
            blueScore: gameData.blueScore
        });

        return historyEntry;

    } catch (error) {
        logger.error('Failed to save game result', {
            roomCode,
            gameId: historyId,
            error: error.message
        });
        // Don't throw - history saving shouldn't break the application
        return null;
    }
}

/**
 * Determine which team went first based on totals
 * @param {Object} gameData - Game data
 * @returns {string} 'red' or 'blue'
 */
function getFirstTeam(gameData) {
    // The team with 9 cards went first
    if (gameData.redTotal === 9) return 'red';
    if (gameData.blueTotal === 9) return 'blue';
    // Default fallback
    return 'red';
}

/**
 * Get game history for a room
 * @param {string} roomCode - Room code
 * @param {number} limit - Maximum number of games to return (default 10)
 * @returns {Promise<Array>} Array of game history summaries (most recent first)
 */
async function getGameHistory(roomCode, limit = 10) {
    const redis = getRedis();

    if (!roomCode) {
        return [];
    }

    try {
        const indexKey = `${GAME_HISTORY_INDEX_PREFIX}${roomCode}`;

        // Get game IDs from sorted set (most recent first)
        const gameIds = await redis.zRange(indexKey, 0, limit - 1, { REV: true });

        if (!gameIds || gameIds.length === 0) {
            return [];
        }

        // Fetch all game entries in parallel
        const gameKeys = gameIds.map(id => `${GAME_HISTORY_KEY_PREFIX}${roomCode}:${id}`);
        const gameDataArray = await redis.mGet(gameKeys);

        // Parse and create summaries
        const history = gameDataArray
            .map((data, index) => {
                if (!data) return null;
                try {
                    const game = JSON.parse(data);
                    // Return summary (not full replay data)
                    return {
                        id: game.id,
                        timestamp: game.timestamp,
                        startedAt: game.startedAt,
                        endedAt: game.endedAt,
                        winner: game.finalState?.winner,
                        redScore: game.finalState?.redScore,
                        blueScore: game.finalState?.blueScore,
                        redTotal: game.finalState?.redTotal,
                        blueTotal: game.finalState?.blueTotal,
                        teamNames: game.teamNames,
                        clueCount: game.clues?.length || 0,
                        moveCount: game.history?.length || 0
                    };
                } catch (e) {
                    logger.warn('Failed to parse game history entry', {
                        roomCode,
                        gameId: gameIds[index],
                        error: e.message
                    });
                    return null;
                }
            })
            .filter(g => g !== null);

        return history;

    } catch (error) {
        logger.error('Failed to get game history', {
            roomCode,
            limit,
            error: error.message
        });
        return [];
    }
}

/**
 * Get a specific game by ID for replay
 * @param {string} roomCode - Room code
 * @param {string} gameId - Game ID
 * @returns {Promise<Object|null>} Full game data for replay or null if not found
 */
async function getGameById(roomCode, gameId) {
    const redis = getRedis();

    if (!roomCode || !gameId) {
        return null;
    }

    try {
        const gameKey = `${GAME_HISTORY_KEY_PREFIX}${roomCode}:${gameId}`;
        const gameData = await redis.get(gameKey);

        if (!gameData) {
            logger.debug('Game not found in history', { roomCode, gameId });
            return null;
        }

        const game = JSON.parse(gameData);
        return game;

    } catch (error) {
        logger.error('Failed to get game by ID', {
            roomCode,
            gameId,
            error: error.message
        });
        return null;
    }
}

/**
 * Get replay events for a specific game
 * Combines stored history with any additional event log data
 * @param {string} roomCode - Room code
 * @param {string} gameId - Game ID
 * @returns {Promise<Object|null>} Replay data with events or null if not found
 */
async function getReplayEvents(roomCode, gameId) {
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
        const replayData = {
            id: game.id,
            roomCode: game.roomCode,
            timestamp: game.timestamp,

            // Initial board state
            initialBoard: game.initialBoard,

            // Ordered list of events for replay
            events: buildReplayEvents(game),

            // Final state
            finalState: game.finalState,

            // Team names
            teamNames: game.teamNames,

            // Metadata
            duration: game.endedAt - game.startedAt,
            totalMoves: game.history?.length || 0,
            totalClues: game.clues?.length || 0
        };

        return replayData;

    } catch (error) {
        logger.error('Failed to get replay events', {
            roomCode,
            gameId,
            error: error.message
        });
        return null;
    }
}

/**
 * Build ordered replay events from game history
 * @param {Object} game - Game history entry
 * @returns {Array} Ordered array of replay events
 */
function buildReplayEvents(game) {
    const events = [];
    const history = game.history || [];

    // Convert history entries to replay events
    for (const entry of history) {
        const event = {
            timestamp: entry.timestamp,
            type: entry.action,
            data: {}
        };

        switch (entry.action) {
            case 'clue':
                event.data = {
                    team: entry.team,
                    word: entry.word,
                    number: entry.number,
                    spymaster: entry.spymaster,
                    guessesAllowed: entry.guessesAllowed
                };
                break;

            case 'reveal':
                event.data = {
                    index: entry.index,
                    word: entry.word,
                    type: entry.type,
                    team: entry.team,
                    player: entry.player,
                    guessNumber: entry.guessNumber
                };
                break;

            case 'endTurn':
                event.data = {
                    fromTeam: entry.fromTeam,
                    toTeam: entry.toTeam,
                    player: entry.player
                };
                break;

            case 'forfeit':
                event.data = {
                    forfeitingTeam: entry.forfeitingTeam,
                    winner: entry.winner
                };
                break;

            default:
                event.data = entry;
        }

        events.push(event);
    }

    // Sort by timestamp to ensure correct order
    events.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    return events;
}

/**
 * Delete old game history for a room (cleanup function)
 * @param {string} roomCode - Room code
 * @returns {Promise<number>} Number of entries deleted
 */
async function cleanupOldHistory(roomCode) {
    const redis = getRedis();

    if (!roomCode) {
        return 0;
    }

    try {
        const indexKey = `${GAME_HISTORY_INDEX_PREFIX}${roomCode}`;

        // Get all game IDs that exceed the limit
        const oldGameIds = await redis.zRange(indexKey, 0, -(MAX_HISTORY_PER_ROOM + 1));

        if (!oldGameIds || oldGameIds.length === 0) {
            return 0;
        }

        // Delete old game entries
        const gameKeys = oldGameIds.map(id => `${GAME_HISTORY_KEY_PREFIX}${roomCode}:${id}`);
        await redis.del(gameKeys);

        // Remove from index
        await redis.zRem(indexKey, oldGameIds);

        logger.info('Cleaned up old game history', {
            roomCode,
            deletedCount: oldGameIds.length
        });

        return oldGameIds.length;

    } catch (error) {
        logger.error('Failed to cleanup old history', {
            roomCode,
            error: error.message
        });
        return 0;
    }
}

/**
 * Get statistics for game history
 * @param {string} roomCode - Room code
 * @returns {Promise<Object>} Statistics object
 */
async function getHistoryStats(roomCode) {
    const redis = getRedis();

    if (!roomCode) {
        return { count: 0, oldest: null, newest: null };
    }

    try {
        const indexKey = `${GAME_HISTORY_INDEX_PREFIX}${roomCode}`;

        const count = await redis.zCard(indexKey);
        if (count === 0) {
            return { count: 0, oldest: null, newest: null };
        }

        // Get oldest and newest entries
        const [oldestEntries, newestEntries] = await Promise.all([
            redis.zRange(indexKey, 0, 0, { WITHSCORES: true }),
            redis.zRange(indexKey, -1, -1, { WITHSCORES: true })
        ]);

        return {
            count,
            oldest: oldestEntries.length > 0 ? {
                id: oldestEntries[0].value,
                timestamp: oldestEntries[0].score
            } : null,
            newest: newestEntries.length > 0 ? {
                id: newestEntries[0].value,
                timestamp: newestEntries[0].score
            } : null
        };

    } catch (error) {
        logger.error('Failed to get history stats', {
            roomCode,
            error: error.message
        });
        return { count: 0, oldest: null, newest: null, error: error.message };
    }
}

module.exports = {
    saveGameResult,
    getGameHistory,
    getGameById,
    getReplayEvents,
    cleanupOldHistory,
    getHistoryStats,
    // Constants for testing
    GAME_HISTORY_TTL,
    MAX_HISTORY_PER_ROOM
};
