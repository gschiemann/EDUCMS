# syntax=docker/dockerfile:1
#
# ── SEC-005 (2026-09-04) — THE RUNTIME IMAGE IS A PRODUCTION CLOSURE ──────
#
# The independent security assessment found the shipped container carrying
# 52 HIGH/CRITICAL advisories behind a `continue-on-error` Trivy step: CI
# was green while the image was red. A real local scan of the pre-fix image
# reproduced the number EXACTLY (52 = HIGH 50 + CRITICAL 2) and, crucially,
# said where they lived:
#
#     48 of 52  /root/.cache/node/corepack/v1/pnpm/9.0.0/**   (pnpm itself:
#               tar, brace-expansion, minimatch, cross-spawn, glob,
#               ip-address, pnpm)
#      2 of 52  /usr/local/lib/node_modules/npm/**            (pacote,
#               sigstore — npm as bundled in node:20-alpine)
#      2 of 52  /app/node_modules/.pnpm/**                    (deepmerge-ts
#               via @wdio/cli, js-yaml via eslintrc — BOTH devDependencies)
#
# So the fix was never "patch 52 packages". It was three structural facts:
#   (1) the runner had a PACKAGE MANAGER in it that nothing at runtime calls;
#   (2) the runner inherited node:20-alpine's bundled npm, also uncalled;
#   (3) the runner copied the BUILDER's node_modules — every devDependency
#       (eslint, jest, typescript, the nest/angular schematics) rode along.
#
# This file fixes all three. The final stage is assembled from a dedicated
# `proddeps` stage that only ever ran `pnpm install --prod`, plus the
# compiled `dist` output — no package manager, no dev toolchain, no source
# trees. See docs/research/2026-09-04-security-remediation/ for the
# before/after scan.
#
# ── WHAT MUST NOT REGRESS (CLAUDE.md "Deploy Reliability") ────────────────
# Every one of these has already broken a Railway deploy at least once:
#   • argon2 + bcrypt compile from C/C++ → the Alpine toolchain
#     (python3 make g++ openssl libc6-compat) must exist in EVERY stage that
#     runs `pnpm install`. That is now TWO stages, not one.
#   • the root `postinstall` runs `prisma generate` → the Prisma schema must
#     be on disk BEFORE `pnpm install`, in every installing stage.
#   • @cms/api-types, @cms/signage-design and @cms/scoreboard-cts resolve
#     via package.json `main` → `dist/index.js`; they must be BUILT before
#     the API, or the API crashes on `Unexpected token 'export'`.
#   • `scripts/railway-start.sh` executes the Prisma CLI on EVERY boot. It
#     used to have a `pnpm --filter @cms/database run db:deploy` last-resort
#     branch; this image no longer ships pnpm, so that branch is gone. The
#     replacement is STRONGER than a runtime fallback: the build now ASSERTS
#     the Prisma CLI, the generated client and the API entrypoint are all
#     present (see "BUILD-TIME BOOT ASSERTIONS" at the bottom). A missing
#     migrator now fails the BUILD instead of the 3am deploy.
#
# Base image is pinned BY DIGEST (SEC-005 required fix) — without it a scan
# result is not reproducible, because the tag can move between the run that
# was measured and the run that ships. This is the multi-arch INDEX digest
# for node:20-alpine, so it resolves on both the linux/amd64 CI runner and a
# linux/arm64 developer Mac; a single-platform digest would break one of
# them. Node v20.20.2 / Alpine 3.23.4 as of 2026-09-04.
#
# NOTE ON NODE 20.19: SEC-013 moved sanitize-html to 2.17.7, whose
# htmlparser2@12 is ESM-only and loads only through Node's `require(esm)`
# backport. Any replacement digest must therefore still be Node >= 20.19 —
# the runner's boot assertions catch a violation at build time, but know it
# before you pick the digest.
#
# To roll it forward:
#   docker buildx imagetools inspect node:20-alpine   # take "Digest:"
# Dependabot also opens a PR for this — see the `docker` block in
# .github/dependabot.yml.
#
# Interaction with ci.yml's "Pre-pull base image with retry" step: that step
# warms `node:20-alpine` by TAG. While the tag still points here, the pinned
# digest is served from that warm cache. Once the tag moves ahead of this
# pin, the pre-pull warms a different digest and this build pulls its own —
# one extra pull, no failure, and it self-heals the next time the pin is
# rolled.
ARG NODE_IMAGE=node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293

