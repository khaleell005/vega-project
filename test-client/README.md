# Test Client

A standalone, zero-build HTML page for manually exercising the rate limiter — separate from the `dashboard/` app, which is for *viewing* usage. This is for *generating* traffic against `/check` and watching how the limiter responds.

## How to use it

Just open `index.html` directly in a browser (double-click it, or `open index.html` on Mac) — no `npm install`, no server needed for the page itself. It's a single self-contained file.

Point it at your running API (default `http://localhost:3000`) and a client ID, then:

- **Single request** — fires one `/check` call, shows the result immediately (allowed/denied, count/limit, latency, source).
- **Burst test** — fires N requests all at once (`Promise.all`), then reports how many were allowed vs. denied and latency percentiles. Good for confirming the limit holds exactly under concurrency (the same thing `test/raceCondition.test.js` proves programmatically).
- **Sustained test** — fires requests at a steady rate (e.g. 20/sec) for a set duration, with a live per-second bar chart. Good for watching the quota window actually reset — you'll see denied requests flip back to allowed once a new minute starts.
- **Request log** — every request fired from any of the three modes above, most recent first.

## Notes

- This talks directly to the API over HTTP, so it works regardless of whether your backend is the original JavaScript version or your TypeScript migration — it only depends on the `/check` endpoint's JSON contract (`allowed`, `count`, `limit`, `source`), not any internal implementation details.
- Requires the API's CORS headers to allow the page's origin — already enabled in `server.ts`/`server.js` (`Access-Control-Allow-Origin: *`), so this should work out of the box whether you open the file directly (`file://`) or serve it from a local dev server.
- Use a client ID from your `clientConfig` (e.g. `client-a`, `client-b`) to test real configured limits, or any other string to exercise the default fallback limit.
