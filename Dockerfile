# Build Stage
FROM node:20-alpine AS builder

WORKDIR /app

# Native build toolchain — argon2 + bcrypt compile from C/C++ on install.
# Without these, `pnpm install` aborts inside Alpine with cryptic
# `node-gyp` failures and Railway shows "Application failed to respond".
RUN apk add --no-cache python3 make g++ openssl libc6-compat

# Enable corepack for pnpm support
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Copy configuration and package manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/tsconfig.json ./apps/api/tsconfig.json
COPY apps/api/tsconfig.build.json ./apps/api/tsconfig.build.json
COPY apps/api/nest-cli.json ./apps/api/nest-cli.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/api-types/package.json ./packages/api-types/package.json
COPY packages/auth-core/package.json ./packages/auth-core/package.json
COPY packages/ws-events/package.json ./packages/ws-events/package.json
COPY packages/signage-design/package.json ./packages/signage-design/package.json

# Prisma schema must exist before `pnpm install` because the root
# postinstall hook runs `prisma generate`. Without these files the
# whole install bails with "Could not find Prisma Schema".
COPY packages/database/prisma ./packages/database/prisma

# Install dependencies (frozen lockfile to ensure deterministic builds)
RUN pnpm install --frozen-lockfile

# Copy shared packages source
COPY packages/ ./packages/

# Re-generate Prisma Client now that the full packages tree is present
RUN cd packages/database && npx prisma generate

# Build the three workspace packages BEFORE the API. The API's compiled
# JS does `require("@cms/api-types")` which resolves via package.json
# `main` to `dist/index.js`. Without this, Node tries to parse the raw
# `src/index.ts` at runtime and crashes with `Unexpected token 'export'`.
RUN cd packages/api-types && pnpm run build
RUN cd packages/auth-core && pnpm run build
RUN cd packages/ws-events && pnpm run build
# @cms/signage-design — the AI-template art-director engine the API imports
# (ai.service.ts / art-director.ts). Must be built BEFORE the API or tsc
# fails with TS2307 "Cannot find module '@cms/signage-design'".
RUN cd packages/signage-design && pnpm run build

# Copy API source
COPY apps/api/ ./apps/api/

# Build API
RUN cd apps/api && pnpm run build

# Stage 2: Production Runner
FROM node:20-alpine AS runner

WORKDIR /app

# Install OpenSSL for Prisma engine compatibility AND Chromium for the
# server-side URL renderer (proxy/renderer.service.ts). Puppeteer-core
# uses the system Chromium binary (no bundled browser download —
# that would add ~280MB; alpine's chromium-browser package is ~150MB
# and security-patched by the alpine maintainers).
#
# Font packages: Chromium needs at least one usable font family or
# rendered pages display tofu/empty boxes. ttf-freefont covers basic
# Latin; nss/freetype/harfbuzz are runtime requirements documented
# by the Puppeteer Alpine setup guide.
RUN apk add --no-cache \
    openssl \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto \
    ffmpeg
# ffmpeg: server-side video transcode in MediaOptimizationService. Signage
# video uploaded at phone bitrate (40MB+) is re-encoded to ~1080p H.264 so a
# screen isn't re-streaming tens of MB per loop. ~30MB added to the image.

# Tell Puppeteer where Chromium lives (it won't try to download its
# own bundled binary). Used by RendererService.launchBrowser.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Install pnpm for prod dependencies
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

ENV NODE_ENV=production

# Copy built output and manifests
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/ ./packages/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules

# Boot wrapper that runs `prisma migrate deploy` before booting the
# API. Kept in scripts/ so Railway's startCommand stays a one-liner
# and so the boot logic is easy to test locally with
# `docker run educms-api scripts/railway-start.sh`.
COPY --chmod=0755 scripts/railway-start.sh ./scripts/railway-start.sh

# Execute as unprivileged node user
USER node

EXPOSE 8080

# Default CMD — Railway overrides this via railway.json's startCommand
# (which calls scripts/railway-start.sh). Kept here as the safe
# fallback for `docker run` without an override.
CMD ["./scripts/railway-start.sh"]