# ═══════════════════════════════════════════════════════════════════════
# Stage 1 — builder. Full dev toolchain; compiles TypeScript to dist/.
#           Nothing from this stage's node_modules reaches the runner.
# ═══════════════════════════════════════════════════════════════════════
FROM ${NODE_IMAGE} AS builder

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
COPY packages/signage-design/package.json ./packages/signage-design/package.json
COPY packages/scoreboard-cts/package.json ./packages/scoreboard-cts/package.json

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
# @cms/signage-design — the AI-template art-director engine the API imports
# (ai.service.ts / art-director.ts). Must be built BEFORE the API or tsc
# fails with TS2307 "Cannot find module '@cms/signage-design'".
RUN cd packages/signage-design && pnpm run build
# @cms/scoreboard-cts — CTS timing/serial parser the API imports (sports
# swim-timing-feed.ts / sports.service.ts). Must be built BEFORE the API or
# tsc fails with TS2305 "no exported member 'SwimTimingSnapshot'" (the exact
# red-Docker-build that shipped 2026-07-01 when this line was missing).
RUN cd packages/scoreboard-cts && pnpm run build

# Copy API source
COPY apps/api/ ./apps/api/

# Build API
RUN cd apps/api && pnpm run build

# ═══════════════════════════════════════════════════════════════════════
# Stage 2 — proddeps. The PRODUCTION dependency closure, and nothing else.
#
# A separate stage rather than `pnpm prune --prod` inside the builder, for
# two reasons. First, it is provably clean: this tree was never populated
# with devDependencies, so no prune bug, stale symlink or leftover
# .tsbuildinfo can survive into the runner. Second, BuildKit runs it
# CONCURRENTLY with the builder, so the second argon2 compile is close to
# free in wall-clock terms.
#
# The manifest set copied here is deliberately IDENTICAL to the builder's.
# `apps/web/package.json` is absent from both, which is what keeps the web
# app's dependency graph (next, react, playwright) out of this image
# entirely — do not "helpfully" add it.
# ═══════════════════════════════════════════════════════════════════════
FROM ${NODE_IMAGE} AS proddeps

WORKDIR /app

# Same native toolchain rule as the builder — argon2 is a PRODUCTION
# dependency, so it compiles here too. Removing this line reproduces the
# original Railway "Application failed to respond" failure exactly.
RUN apk add --no-cache python3 make g++ openssl libc6-compat

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/api-types/package.json ./packages/api-types/package.json
COPY packages/signage-design/package.json ./packages/signage-design/package.json
COPY packages/scoreboard-cts/package.json ./packages/scoreboard-cts/package.json

# Prisma schema before install — same reason as the builder (root
# postinstall → `prisma generate`). Also the schema + migrations the
# runner needs for `prisma migrate deploy`, so it is copied once here and
# carried into the final stage with the rest of packages/.
COPY packages/database/prisma ./packages/database/prisma

# `@cms/database` is entered through `main: index.js` (a CJS re-export of
# @prisma/client plus the AppRole constants). It is source, not build
# output, so it comes from the repo rather than from the builder's dist.
COPY packages/database/index.js ./packages/database/index.js

# THE production install. `--prod` drops every devDependency; the lockfile
# stays frozen so this resolves to the same versions CI verified.
#
# `prisma` (the CLI) survives this on purpose: it was moved from
# devDependencies to dependencies of @cms/database precisely because
# scripts/railway-start.sh runs `prisma migrate deploy` on every boot.
# If a future edit moves it back, the BUILD-TIME BOOT ASSERTIONS in the
# runner stage fail the build rather than letting production find out.
RUN pnpm install --frozen-lockfile --prod

