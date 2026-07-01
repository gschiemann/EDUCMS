# New-Endpoint Security Audit — this week's merge wave (quick, lead-authored)

Date: 2026-07-01 (Fable, final 1% budget). Scope: every API surface added
AFTER the 2026-06-26 pre-launch security audit — the ~10-commit wave
(App Library Tier-1/2, Concierge own-links, swim/dive depth, refine-designer).
Rationale: heavy churn = new attack surface that was never security-reviewed
as a set; the scariest candidate was the swim ingest living in the
deliberately-PUBLIC /sports/board/:id controller.

## Verdict: PASS — all new endpoints properly secured (code-verified)

| Endpoint | Auth verified |
|---|---|
| `POST /sports/board/:id/swim-timing-snapshot` | ✅ Rate-limit BEFORE token check (anti-hammer/anti-timing), then game-scoped HMAC `verifyFeedToken(id, token, version)` → 401. Mirrors the hardened `/cts-snapshot` + `/feed` pattern exactly (sports-board.controller.ts:232-260). NOT open despite the unguarded (by-design public-poll) controller class. |
| `POST /templates/refine-designer` | ✅ Class-level `@UseGuards(JwtAuthGuard, RbacGuard)` (templates.controller.ts:97) + handler scopes by `req.user.tenantId`. Output re-sanitized + re-injected; board HTML renders in the null-origin sandboxed iframe (the real boundary). |
| `POST /integrations/discover` + `/describe` (own-links additions) | ✅ Class-level JwtAuthGuard+RbacGuard (integrations.controller.ts:44), pre-existing rate limits (20-30/hr), `extractOwnLinks` parses already-safeFetch'ed HTML — no new SSRF surface. |
| App Library client code (url-transforms, brand-icons, starterLayouts, GameStateProvider) | ✅ No new server surface — client-side transforms; board polling is the pre-existing public read. |

## Residual hardening notes (P3, not blockers)

1. **Feed rate limiter is in-memory per-replica** (`feedHits` Map in
   sports-board.controller.ts). At N replicas the effective cap is N×. Known
   accepted pattern in this codebase (same class as the AI hourly cap before
   its Redis move). If board-feed ingest ever scales past one API replica,
   move to the shared Redis limiter like ai-hourly-cap.ts.
2. **Standing process rule:** every future merge wave that adds endpoints
   should get this same 15-minute set-review before it's called done — this
   audit exists because none of the 3 build agents' work was security-reviewed
   *as a set*. Cheap to fold into the lead merge checklist.
