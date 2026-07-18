# Global Rate Limiter as a Service

A High Availability rate limiter that sits in front of third-party APIs and enforces per-client quotas accurately across a cluster of instances, stays fast (single-digit milliseconds), fails safe if Redis/Postgres go down, logs every request without slowing the hot path, and ships a dashboard for real-time and historical usage with a live request log.

Built for the Vega IT Abuja Tech Challenge qualification task.

---

## Requirements Checklist

Every item below was implemented, tested, and verified.

- [ ] **Atomic rate limiting** — Lua script runs check-and-increment as a single Redis command; no race conditions under concurrency
- [ ] **Per-client quotas** — configurable limits per `clientId` (e.g. 100/min for `client-a`)
- [ ] **Cluster-safe** — multiple instances share the same Redis counters; atomicity holds across replicas
- [ ] **Single-digit millisecond latency** — hot path (`/check`) responds in <10ms under normal load
- [ ] **Circuit breaker with local fallback** — if Redis is down, falls back to in-memory counters; traffic is never blocked
- [ ] **Request logging (allowed + denied)** — every `/check` call is logged to Postgres, both 200 and 429 responses
- [ ] **Logging does not block the hot path** — DB writes are fire-and-forget (no `await`); Postgres outage doesn't slow responses
- [ ] **Analytics dashboard** — React SPA showing total/allowed/denied counts, average response time, and daily trend chart
- [ ] **Real-time request log** — dashboard polls the API every 4 seconds and displays a live table of recent requests (time, status, latency, source)
- [ ] **Range filtering** — analytics supports 10d, 15d, 30d ranges with zero-filled trend series
- [ ] **Redis caching layer** — analytics cached 30s, usage cached 5s; SCAN-based invalidation
- [ ] **Graceful shutdown** — handles SIGTERM/SIGINT; drains in-flight requests, disconnects Prisma + Redis
- [ ] **Database indexing** — composite indexes on `(client_id, created_at DESC)` and `(client_id, status, created_at DESC)`
- [ ] **Docker Compose stack** — `docker compose up --build` brings up Redis, Postgres, API, dashboard, and test client
- [ ] **Per-app Dockerfiles** — API, dashboard, and test client each have their own Dockerfile
- [ ] **Test client** — standalone HTML page for exercising the `/check` endpoint with single, burst, and sustained test modes
- [ ] **Client selector** — both dashboard and test client use a dropdown to switch between `client-a`, `client-b`, or a custom client ID
- [ ] **Unit tests** — race condition (300 concurrent reqs), fail-safe (simulated outage), analytics (seeded data)
- [ ] **Load test** — autocannon-based (50 connections, 10s, p99 latency check)
- [ ] **Detailed code comments** — every source file explains the why, not just the what
- [ ] **TypeScript strict mode** — backend and dashboard fully typed

---

## 1. Prerequisites