# pnpm's content-addressable store and metadata caches are build-time
# artifacts. Nothing at runtime reads them, and they are pure attack
# surface + image weight in a production container.
RUN rm -rf /root/.cache /root/.local/share/pnpm /root/.npm /tmp/* \
    && find /app/node_modules -name "*.md" -delete 2>/dev/null || true

# ═══════════════════════════════════════════════════════════════════════
# Stage 3 — runner. Compiled output + production dependencies. No package
#           manager, no compiler, no source trees.
# ═══════════════════════════════════════════════════════════════════════
FROM ${NODE_IMAGE} AS runner

WORKDIR /app

# Install OpenSSL for Prisma engine compatibility AND Chromium for the
# server-side URL renderer (proxy/renderer.service.ts). Puppeteer-core
# uses the system Chromium binary (no bundled browser download —
# that would add ~280MB; alpine's chromium-browser package is
# security-patched by the alpine maintainers).
#
# CHROMIUM AND FFMPEG STAY. They are not "extra weight to trim": the
# renderer and the poster/PDF paths run in THIS image, and
# MediaOptimizationService shells out to `ffmpeg` to re-encode signage
# video. A slim image that silently loses them would break the renderer
# and every uploaded video — the SEC-005 remediation is about removing
# what nothing calls, not about removing what the product needs. (Neither
# contributed a single finding to the 52; the whole backlog was
# JavaScript tooling.)
#
# Font packages: Chromium needs at least one usable font family or
# rendered pages display tofu/empty boxes. ttf-freefont covers basic
# Latin; nss/freetype/harfbuzz are runtime requirements documented
# by the Puppeteer Alpine setup guide.
#
# `freetype-dev` was in this list and is now gone: it is the HEADERS +
# static-library package for building against freetype. Nothing in a
# runtime image compiles against it; `freetype` itself (kept) is the
# shared library Chromium actually loads.
RUN apk add --no-cache \
    openssl \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto \
    ffmpeg
# ffmpeg: server-side video transcode in MediaOptimizationService. Signage
# video uploaded at phone bitrate (40MB+) is re-encoded to ~1080p H.264 so a
# screen isn't re-streaming tens of MB per loop. ~30MB added to the image.

# Drop the package managers node:20-alpine bundles. Nothing in this image
# invokes npm, npx or yarn at runtime (verified: the only child processes the
# API spawns are `ffmpeg` and `gh`), npm's vendored pacote/sigstore accounted
# for 2 of the original 52 findings, and a package manager sitting in a
# production container is a live "fetch and execute arbitrary code" primitive
# for anyone who reaches RCE in the app. Node itself needs neither to run.
#
# NOT removed, and deliberately so: /usr/bin/python3. It arrives as a
# TRANSITIVE dependency of Chromium (chromium -> at-spi2-core -> python3,
# confirmed with `apk info --rdepends python3` in the built image), so
# deleting it would break the renderer's accessibility bus for ~25 MiB. It
# contributed zero findings to the scan.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
           /opt/yarn-v* /usr/local/bin/yarn /usr/local/bin/yarnpkg

# Tell Puppeteer where Chromium lives (it won't try to download its
# own bundled binary). Used by RendererService.launchBrowser.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

ENV NODE_ENV=production

# ── The production dependency closure (from proddeps, never the builder) ──
# Copied as whole trees so pnpm's relative symlinks (node_modules/.pnpm/…
# ← packages/*/node_modules/*) resolve exactly as they did at install time.
# `packages/` arrives from proddeps rather than the builder because that
# copy contains ONLY manifests, the Prisma schema/migrations, index.js and
# node_modules — no `src/`.
COPY --from=proddeps /app/node_modules ./node_modules
COPY --from=proddeps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=proddeps /app/packages ./packages

# ── Manifests the Node resolver reads at require() time ──
COPY --from=proddeps /app/package.json ./package.json
COPY --from=proddeps /app/apps/api/package.json ./apps/api/package.json

# ── Compiled output ONLY. No apps/api/src, no packages/*/src. ──
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/api-types/dist ./packages/api-types/dist
COPY --from=builder /app/packages/signage-design/dist ./packages/signage-design/dist
COPY --from=builder /app/packages/scoreboard-cts/dist ./packages/scoreboard-cts/dist

# Boot wrapper that runs `prisma migrate deploy` before booting the
# API. Kept in scripts/ so Railway's startCommand stays a one-liner
# and so the boot logic is easy to test locally with
# `docker run educms-api scripts/railway-start.sh`.
COPY --chmod=0755 scripts/railway-start.sh ./scripts/railway-start.sh

