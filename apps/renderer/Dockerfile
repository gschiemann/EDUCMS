# syntax=docker/dockerfile:1
#
# VenueOS board renderer — its own small Railway service (apps/renderer/README.md).
#
# BUILD CONTEXT IS THE REPO ROOT, like the API's Dockerfile, because the pnpm
# workspace lockfile lives there:
#     docker build -f apps/renderer/Dockerfile .
#
# What this image is, and is not:
#   • It holds NO secrets and reads no environment beyond PORT and tuning knobs.
#   • It serves NO public traffic: private networking only — never give the
#     service a public domain.
#   • Its Chromium has no network (src/network.ts): fonts come from the
#     fontsource packages installed here, never from Google.
#
# NODE 22, NOT 20 — deliberately. Node 20 reached end of life on 2026-04-30
# (the API's Dockerfile moved for the same reason on 2026-09-08). This is the
# SAME pinned multi-arch index digest the API uses, so both services roll
# forward together (docker buildx imagetools inspect node:22-alpine).
ARG NODE_IMAGE=node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

# ═══════════════════════════════════════════════════════════════════════
# Stage 1 — builder: compile TypeScript. Nothing from here but dist/ ships.
# ═══════════════════════════════════════════════════════════════════════
FROM ${NODE_IMAGE} AS builder
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/renderer/package.json ./apps/renderer/package.json
# `pnpm deploy` materialises ONE workspace package with its own dependency
# closure from the lockfile — unlike `pnpm install --filter`, which also
# installs the workspace ROOT's dependencies (the whole @wdio/jest/turbo dev
# toolchain, and `pg` + `dotenv` in a --prod install). Verified by replaying
# both in a copy of this build context: deploy gives 102 production packages
# and nothing of the root's.
# --ignore-scripts: nothing in the closure has an install script (sharp 0.35
# ships prebuilt @img/* binaries; puppeteer-core downloads nothing).
RUN pnpm --filter renderer deploy --ignore-scripts /build

WORKDIR /build
COPY apps/renderer/tsconfig.json apps/renderer/tsconfig.build.json ./
COPY apps/renderer/src ./src
RUN ./node_modules/.bin/tsc -p tsconfig.build.json

# ═══════════════════════════════════════════════════════════════════════
# Stage 2 — proddeps: the production dependency closure and nothing else
# (no typescript, no @types, no playwright-core).
# ═══════════════════════════════════════════════════════════════════════
FROM ${NODE_IMAGE} AS proddeps
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/renderer/package.json ./apps/renderer/package.json
RUN pnpm --filter renderer deploy --prod --ignore-scripts /out \
    && rm -rf /root/.cache /root/.local/share/pnpm /tmp/* \
    # The bundle serves WOFF2 only; the WOFF twins fontsource ships for
    # older bundlers are dead weight here. (Licences stay.)
    && find /out/node_modules/.pnpm -path '*@fontsource*/files/*.woff' -delete \
    && find /out/node_modules/.pnpm -path '*@fontsource*' -name '*.md' -delete

# ═══════════════════════════════════════════════════════════════════════
# Stage 3 — runner.
# ═══════════════════════════════════════════════════════════════════════
FROM ${NODE_IMAGE} AS runner

# Chromium plus the fonts a board can fall back to. The Designer's Google
# fonts and the exemplars' system-font look-alikes come from the bundle; these
# cover what no bundle can: generic families, emoji, and CJK/other scripts
# (an operator can type Chinese into a board — without font-noto-cjk every
# glyph would render as a box). tini is PID 1 so the Chromium helper
# processes a killed browser leaves behind are reaped, not left as zombies.
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      fontconfig \
      ttf-freefont \
      font-noto \
      font-noto-emoji \
      font-noto-cjk \
      tini

# Nothing here fetches or installs code at runtime; a package manager in a
# production container is a fetch-and-execute primitive (the API's SEC-005).
# corepack goes too: it exists to download package managers on demand.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
           /usr/local/lib/node_modules/corepack /usr/local/bin/corepack \
           /opt/yarn-v* /usr/local/bin/yarn /usr/local/bin/yarnpkg

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    PORT=8080

# /app IS the renderer package: package.json, node_modules (the deploy's
# self-contained closure, relative symlinks intact), dist/, fonts/.
WORKDIR /app
COPY --from=proddeps /out/node_modules ./node_modules
COPY --from=proddeps /out/package.json ./package.json
COPY --from=builder /build/dist ./dist
COPY apps/renderer/fonts ./fonts

# ── Build-time assertions: fail the BUILD, not the 3am deploy ──────────────
RUN set -eu; \
    test -x /usr/bin/chromium-browser || { echo "FATAL: Chromium missing"; exit 1; }; \
    /usr/bin/chromium-browser --version; \
    node -e "require('sharp')" || { echo "FATAL: sharp does not load (musl prebuilt missing?)"; exit 1; }; \
    node --input-type=module -e " \
      await import('puppeteer-core'); \
      const { loadFontCatalog } = await import('./dist/fonts/catalog.js'); \
      const c = loadFontCatalog(); \
      if (c.families.size < 20) throw new Error('font bundle incomplete: ' + c.families.size + ' families'); \
      console.log('[dockerfile] font bundle:', c.families.size, 'families,', c.substitutes.size, 'look-alikes'); \
    " || { echo "FATAL: the renderer's modules or font bundle do not load"; exit 1; }; \
    for pm in pnpm npm npx yarn yarnpkg corepack; do \
      if command -v "$pm" >/dev/null 2>&1; then echo "FATAL: '$pm' is in the runtime image"; exit 1; fi; \
    done; \
    echo "[dockerfile] runner assertions passed"

USER node
EXPOSE 8080
ENTRYPOINT ["/sbin/tini", "--"]
# The Node half only marshals requests and images; Chromium's memory is its own
# (and is watched — src/server.ts). A small heap keeps the two from competing.
CMD ["node", "--max-old-space-size=512", "dist/main.js"]
