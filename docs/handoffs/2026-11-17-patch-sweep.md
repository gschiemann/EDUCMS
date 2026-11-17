# Patch sweep - 2026-11-17

The owner's ask (2026-11-17, chat): "the hacks continue like crazy, make sure we are fully patched everywhere." This is the delta since `docs/handoffs/2026-11-13-security-patch-sweep.md`, plus the hosting side that sweep left out. It records what was checked, what this change patches, what cannot be patched by a dependency bump, and what needs the owner.

Model: Claude Fable 5.2 (`claude-fable-5-2`), Claude Code cloud session. No agents dispatched.

## This week's attacks, and whether they reach us

| What happened | Class | Here |
|---|---|---|
| 2026-11-16, Optimizely: malicious JavaScript served from the vendor's own CDN to visitors of at least 178 sites | A third-party script a page loads at run time | **Not exposed.** The dashboard loads no third-party script (no external loader in `apps/web/src`), and its enforced policy is `script-src 'self' 'nonce-...'` with `object-src 'none'` and `base-uri 'none'` (`apps/web/src/lib/csp-script-policy.ts`), so a script from another origin does not run. Player and prerendered routes sit outside the nonce policy by design; customer boards run in sandboxed null-origin frames |
| npm supply-chain campaigns all year; 2026-11-17, hijacked releases of Microsoft's agent-framework | A poisoned package version | Not in the lockfile (0 matches). `pnpm audit`: 0 critical, no malware advisory |
| 2026-11-09, Chrome zero-day CVE-2026-125350, exploited in the wild, fixed in 157.0.8103.50 | A browser bug reached by hostile page content | **Reaches our server-side Chromium.** See "Not fixable by a version bump", item 1 |
| 2026-11-11, Node.js security release 22.23.5 | Runtime | Already pinned in both images (#307) and deployed (API deployment `d6b113a`) |
| 2026-11-03, Next.js security release 16.4.5 | Web framework | Already in (#307). 16.4.6 is not a security release |

## Patched in this change

| Component | From -> to | Why | Reach |
|---|---|---|---|
| `ws` 8.x | 8.21.2 / 8.21.3 -> 8.23.0 (exact) | Release of 2026-11-12, commit `ace7248` "[security] Limit automatically sent pending pongs": a cap on the pong replies a peer can make the server queue. No advisory database listed it for our versions | Production. It is the library under the screens' WebSocket gateway (`@nestjs/platform-ws`), and the client inside `@supabase/realtime-js` and `puppeteer-core` |
| `ws` 7.x | 7.5.13 -> 7.5.14 | The same fix, backported the same day | Development graph only |
| `sanitize-html` | 2.18.1 -> 2.18.2 (exact) | Release of 2026-11-11, changelog section "Security": style content inside `svg` or `math` was emitted as written, so markup the allow-list never permitted could reach the browser | Production: the API's sanitising pipe and the SVG asset sanitiser. Neither allow-list permits a `style` element, so the defect is not reachable here; taken anyway. Same six dependencies as 2.18.1 |
| OS packages in both images (Chromium, ffmpeg, OpenSSL, NSS, fonts) | whatever the builder had cached -> whatever Alpine serves on the day of the build | They are unpinned `apk add` packages. A builder that keeps layers reuses the layer while the instruction and the base image are unchanged. `ARG OS_PACKAGES_REFRESHED` changes the instruction, so this deploy fetches them again | Production: the API image and the renderer image. Closes open item 2 of the 2026-11-13 record as a mechanism; it is a refresh, not a pin |

Overrides follow the existing convention: bounded, exact, at least five days old, rationale in `pnpm.comment-overrides`.

## Not fixable by a version bump today

1. **Chromium in both images is one security release behind, and that release fixes a bug being exploited.** CI built both images on 2026-11-16 with `chromium 156.0.8078.79-r0`. The fix for CVE-2026-125350 (use-after-free in the XML component, on CISA's exploited list since 2026-11-10) is in 157.0.8103.50. What our Chromium renders: board HTML for posters and the AI design review (renderer service), uploaded PDFs, and external pages through `GET /api/v1/proxy/web`, which is capability-gated to a signed-in operator or a paired screen (SEC-006) and runs `--no-sandbox` inside the API container. That path had **0 requests in the last 7 days** (Railway HTTP metrics). The refresh line in this change makes the deploy fetch Alpine's current package; **the CI log of this pull request shows which version that is.** If Alpine has not shipped 157 yet, there is nothing to install: re-check, move the date, redeploy. A scheduled weekly rebuild would remove the manual step; that is a CI/CD decision.
2. **`picomatch` GHSA-fc5q-39xc-vjpf (high) has no fixed version.** The advisory was widened on 2026-11-17 to `<= 4.0.7`, the newest release, which turned `Production Dependency Audit` and the hourly `Security Watch` red on `master`. It needs an attacker-supplied glob pattern. Here picomatch 4.0.4 is in the production graph only under `apps/web`, through `@sentry/nextjs` and `next-intl`. It cannot be pinned; it needs a waiver with a proof and an expiry (`scripts/npm-advisory-audit.cjs`, `WAIVERS`), which changes what a gate accepts: the owner's decision, a separate pull request.
3. **pnpm 9.0.0 (April 2024) is the installer in CI, in both image builds and in every agent sandbox, and its line is no longer patched** (newest 9.x: 9.15.9, March 2025). The 2026 pnpm advisories are fixed only in 10.34.x and 11.x: CVE-2026-50021 / GHSA-q6j5-fjx5-2mc3 (integrity check skipped when the lockfile omits the field), CVE-2026-50016 / GHSA-hwx4-2j3j-g496, CVE-2026-59195 / GHSA-qrv3-253h-g69c, CVE-2026-59196, CVE-2026-82392 and CVE-2026-82393 (path traversal on install: a crafted lockfile or tarball writes files outside `node_modules`). The exposure is installing a lockfile or tarball an attacker controls; this repository is public and CI runs `pnpm install` on pull requests. pnpm 9 also runs every dependency's install script by default; pnpm 10 runs only the ones listed, and `pnpm-workspace.yaml` already carries that list. **Tested, nothing changed:** `pnpm@10.34.9 install --frozen-lockfile --lockfile-only` accepts today's lockfile as it is. The move is 23 pins in 11 workflow files, 4 in the Dockerfiles and `packageManager`: a CI/CD definition change, the owner's decision, a separate pull request.
4. **Redis is 8.2.9 on Railway; 8.2.11 (2026-10-26) is marked SECURITY.** Its fix is a heap overflow when a PUBLISH larger than 4 GB crosses the cluster bus in cluster mode. Ours is a single node with no cluster bus, no public TCP proxy (checked today) and a required password, so it is not reachable here. Railway's image auto-update for vulnerabilities is on (weekends) and keeps the tag. Moving the tag is the owner's apply (`.railway/railway.ts`, CLAUDE.md section 10).
5. **DOMPurify 3.4.18** (2026-11-14) is three days old. Its fixes are in `SAFE_FOR_TEMPLATES`, hooks and `IN_PLACE`; our five call sites use only `USE_PROFILES: { svg, svgFilters }`. Raise it from 2026-11-19.
6. **NestJS 11.1.19 -> 11.2.10** is seven months of fixes, many of them hardening (middleware exclusions, validation pipes, SSE, streamable files) and several that now fail startup on a misconfiguration. The API uses no `exclude()`, no `@Sse`, no `ValidationPipe` and no `StreamableFile`, so none is a fix for a path we use. A planned change with its own pull request, not today's patch.
7. **The panels' System WebView** (Chrome 87 to 116 seen in the field) is unchanged from the 2026-11-13 record and is still the largest browser exposure. No code change patches it.

## Checked and current

- Node 22.23.5 is the newest 22.x security release as of today; both images pin it.
- `next` 16.4.5. Next's own React for the App Router is `19.3.0-canary-278794d7-20261002`, read from `next/dist/compiled/react-dom`: newer than the React Server Components fixes the 2026-11-13 record could not verify (closes its item 3).
- `undici` 7.30.2 and 6.29.1, `multer` 2.5.0, `jsonwebtoken` 9.0.3, `sharp` 0.35.5, `helmet` 7.2.0: newest in their majors. `jose` 4.15.9 (through `openid-client`): newest 4.x, no advisory.
- Supabase: Postgres 17.6.1.104 on the GA channel. Security advisor: one lint, INFO level, "RLS enabled, no policy" on 112 tables, which means no access through the Data API (the app connects as the database role). No WARN or ERROR lint, none about the Postgres version.
- Railway Redis: private network only.
- GitHub Actions are pinned by commit SHA (spot check of `ci.yml`).

## Not checked, or could not be checked from this session

- GitHub's Dependabot, code-scanning and secret-scanning alerts (the API refused this session).
- The Chromium version running in production right now (it needs the deployed image or its logs; this session does not read logs).
- Alpine's package index (not reachable from the sandbox), so whether Chromium 157 is available was not known before this pull request's CI ran.
- The Android toolchain beyond the 2026-11-13 search; `player-kotlin-check.yml` runs osv-scanner.
- This is a dependency, runtime and hosting-version sweep. It is not a penetration test or a code audit.

## Evidence for this change

- The lockfile diff is three entries (`ws` 8, `ws` 7, `sanitize-html`); their integrity hashes equal the registry's.
- API jest, with a local stand-in for the generated database client: 643 of 647 suites pass; the 4 failing suites fail identically on `master` here (three need ffmpeg, one is the stand-in). The realtime and sanitiser suites: 15 suites, 202 tests, pass.
- Direct smoke: a `ws` 8.23.0 server and client echo a message and answer 5 pings with 5 pongs; `sanitize-html` 2.18.2 strips a script, event handlers and an `svg` with a `style` under our allow-list shape.
- `pnpm install --frozen-lockfile` is clean. `npm-advisory-audit.cjs` is unchanged: 0 critical, 1 high (picomatch, above), 2 moderate (glob and minimatch, tolerated since 2026-11-08).
- **Unverified locally:** both Docker builds (no daemon here), the Playwright emergency path, anything deployed. CI on the pull request is the proof.

## A note on method

CLAUDE.md section 11 says a session that reads web pages holds no write tool. This sweep read vendor advisories and release notes in the same session that edited the repository. Nothing on a page was treated as an instruction; every version and hash in the change was taken from the npm registry, not from a page. The 2026-11-13 sweep split the two roles between a sub-agent and the lead; this one did not.

## Sources

- Optimizely incident: https://unit42.paloaltonetworks.com/optimjack-supply-chain-attack/
- Chrome 157.0.8103.50 and CVE-2026-125350: https://www.malwarebytes.com/blog/bugs/2026/11/update-chrome-now-to-fix-a-flaw-attackers-are-exploiting
- Node.js 22.23.5: https://nodejs.org/en/blog/release/v22.23.5
- Next.js November security release: https://nextjs.org/blog/upcoming-nextjs-security-release-november-2026
- picomatch advisory: https://github.com/advisories/ghsa-fc5q-39xc-vjpf
- pnpm advisories: https://github.com/advisories/GHSA-q6j5-fjx5-2mc3 and https://corgea.com/research/cve-2026-82392-cve-2026-82393-pnpm-path-traversal-install-overwrite
- Redis 8.2.11: https://github.com/redis/redis/releases/tag/8.2.11
- NestJS releases: https://github.com/nestjs/nest/releases
- sanitize-html 2.18.2 changelog, as quoted in https://github.com/UK-Export-Finance/dtfs2/pull/5137
- ws 8.23.0 release notes, as quoted in https://github.com/nestjs/graphql/pull/4228