# ── BUILD-TIME BOOT ASSERTIONS ────────────────────────────────────────────
# Everything a boot cannot survive without, checked while it is still cheap
# to fail. Most of these were, at some point, the cause of a real failed
# deploy, and every one of them was previously only discoverable AT BOOT —
# CLAUDE.md's Deploy Reliability section is explicit that the docker-build
# smoke ran with SKIP_MIGRATE=true, so the migrate path was the one path CI
# never exercised. Asserting here turns each into a failed BUILD instead.
#
# These are cheap (sub-second) and they are the thing that makes the
# aggressive pruning above safe: if a future edit drops something the
# runtime needs, the build says so by name.
RUN set -eu; \
    test -x ./packages/database/node_modules/.bin/prisma \
      || { echo "FATAL: Prisma CLI missing from the production closure — scripts/railway-start.sh cannot run 'migrate deploy'. Is 'prisma' still in packages/database dependencies (not devDependencies)?"; exit 1; }; \
    test -f ./packages/database/prisma/schema.prisma \
      || { echo "FATAL: Prisma schema not present at packages/database/prisma/schema.prisma"; exit 1; }; \
    test -d ./packages/database/prisma/migrations \
      || { echo "FATAL: Prisma migrations directory missing — 'migrate deploy' would silently apply nothing"; exit 1; }; \
    test -f ./apps/api/dist/main.js \
      || { echo "FATAL: API entrypoint apps/api/dist/main.js missing"; exit 1; }; \
    test -f ./packages/database/index.js \
      || { echo "FATAL: @cms/database entrypoint index.js missing"; exit 1; }; \
    echo "[dockerfile] loading every workspace package from the production closure"; \
    node -e "require('/app/packages/database')" \
      || { echo "FATAL: @cms/database (and through it @prisma/client) failed to load"; exit 1; }; \
    node -e "require('/app/packages/api-types')" \
      || { echo "FATAL: @cms/api-types failed to load — is packages/api-types/dist in the image?"; exit 1; }; \
    node -e "require('/app/packages/scoreboard-cts')" \
      || { echo "FATAL: @cms/scoreboard-cts failed to load"; exit 1; }; \
    node -e "require('/app/packages/signage-design')" \
      || { echo "FATAL: @cms/signage-design failed to load"; exit 1; }; \
    echo "[dockerfile] loading the API's own native + ESM-interop dependencies"; \
    ( cd /app/apps/api && node -e "require('argon2')" ) \
      || { echo "FATAL: argon2 failed to load. It compiles from C/C++ during install — check the Alpine toolchain (python3 make g++ openssl libc6-compat) in the proddeps stage."; exit 1; }; \
    ( cd /app/apps/api && node -e "const p=require('./dist/security/sanitization.pipe.js'); if(!p.SanitizationPipe) throw new Error('SanitizationPipe export missing');" ) \
      || { echo "FATAL: the HTML sanitizer failed to load. SEC-013 moved sanitize-html to 2.17.7, whose htmlparser2@12 is ESM-only — it loads only through Node's require(esm) backport, i.e. Node >= 20.19. If the base image was rolled back below that, this is why."; exit 1; }; \
    for pm in pnpm npm npx yarn yarnpkg; do \
      if command -v "$pm" >/dev/null 2>&1; then \
        echo "FATAL: '$pm' is back in the runtime image. SEC-005: 48 of the original 52 findings came from the bundled pnpm and 2 more from npm, and a package manager in a production container is a ready-made fetch-and-execute primitive."; \
        exit 1; \
      fi; \
    done; \
    test -x /usr/bin/chromium-browser \
      || { echo "FATAL: Chromium missing — the /proxy/web renderer and poster/PDF paths need it"; exit 1; }; \
    command -v ffmpeg >/dev/null 2>&1 \
      || { echo "FATAL: ffmpeg missing — MediaOptimizationService shells out to it"; exit 1; }; \
    echo "[dockerfile] production closure assertions passed"

# Execute as unprivileged node user
USER node

EXPOSE 8080

# Default CMD — Railway overrides this via railway.json's startCommand
# (which calls scripts/railway-start.sh). Kept here as the safe
# fallback for `docker run` without an override.
CMD ["./scripts/railway-start.sh"]
