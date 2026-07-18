-- rateLimit.lua — Atomic fixed-window rate limiter.
--
-- Why Lua?
--   If we did this as separate Redis commands from Node (GET, check, INCR),
--   two concurrent requests from two different service instances could both
--   read the count BEFORE either one increments it -- both would "pass" even
--   if only one slot was left. Redis runs Lua scripts atomically (single-
--   threaded, no other command can interleave), so this whole check-and-
--   increment happens as one indivisible step no matter how many instances
--   are hammering Redis at once. This is what makes the limiter correct
--   under concurrency/race conditions.
--
-- Arguments:
--   KEYS[1] = the Redis key for this client's current window,
--             e.g. "ratelimit:client-a:202607171031"
--   ARGV[1] = the client's limit for this window (e.g. 100)
--   ARGV[2] = window length in seconds (e.g. 60)
--
-- Returns: { allowed (1 or 0), current_count, limit }
--
-- Key lifecycle:
--   - Created on first request with SET ... EX (auto-expires after window)
--   - Incremented on each subsequent allowed request
--   - No manual cleanup needed -- Redis TTL handles garbage collection

local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window_seconds = tonumber(ARGV[2])

local current = redis.call("GET", key)

if current == false then
  -- First request in this window: initialize the counter and set its expiry
  -- so it auto-cleans (no separate cron/cleanup job needed). The EX flag
  -- ensures the key disappears after the window ends.
  redis.call("SET", key, 1, "EX", window_seconds)
  return { 1, 1, limit }
end

current = tonumber(current)

if current < limit then
  -- Below the limit: increment and allow. INCR is atomic and returns the
  -- new value, so we get the updated count in one command.
  local new_count = redis.call("INCR", key)
  return { 1, new_count, limit }
else
  -- At or above the limit: deny without incrementing. This way the counter
  -- accurately reflects the number of ALLOWED requests, not total attempts.
  return { 0, current, limit }
end
