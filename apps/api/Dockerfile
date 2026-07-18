# =============================================================================
# Dockerfile — Rate Limiter API (TypeScript)
# =============================================================================
#
# Builds the backend API as a single Docker image. The app runs via `tsx`
# (TypeScript execution) directly — no build step needed. This simplifies
# the Dockerfile and keeps the image small.
#
# Build:  docker build -t rate-limiter-app .
# Run:    docker compose up --build (preferred — brings up the full stack)
#
# Multi-stage optimization: not used here because tsx runs TS directly.
# If you want a smaller image (no TypeScript tooling), switch to tsc
# compilation in a build stage and copy only the dist/ output.
# =============================================================================

# Use Node.js 20 Alpine for a small, production-ready base image.
FROM node:20-alpine

WORKDIR /app

# Install production dependencies first (cached layer — only rebuilds
# when package.json or package-lock.json changes).
COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps

# Copy Prisma schema and generate the Prisma Client.
# This must happen before the app source is copied, because prisma generate
# reads the schema file and produces node_modules/@prisma/client.
COPY prisma ./prisma

# Copy TypeScript config and application source.
COPY tsconfig.json ./
COPY src ./src

# Generate Prisma Client from the schema.
# This creates the typed query builder used by analytics.ts, requestLogger.ts, etc.
RUN npx prisma generate

# Expose the API port (documentary — actual port mapping is in docker-compose.yml).
EXPOSE 3000

# Startup command:
#   1. Run `prisma db push` to sync the schema with the database.
#      `--accept-data-loss` is required because Prisma may need to drop
#      columns/tables to match the schema. This is safe for this project
#      because the schema is the source of truth.
#   2. Start the API server via tsx (TypeScript execution, no compilation).
#      The DATABASE_URL env var is injected by docker-compose.yml.
CMD ["sh", "-c", "npx prisma db push --accept-data-loss --url \"$DATABASE_URL\" && npx tsx src/server.ts"]
