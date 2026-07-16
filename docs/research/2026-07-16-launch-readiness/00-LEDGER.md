# VenueOS Launch-Readiness Ledger — 2026-07-16

> Code-verified re-audit of current master (`a8959842`) across all 21 Standard Audit Surface sections.
> 12 domain assessors → adversarial verification of every BLOCKER/HIGH finding → this synthesis.
> Workflow run: `wf_f173a96f-38c` (22 agents, 0 errors). Raw findings: `01-full-findings.json`.

## Overall verdict

**READY FOR CONTROLLED LAUNCH — 0 surviving code blockers; launch-gated only on Greg's config/secret actions plus a short truth-in-advertising fix list**

The load-bearing surfaces are genuinely hardened, not theater. Emergency/real-time (server-side HMAC forgery gate before any fan-out, atomic immutable audit, manifest+per-screen all-clear across all three scopes, canTriggerPanic revocation, storage-layer append-only) all verified real. Auth/tenant isolation, the Stripe webhook (idempotent/out-of-order/SERIALIZABLE-safe), POS direct connectors, signed emergency webhooks with durable multi-replica retry, and the W0-09/AI-Designer containment fixes all held up under adversarial re-verification. Critically, the two findings originally rated BLOCKS_LAUNCH/HIGH — the stale /help/billing article and the broken manual-iframe streaming path — were both downgraded by verifiers to SHOULD_FIX: real defects, but neither is unsafe, data-lossy, nor breaks the primary signage/emergency job. So there are ZERO genuine code launch-blockers. The residual risk is concentrated in (a) Greg's config/secret actions (secret rotation, Resend domain, PILOT_SEAT_LIMIT, Stripe, POS OAuth) and (b) a cluster of truth-in-advertising dents — quarantined boards still reachable via the builder picker and the public homepage, streaming "paste the URL, that's it" showing an empty card, email silently dropping non-owner mail while reporting SENT. A controlled/limited-cohort launch in days is defensible once the config gating is done and the top truth dents are patched. It is not yet "world-class": accessibility backlog, structural tenant isolation, a template-release pipeline, and Taurus container-query debt are honest multi-week items.

## Launch blockers (code): 0

 _None. The adversarial pass dropped every candidate blocker; the life-safety/emergency surface verified genuinely hardened._

## Should-fix before a world-class launch: 20

### S1. Manually-pasted YouTube/Twitch/Vimeo streaming channels render 'No channel selected' — the #1 marketed streaming path is broken end-to-end
- **Domain:** streaming · **Code-fixable:** true
- **Fix:** iframe channels persist the URL only into externalId; the picker copies playbackUrl/embedUrl (both undefined). Either drop the `?undefined` at settings/streaming/page.tsx:770, or have resolvePlayback/listChannels fall back to externalId, or make the PropertiesPanel picker use externalId for iframe type. Add a regression test that a picked iframe channel yields a non-empty embedUrl.

### S2. Quarantine bypass: 20 of 21 quarantined boards are still selectable in the builder's Industry-Signage picker and can be published to live screens
- **Domain:** templates · **Code-fixable:** true
- **Fix:** The quarantine only touches the DB gallery query. Filter the static SIGNAGE_TEMPLATES catalog against the shared QUARANTINED_BOARD_URLS denylist so the picker only offers ACTIVE boards.

### S3. Public marketing homepage renders 2 quarantined placeholder boards live on desktop (QSR + Fashion hero show gray '2150 × 1000' / 'Drop look photo' boxes)
- **Domain:** templates · **Code-fixable:** true
- **Fix:** Repoint IndustryShowcase.tsx QSR (line 90) and Fashion (line 141) src to non-quarantined flagships, or ship versions with default background images so no placeholder shows — brand-licensing/placeholder boards should not appear on the primary funnel.

### S4. Customer-facing /help/billing article describes the defunct per-building/30-day/15%/PO-flow model, contradicting the live per-screen $25/$240/14-day/20% pricing
- **Domain:** billing · **Code-fixable:** true
- **Fix:** Rewrite billing.md to the live model (per-screen $25/mo or $240/yr save 20%, 14-day/3-screen no-card trial, Stripe checkout + Portal, no self-serve PO UI), remove Single-School/District tier names, align/drop the refund claim, set real support emails — or unpublish the article until rewritten.

