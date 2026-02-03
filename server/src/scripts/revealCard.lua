local gameKey = KEYS[1]
local index = tonumber(ARGV[1])
local timestamp = tonumber(ARGV[2])
local playerNickname = ARGV[3]
local maxHistoryEntries = tonumber(ARGV[4])
-- Bug #4 fix: Add player team parameter for turn validation
local playerTeam = ARGV[5]

-- Preserve existing TTL so the key doesn't become permanent
local currentTTL = redis.call('TTL', gameKey)

local gameData = redis.call('GET', gameKey)
if not gameData then
    return cjson.encode({error = 'NO_GAME'})
end

local game = cjson.decode(gameData)

-- Validate preconditions
if game.gameOver then
    return cjson.encode({error = 'GAME_OVER'})
end

-- Bug #4 fix: Re-validate turn in Lua script (defense in depth)
if playerTeam and playerTeam ~= '' and game.currentTurn ~= playerTeam then
    return cjson.encode({error = 'NOT_YOUR_TURN'})
end

-- Bug #9 fix: Require a clue before revealing cards
-- currentClue is nil/null when no clue has been given this turn
if game.currentClue == nil or game.currentClue == cjson.null then
    return cjson.encode({error = 'NO_CLUE'})
end

if game.guessesAllowed > 0 and game.guessesUsed >= game.guessesAllowed then
    return cjson.encode({error = 'NO_GUESSES'})
end
-- Lua arrays are 1-indexed, so add 1 to the index
local luaIndex = index + 1
if game.revealed[luaIndex] then
    return cjson.encode({error = 'ALREADY_REVEALED'})
end

-- Store previous state
local previousTurn = game.currentTurn
local cardType = game.types[luaIndex]

-- Execute reveal
game.revealed[luaIndex] = true
if cardType == 'red' then
    game.redScore = game.redScore + 1
elseif cardType == 'blue' then
    game.blueScore = game.blueScore + 1
end
game.guessesUsed = (game.guessesUsed or 0) + 1

-- Determine outcome
local turnEnded = false
local endReason = cjson.null

-- Check assassin
if cardType == 'assassin' then
    game.gameOver = true
    if previousTurn == 'red' then
        game.winner = 'blue'
    else
        game.winner = 'red'
    end
    endReason = 'assassin'
    turnEnded = true
-- Check win conditions
elseif game.redScore >= game.redTotal then
    game.gameOver = true
    game.winner = 'red'
    endReason = 'completed'
    turnEnded = true
elseif game.blueScore >= game.blueTotal then
    game.gameOver = true
    game.winner = 'blue'
    endReason = 'completed'
    turnEnded = true
-- Wrong guess
elseif cardType ~= previousTurn then
    if previousTurn == 'red' then
        game.currentTurn = 'blue'
    else
        game.currentTurn = 'red'
    end
    game.currentClue = cjson.null
    game.guessesUsed = 0
    game.guessesAllowed = 0
    turnEnded = true
-- Max guesses reached
elseif game.guessesAllowed > 0 and game.guessesUsed >= game.guessesAllowed then
    if previousTurn == 'red' then
        game.currentTurn = 'blue'
    else
        game.currentTurn = 'red'
    end
    game.currentClue = cjson.null
    game.guessesUsed = 0
    game.guessesAllowed = 0
    turnEnded = true
    endReason = 'maxGuesses'
end

-- Add to history (with cap)
if not game.history then
    game.history = {}
end
table.insert(game.history, {
    action = 'reveal',
    index = index,
    word = game.words[luaIndex],
    type = cardType,
    team = previousTurn,
    player = playerNickname,
    guessNumber = game.guessesUsed,
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

-- Save updated game, preserving TTL
if currentTTL > 0 then
    redis.call('SET', gameKey, cjson.encode(game), 'EX', currentTTL)
else
    redis.call('SET', gameKey, cjson.encode(game))
end

-- Return result
local result = {
    success = true,
    index = index,
    type = cardType,
    word = game.words[luaIndex],
    redScore = game.redScore,
    blueScore = game.blueScore,
    currentTurn = game.currentTurn,
    guessesUsed = game.guessesUsed,
    guessesAllowed = game.guessesAllowed,
    turnEnded = turnEnded,
    gameOver = game.gameOver,
    winner = game.winner,
    endReason = endReason
}

if game.gameOver then
    result.allTypes = game.types
end

return cjson.encode(result)
