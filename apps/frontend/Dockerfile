#
# Multi-stage Dockerfile for Next.js (production, standalone output)
# - Builder installs deps, builds app
# - Runner uses minimal files from .next/standalone
#

FROM node:20-alpine AS base
WORKDIR /app

# 1) Dependencies layer
FROM base AS deps
ENV NODE_ENV=development
RUN apk add --no-cache libc6-compat python3 make g++ bash
WORKDIR /app
COPY package.json package-lock.json* ./
# Prefer clean, reproducible installs; fall back to install if lockfile is missing
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# 2) Builder layer
FROM base AS builder
ENV NODE_ENV=production
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_SCHEMA_MAPPER_BASE_URL
ARG NEXT_PUBLIC_WO_BASE_URL
ARG NEXT_PUBLIC_ORGANIZATION_ID
ARG NEXT_PUBLIC_DEEP_AGENTS_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_SCHEMA_MAPPER_BASE_URL=$NEXT_PUBLIC_SCHEMA_MAPPER_BASE_URL
ENV NEXT_PUBLIC_WO_BASE_URL=$NEXT_PUBLIC_WO_BASE_URL
ENV NEXT_PUBLIC_ORGANIZATION_ID=$NEXT_PUBLIC_ORGANIZATION_ID
ENV NEXT_PUBLIC_DEEP_AGENTS_BASE_URL=$NEXT_PUBLIC_DEEP_AGENTS_BASE_URL
RUN apk add --no-cache libc6-compat python3 make g++ bash
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Some repos don't have /public. Next.js build is fine without it, but our runner COPY expects it.
RUN mkdir -p public
# Ensure Next standalone output is generated
RUN npm run build

# 3) Runner layer
FROM node:20-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# Copy the Next.js standalone server and static assets
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

ENV PORT=3000
EXPOSE 3000
USER nextjs

# Use the standalone server produced by Next.js
CMD ["node", "server.js"]
