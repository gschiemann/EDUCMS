# Release train 2026-11-18: the four open pull requests and the browser-install mirror

Owner, in chat, 2026-11-18 09:21 CT, asked which pull requests were left and then: "Wrap up everything all PR's". This is the record of what the train carries, what the lead read before merging another session's work, and what is still unverified.

## What the train carries

| Unit | What it is | Runtime effect on merge |
|---|---|---|
| PR #332 | 30-day waiver, with a proof that re-runs on every check, for picomatch GHSA-fc5q-39xc-vjpf (no fixed release: 4.0.7 of 2026-08-24 is still flagged) | none: gate scripts only |
| PR #326 | Weekly review 2026-W47, one document | none |
| PR #312, second half | 13 commits (49 files) that reached the branch after the 2026-11-16 train took it: web, integration and outbound-fetch hardening | yes, see "What the lead read" |
| PR #327 | The device message poll can answer "nothing changed" from memory | none until `EMERGENCY_MESSAGES_FAST_304` is set; it ships unset |
| Mirror rewrite | The seven browser-install steps (a11y, ci, cross-browser x2, emergency-path, prod-smoke x2) also rewrite `*.ec2.archive.ubuntu.com` to the main Ubuntu mirror | CI only |

## Why Security Watch was red (the owner's question)

- GitHub published GHSA-fc5q-39xc-vjpf (high, ReDoS, every picomatch release up to 4.0.7) between the watch's 2026-11-17 13:33Z run (green) and its 22:27Z run (red, on `d6b113aa`, before the patch sweep #331 merged at 23:35Z). Three red runs followed: 22:27Z, 04:29Z, 14:09Z.
- The watch is scheduled hourly but GitHub started it only three times in those 24 hours. The daily jobs start 7 to 10 hours after their cron time (Emergency Path: cron 08:43Z, started 17:51Z and 18:52Z on the two previous days).
- `scheduled-failure-issue.yml` opened issue #330 and commented on each repeat. Its on-call step did not fire: the run log says "On-call routine not configured" (the two `ROUTINE_FIRE_*` secrets are unset).

## The WebKit install stall (found while answering)

