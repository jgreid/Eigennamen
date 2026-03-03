-- atomicPersistGameState.lua
-- Description: Atomically saves game state AND updates room status to 'playing',
-- preventing divergence if either operation fails independently.
--
-- KEYS[1]: Game key (e.g., room:ABC123:game)
-- KEYS[2]: Room key (e.g., room:ABC123)
-- KEYS[3]: Players set key (e.g., room:ABC123:players)
-- ARGV[1]: Game state JSON
-- ARGV[2]: TTL (seconds)
--
-- Returns: 'OK' on success, 'NO_ROOM' if room not found

local gameKey = KEYS[1]
local roomKey = KEYS[2]
local playersKey = KEYS[3]
local gameJson = ARGV[1]
local ttl = tonumber(ARGV[2])

-- Verify room exists before writing game state
local roomData = redis.call('GET', roomKey)
if not roomData then
    return 'NO_ROOM'
end

-- Decode room, update status
local ok, room = pcall(cjson.decode, roomData)
if not ok then return 'NO_ROOM' end
room.status = 'playing'

-- Write game state + room status + refresh players TTL atomically
redis.call('SET', gameKey, gameJson, 'EX', ttl)
redis.call('SET', roomKey, cjson.encode(room), 'EX', ttl)
redis.call('EXPIRE', playersKey, ttl)

return 'OK'
