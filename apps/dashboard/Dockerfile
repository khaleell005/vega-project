# Dockerfile — Dashboard (React + Vite, pnpm monorepo)
#
# Multi-stage: build stage compiles Vite, final stage serves static via nginx.

FROM node:20-alpine AS build

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace config.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy only package.json files.
COPY apps/dashboard/package.json ./apps/dashboard/

# Install all deps (workspace-aware, includes devDependencies for Vite build).
RUN pnpm install --frozen-lockfile --filter @rate-limiter/dashboard...

# Copy dashboard source.
COPY apps/dashboard/ ./apps/dashboard/

ARG VITE_API_BASE=http://localhost:3000
ENV VITE_API_BASE=$VITE_API_BASE

RUN cd apps/dashboard && pnpm run build

FROM nginx:alpine
COPY --from=build /app/apps/dashboard/dist /usr/share/nginx/html
EXPOSE 80
