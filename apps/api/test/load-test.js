/**
 * load-test.js — Proves the /check endpoint stays under the latency target.
 *
 * Uses autocannon with 50 concurrent connections for 10 seconds.
 * Fails if p99 latency exceeds the target or any errors occur.
 *
 * Usage:  npm start (terminal 1)  →  npm run loadtest (terminal 2)
 * Override target: LOAD_TEST_P99_TARGET_MS=10 npm run loadtest
 */

const autocannon = require("autocannon");
const os = require("os");

const TARGET_URL = process.env.LOAD_TEST_URL || "http://localhost:3000/check";
const DURATION_SECONDS = 10;
const CONNECTIONS = 50;
const P99_TARGET_MS = parseInt(process.env.LOAD_TEST_P99_TARGET_MS || "5", 10);

async function run() {
  console.log(`Load testing ${TARGET_URL}`);
  console.log(`${CONNECTIONS} connections for ${DURATION_SECONDS}s (${os.cpus().length} cores)\n`);

  const result = await autocannon({
    url: TARGET_URL,
    connections: CONNECTIONS,
    duration: DURATION_SECONDS,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientId: "load-test-client" }),
  });

  console.log(autocannon.printResult(result));

  const p99 = result.latency.p99;
  console.log(`\np99 latency: ${p99}ms (target: <${P99_TARGET_MS}ms)`);

  if (p99 > P99_TARGET_MS) {
    console.error(`FAILED: p99 ${p99}ms exceeds target of ${P99_TARGET_MS}ms`);
    process.exit(1);
  }

  if (result.errors > 0 || result.timeouts > 0) {
    console.error(`FAILED: ${result.errors} errors, ${result.timeouts} timeouts`);
    process.exit(1);
  }

  console.log("PASSED: latency and reliability within target.");
}

run().catch((err) => {
  console.error("Load test failed to run:", err.message);
  process.exit(1);
});
