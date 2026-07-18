# Dockerfile — dashboard (React + Vite)
#
# Multi-stage: the build stage compiles the Vite app (needs Node +
# devDependencies), the final stage only needs nginx to serve the
# static output. Keeps the shipped image small and free of any
# Node/npm tooling.

FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# The dashboard is a client-side app -- this env var gets baked into
# the built JS bundle at build time (Vite's import.meta.env behavior),
# so it must point at wherever the API will be reachable FROM THE
# BROWSER, not from inside the Docker network. Defaults to the
# backend's host-published port, which is what docker-compose.yml
# passes in.
ARG VITE_API_BASE=http://localhost:3000
ENV VITE_API_BASE=$VITE_API_BASE

RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