- After #331 merged, two push runs on master went red: Prod Smoke (WebKit canary) and Emergency Path (WebKit half). Neither ran a test. Both ended in "Install Playwright browser" with exit code 124 (the step's own `timeout 360`, twice).
- The lead reported the merge as verified without watching those two runs. That was a miss.
- Evidence from the job logs: every stalled install ran on a runner whose provisioner block says `Cloud: AWS` (us-east-1 or us-west-2) and pulled packages from `us-east-2.ec2.archive.ubuntu.com` (about 9 MB in 2 min 41 s). Every install that passed ran on `Cloud: Azure` and pulled the same 125 MB from `archive.ubuntu.com` in 5 to 31 seconds. Six stalls, all AWS; four passes sampled, all Azure; 35 of 35 installs before 2026-11-17 23:30Z took 25 to 81 seconds.
- The step already rewrote the Azure mirror to the main mirror (2026-10-22). On an AWS runner the mirror list names an EC2 mirror, which that rewrite did not touch. The train extends the same `sed` to the EC2 name. Not yet proven on an AWS runner: read the first WebKit job that lands on one.
- Re-runs on 2026-11-18: Prod Smoke passed (issue #333 closed itself). Emergency Path on master stalled twice more (both AWS); issue #334 stays open until a master run of that workflow is green.

## What the lead read in #312's second half before merging it

Read in full: the asset proxy, the keep-warm route, the health controller change, the launch redirect check, the Sentry scrub module and the client config, the OAuth browser binding and the social callback, the POS secret and store checks, the scoreboard ingest gate, the outbound-fetch deadline and its callers. Skimmed: the POS OAuth controller (same binding as social), branding logo sanitising, the edge worker, the POS settings UI.

Findings that bear on production:

- **`/cdn/assets` proxy.** It now serves only image, video, audio and PDF types inline and everything else as a download, with `nosniff` and a sandbox CSP. The `assets` bucket holds 1,600 objects: all image, video, audio or PDF except 8 `text/plain` and 2 `application/json` from April and May. No `text/html`. In the player, PDF and web content never use this proxy, and `resolveAssetUrl` is a pass-through unless `NEXT_PUBLIC_ASSET_CDN` is set. Whether that variable is set in production was not read (reading project variables would put values in this session).
- **Keep-warm route.** It answers 503 in production without `CRON_SECRET`. `apps/web/vercel.json` schedules no cron, and the keep-warm that runs is the GitHub workflow calling the API directly, so nothing depends on this route.
- **`GET /api/v1/health/storage`.** The body is now `{ status }` only. The one reader of the old body, the status page, changes in the same commit. `/api/v1/health`, `/started` and `/ready` are untouched.
- **Sentry scrub.** One shared module for the three web configs. It uses nothing newer than `Object.entries`, so it is safe on the Chromium 83 controllers.
- **OAuth browser binding (POS, social).** The callback now refuses unless the browser carries the nonce set at `authorize`. The cookie is set on the host that served `authorize` and read on the host in `PUBLIC_API_BASE_URL`. **Unverified:** a browser that reaches the API through the same-origin gateway gets the cookie on the web host, and the callback on the API host would then answer `browser-mismatch`. It fails closed. No real provider flow was run. The Clever flow on master has the same shape.
- **Outbound fetch deadline.** Default total budget is three idle timeouts, at least 15 s. Every caller fetches small bodies except the USB export, which sets 15 minutes explicitly.
- No schema change, no migration, no new API environment variable, no player or emergency-path file in this half.

## Checks run locally on the merged tree

- Environment docs regenerate clean (`generate-env-docs.cjs --check`), 277 variables declared, `check-env-declared.cjs` 0 errors.
- Web tests touched by the train: 6 suites, 86 tests, pass.
- Full API suite with the local Prisma stand-in: same four suites fail as on master (`assets-accept-containers`, `pdf-pages`, `video-probe-autoheal`, `playlist-fallback`: ffmpeg and the stand-in), nothing new.
- 28 workflow files parse; 143 of 143 action references pinned.

## Review and approvals

- Not reviewed by a different vendor. Every unit except #326 is consequential (a CI gate, CI definitions, auth and secrets, the emergency path). The lead asked the owner at about 09:30 CT to say "waive" or "hold" and does not merge the consequential units without his explicit answer. The pull request carries that answer verbatim.
- **Not waived, whatever the answer:** the on-glass bench drill before `EMERGENCY_MESSAGES_FAST_304` is set for any screen, which needs the owner's permission for that test.
- Method note: this session read vendor advisories and CI logs while holding write tools (same deviation as recorded on 2026-11-17).

## After the merge (measured 2026-11-18)

- The owner answered "Waive" at 09:51 CT. The train merged as `9bcf6bab` at 15:54Z (pull request #336); #332, #326, #312 and #327 closed as merged with it. The waiver row is on `docs/governance/AUTONOMY-REGISTER.md`.
- Railway `api` and `renderer`: SUCCESS on `9bcf6ba`. Vercel production: READY on the same commit, 104 s build.
- Prod Smoke on the push: both jobs green. Its Chromium job waits until `/api/v1/health` reports this commit before it tests, so the deployed commit is confirmed by that run, not by this session (the sandbox cannot reach the hosts).
- Fleet, same three windows as 2026-11-15 (ping 2 min, paint 6 min, push 2 min): 41 / 41 / 41 at 15:54:14Z before, 41 / 41 / 41 at 16:00:21Z after.
- API, the hour to 16:00Z: 54,225 requests, 0 5xx, 28 4xx. `GET /api/v1/emergency/messages`: 14,688, every one a 304.
- Security Watch, run by hand on the merged master: green. Issue #330 closed itself.
- **The mirror rewrite is proven on AWS runners.** In the train's own CI, four jobs with a browser install ran on `Cloud: AWS` (us-east-1, us-west-2); all four pulled from `archive.ubuntu.com` and passed, WebKit's 125 MB in 33 s and 36 s.
- Not verified on glass. Not verified: a real POS or social OAuth connect.

## The installer move: pnpm 9.0.0 to 10.34.9 (its own pull request, same waiver)

**Why.** 9.0.0 is from April 2024. The fixes for this year's pnpm advisories (CVE-2026-50016, 50021, 59195, 59196, 82392, 82393) exist only in 10.34.x and 11.x. 10.34.9 is the newest 10.x (2026-10-25, 23 days old on the day of the move).

**What changed.** 23 `pnpm/action-setup` pins in 11 workflow files, four `corepack prepare` lines in the two Dockerfiles, `packageManager`, the two contributor docs, and `--legacy` on the renderer image's two `pnpm deploy` lines.

**Replayed locally with 10.34.9 before pushing:**

- `pnpm install --frozen-lockfile` succeeds; `pnpm install --lockfile-only` leaves `pnpm-lock.yaml` byte-identical.
- pnpm 10 runs a dependency's install script only when `pnpm-workspace.yaml` `allowBuilds` names it (pnpm 9.0.0 ignored that list and ran them all). Rebuilding `argon2` and `@nestjs/core` ran their scripts; the unlisted ones did not run.
- Thirteen installed packages have an install script. Eight are on the list. The five that are now skipped, and why that changes nothing: `@sentry/cli`, `@swc/core`, `workerd` and `@parcel/watcher` ship their binary as an optional platform package and the script only re-checks it; `@sentry/node-cpu-profiler` ships prebuilt binaries for linux x64 glibc and musl at Node 22's ABI (127).
- `pnpm deploy` without `--legacy` stops with `ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE`. With it, the renderer's production closure has the same six top-level packages and the same version of every shared package; it no longer carries `proxy-agent` 6.5.0 and its 25 dependencies, an optional peer of `@puppeteer/browsers` that pnpm 9 attached although it is outside the requested range (`>=8.0.1`) and is used only to download a browser.
- The advisory gate and the picomatch proof run unchanged under pnpm 10 (736 production packages).

**What only CI and the hosts can show:** the API image builds and boots (`Docker build + boot smoke test`), the renderer image builds and renders (`Renderer image build + render smoke test`, a reporting job that this change must not leave red), the web build, and which pnpm Vercel's builder picks for `packageManager: pnpm@10.34.9`.

**Rollback.** Revert the pull request: the lockfile is unchanged, so 9.0.0 installs exactly as before.

## Still open after this train

1. ~~The installer move is open.~~ Closed 2026-11-18: PR #337 merged as `4fb09095` at 16:26Z; both images built with pnpm 10.34.9, the fleet read 42 checking in, 42 painting, 42 on push before and after, and the API served no 5xx.
2. Weekly review section E: five decisions for the owner, including confirm-or-void for the lead-granted waiver on #324.
3. Bench drills owed: #311 and #322 (gateway return path), and #327 before its switch.
4. Chromium 157.0.8103.50 (CVE-2026-125350) is not in Alpine yet; DOMPurify 3.4.18 is eligible from 2026-11-19T14:18Z. Both are carried forward in `docs/handoffs/2026-11-19-dompurify-and-runner-image.md`.
5. The on-call routine secrets are unset, so a red scheduled job only opens an issue and emails the owner.
