/**
 * prisma.ts — Prisma client singleton.
 *
 * Creates a single PrismaClient instance that connects to PostgreSQL
 * using the @prisma/adapter-pg driver adapter (the newer Prisma approach
 * that uses the pg driver directly instead of Prisma's built-in engine).
 *
 * Connection string comes from the DATABASE_URL environment variable,
 * which is set in docker-compose.yml for container mode, or in .env
 * for local development.
 */

import dotenv from "dotenv";
dotenv.config();

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

export default prisma;
