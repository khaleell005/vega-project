/**
 * db/migrate.ts — Standalone database migration script.
 *
 * Runs `prisma db push` to synchronize the Prisma schema with the database.
 * This is a "push" migration (not a "migrate dev" migration) — it applies
 * schema changes directly without generating a migration file. The
 * `--accept-data-loss` flag is required because Prisma may need to drop
 * columns or tables to match the schema.
 *
 * Usage:
 *   npm run migrate        — runs this script
 *   Also runs automatically on Docker startup (see Dockerfile CMD)
 *
 * Why `db push` instead of `migrate dev`:
 *   For this project (a service, not a library), we want the schema to
 *   auto-sync on startup. `db push` is idempotent and safe to run
 *   repeatedly — it's the right tool for deployment-time migrations.
 */

import { execSync } from "child_process";
import path from "path";
import prisma from "../lib/prisma";

async function migrate(): Promise<void> {
  console.log("[migrate] applying Prisma schema to database...");

  execSync("npx prisma db push --accept-data-loss --url \"$DATABASE_URL\"", {
    stdio: "inherit",
    // Navigate from src/db/ to apps/api/ (two levels up) so `npx prisma`
    // finds the prisma/ directory and schema.prisma at the project root.
    cwd: path.join(__dirname, "..", ".."),
  });

  console.log("[migrate] done.");
}

migrate()
  .then(() => prisma.$disconnect())
  .catch(async (err: Error) => {
    console.error("[migrate] failed:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
