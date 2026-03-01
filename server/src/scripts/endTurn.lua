-- endTurn.lua
-- Description: Atomically ends the current team's turn, switches to the other team, and records the action in history
--
-- KEYS[1]: Game key (e.g., `game:room:ABC123`)
-- ARGV[1]: Player nickname
-- ARGV[2]: Timestamp (ms)
-- ARGV[3]: Max history entries
-- ARGV[4]: Expected current turn team (race condition guard)
--
-- Returns: JSON `{success: true, previousTurn, currentTurn}` or `{error: 'CODE'}`

local gameKey = KEYS[1]
local playerNickname = ARGV[1]
local timestamp = tonumber(ARGV[2])
local maxHistoryEntries = tonumber(ARGV[3])
local expectedTeam = ARGV[4]

-- Preserve existing TTL so the key doesn't become permanent
local currentTTL = redis.call('TTL', gameKey)

local gameData = redis.call('GET', gameKey)
if not gameData then
    return cjson.encode({error = 'NO_GAME'})
end

local ok, game = pcall(cjson.decode, gameData)
if not ok then
    return cjson.encode({error = 'CORRUPTED_DATA'})
end

-- Validate preconditions
if game.gameOver then
    return cjson.encode({error = 'GAME_OVER'})
end

-- Validate the calling team matches current turn (prevents race condition)
if expectedTeam and expectedTeam ~= '' and game.currentTurn ~= expectedTeam then
    return cjson.encode({error = 'NOT_YOUR_TURN'})
end

local previousTurn = game.currentTurn

-- Switch turn
if game.currentTurn == 'red' then
    game.currentTurn = 'blue'
else
    game.currentTurn = 'red'
end

-- Reset clue state
game.currentClue = cjson.null
game.guessesUsed = 0
game.guessesAllowed = 0

-- Add to history
if not game.history then
    game.history = {}
end
table.insert(game.history, {
    action = 'endTurn',
    fromTeam = previousTurn,
    toTeam = game.currentTurn,
    player = playerNickname,
    timestamp = timestamp
})

-- Cap history
if #game.history > maxHistoryEntries then
    local newHistory = {}
    for i = #game.history - maxHistoryEntries + 1, #game.history do
        table.insert(newHistory, game.history[i])
    end
    game.history = newHistory
end

-- Increment version
game.stateVersion = (game.stateVersion or 0) + 1

-- Save game, preserving TTL
if currentTTL > 0 then
    redis.call('SET', gameKey, cjson.encode(game), 'EX', currentTTL)
else
    redis.call('SET', gameKey, cjson.encode(game))
end

return cjson.encode({
    success = true,
    previousTurn = previousTurn,
    currentTurn = game.currentTurn
})