- **Docker** and **Docker Compose** (this is the only requirement if you're running everything via Compose — see Section 2)
- For running things individually outside Docker: **Node.js 18+**, a local **Redis**, and a local **Postgres**

## 2. Run everything with one command

```bash
docker compose up --build
```

This brings up five services:

| Service | What | Host port (default) |
|---|---|---|
| `redis` | Shared counter store + cache layer | 6379 |
| `postgres` | Durable request log + analytics | 5432 |
| `app` | The rate limiter API (TypeScript) | 3000 |
| `dashboard` | React dashboard (TypeScript + Vite) | 5173 |
| `test-client` | Standalone test page for exercising `/check` | 8080 |

Once it's up:
- **http://localhost:5173** — Dashboard (view usage, analytics, real-time request log)
- **http://localhost:8080** — Test client (fire requests against the API)
- **http://localhost:3000** — API directly (see Section 6 for endpoints)

The `app` service automatically applies the database migration on startup (safe to run repeatedly), so there's no separate setup step needed.

### If you already have Redis or Postgres running locally on the default ports

Create a `.env` file **next to `docker-compose.yml`** (this is a different `.env` from the one the Node app itself uses — Compose reads this one for port substitution) to remap the host ports:

```
POSTGRES_HOST_PORT=5433
REDIS_HOST_PORT=6380
APP_HOST_PORT=3000
DASHBOARD_HOST_PORT=5173
TEST_CLIENT_HOST_PORT=8080
```

Then run `docker compose up --build` again.

## 3. Running without Docker (local dev)

```bash
# Start Redis and Postgres however you prefer (Docker, Homebrew, etc.)

# API
cd apps/api
npm install
cp ../../.env.example .env        # edit PGHOST/PGPORT/etc. to match your local setup
npm run migrate
npm start                         # API on :3000

# Dashboard
cd ../dashboard
npm install
cp .env.example .env
npm run dev                       # dashboard on :5173

# Test client (no build needed — just open the HTML file)
open ../../test-client/index.html  # or double-click it in Finder
```

**Available scripts (from `apps/api/`):**

| Command | What it does |
|---|---|
| `npm start` | Runs the API via `tsx src/server.ts` |
| `npm run dev` | Runs the API with file watching (`tsx watch`) |
| `npm run typecheck` | TypeScript type checking (`tsc --noEmit`) |
| `npm run migrate` | Runs Prisma migrations |
| `npm test` | Runs the Jest test suite (race condition, fail-safe, analytics) |
| `npm run loadtest` | Load test with autocannon (requires server running separately) |

**Important:** `dotenv` does not error if `.env` is missing — it silently leaves environment variables unset and the app falls back to hardcoded defaults. Always confirm with `cat .env` after copying it.

## 4. Running the tests

### Unit tests (Jest)

```bash
# Requires Redis + Postgres running (either via Docker Compose or locally) and .env configured
npm test
```

This runs the full Jest suite with `--runInBand` (sequential execution to avoid Redis contention between tests):

**`test/raceCondition.test.ts`** — Atomicity verification
- Fires 300 concurrent `checkLimit()` calls against a 60/min limit
- Asserts **exactly 60 are allowed** — proves the Lua script's atomicity
- Fires 80 requests for each of 2 clients simultaneously
- Asserts each client gets exactly 60 — proves client isolation

**`test/failSafe.test.ts`** — Circuit breaker fallback
- Simulates a Redis outage by monkey-patching `redis.eval` to reject
- Asserts requests still get served with `source: "local-fallback"`
- Asserts the local fallback still enforces the 60/min limit
- Asserts Redis path resumes after restore

**`test/analytics.test.ts`** — Analytics aggregation
- Seeds 4 known rows (3 today, 1 twenty days ago)
- Asserts 10d range returns only today's 3 rows with correct avg
- Asserts 30d range returns all 4 rows
- Asserts trend series is zero-filled (11 points for 10d)
- Asserts unknown clients return clean zeros

### Load / performance test

```bash
npm start              # in one terminal
npm run loadtest        # in another
```

This fires 50 concurrent connections for 10 seconds at `/check` using autocannon and reports latency percentiles. It fails (non-zero exit) if:
- p99 latency exceeds 20ms (configurable via `LOAD_TEST_P99_TARGET_MS`)
- Any connection errors or timeouts occur

The p99 target is hardware-sensitive — on a single-core machine, the load generator competes with the server for CPU time. Override with `LOAD_TEST_P99_TARGET_MS` if needed.

## 5. Verifying the edge cases manually

### Rate limiting works and is atomic

```bash
curl -X POST http://localhost:3000/check \
  -H "Content-Type: application/json" \
  -d '{"clientId":"client-a"}'
```

`client-a` has a 100/min limit (see `apps/api/src/config/clientConfig.ts`). Repeat past 100 in the same minute and you'll get `"allowed": false` with a `429` status.

### Both allowed and denied requests are logged

```bash
# Check the database — both statuses should appear:
docker exec rate-limiter-postgres-1 psql -U postgres -d rate_limiter \
  -c "SELECT status, COUNT(*) FROM requests GROUP BY status;"
```

### Fail-safe behavior (Redis outage)

```bash
docker stop rl-redis    # or whatever your Redis container/process is named
curl -X POST http://localhost:3000/check \
  -H "Content-Type: application/json" \
  -d '{"clientId":"client-a"}'
```

You should still get a `200`/`429` response (not an error or a hang), with `"source": "local-fallback"` instead of `"source": "redis"`. Restart Redis and the next request should show `"source": "redis"` again.

### Logging doesn't block the hot path

```bash
docker stop rl-postgres   # simulate a Postgres outage
curl -w "\ntime: %{time_total}s\n" -X POST http://localhost:3000/check \
  -H "Content-Type: application/json" \
  -d '{"clientId":"client-a"}'
```

The response should still come back in single-digit-to-low-double-digit milliseconds, even with Postgres completely down — the log write fails silently in the background without affecting the response.

### Graceful shutdown

```bash
docker logs -f rate-limiter-app-1   # watch logs
# In another terminal:
docker kill --signal=SIGTERM rate-limiter-app-1
# You should see:
#   [SIGTERM] received, shutting down gracefully...
#   [shutdown] HTTP server closed
#   [shutdown] Prisma disconnected
#   [shutdown] Redis disconnected
```

### Analytics with range filter

```bash
curl "http://localhost:3000/analytics/client-a?range=10d"
curl "http://localhost:3000/analytics/client-a?range=30d"
```

Returns total/allowed/denied counts, average response time, and a zero-filled daily trend array for charting.

### Real-time request log

```bash
curl "http://localhost:3000/requests/client-a?limit=10"
```

Returns the 10 most recent requests for `client-a` (newest first), each with `id`, `status`, `responseTimeMs`, `source`, and `createdAt`. This is the same data the dashboard's "Recent requests" section polls every 4 seconds.

## 6. API reference

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/check` | `{ "clientId": string }` → is this request allowed? Returns `{ allowed, clientId, count, limit, source }` |
| `GET` | `/usage/:clientId` | Current window's live count, read-only (no increment) — used by the dashboard |
| `GET` | `/analytics/:clientId?range=10d\|15d\|30d` | Usage summary + zero-filled daily trend |
| `GET` | `/requests/:clientId?limit=50` | Recent request log (newest first, max 200) — powers the dashboard's real-time log |
| `GET` | `/health` | Liveness check |

**Response headers:**
- `X-Response-Time-Ms` — latency of the rate-limit check in milliseconds (on `/check`)

## 7. Project structure

```
rate-limiter/
├── docker-compose.yml         # 5-service stack (redis, postgres, app, dashboard, test-client)
├── .env                       # Local dev environment variables
├── .env.example               # Environment variable template
│
├── test-client/               # Standalone test page for exercising /check
│   ├── Dockerfile             # nginx:alpine serving static HTML
│   ├── index.html             # Single-file app: single, burst, and sustained test modes
│   └── README.md              # Usage instructions
│
└── apps/
    ├── api/                   # Rate limiter API (TypeScript + Express)
    │   ├── Dockerfile         # Node 20 Alpine + tsx (no build step)
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── jest.config.js
    │   ├── prisma/
    │   │   └── schema.prisma  # Request model with composite indexes
    │   ├── src/
    │   │   ├── server.ts              # Express API, routes, graceful shutdown
    │   │   ├── config/
    │   │   │   └── clientConfig.ts    # Per-client limits (hardcoded config)
    │   │   ├── services/
    │   │   │   ├── rateLimiter.ts     # Lua-based atomic check + circuit breaker + local fallback
    │   │   │   ├── requestLogger.ts   # Async request logging to Postgres via Prisma
    │   │   │   └── analytics.ts       # Aggregate + trend queries with Redis caching
    │   │   ├── lib/
    │   │   │   ├── redis.ts           # ioredis connection with retry strategy
    │   │   │   ├── prisma.ts          # Prisma client with PostgreSQL driver adapter
    │   │   │   └── cache.ts           # Redis cache utility (get/set/invalidation via SCAN)
    │   │   ├── lua/
    │   │   │   └── rateLimit.lua      # Atomic Redis Lua script (check + increment + TTL)
    │   │   └── db/
    │   │       └── migrate.ts         # Standalone migration script
    │   └── test/
    │       ├── raceCondition.test.ts  # Concurrent request atomicity test (300 reqs, 60 limit)
    │       ├── failSafe.test.ts       # Circuit breaker fallback test (simulated outage)
    │       ├── analytics.test.ts      # Analytics aggregation test (seeded data, range filters)
    │       └── load-test.js           # Autocannon load test (50 connections, 10s, p99 check)
    │
    └── dashboard/             # React SPA (TypeScript + Vite)
        ├── Dockerfile         # Multi-stage: Vite build + nginx serve
        ├── package.json
        ├── vite.config.ts
        ├── index.html
        └── src/
            ├── main.tsx           # Dashboard entry point
            ├── App.tsx            # Main layout: client selector, gauge, stats, trend, request log
            ├── api.ts             # Typed API client (fetchUsage, fetchAnalytics, fetchRequests)
            └── components/
                ├── QuotaGauge.tsx     # Visual gauge bar (safe/warn/danger states)
                ├── StatCard.tsx       # Summary stat display card
                ├── RangeFilter.tsx    # 10d/15d/30d range selector
                ├── TrendChart.tsx     # Recharts area chart with tooltip
                └── RequestLog.tsx     # Real-time request log table (auto-polls every 4s)
```

## 8. Test client

The test client (`test-client/index.html`) is a standalone HTML page for manually exercising the rate limiter. It runs directly in the browser — no build step, no dependencies.

### Accessing it

| Method | URL |
|---|---|
| Via Docker Compose | http://localhost:8080 |
| Opening the file directly | `open test-client/index.html` in Finder |

### Test modes

| Mode | What it does |
|---|---|
| **Single request** | Fires one `POST /check` call. Shows allowed/denied, count/limit, latency, and source. |
| **Burst test** | Fires N concurrent requests via `Promise.all`. Reports how many were allowed vs. denied, plus p50/p99 latency percentiles. Good for confirming the limit holds exactly under concurrency. |
| **Sustained test** | Fires requests at a steady rate (e.g. 20/sec) for a set duration. Shows a live per-second sparkline chart. Good for watching the quota window reset — denied requests flip back to allowed once a new minute starts. |

### Client selector

The test client has a **Client** dropdown with three options:
- **client-a** (100/min limit) — selected by default
- **client-b** (5000/min limit)
- **Custom...** — reveals a text input for any other client ID

Select the same client in both the test client and the dashboard to see requests appear in the dashboard's "Recent requests" log.

### Request log

Every request fired from any of the three modes is logged in the **Request log** table at the bottom of the page. Shows the 200 most recent requests, newest first, with:
- **Time** — when the request was fired
- **Mode** — single, burst, or sustained
- **Client** — the client ID used
- **Result** — allowed, denied, or error
- **Count/Limit** — current count vs. the client's limit
- **Latency** — round-trip time in milliseconds
- **Source** — redis, local-fallback, or error message

## 9. Dashboard real-time request log

The dashboard includes a **"Recent requests"** section at the bottom that displays a live table of the most recent requests for the selected client.

### How it works

- The dashboard polls `GET /requests/:clientId?limit=50` every 4 seconds
- Results are displayed in a scrollable table with sticky headers
- Each row shows: **Time**, **Status** (allowed/denied badge), **Latency**, and **Source**
- A **Refresh** button allows manual updates
- The log updates automatically when you switch clients

### Configuration

- Polling interval: 4 seconds (defined as `POLL_MS` in `apps/dashboard/src/App.tsx`)
- Default request limit: 50 (configurable via the `limit` query parameter)
- Max limit: 200 (capped server-side to prevent excessive queries)

## 10. Key design decisions

### TypeScript (strict mode)
The entire backend (`apps/api/src/`) and dashboard (`apps/dashboard/src/`) are written in TypeScript with strict mode. The backend runs via `tsx` (no build step), and the dashboard is compiled by Vite.

### Atomic rate limiting via Lua
The core rate check (`rateLimit.lua`) runs as a single atomic Redis command. No race conditions are possible even under extreme concurrency across multiple service instances. Verified by `apps/api/test/raceCondition.test.ts` (300 concurrent requests against a 60/min limit).

### Circuit breaker with local fallback
If Redis becomes unavailable, `opossum` opens the circuit and the rate limiter falls back to per-process in-memory counters. Limits become approximate during the outage, but traffic is never blocked. Verified by `apps/api/test/failSafe.test.ts`.

### Redis caching layer
- **Analytics queries** cached for 30 seconds (avoids repeated heavy Postgres aggregation)
- **Usage reads** cached for 5 seconds (balances freshness vs. Redis load)
- **Request log** not cached — freshness matters more than performance for the live log
- Cache invalidated via SCAN-based iteration (non-blocking, safe under load)

### Both allowed and denied requests are logged
Every `/check` call — whether allowed (200) or denied (429) — is logged to Postgres. This ensures analytics and billing data is complete and accurate.

### Graceful shutdown
The server handles `SIGTERM`/`SIGINT`: drains in-flight requests, disconnects Prisma, disconnects Redis, then exits cleanly.

### Database indexing
Two composite indexes on the `requests` table:
- `(client_id, created_at DESC)` — supports the main analytics query and request log
- `(client_id, status, created_at DESC)` — supports filtered counts (allowed vs. denied)

### Fire-and-forget logging
The request logger (`requestLogger.ts`) is called without `await` from the `/check` handler. This means the database write never blocks the response. If Postgres is down, the user still gets their fast answer — the log failure is silently swallowed. This is critical for maintaining single-digit millisecond latency on the hot path.

### Fail-open design
Every external dependency (Redis, Postgres, cache) is wrapped in try/catch with graceful degradation:
- Redis down → local in-memory fallback (approximate limits)
- Postgres down → request still allowed, log silently dropped
- Cache down → query Postgres directly (slower but correct)
