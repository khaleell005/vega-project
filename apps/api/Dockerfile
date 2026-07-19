# Dockerfile — Rate Limiter API (pnpm monorepo)
#
# Build context: repo root (docker-compose sets this).
# Uses pnpm for dependency management with workspace hoisting.

FROM node:20-alpine

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace config for dependency resolution.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy only package.json files for install layer cache.
COPY apps/api/package.json ./apps/api/

# Install production deps only (workspace-aware).
RUN pnpm install --frozen-lockfile --prod --filter @rate-limiter/api...

# Copy Prisma schema and generate client.
COPY apps/api/prisma ./apps/api/prisma
RUN cd apps/api && npx prisma generate

# Copy app source.
COPY apps/api/tsconfig.json ./apps/api/
COPY apps/api/src ./apps/api/src

EXPOSE 3000

CMD ["sh", "-c", "cd apps/api && npx prisma db push --accept-data-loss --url \"$DATABASE_URL\" && npx tsx src/server.ts"]
