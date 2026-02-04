local gameKey = KEYS[1]
local team = ARGV[1]
local clueWord = ARGV[2]
local clueNumber = tonumber(ARGV[3])
local spymasterNickname = ARGV[4]
local timestamp = tonumber(ARGV[5])
local maxHistoryEntries = tonumber(ARGV[6])
local boardSize = tonumber(ARGV[7])
local maxClues = tonumber(ARGV[8]) or 100  -- Default to 100 if not provided

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
if game.currentTurn ~= team then
    return cjson.encode({error = 'NOT_YOUR_TURN'})
end
if game.currentClue then
    return cjson.encode({error = 'CLUE_ALREADY_GIVEN'})
end

-- Validate clue number
if clueNumber < 0 or clueNumber > boardSize then
    return cjson.encode({error = 'INVALID_NUMBER'})
end

-- Validate clue word is not on the board (case-insensitive)
local normalizedClue = string.upper(clueWord)
for i, word in ipairs(game.words) do
    local normalizedWord = string.upper(word)
    -- Exact match
    if normalizedClue == normalizedWord then
        return cjson.encode({error = 'WORD_ON_BOARD', word = word})
    end
    -- Clue contains board word
    if string.len(normalizedWord) > 1 and string.find(normalizedClue, normalizedWord, 1, true) then
        return cjson.encode({error = 'CONTAINS_BOARD_WORD', word = word})
    end
    -- Board word contains clue
    if string.len(normalizedClue) > 1 and string.find(normalizedWord, normalizedClue, 1, true) then
        return cjson.encode({error = 'BOARD_CONTAINS_CLUE', word = word})
    end
end

-- Create and set clue
local clue = {
    team = team,
    word = string.upper(clueWord),
    number = clueNumber,
    spymaster = spymasterNickname,
    timestamp = timestamp
}

game.currentClue = clue
-- 0 means unlimited guesses, otherwise number + 1
game.guessesAllowed = clueNumber == 0 and 0 or clueNumber + 1
game.guessesUsed = 0

if not game.clues then
    game.clues = {}
end
table.insert(game.clues, clue)

-- Performance fix: Cap clues array to prevent unbounded memory growth
if #game.clues > maxClues then
    local newClues = {}
    for i = #game.clues - maxClues + 1, #game.clues do
        table.insert(newClues, game.clues[i])
    end
    game.clues = newClues
end

-- Add to history
if not game.history then
    game.history = {}
end
table.insert(game.history, {
    action = 'clue',
    team = team,
    word = clue.word,
    number = clueNumber,
    guessesAllowed = game.guessesAllowed,
    spymaster = spymasterNickname,
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
    team = team,
    word = clue.word,
    number = clueNumber,
    spymaster = spymasterNickname,
    guessesAllowed = game.guessesAllowed,
    timestamp = timestamp
})
