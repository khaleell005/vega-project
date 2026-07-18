/**
 * migrate.ts — Runs `prisma db push` to sync schema to the database.
 * Used in the Dockerfile CMD to auto-apply schema on startup.
 */

import { execSync } from "child_process";

try {
  console.log("[migrate] Running prisma db push...");
  execSync("npx prisma db push --accept-data-loss", {
    stdio: "inherit",
  });
  console.log("[migrate] Schema synced successfully.");
} catch (err) {
  console.error("[migrate] Failed:", (err as Error).message);
  process.exit(1);
}
