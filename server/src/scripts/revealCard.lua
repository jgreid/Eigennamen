local gameKey = KEYS[1]
local index = tonumber(ARGV[1])
local timestamp = tonumber(ARGV[2])
local playerNickname = ARGV[3]
local maxHistoryEntries = tonumber(ARGV[4])
-- Bug #4 fix: Add player team parameter for turn validation
local playerTeam = ARGV[5]

-- Defense-in-depth: Validate index bounds (0-24 for 25-card board)
-- JS already validates, but Lua should also check to prevent any bypass
local BOARD_SIZE = 25
if index == nil or index < 0 or index >= BOARD_SIZE then
    return cjson.encode({error = 'INVALID_INDEX'})
end

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
local isDuet = game.gameMode == 'duet'

-- Determine card type (Duet mode uses perspective-based types)
local cardType
if isDuet and previousTurn == 'blue' and game.duetTypes then
    cardType = game.duetTypes[luaIndex]
else
    cardType = game.types[luaIndex]
end

-- Execute reveal
game.revealed[luaIndex] = true

if isDuet then
    -- Duet mode: team-colored cards increment greenFound
    if cardType == 'red' or cardType == 'blue' then
        game.greenFound = (game.greenFound or 0) + 1
        if previousTurn == 'red' then
            game.redScore = game.redScore + 1
        else
            game.blueScore = game.blueScore + 1
        end
    end
else
    -- Classic/Blitz mode scoring
    if cardType == 'red' then
        game.redScore = game.redScore + 1
    elseif cardType == 'blue' then
        game.blueScore = game.blueScore + 1
    end
end
game.guessesUsed = (game.guessesUsed or 0) + 1

-- Determine outcome
local turnEnded = false
local endReason = cjson.null

if isDuet then
    -- Duet mode outcome logic
    if cardType == 'assassin' then
        game.gameOver = true
        game.winner = cjson.null  -- No winner in duet (cooperative loss)
        endReason = 'assassin'
        turnEnded = true
    elseif (game.greenFound or 0) >= (game.greenTotal or 15) then
        game.gameOver = true
        game.winner = 'red'  -- Cooperative win
        endReason = 'completed'
        turnEnded = true
    elseif cardType == 'neutral' then
        game.timerTokens = math.max((game.timerTokens or 0) - 1, 0)
        if game.timerTokens <= 0 then
            game.gameOver = true
            game.winner = cjson.null
            endReason = 'timerTokens'
            turnEnded = true
        else
            -- Switch turn on neutral
            if previousTurn == 'red' then
                game.currentTurn = 'blue'
            else
                game.currentTurn = 'red'
            end
            game.currentClue = cjson.null
            game.guessesUsed = 0
            game.guessesAllowed = 0
            turnEnded = true
        end
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
else
    -- Classic/Blitz mode outcome logic
    if cardType == 'assassin' then
        game.gameOver = true
        if previousTurn == 'red' then
            game.winner = 'blue'
        else
            game.winner = 'red'
        end
        endReason = 'assassin'
        turnEnded = true
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

-- Include duet-specific fields
if isDuet then
    result.timerTokens = game.timerTokens
    result.greenFound = game.greenFound
    if game.gameOver and game.duetTypes then
        result.allDuetTypes = game.duetTypes
    end
end

return cjson.encode(result)
