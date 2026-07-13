-- submitClue.lua
-- Description: Atomically records a spymaster's clue for the current turn.
--   Sets currentClue, resets the guess counter, sets guessesAllowed, and
--   appends the clue to clues[] and history[]. Does NOT change scores, the
--   board, or whose turn it is — it only governs WHO may write currentClue.
--
-- KEYS[1]: Game key (e.g., `room:ABC123:game`)
-- ARGV[1]: Clue word (already sanitized/validated by the caller)
-- ARGV[2]: Clue number (integer >= -1; -1 is the unlimited "U" sentinel, 0 the anti-clue)
-- ARGV[3]: Spymaster nickname
-- ARGV[4]: Expected current turn team (race condition guard)
-- ARGV[5]: Timestamp (ms)
-- ARGV[6]: Max history entries
-- ARGV[7]: Default TTL in seconds (applied when the key has no expiry)
--
-- Returns: JSON `{success:true, word, number, team, guessesAllowed}` or `{error:'CODE'}`

local gameKey = KEYS[1]
local word = ARGV[1]
local number = tonumber(ARGV[2])
local CLUE_NUMBER_MAX = 9
local CLUE_NUMBER_UNLIMITED = -1
if number == nil then number = 0 end
if number < CLUE_NUMBER_UNLIMITED then number = CLUE_NUMBER_UNLIMITED end
if number > CLUE_NUMBER_MAX then number = CLUE_NUMBER_MAX end
local spymaster = ARGV[3]
local expectedTeam = ARGV[4]
local timestamp = tonumber(ARGV[5])
local maxHistoryEntries = tonumber(ARGV[6])
if maxHistoryEntries == nil or maxHistoryEntries < 1 then maxHistoryEntries = 100 end
local defaultTtl = tonumber(ARGV[7])
if defaultTtl == nil or defaultTtl < 1 then defaultTtl = 86400 end

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

if game.paused then
    return cjson.encode({error = 'GAME_PAUSED'})
end

-- Validate the calling team matches current turn (prevents race condition)
if expectedTeam and expectedTeam ~= '' and game.currentTurn ~= expectedTeam then
    return cjson.encode({error = 'NOT_YOUR_TURN'})
end

-- One clue per turn: reject if a clue is already active this turn.
-- cjson decodes JSON null to the cjson.null sentinel, so compare against it.
if game.currentClue and game.currentClue ~= cjson.null then
    return cjson.encode({error = 'CLUE_ALREADY_GIVEN'})
end

-- Codenames convention: a clue number of N grants N+1 guesses.
-- 0 (anti-clue) and -1 (unlimited "U") both grant unlimited guesses --
-- matching the guessesAllowed=0 sentinel elsewhere.
local guessesAllowed
if number >= 1 then
    guessesAllowed = number + 1
else
    guessesAllowed = 0
end

game.currentClue = {
    team = game.currentTurn,
    word = word,
    number = number,
    spymaster = spymaster,
    timestamp = timestamp
}
game.guessesUsed = 0
game.guessesAllowed = guessesAllowed

-- Append to the running clue list
if not game.clues then
    game.clues = {}
end
table.insert(game.clues, {
    team = game.currentTurn,
    word = word,
    number = number,
    spymaster = spymaster,
    timestamp = timestamp
})

-- Add to history
if not game.history then
    game.history = {}
end
table.insert(game.history, {
    action = 'clue',
    team = game.currentTurn,
    word = word,
    number = number,
    guessesAllowed = guessesAllowed,
    spymaster = spymaster,
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

-- Save game, preserving TTL (or falling back to the caller-supplied default
-- TTL so the key never becomes permanent)
local saveTtl = currentTTL > 0 and currentTTL or defaultTtl
redis.call('SET', gameKey, cjson.encode(game), 'EX', saveTtl)

return cjson.encode({
    success = true,
    word = word,
    number = number,
    team = game.currentTurn,
    guessesAllowed = guessesAllowed
})
