-- rateLimit.lua — Atomic fixed-window rate limiter.
--
-- Runs atomically in Redis (no interleaving). Single EVAL = one round-trip.
--
-- KEYS[1] = ratelimit:{clientId}:{windowBucket}
-- ARGV[1] = client's per-minute limit
-- ARGV[2] = window length in seconds
--
-- Returns: { allowed (1/0), current_count, limit }

local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window_seconds = tonumber(ARGV[2])

local current = redis.call("GET", key)

if current == false then
  -- First request: set counter with auto-expiry.
  redis.call("SET", key, 1, "EX", window_seconds)
  return { 1, 1, limit }
end

current = tonumber(current)

if current < limit then
  local new_count = redis.call("INCR", key)
  return { 1, new_count, limit }
else
  -- At limit: deny without incrementing (counter reflects allowed requests).
  return { 0, current, limit }
end
