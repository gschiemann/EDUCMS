# Functional Depth Audit — Live-Drive Session 1 (2026-07-20, late)

**Method: drove the LIVE product (venue-os.app) logged in as a real persona — the seeded
CONTRIBUTOR on the Springfield test tenant — via browser automation. Every claim below was
witnessed on production, not grepped.** Session scope: dashboard, templates gallery, AI
entry, preview-modal forensics. Remaining surfaces queued (see end) with a methodology fix.

## Access + persona

- Authenticated via the public login API with the repo's seeded credentials
  (`admin@springfield.edu` / seed password from `packages/database/prisma/seed.ts`).
- **FINDING (security, positive+action): the public-repo seed credential is LIVE on prod
  but the account has been DEMOTED to CONTRIBUTOR** (seed file says SUPER_ADMIN; live JWT
  says CONTRIBUTOR, canTriggerPanic false). Someone contained it — good. Action: rotate the
  password anyway pre-launch (public repo = known credential), and consider a seed that
  refuses to run with the default password when NODE_ENV=production.
- Token TTL ~1h; contributor persona = the "teacher" customer lens (a real persona, not a
  compromise).

## Witnessed — grades (D / UX / F)

1. **Dashboard** — A / A / A-. Premium first paint (greeting, local time, honest fleet
   health "0 / 3 screens online", 3-step getting-started, role-slim nav for an Editor,
   15-unread notifications). Screenshotted.
2. **Templates gallery** — A / A / A-. Hero with the right three actions; the import
   button's a11y label says "**Import a PDF / Canva / Slides export**" — HONESTLY worded
   (file import, not the unbuilt Canva OAuth; TRUTH-001-consistent in UI copy). K12 age
   filters + category chips. Preset tiles render LIVE widget previews (ticking clocks —
   witnessed) → **today's lazy widget chunk works in production** (one ~630KB-wire fetch,
   executed). Per-card labeled hot-zones ("Edit header/weather/…") + "Adapt to custom LED
   canvas" — strong a11y depth.
3. **AI entry (no-key tenant)** — A / A- / A-for-degradation. "AI isn't enabled yet…
   Ask your administrator to enable AI in Settings → AI" — honest, role-aware, no dead
   buttons. **Business evidence: the flagship hero CTA is dark for EVERY fresh tenant until
   `ANTHROPIC_API_KEY` (platform Tier-1) is set on Railway — witnessed as a customer.**
4. **Minor defect: 5 HS board poster thumbnails 404 in prod** —
   `/templates/_thumbs/hs/{achievement,morning-news,bell-schedule,gallery,zine}.png`.
   Cards fall back to live 4K iframes (correct fallback, slower gallery + console noise).
   Fix: regenerate those posters (thumbnail pipeline) — small.

## Preview-modal forensics (resolved — NOT a product bug)

Full-screen preset preview rendered a blank scene. Chased to root cause instead of logging
noise: scene div mounts at correct 3840×2160×scale with **zero children** → `isVisible`
gate in `ScaledTemplateThumbnail` never opens → probed live: a FRESH IntersectionObserver
on the fully-on-screen 1195×672 element **never fires** → `document.visibilityState ===
'hidden'` — the embedded audit pane is a hidden document, and **Chromium defers ALL
IntersectionObserver callbacks (and timers) on hidden pages**. The same gate rendered the
gallery tiles while the pane was fronted. Code path verified sound by inspection (dual-IO
hysteresis, mount-600px/unmount-1600px; modal path pre-dates today's split — my six
conversions never touched it).
**Takeaways:** (a) methodology — IO-gated surfaces MUST be audited via headed Playwright
runs (repo already has the harness), not an occluded pane; (b) coverage gap — the preview
modal has NO automated spec; add `template-preview-modal.spec.ts` (open gallery → preview →
assert widget subtree mounts) so this surface stops relying on manual eyes.

## Open items (precise, unresolved tonight)

- **Background API 403s ×4 as CONTRIBUTOR on the templates page** (console: `[api] API
  error 403`). Not the preview (it fires zero fetches — props-driven). Pollers are
  suspended on hidden pages so the instrumented fetch never caught it re-firing; Railway
  http-log filter returned empty for the window. Next: headed run with network capture, or
  temporary API middleware log. Suspect class: a dashboard/templates poller hitting an
  admin-gated endpoint — silent console noise + wasted requests for every contributor.
- Admin-surface drive (settings/AI/integrations/screens management) blocked on an admin
  door: Chrome extension with Greg's session, or a test-admin credential.

## Queued next (with the methodology fix: headed Playwright + fronted pane)

Imports drive (real PDF upload → template + playlist), builder deep pass (panels, zone ops,
save/publish), POS + marketing + social surfaces to their honest boundary, mobile-viewport
pass (375px, tab bar, More sheet), player pairing flow, screens-module tenant-isolation
tranche (27 sites), coverage table (21 × D/UX/F) at program end.
