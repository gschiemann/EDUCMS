# Security patch sweep — 2026-11-13

The owner's ask: "there have been a lot of new vulnerabilities coming out, make sure our app is secure and patched." This is the record of what was checked, what was patched, and what is still open. Sweep by a sub-agent in an isolated worktree; the lead reviewed the diff, re-ran `check-node-security.cjs`, and confirmed the Node image digest against the registry independently.

## Patched in this change

| Component | From → to | Why | Reach |
|---|---|---|---|
| `next` (apps/web) | 16.4.2 → 16.4.5 (exact) | Next.js security release of 2026-11-03: GHSA-mfr8-8qww-v76h (cross-tenant cache disclosure, high) and six medium advisories | Production. Exposure looks low here (no `cacheComponents`, no `dangerouslyAllowSVG`, no edge-runtime route found by grep; hosted on Vercel) |
| `undici` 7.x | 7.30.1 → 7.30.2 | Release of 2026-11-05: GHSA-mqg3-3v4r-cm32 (redirect-chain cache poisoning, high) and five medium | Production graph via `cheerio` / `jsdom` in the API; no direct import in `apps/*/src` |
| `basic-ftp` | 6.2.1 → 6.2.4 | GHSA-5pm8-86m8-9m6r, GHSA-r4jh-29pc-gfqr (moderate) | Production graph via `puppeteer-core`; runs only for an `ftp://` proxy URL |
| `fast-xml-parser` | 5.8.0 → 5.12.0 | GHSA-474x-hrwr-fgx4 (low) | Production: the API's feed and Office-file parsers read untrusted XML; none sets `stopNodes` |
| `hono` | 4.13.13 → 4.13.16 | five advisories (moderate / low) | Development tooling only |
| Node.js runtime, both images | 22.23.4 → 22.23.5 | Security release of 2026-11-11: six high (http2, tls, http), eight medium, three low. `scripts/check-node-security.cjs` was failing on `master` | Production: API and renderer images |

Overrides follow the existing `pnpm.overrides` convention (bounded, rationale in `pnpm.comment-overrides`, pinned exact to a release at least five days old, per the 2026-10-24 precedent).

## Checks

- `pnpm audit --prod`: before 0 critical / 0 high / 4 moderate / 1 low; after 0 / 0 / 2 / 0 (the two left are `glob` and `minimatch`, below).
- `node scripts/npm-advisory-audit.cjs` (the CI gate): moderate 4 → 2, low 1 → 0.
- `node scripts/check-node-security.cjs`: exit 1 on `master`, exit 0 with this change.
- Node image digest `sha256:1314fb30…88481a` read from the registry twice, by two methods.
- `pnpm install --frozen-lockfile`, package builds, `prisma generate`, `pnpm --filter api build`, `next build` on 16.4.5: pass.
- API `tsc`: unchanged from `master` (errors only in `*.spec.ts`); web `tsc`: 0 errors.
- API jest: 12,093 pass, 12 fail — all in the real-file video-transcode spec, the known baseline on this machine. Web jest: 10,057 pass; `mp4-inspect.test.ts` does not load here (known).
- **Unverified locally:** the Docker build and boot (no daemon here — the required CI check `Docker build + boot smoke test` is the proof), the Playwright emergency-path and two-tenant suites, lint, WebKit, and anything deployed.

## Still open — each needs a decision or a follow-up

1. **The advisory gates were blind to two real security releases.** Neither the npm advisory data (what `npm-advisory-audit.cjs` and Security Watch read) nor OSV listed the Next.js or undici releases for our versions; they were found in the vendors' own release notes. Closing this means a vendor-release check beside `check-node-security.cjs` — a CI change.
2. **Chromium, ffmpeg and openssl in the images are unpinned `apk add` packages.** Their versions are whatever Alpine served when the image was last built. Rolling the Node base image rebuilds them unless a cached layer is reused; the deployed versions were not determined.
3. **`react` / `react-dom` 19.2.4.** The React Server Components advisories (CVE-2026-23864, CVE-2026-23869) are in `react-server-dom-*`, which Next vendors. Whether Next 16.4.5's vendored copy carries the fix: not verified.
4. **`sanitize-html` 2.18.1** (the API's sanitising pipe): 2.18.2 exists; whether it is a security fix was not determined.
5. **`ws`, `jose`, `jszip`:** clean per `pnpm audit`; release notes not read.
6. **Tolerated, per `docs/governance/decisions/2026-11-08-dependabot-alerts-triage.md`:** `glob` and `minimatch` (fix is a major; build-time only), `zod` 3 copies (development only; production resolves zod 4), `deepmerge` (no patched version).
7. **Majors not attempted, none forced by a known advisory:** Prisma 5 → 7, `@nestjs` 11 → 12, `@sentry` 10 → 11, `@simplewebauthn/server` 13 → 14 (auth), `ioredis` 5 → 6, `helmet` 7 → 8.
8. **Android player:** library versions (AGP 8.5.2, Kotlin 1.9.24, compileSdk/targetSdk 34, `androidx.webkit` 1.11.0) show no advisory in one search — not verified beyond that. The real exposure is each panel's System WebView, which the app does not ship: the Cleveland fleet reports Chrome 87, 95, 101 and 116 on Android 7.1.2 and 11.
9. **Follow-ups once five days old:** `next` 16.4.6 (changes route-handler compression), `fast-xml-parser` 5.12.1, `fast-xml-builder` 1.3.2.
10. `docker-compose.yml` (local development only) uses `growthbook/growthbook:latest`, an unpinned tag; not assessed.

## What this sweep was not

A dependency and runtime patch sweep. It is not a penetration test, a code audit of auth or tenancy, or a review of cloud configuration; `docs/governance/AUDIT-SURFACE.md` is the map for those.

Models: Claude Fable 5.2 (Anthropic, Claude Code on the web) — sweep by a sub-agent, review and the Node pin by the lead session.
