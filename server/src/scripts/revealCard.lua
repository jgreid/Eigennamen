local gameKey = KEYS[1]
local index = tonumber(ARGV[1])
local timestamp = tonumber(ARGV[2])
local playerNickname = ARGV[3]
local maxHistoryEntries = tonumber(ARGV[4])
if maxHistoryEntries == nil or maxHistoryEntries < 1 then maxHistoryEntries = 100 end
-- Bug #4 fix: Add player team parameter for turn validation
local playerTeam = ARGV[5]
-- Default TTL applied when the key has no expiry (-1) to prevent permanent keys
local defaultTtl = tonumber(ARGV[6])
if defaultTtl == nil or defaultTtl < 1 then defaultTtl = 86400 end

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

local ok, game = pcall(cjson.decode, gameData)
if not ok then
    return cjson.encode({error = 'CORRUPTED_DATA'})
end

-- Validate preconditions
if game.gameOver then
    return cjson.encode({error = 'GAME_OVER'})
end

-- Reject reveals on a paused game atomically (defense in depth). The handler's
-- paused check reads a cached game and can be stale; submitClue.lua guards this
-- too. Prevents a bot or a racing client from acting while the game is paused.
if game.paused then
    return cjson.encode({error = 'GAME_PAUSED'})
end

-- Bug #4 fix: Re-validate turn in Lua script (defense in depth)
if playerTeam and playerTeam ~= '' and game.currentTurn ~= playerTeam then
    return cjson.encode({error = 'NOT_YOUR_TURN'})
end

-- guessesAllowed=0 is the initial "no clue yet" state, but it's also the
-- sentinel submitClue.lua sets for a real clue-number-0 ("unlimited guesses"),
-- so guessesAllowed alone can't tell the two apart. Require an actual clue to
-- be active (defense in depth — the socket handler checks this too) so a
-- reveal can never happen before any clue was ever given this turn.
if not game.currentClue or game.currentClue == cjson.null then
    return cjson.encode({error = 'NO_CLUE_GIVEN'})
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
local isMatch = game.gameMode == 'match'

-- Determine card type (Duet mode uses perspective-based types)
local cardType
if isDuet and previousTurn == 'blue' and game.duetTypes then
    cardType = game.duetTypes[luaIndex]
else
    cardType = game.types[luaIndex]
end

-- Defense in depth (N9): a truncated types/duetTypes array yields a nil card
-- type. Reject BEFORE mutating — otherwise the reveal + guessesUsed increment
-- still commit, but the result omits `type` and fails revealResultSchema, so the
-- op throws AFTER mutating and clients are left one reveal behind with no
-- broadcast. The TS-side gameStateSchema length refine catches this on read too;
-- this guards the direct-Lua path a non-getGame caller could take.
if cardType == nil or cardType == cjson.null then
    return cjson.encode({error = 'CORRUPTED_DATA'})
end

-- Execute reveal
game.revealed[luaIndex] = true

-- Track which team revealed this card (for match mode scoring)
if game.revealedBy then
    game.revealedBy[luaIndex] = previousTurn
end

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
    -- Classic mode scoring
    if cardType == 'red' then
        game.redScore = game.redScore + 1
    elseif cardType == 'blue' then
        game.blueScore = game.blueScore + 1
    end
end
game.guessesUsed = (game.guessesUsed or 0) + 1

-- Capture this reveal's ordinal NOW, before the outcome blocks below reset
-- game.guessesUsed to 0 on any turn switch. Using the post-reset value in the
-- history insert recorded every turn-ending reveal as guessNumber 0 (N6).
local guessNumber = game.guessesUsed

-- Match mode: accumulate card score into match score immediately
if isMatch and game.cardScores then
    local cs = game.cardScores[luaIndex] or 0
    if cs ~= 0 then
        if previousTurn == 'red' then
            game.redMatchScore = (game.redMatchScore or 0) + cs
        else
            game.blueMatchScore = (game.blueMatchScore or 0) + cs
        end
    end
end

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

    -- Cooperative unreachable-win guard (A6): a card that is an agent from one
    -- side but revealed as a bystander from the other is permanently consumed;
    -- once the greens still findable drop below greenTotal the co-op win is
    -- impossible. End as a loss with a clear reason rather than burning tokens on
    -- a mathematically dead board. Mirrors revealEngine.isDuetWinUnreachable.
    if not game.gameOver then
        local reachable = game.greenFound or 0
        for i = 1, #game.types do
            if not game.revealed[i] then
                local agentForA = game.types[i] == 'red' or game.types[i] == 'blue'
                local agentForB = game.duetTypes and (game.duetTypes[i] == 'red' or game.duetTypes[i] == 'blue')
                if agentForA or agentForB then
                    reachable = reachable + 1
                end
            end
        end
        if reachable < (game.greenTotal or 15) then
            game.gameOver = true
            game.winner = cjson.null
            endReason = 'unreachable'
            turnEnded = true
        end
    end
elseif isMatch then
    -- Match mode outcome logic (same as Classic for now, but separated for extensibility)
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
else
    -- Classic mode outcome logic
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
    guessNumber = guessNumber,
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

-- Persist the authoritative end reason when the game ends, so game history can
-- distinguish a duet cooperative loss (timerTokens/unreachable) from a
-- completion instead of defaulting every non-assassin end to 'completed' (N7).
if game.gameOver and endReason ~= nil and endReason ~= cjson.null then
    game.endReason = endReason
end

-- Increment version
game.stateVersion = (game.stateVersion or 0) + 1

-- Save updated game, preserving TTL (or falling back to the caller-supplied
-- default TTL so the key never becomes permanent)
local saveTtl = currentTTL > 0 and currentTTL or defaultTtl
redis.call('SET', gameKey, cjson.encode(game), 'EX', saveTtl)

-- Return result. The nullable fields (winner, endReason) are OMITTED when they
-- have no value instead of being encoded as JSON null: real Redis's cjson
-- emits null for cjson.null, but Upstash's Lua emulation drops such fields, so
-- key-absence is the only "no value" encoding that round-trips identically on
-- every Redis implementation. revealResultSchema (luaGameOps.ts) maps a
-- missing key back to null.
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
    gameOver = game.gameOver
}
if game.winner ~= nil and game.winner ~= cjson.null then
    result.winner = game.winner
end
if endReason ~= nil and endReason ~= cjson.null then
    result.endReason = endReason
end

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

-- Include match mode fields
if isMatch and game.cardScores then
    result.cardScore = game.cardScores[luaIndex]
    result.redMatchScore = game.redMatchScore or 0
    result.blueMatchScore = game.blueMatchScore or 0
end

return cjson.encode(result)
