# VenueOS — Full Standard Audit Surface Audit (2026-05-30)

**Method:** 7 read-only agents, all 21 Standard Audit Surface sections × Design/UX/Functionality lenses, every documented safeguard/feature traced to real callers (`file:line`), costumes hunted, run against current master (`8eb8768`) — newer than the 2026-05-28 synthesis. Per-cluster reports: `01`–`07` in this folder.

## Headline
**The app is in strong shape and has moved well ahead of the 2026-05-28 audit. Zero P0s remain — every prior P0/P1 traced was verified genuinely fixed (not theater).** The integration surface is now *honest*: un-wired vendors are rejected at the API boundary, not fake buttons. Residual findings are P1 (mostly Taurus-rendering + test-coverage) and P2/P3 cleanup, plus competitive **feature gaps** (AI image-gen / translation) that are net-new builds, not bugs.

## Page-1 coverage table (21 × D/UX/F)

| § | Domain | D | UX | F | Status |
|---|---|---|---|---|---|
| 1 | Real-time + signed pub/sub | A | A | A− | covered |
| 2 | Storage + content pipeline | A | A | A− | covered |
| 3 | AI providers × entry points | A | A | A− | covered |
| 4 | AI feature surfaces | A | A− | B+ | covered |
| 5 | AI comparative scan | — | — | C+ | covered (competitive gaps) |
| 6 | Streaming | B+ | B+ | B | covered |
| 7 | Sports score/data | A− | B+ | B+ | covered |
| 8 | POS / commerce | B+ | B+ | B | covered |
| 9 | Communications | A | A | A (email) / N-A (unbuilt) | covered |
| 10 | Auth + identity | A− | B+ | A− | covered |
| 11 | Billing + commerce | A | A | A | covered |
| 12 | Design imports | A | A | B | covered (Sprint 10/11 N-A) |
| 13 | Public alert integrations | — | — | N-A | N-A (V2, honest) |
| 14 | Multi-vertical surface | A | B+ | B− | covered (content depth) |
| 15 | Cross-browser + Chromium-83 | B+ | B | B | covered (aspect-ratio P1) |
| 16 | Forensic / audit | A | A− | A− | covered |
| 17 | Operational / DX | A | A | A | covered |
| 18 | Accessibility | A | A | A− | covered |
| 19 | Widget editability | A | A− | A− | covered |
| 20 | Design/UX/Functionality lenses | — | — | — | applied throughout |
| 21 | Verify-before-claim | — | — | — | discipline (this audit traced every claim to code) |

**N-A (honest, not built — roadmap, correctly not faked):** §13 CAP/IPAWS/Raptor/RapidSOS/PA-speaker (V2); §6 RTSP transcoder, NFHS managed integration; §7 Daktronics/Sportzcast/Genius/MaxPreps/GameChanger syncs; §8 Toast/Clover/Lightspeed/Shopify/MINDBODY; §9 Twilio/Slack/Teams/push/PagerDuty; §10 WebAuthn; §12 Canva/Slides/PowerPoint/Figma. None are sold-but-absent costumes.

## Consolidated punch-list

### P0 — none.

### P1 (fix this pass)
1. **§15-2 — `aspect-ratio` collapses on Taurus/Chromium-83** (12 widgets: cafeteria boards, product grid, MsStudio). Real render bug today, no polyfill. → padding-hack / explicit height. *[07]*
2. **§15-1 — `text-wrap: balance` degrades on Taurus** (8 MS widgets). → drop / `@supports` guard. *[07]*
3. **§15-4 — 17 new widget families have ZERO WebKit smoke** (Bulletin/Scrapbook/Storybook/HS/MS) — Safari-killer risk via `dangerouslySetInnerHTML`. → add to `widget-render.spec.ts`. *[07]*
4. **§10 F-1 — `passport-saml@3` CVE-2025-54419 on a self-service-enableable path** (any DISTRICT_ADMIN can flip `enabled:true`). → interim: gate SAML-enable behind SUPER_ADMIN; full: migrate to `@node-saml/passport-saml@5` (task #199 — feature). *[04]*

### P2 (fix this pass)
5. **§16 — unknown-email failed logins not in durable audit trail** (`AuditLog.tenantId` NOT NULL). → sentinel "system" tenant for security events. *[05]*
6. **§2 — legacy null-hash assets have no SHA-256 integrity verification** (no backfill). → one-off backfill script. *[01]*
7. **§3 — model catalog stale** (claude-3-5-haiku/opus-4/gpt-5/gemini-2.5). → refresh IDs. *[02]*
8. **§3 — Anthropic prompt-cache in only 1/6 sites** (cost waste on platform-paid gen). → `cache_control` on the 5 user-facing calls. *[02]*
9. **§14 / §3 — no per-vertical AI system prompts** (intent-keyed only). → branch system prompt on vertical. *[02][06]*
10. **§14 — no signup sample-data auto-seed** (empty first dashboard). → seed a vertical starter playlist on first login. *[06]*
11. **§11 — `activate-trial` is a cosmetic stub** (no DB write). → persist a real trial License or relabel. *[05]*
12. **§15-3 — backdrop-filter solid-bg fallback unverified** (AnimatedMorningNews, AchievementShowcase, fitness/*). → verify per file. *[07]*
13. **§18-1 — hold-to-trigger has no keyboard (onKeyDown) equivalence** → keyboard-only operator can't trigger emergency. → add Space/Enter handler + keyboard E2E. *[07]*

### P3 (fix the cheap ones; defer the rest with note)
14. §10 F-2 — device-WS revocation env-gate inconsistent → drop the gate (strengthens). *[04]*
15. §14 — FASHION not cross-tagged to RETAIL → dual-tag. *[06]*
16. §19 — brand swatch emits frozen hex not live `var(--brand-*)` → emit the var. *[06]*
17. §2 — 80% emergency-floor warning not implemented. *[01]*
18. §3 — alt-text hourly cap not shared with sparkle. *[02]*
19. §1 — SSE-tier emergency messages skip client-side replay dedup (server HMAC-gated; optional). *[01]*
20. **DEFER (Greg's call):** `PILOT_SEAT_LIMIT=1000` (deliberate testing value — flip to contracted count at first paid onboarding). *[05]*
21. **DEFER (premature):** in-memory rate-limiters → Redis (only matters >3 replicas; each has a Redis `@Throttle` wall already). *[05]*

### Feature-builds (NOT fixes — flagged, not faked)
- **AI image generation** (HIGH competitive gap vs OptiSigns/Canva). *[02]*
- **AI translation / multilingual** (HIGH — K-12 ELL + V2 multilingual emergency). *[02]*
- **SPORTS gallery depth** (11 → full 6-category Sprint-13 ambition). *[06]*
- **`passport-saml@5` full migration** (interim gate covers the risk). *[04]*
- Named POS/sports/streaming vendor syncs; Twilio/Slack/push; CAP/IPAWS/Raptor (all honest roadmap N-A).

## Bottom line
No launch blockers. The highest-value fix is the **Taurus `aspect-ratio` render bug** (real, on-wall today). The highest-value *latent security* item is the **SAML CVE enable-gate**. Everything else is cleanup. The competitive AI gaps (image-gen, translation) are the biggest *product* opportunities but are builds, not fixes.