### S5. BYOK key decrypt-failure silently falls through to platform (Tier-1) spend on the cheapest model instead of erroring
- **Domain:** ai · **Code-fixable:** true
- **Fix:** When aiKeyEncrypted is present but decrypt throws, throw ServiceUnavailableException (AI_KEY_UNREADABLE) instead of returning the platform key; only fall to platform when no BYOK key was ever configured. Sharp edge: W0-01 secret rotation touches DEVICE_SECRET_KEY (the BYOK master key) and would dump the whole fleet onto platform spend at once.

### S6. axe-core CI gate runs unauthenticated — dashboard, template builder, emergency broadcast console and 3 other authed routes are only login/shell renders, so the a11y green is false confidence
- **Domain:** a11y · **Code-fixable:** true
- **Fix:** Seed + log the harness in against the ephemeral pg the e2e gate already stands up, add the builder route to ROUTES, re-run axe on real authed renders, and re-lock the warning baseline from authed numbers.

### S7. E2E CI gate is shallow — 17 of 36 tests are skip()ed, including panic-trigger, all-clear and every authenticated critical-path flow; the 30-test floor implies depth that isn't there
- **Domain:** ops · **Code-fixable:** true
- **Fix:** Seed an e2e admin user in the CI db:seed step, then un-skip at least panic-trigger, all-clear and schedule-publish specs; assert a minimum count of NON-skipped tests, not just discovered tests.

### S8. Container CVE scan (Trivy) is non-blocking — a new CRITICAL/HIGH base-image or OS CVE will not fail CI
- **Domain:** ops · **Code-fixable:** true
- **Fix:** Triage the current CRITICAL/HIGH backlog in one real CI run, rebase the base image / add accepted-risk ignore entries, then drop continue-on-error so a new critical CVE reds the build.

### S9. express-session uses the default in-memory MemoryStore — OIDC SSO login breaks intermittently the moment Railway scales past 1 replica, and MemoryStore leaks at scale
- **Domain:** auth · **Code-fixable:** true
- **Fix:** Back express-session with a Redis store (connect-redis on the existing RedisService client) so OIDC state/nonce is shared+bounded across replicas, or move state/nonce to a signed short-TTL cookie. Until then keep numReplicas=1.

### S10. 27 shipped boards (incl. the entire K-12 hs pack) load Google Fonts from fonts.googleapis.com — typography degrades to system fonts offline/on Taurus, risking auto-fit overflow
- **Domain:** templates · **Code-fixable:** true
- **Fix:** Self-host/inline the font files (base64 @font-face or same-origin /public/fonts) so boards are truly self-contained per the CLAUDE.md offline-cacheable requirement.

