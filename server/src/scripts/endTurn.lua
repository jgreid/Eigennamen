local gameKey = KEYS[1]
local playerNickname = ARGV[1]
local timestamp = tonumber(ARGV[2])
local maxHistoryEntries = tonumber(ARGV[3])
local expectedTeam = ARGV[4]

local gameData = redis.call('GET', gameKey)
if not gameData then
    return cjson.encode({error = 'NO_GAME'})
end

local game = cjson.decode(gameData)

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

-- Save game
redis.call('SET', gameKey, cjson.encode(game))

return cjson.encode({
    success = true,
    previousTurn = previousTurn,
    currentTurn = game.currentTurn
})
