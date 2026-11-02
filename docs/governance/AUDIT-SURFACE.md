**Scope:** the Standard Audit Surface — the domain map every audit of "the app" must cover. It has the same authority as `/CLAUDE.md` (§11 requires audits to cover every section or say on page one what they skipped). Sections 1–21 moved verbatim from the old single-file `CLAUDE.md` on 2026-11-01; sections 22–27 were added the same day and have not been audited yet (move map: `docs/governance/decisions/2026-11-01-rulebook-restructure-map.md`).

# Audit Surface

## Standard Audit Surface — every audit MUST cover this list explicitly

Lead's rule (2026-05-26): *"when i say audit the entire app … every streaming integration, every AI template, every POS integration, every AI tool that exists or should exist needs to be discovered."* When the lead asks to audit "the app" / "every integration" / anything implying full coverage, the audit MUST explicitly enumerate **every** domain below and mark each: **covered** / **N-A (not yet built)** / **deferred-with-reason**. Silently scoping down is forbidden — if a domain is skipped, the audit report MUST say so on the first page.

This list is the floor, not the ceiling. Add to it when a new integration domain appears in the codebase. Future audits should grep `## Standard Audit Surface` in `docs/governance/AUDIT-SURFACE.md` and check every bullet.

### 1. Real-time + signed pub/sub
- Emergency trigger / all-clear / per-screen overrides
- WebSocket gateway signing + verification (timestamp unit, signature pass-through, freshness window)
- Redis fan-out gate (verifyWsHmac on every replica's pmessage)
- HTTP polling backstop via manifest endpoint
- SSE controller fallback
- Player WS message-type handlers (OVERRIDE, ALL_CLEAR, TENANT_CHANGED, SOS, TEXT_BROADCAST, MEDIA_ALERT, REFRESH_WEB, CHECK_FOR_UPDATES, SYNC)
- Hold-to-trigger + typed-confirm UX consistency
- Per-eventId dedup at every layer

### 2. Storage + content pipeline
- Supabase asset upload + Cache-Control / egress
- Service-worker offline cache tiers (playlist + emergency, never-evict floor)
- USB playlist sticks (2026-10-22 — no settings, no PIN): "Download to USB" / the wizard's "USB drive" destination (`@/lib/usb-export`) → API signs with a silently minted tenant key (`usb-export/usb-signing-key.ts`) → a paired APK fetches the key (`GET /screens/:id/usb-key`), auto-detects the stick, verifies HMAC + every SHA-256, imports (`usb/UsbPackage.kt`, `UsbAutoImport.kt`) and serves it to page + service worker; the web player overlays it on normal manifests only (`player/usbPackage.ts`) until the next server publish
- Floor plan upload (Sprint 8b)
- Asset re-cache backfill jobs
- Image / video transcoding pipeline (built — `apps/api/src/storage/video-transcode/`)

### 3. AI providers — every entry point × every provider
For each of the 3 providers (**Anthropic / OpenAI / Google**):
- Test-on-save error mapping (every status code, quota disambiguation)
- Generate-time error mapping (same disambiguation, NOT separate code)
- Out-of-credit vs rate-limit signature recognition
- AuditLog row on success AND on failed key tests
- BYOK key encryption + rotation + revocation
- Platform free-tier usage accounting (multi-replica safe)
- Model catalog freshness (deprecated-model graceful fallback)
- AbortSignal timeout on every fetch
- Prompt caching where supported (Anthropic ephemeral)
- Temperature parity across providers

### 4. AI feature surfaces — every place AI does work
- Sparkle button (text generation in widgets — PropertiesPanel mount sites)
- Touch-template generation (full-template synthesis)
- AI image generation (OpenAI / Google image models) — built (`POST /templates/:id/regenerate-image`; on our key only for the VenueOS + AI plan and free trials)
- AI background removal — if/when built
- AI translation for multilingual templates — if/when built
- TTS for emergency announcements (V2 spec — Voice synthesis)
- Auto-celebration trigger via score-feed (Sprint 13 AUTO)
- AI summarization of incoming context (V2 controlled assist)
- AI-from-CMS-data (lunch menu copy from POS, schedule descriptions)
- AI alt-text / caption auto-generation
- AI anomaly detection (offline-screen pattern, abnormal playback)
- Voice-to-text for SOS voice notes — if/when built

### 5. AI-tool comparative scan
Each "audit the entire app" pass MUST list AI features industry leaders ship that we DON'T yet have, and grade competitive parity. Examples to check:
- Yodeck / Rise Vision / OptiSigns / ScreenCloud / BrightSign AI features
- Canva Magic Write equivalent for content fields
- Smart playlist suggestions ("for a Tuesday lunch crowd")
- Content scheduling AI ("post this video next Tuesday")
- CV asset tagging on upload
- AI-generated celebration animations (Sprint 13 stretch)
- AI-suggested template themes from logo color extraction
- Computer-vision people-counting for sponsor proof-of-impressions

If a feature is on this list and we don't ship it, flag as a competitive gap with severity.

### 6. Streaming integrations
- RTSP camera feed widgets (V2 Responder Bridge)
- HLS / DASH / M3U8 live streams in player
- Embedded YouTube live / Twitch / Facebook Live (Periscope shut down in 2021)
- NFHS Network broadcast overlay (Sprint 13 streaming)
- Webcam URL widget
- Streaming asset playlist support (treat as Asset, schedule rules)
- IP camera RTSP share-links for responders (V2 Phase 2)

### 7. Sports score / data integrations (Sprint 13)
- Daktronics All Sport console tap-off
- Sportzcast / Scorebird
- Genius Sports / Sportradar live feeds
- MaxPreps
- GameChanger
- Game-state console publishing
- Auto-celebration from score delta
- Per-sport widget set parity (every sport in the Sport Engine spec)

### 8. POS / commerce integrations
- Square (restaurants / retail)
- Toast (restaurants)
- Clover (restaurants / retail)
- Lightspeed (retail)
- Shopify (retail)
- Stripe Terminal (in-venue checkout, distinct from billing)
- Pull-from-POS for menu boards (price + availability)
- Pull-from-POS for inventory signage
- Pull-from-POS for promo / happy-hour automation

### 9. Communications integrations
- Twilio SMS / voice (V2 multi-modal output)
- Email (Resend, `apps/api/src/email/` — not SendGrid)
- APNs / FCM push notifications (mobile panic page)
- Slack outbound notifications
- Microsoft Teams outbound notifications
- PagerDuty / OpsGenie (V2 responder escalation)
- Webhook outbound (custom integrations)

### 10. Auth + identity
- JWT issuance + revocation (jwt_revoked_list)
- Argon2 password hashing
- express-session cookies
- TOTP MFA (built — `apps/api/src/auth/mfa.controller.ts`)
- WebAuthn passkeys (built — `apps/api/src/auth/passkey.controller.ts`)
- SSO (OIDC built — `apps/api/src/sso/`; SAML is a stub that is hard-gated off, `passport-saml` intentionally not installed)
- Clever SIS (built — `apps/api/src/integrations/clever/`, env-gated by `CLEVER_CLIENT_ID` / `CLEVER_CLIENT_SECRET`)
- Role staleness (canTriggerPanic JWT-claim vs live row)

### 11. Billing + commerce
- Stripe Checkout / Customer Portal / Invoices
- Stripe webhook idempotency + ordering + audit
- License seat enforcement (SERIALIZABLE pair-tx)
- Multi-vertical pricing tiers
- Free pilot lifecycle (14-day trial activation, conversion)
- Dunning / past-due UX
- Refunds + comp seats (SUPER_ADMIN paths)
- PCI scope (every form, every log line — no PAN anywhere)

### 12. Design import integrations
- PDF / PPTX upload → playlist (Sprint 10)
- Canva Connect (Sprint 11)
- Google Slides via Drive API (Sprint 11)
- Microsoft PowerPoint Online via Graph (Sprint 11)
- Figma (Sprint 11)
- Keynote (fallback to PDF export)

### 13. Public alert integrations (V2)
- CAP (Common Alerting Protocol) inbound
- IPAWS inbound consumption (FEMA national alerts)
- IPAWS outbound origination (FEMA-authorized — explicit decision needed)
- Raptor SOS integration
- RapidSOS integration
- PA / IP-speaker (Valcom / Atlas / SingleWire InformaCast Fusion)

### 14. Multi-vertical surface
- Every vertical in `packages/api-types/src/verticals.ts` has its sample identity there (`VerticalSample`) and its industry copy in `useTenantCopy` (`apps/web/src/hooks/use-tenant-copy.ts`); `DistrictSchoolsCard` no longer exists — its behaviour moved to `settings/cc/LocationsPage.tsx`
- Vertical-specific default templates (Sports gets scoreboards, Retail gets promos, etc.)
- Sample data per vertical (signup + onboarding flows)
- Vertical-aware billing tier names (no "EDU District" on a Sports tenant)
- Per-vertical AI prompts (announcement style for school vs gym vs restaurant)
- Per-vertical sample URLs for branding wizard
- Brand-applyToTemplates covers vertical-specific widget sets (Sports, Retail, etc.)
- "Add a [noun]" buttons say "Location" for every vertical (the hierarchy nouns are unified — `useTenantCopy`, operator decision 2026-06-01); only the industry identity (tagline, template categories, role labels) varies by vertical

### 15. Cross-browser + Chromium-83
- Safari (WebKit) — every customer-facing surface
- Chromium 83 (NovaStar Taurus) — every player-shipped surface
- Tailwind class sweep (gap-*, inset-*, backdrop-blur-*, has-*, container-type, oklch, color-mix, aspect-ratio, text-wrap-balance)
- Cross-browser CI baseline ratchet (only DOWN, never UP)
- Per-template WebKit smoke check (not just 18 holiday templates)
- Older Android System WebView for kiosk APKs

### 16. Forensic / audit coverage
- AuditLog row on EVERY privileged action (every mutation, every key change, every login attempt, every payment event)
- DB-level immutability triggers (UPDATE/DELETE blocked at storage)
- Cross-tenant scope verification on every actor-id check
- Replay-attack defense (per-eventId dedup, idempotency tables)
- Cron-triggered consistency checks (License vs Stripe quantity, Tenant.address vs lat/lng)

### 17. Operational + DX
- Health endpoints (liveness, readiness, emergency-path)
- CI gates (preflight, taurus-safety, cross-browser, a11y) — they report on PRs and pushes; only the four build checks block a merge (see Deploy Reliability)
- Git hooks (pre-commit: lockfile drift and `inset: 0` in player/widget files; pre-push: `pnpm preflight` — no secret scan locally, gitleaks runs in CI)
- Rollback procedure (revert the PR or redeploy the previous build; nightly `db-backup.yml` for data — see Backup & Rollback)
- Multi-replica safety (in-memory caches → Redis when load-bearing)
- Connection pool sizing (`connection_limit=10` + `pool_timeout=20` on DATABASE_URL)
- Boot-time required-secret enforcement

### 18. Accessibility + a11y
- axe-core CI baseline (Sprint 1 work)
- Screen-reader live regions on emergency surfaces
- Keyboard-only navigation through every flow
- aria-live announcements on hold-to-trigger
- Color-blind-safe pin colors on fleet map
- Sufficient contrast on all brand-injected palettes (WCAG AA minimum)

### 19. Template + Widget Editability Standard

Operator complaint (2026-05-26): *"none of the fucking templates are even editable, you can't edit a single word"*. The audit must grade every widget A-F against these criteria. Anything below B is a launch blocker.

For each widget under `apps/web/src/components/widgets/`:
- **Text** addressable: content, font family, font size, font color, font weight, alignment, line-height (use `StyleableField`)
- **Image** replaceable: asset picker OR URL paste, fit/position controls (cover / contain / fill)
- **Background**: solid color, gradient (2-stop minimum), image upload — all editable in PropertiesPanel
- **Clock**: timezone selector, 12/24-hour, second-hand toggle, date-format
- **Countdown**: target date/time picker, units shown (days/hours/min/sec), label customizable
- **Charts / lists / menus**: items addable / removable / reorderable
- **Position + sizing**: x/y, w/h, rotation, z-index, opacity (canvas-relative percentages)
- **Brand-palette honoring**: every color field offers "Brand primary" / "Brand accent" preset that resolves to `var(--brand-primary)` / `var(--brand-accent)`

Audits MUST list every widget + the missing fields. Adding entries to a registry without wiring them into `PropertiesPanel` does not count — the operator must actually be able to click the text and edit it.

### 20. Design + UX + Functionality lenses

Every "audit the entire app" pass MUST score every Standard Audit Surface section (1-27) across three lenses:
- **DESIGN**: does it look like a $$$ product? Would a superintendent show this to their board?
- **UX**: can a non-IT operator complete the task in 30 seconds without help / docs / a Loom video?
- **FUNCTIONALITY**: does it actually work end-to-end? Or is it "Coming soon" wearing a real-button costume?

The audit report's page 1 coverage table has 3 columns (D / UX / F) × 27 rows. Anything ≤ B in any column is a gap.

**UX time-budget — a standing acceptance gate (added 2026-05-29).** Beyond audits: NO new operator-facing feature ships without a named **happy path** a non-IT operator can complete in **under 30 seconds / a handful of clicks**, plus a screenshot (or Playwright run) proving it. "Easiest UX — the app almost does the work for them" is a north-star, not a nicety: default to auto-detect + sensible defaults + one-click over forms; route operators through the **Integration Concierge** (paste-URL / describe-in-a-sentence → we discover + wire the integration + auto-seed the first template) wherever they'd otherwise need an IT consultant. If a feature can't clear its 30-second happy path, it isn't done.

### 21. Verification Before Claim — discipline

Incident: `docs/incidents/2026-05-26-logo-bug-round-7.md`.

Before telling the user a fix shipped, you MUST do one of:
1. Load the rendered page in Playwright, screenshot, eyeball it
2. Use the Chrome MCP / Preview MCP to navigate to the live Vercel URL and click through
3. Fetch the deployed asset (`curl ...vercel.app/path`) and grep for the change
4. Read a fresh git log on master and confirm your commit landed AND CI is green AND Vercel deployment shows "Ready" timestamp newer than your push

If you can't verify, SAY SO. "Pushed, awaiting verification" beats "Done!" every time. The user has explicitly named this: *"stop wasting my time and make sure shit is actually working before you fucking blindly tell me shit is done."*

### 22. Privacy & student data (added 2026-11-01 — not yet audited)
- FERPA / COPPA posture for K-12 tenants: what student data the product holds, who can see it, and the attestation an administrator gives
- Default-deny of student names and photos on public screens until that attestation and a per-student opt-out exist
- Data retention per table (playback samples, request logs, audit logs, bug telemetry, uploaded media) and what is deleted when a tenant leaves
- Data-subject access and deletion requests (DSAR): who can export or erase a person's data, how, and the audit row it leaves
- Sub-processors (hosting, database, email, billing, AI vendors): what personal data reaches each, in a list a district can read
- Third-party requests made by a screen at render time (fonts, images, scripts) — what an offline or privacy-sensitive school screen leaks

### 23. Supply chain (added 2026-11-01 — not yet audited)
- Lockfile discipline: frozen installs in CI, drift gate, no unreviewed dependency bump
- Build provenance and SBOM for the API image and the player APKs (SLSA-style attestation)
- Dependency CVEs: scanning cadence, who triages, how long a known-vulnerable version may ship
- GitHub Actions pinned by commit SHA, least-privilege tokens, no third-party action with write access to secrets
- APK signing: where the release keystore lives, who can sign, rotation and revocation of the signing key
- Secret scanning in CI and on push; what happens to a secret already in history

### 24. Fleet & OTA (added 2026-11-01 — not yet audited)
- Update rings: lab → field window (bench screens) → canary cohort → fleet, with the promotion rule written down
- Hardware classes and the qualification matrix: which class has a recorded PASS for which scenario
- Kill switches for every autonomous behaviour (quarantine of a release, per-screen opt-outs) and the failure direction of each
- Rollback of a bad APK or web bundle: how fast, by whom, proven how
- Field builds and windows: who can arm one, what is audited, which screens may receive it
- Mass-action rules: one hardware class at a time, off-hours, never during playback

### 25. SLOs & error budgets (added 2026-11-01 — not yet audited)
- Alert delivery: trigger → painted on the glass, with a p99 target and a daily synthetic drill
- Manifest freshness: how stale a screen's content may be before the fleet UI says so
- API availability and the error budget that gates risky releases
- Screen-online and render-proof ratios as customer-visible health
- Who is paged, for what, and how an SLO breach turns into a rule or a gate

### 26. Disaster recovery (added 2026-11-01 — not yet audited)
- Backups: what is backed up, how often, where, encrypted with what
- Restore drills: the date of the last one, its duration and what it found
- RPO and RTO per data class (database, object storage, configuration)
- Loss of a key or secret: rotation windows, the runbook, the fleet impact
- Loss of a provider (hosting, database, Redis, object storage, repository): the documented path to recover
- Loss of a person: who else can deploy, rotate and merge

### 27. Assistive technology & accessibility testing beyond axe (added 2026-11-01 — not yet audited)
- Screen-reader passes (VoiceOver, NVDA/JAWS) over the emergency trigger flow and the operator's daily tasks
- Remote-only (D-pad) operation of every on-glass surface, with parked focus and a visible highlight
- High-contrast and forced-colors modes; reduced-motion preferences
- Captions or text equivalents for audio and video in alerts
- Colour-independent status (no meaning carried by colour alone) on dashboards and the fleet map
- Manual keyboard-only passes recorded per release, not only the automated baseline

### How to invoke this checklist

Every audit prompt sent to an agent OR run interactively MUST start with:
> "Use the Standard Audit Surface checklist in docs/governance/AUDIT-SURFACE.md as your domain map. For every numbered section (1-27), report covered/N-A/deferred across the Design/UX/Functionality lenses. If you scope down, say so on the first page."

The audit report's first section MUST be a table showing all 27 sections × 3 lenses and their coverage status. Anything missing from the table is a gap.
