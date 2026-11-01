# Application profile — VenueOS

Article 6 of the Foundry Standard. Everything not listed under "Approved exceptions" is governed by the standard as written.

| Field | Value |
|---|---|
| Application name | VenueOS (repository "EDU CMS") |
| Primary mission | One platform that runs everyday signage, native life-safety alerts (lockdown / weather / evacuation) and, in sports, full game presentation on the same screens. |
| Primary users | K-12 district and school administrators and staff; venue, restaurant, retail, worship and corporate operators; installers working wall-mounted panels with a D-pad remote as the only input; the public who read the screens; the company's super-admins. |
| Business model | Per-screen subscription: $20 / screen / month ($200 / year) without AI, $25 / $250 with AI; free trial; invoice / PO / comp accounts via super-admin; Stripe-hosted card entry only (PCI SAQ-A scope). Pricing is the owner's decision alone. |
| Critical workflows (must never break) | Emergency trigger → every screen in scope shows the alert within seconds → all-clear. Pairing a screen. Publishing a playlist or schedule (staged media delivery, screen-sized copies). Player boot, offline recovery, credential renewal. OTA updates (one hardware class at a time). Sign-in with MFA / passkeys and first-login setup. Billing. |
| Sensitive information handled | Credentials (argon2), MFA secrets and device credentials (sealed with `DEVICE_SECRET_KEY`), tenant content, **K-12 student names and photos (default-DENY on public screens until FERPA attestation and per-student opt-out)**, customer admin emails, audit logs including who fired a lockdown and from where, Stripe customer ids (never card data), BYOK AI keys and POS / streaming / social credentials (sealed), kiosk Wi-Fi. |
| External integrations | Supabase (Postgres, storage), Redis, Railway, Vercel, Resend, Stripe, Anthropic / OpenAI / Google AI, Pexels, Google Maps and Places, Meta (Instagram, Facebook), Clever, GitHub Releases (APK), Goodview vendor services on the panel; planned: Canva, POS (Square, Toast, Clover, Lightspeed, Shopify), sports feeds. |
| Availability requirements | The emergency path must deliver during a Redis or WebSocket outage (HTTP polling fallback) and to a panel that is in standby (native alert watch). `/health` liveness always 200; readiness and emergency-path probes separate. Single API replica with leader-leased workers. SLO targets in `docs/SLO_AND_ONCALL.md` (not yet contracted; no paging rotation — recorded GAP). |
| Regulatory considerations (facts, never claimed certifications) | FERPA (student data); PCI SAQ-A scope (Stripe-hosted card entry); WCAG AA target for dashboards; US data residency on the current Supabase project. Customer security documents state only what signage vendors publish — never certifications we do not hold (owner rule 2026-10-05). |
| Mission-critical / life-safety paths (by file path) | `apps/api/src/emergency/**` · `apps/api/src/realtime/redis.service.ts` (`verifyWsHmac`) and the WebSocket signer · the manifest's `emergency` field (`apps/api/src/screens/**` manifest resolution) · the web player's emergency-first apply and interlock (`apps/web/src/app/player/**`, `emergencyInterlock.ts`, `applyManifest`) · the APK's native alert watch and emergency display path (`apps/player/**` `DisplayEmergency*`, alert watch) · `.github/workflows/emergency-path.yml` and its fixtures. |
| Platforms and real targets (the "glass") | Android kiosk players (Goodview GUQ Amlogic t982 / Android 11–13, Rockchip rk3288 / rk3328 double-sided units, NovaStar Taurus LED controllers on Chromium 83–87), Safari / Chrome / Firefox / Edge dashboards, iPhone for the operator. |
| The physical bench (the digital twin) | The owner's bench units, one per hardware class, listed in `apps/player/HARDWARE-QUALIFICATION.md`. Open at adoption: the launch GUQ classes are not yet qualified on the glass and field-candidate builds bypass the tag-time gate (`MECHANISMS.md`, GAP 1). |
| Standard version pinned | 1.0.0 (`standard/standard.lock`) |

## Approved exceptions to the standard

| Exception | Article | Approved by | Date | Reason | Expiry |
|---|---|---|---|---|---|
| Weekly review instead of a daily improvement proposal; the daily is `ops-sweep` | 44 | owner (accepted the lead's default) | 2026-10-31 | one owner; daily proposals would not be read | — |
| Creativity produces proposals only; no unrequested UI ever ships | 2 | owner (standing rule 2026-09-01) | 2026-10-31 | the owner is the designer of record | — |
| Repository stays public while CI minutes are billed | 16, 36 | owner | 2026-10-12 | cost; rulesets require public or Pro | until CI billed minutes < ~3,000 / month |
| No paging rotation; alarms by email to the owner | 22, 23 | owner | 2026-10-12 ("bare-minimum ops") | one-person company | review at the first weekly review after launch |