### S11. Email delivery reports SENT / 'check your inbox' even when EMAIL_FROM is unverified and Resend silently drops all non-account-owner mail; health probe over-claims READY
- **Domain:** comms · **Code-fixable:** true
- **Fix:** Code half: at boot in prod log a loud warning when EMAIL_FROM is unset/defaulted; downgrade the comms-email health row to DEGRADED ('sender domain not verified — only the Resend account owner will receive mail'). (Domain verification itself is Greg's config action.)

### S12. USB export silently DROPS assets with a null fileHash (fresh presign uploads) instead of hashing the bytes it already downloads — offline kiosk plays with missing items, no error surfaced
- **Domain:** storage · **Code-fixable:** true
- **Fix:** In processPlaylist compute sha256 of the already-fetched body and persist it back to Asset.fileHash instead of `continue`-ing on null; closes the backfill race.

### S13. USB includeEmergency bundles only the tenant-default emergency playlist, omitting the 6 per-screen per-type emergency playlists (lockdown/evacuate/weather/hold/secure/medical) + portrait variants
- **Domain:** storage · **Code-fixable:** true
- **Fix:** When body.screenId is set, also read that Screen's emergency*PlaylistId (+ portrait variants), dedupe with the tenant default, and include all resolvable ones in the bundle.

### S14. DEVICE_JWT_SECRET is validated lazily on first device request, not at boot — contradicts the documented 'refuses to start if missing' guarantee; a misconfigured deploy passes healthcheck then 500s all device auth
- **Domain:** ops · **Code-fixable:** true
- **Fix:** Add DEVICE_JWT_SECRET (and any other lazily-checked required secret) to an explicit boot-time assertion in main.ts, mirroring the ALLOWED_ORIGINS/connection_limit refuse-to-boot block.

### S15. SSE emergency stream re-checks token revocation only at open — an already-open stream keeps delivering after a device token is revoked/unpaired
- **Domain:** emergency · **Code-fixable:** true
- **Fix:** In SseService.register re-run the jwt_revoked_list check and re-read screen.status on each keepalive tick and close on revoked/REVOKED, or cap SSE lifetime with a short max-age forcing re-auth.

### S16. from-preset/:presetId clones a preset with no status filter — a known/guessable preset id revives a quarantined board into a live ACTIVE tenant template
- **Domain:** templates · **Code-fixable:** true
- **Fix:** Reject when QUARANTINED_PRESET_IDS.has(presetId) (or require status ACTIVE) in createFromPreset for both DB and in-memory paths.

### S17. Brand-palette ink picker (bestTextOn) chooses best-of-black/white but never guarantees ≥4.5:1 WCAG AA — mid-tone brand colors leave button text below AA
- **Domain:** a11y · **Code-fixable:** true
- **Fix:** If neither #fff nor #111 clears 4.5:1, darken/lighten the brand bg or pick a tinted ink until it does, and surface an 'adjusted for legibility' hint in the branding wizard.

### S18. imagen-4.0-generate-001 shuts down 2026-08-17 (~1 month out); Google-BYOK image generation 404s after that and needs a callGoogleImage rewrite, not an id swap
- **Domain:** ai · **Code-fixable:** true
- **Fix:** Migrate callGoogleImage to gemini-3.1-flash-image (generateContent + inlineData base64) before 2026-08-17; verify a GA image id first. Only affects Google-BYOK image path; OpenAI gpt-image unaffected.

### S19. AI cross-request spend race (AI-003A) — two concurrent fan-outs both pass the read-then-act headroom check and each spend, overshooting caps by up to count-1 per pair
- **Domain:** ai · **Code-fixable:** true
- **Fix:** Atomic Redis INCRBY-with-ceiling (or SELECT FOR UPDATE tx) reserving count before dispatch, refund on per-candidate failure. Bounded to cents; fine to defer past a controlled launch.

### S20. check-inset-serialization.cjs AST guard (the only detector for the grep-invisible inset-serialization Taurus landmine) is manual-run-only, wired into no CI workflow
- **Domain:** crossbrowser · **Code-fixable:** true
- **Fix:** Add `node apps/web/tools/check-inset-serialization.cjs` as a step in taurus-safety.yml, exiting non-zero on flagged regressions (informational-only list stays non-fatal).

## Config / decision-gated (Greg — not code): 10

1. Rotate DEVICE_SECRET_KEY, DEVICE_JWT_SECRET, JWT_SECRET and SESSION_SECRET to fresh crypto-random values in the Railway production env before public launch (W0-01). The emergency HMAC forgery gate's guarantee is only as strong as these secrets' confidentiality; no-default-boot enforcement is already shipped, but rotation is standard hygiene for a life-safety system.

2. Verify a Resend sending domain (SPF/DKIM/DMARC) and set EMAIL_FROM to an address on it. The default onboarding@resend.dev delivers ONLY to the Resend account owner — all other invites/approval/alert mail is silently dropped while the app reports SENT.

3. Enforce the advertised FREE_TRIAL: set PILOT_SEAT_LIMIT=3 in the API env (the default is 1000 = perpetual), or land the PLAN-001A trial-row backfill so signups get a real 14-day/3-screen trial row. Code enforcement path is already correct once a real trial row exists.

4. Configure Stripe to turn billing live: STRIPE_SECRET_KEY, STRIPE_PRICE_MONTHLY, STRIPE_PRICE_ANNUAL, and the webhook endpoint + STRIPE_WEBHOOK_SECRET. Until then billing degrades gracefully but no one can subscribe.

5. Provision POS OAuth apps for the launch provider(s) — Square/Clover/Lightspeed/Shopify CLIENT_ID/SECRET plus SQUARE_WEBHOOK_SIG_KEY for real-time auto-86. Until then the Connect button honestly surfaces 'OAuth not configured'; the custom bring-your-own-webhook path works with no platform credentials.

6. SSO/SAML ship-or-drop decision (task #199): SAML login is intentionally disabled (passport-saml uninstalled for CVE-2025-54419) and fails closed, but landing/pricing/developer surfaces advertise 'SSO / SAML'. Either migrate to @node-saml/passport-saml v5 to make SAML real, or label the SAML option 'coming soon' and keep marketing to Google/Microsoft/OIDC which genuinely work.

7. Set PLATFORM_ALERT_EMAILS in Railway so efficiency/egress anomaly alerts route to a monitored inbox; until then the SUPER_ADMIN fallback still pages the test account.

8. Pick the canonical support-email domain (venueos.app vs venue-os.app — currently inconsistent across billing/legal/help surfaces, some self-declared placeholders) and set all mailto/support strings to real, monitored inboxes.

9. Clever SIS sync silently truncates rosters >1000 (no pagination) and uses non-v3.1 role segments; dormant unless CLEVER_CLIENT_ID/SECRET are set. Fix pagination + role values (or label it beta/unvalidated) before marketing Clever as live.

10. Before launch, make one live test call per default AI model id per provider (platform default claude-haiku-4-5 plus the 2026-dated catalog ids) to confirm each is actually GA — the retirement CI gate can prove a known-retired id was removed but cannot prove a new id exists, and a wrong default = fleet-wide platform-path 404 with no tripwire.

## World-class program (multi-week, honestly not days-away): 7

1. Player-side end-to-end Ed25519 signature verification of emergency messages — today the player only checks a signature field is PRESENT; the real defense is the server-side HMAC gate. Genuine hardening is per-tenant asymmetric key issuance at pair time (multi-week), not a days-away item.

2. Structural tenant isolation: isolation currently depends on each service adding tenantId to its where-clause with no framework backstop. Introduce a request-scoped tenant-guarded Prisma client extension that injects/requires tenantId on tenant-owned models, plus a CI AST gate flagging bare-id findUnique/update/delete (multi-week).

3. Template approval/release pipeline (TPL-002): quarantine is an interim hardcoded denylist; suppressing a bad/licensing-risk board requires a code edit + redeploy. Build a real review gate so new boards don't ship straight to ACTIVE.

4. ~1037 container-query-unit usages in player/widget paths are unsupported on ALL Taurus firmware (Chromium 83 AND 87). Enumerate which cq-using widgets are Taurus-targeted, add @container fallbacks or JS-measured scaling, then ratchet the baseline down. Confirm the launch cohort's firmware first — deferrable if no Chromium-<105 Taurus walls ship initially.

5. 221 pre-existing jsx-a11y errors (keyboard-on-div, static-element interactions, label association) across ~142 onClick components — a real ADA Title II / Section-504 exposure for district procurement. Dedicated a11y sprint to convert interactive divs to buttons + add key handlers/roles/names, ratcheting the down-only baseline to zero.

6. Sponsor proof-of-play cue-fired endpoint is tokenless (must be — the caller is the un-authed public ribbon) and, despite id-validation/dedup/rate-limits, allows bounded valid-impression inflation (~14,400/hr). Full fix is device-authenticated proof-of-play with a signed per-render device token (multi-week). Do not sell the impression PDF as audited until then.

7. uncaughtException/unhandledRejection handlers are deliberately log-only, so the process can keep serving from a corrupted state. Post-launch: on uncaughtException, log + graceful server.close() with a short timeout then exit(1), letting Railway's restart policy recycle a clean pod.