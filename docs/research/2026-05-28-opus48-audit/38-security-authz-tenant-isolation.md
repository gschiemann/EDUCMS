# Security Audit — AuthZ + Multi-Tenant Isolation (the #1 SaaS launch risk)

> Opus 4.8 read-only, 2026-05-29. Traced REAL guards/queries across ~58 controllers. Verdict: SOLID.

## Verdict: tenant isolation is SOLID — NO P0 IDOR or cross-tenant hole found.
Multiple prior passes (inline comments cite MED-1/HIGH-1/auth-002/etc.) hold up under verification.

## Architecture
`RbacGuard` does NOT enforce tenantId generically (only district/school when those exact fields appear). **Isolation rests on each service filtering by `tenantId` — and that convention is followed consistently + correctly.** Dominant safe pattern: `findFirst({where:{id, tenantId: req.user.tenantId}})` then mutate by id (ownership proven). `tenantId` always from the verified JWT, never request input.

## Per-resource: ALL ISOLATED
Assets, asset folders, playlists (item-reorder validates every assetId), schedules (playlist/screen/group re-checked), screens (pair rejects claiming another org's), screen-groups, templates (`OR:[{tenantId},{isSystem}]` reads; `assertOwnedTemplate` mutations), users, sponsors (`owned()`), games/sports (`owned()` ~40 sites), submissions, audit logs, branding, billing/license, AI key (GET masked), floor plans, per-screen emergency override (`requireTenantId` rejects tenantId-less tokens), POS/streaming/ads. Evidence file:lines in the report body.

## RBAC / escalation — CLEAN
- No self-promotion endpoint (`@Put('me')` only name fields).
- `assertCallerCanAssignRole` — assign only strictly-lower roles; even SUPER_ADMIN can't mint another via API.
- `canTriggerPanic` writer admin-only + tenant-scoped + refuses RESTRICTED_VIEWER + audited.
- JWT-staleness RESOLVED: role downgrade / canTriggerPanic-removal → `revokeUserTokens` (Redis per-user invalid-before epoch); guard rejects older tokens, fails CLOSED on Redis error.
- SUPER_ADMIN cross-tenant routes gated; `switchTenant` verifies target is caller's district/child.

## Public routes — all SAFE
impression (tenant-match write only), cts-cue-fired (best-effort, no cross-tenant read), feed/cts-snapshot (game-scoped HMAC), board (public by design, UUID), billing webhook (Stripe HMAC), devices/pair (code + 10/min), screens register/status (self-report), manifest (device-JWT must match screen; user must match tenant), SSE (tenant from live Screen row), branding scrape/public, proxy (safeFetch), youtube-live, SSO config-public + callbacks (returns {enabled,provider}; cross-tenant email rejected), OAuth callbacks (server-side state token → connection bound to stored tenantId, not callback input). Device JWTs scoped {screenId,tenantId}, verified vs live Screen row (re-paired-device old token can't leak).

## Emergency — verified airtight
Every write (trigger/all-clear/sos/broadcast/media-alert) → `resolveScopeTenant` (owning tenant from DB row, 403 on mismatch). mediaUrl allowlisted, playlistId tenant-verified. Panic-bypass doesn't widen tenant scope; RESTRICTED_VIEWER hard-blocked.

## Findings — all LOW (none gate launch)
1. SSE revocation check still gated on `NODE_ENV==='production'` (`sse.controller.ts:63`) — the guard had this removed in P1-4; staging-only gap (revoked device token keeps SSE open in non-prod). Remove the wrapper to match.
2. Public `cts-cue-fired` accepts unauth forensic writes (UUID game, 40/10s) — pollutes proof-of-play noise; consider requiring the feed token.
3. Feed tokens never expire / no per-game revocation — leaked token = clamped score-push to one transient game until secret rotation. Acceptable per threat model.
4. **Informational (defense-in-depth):** RbacGuard provides no generic tenant fence — isolation is 100% convention (per-service tenantId filter). Every path does it right today, but a future forget-the-filter endpoint = instant IDOR with no backstop. Consider Prisma middleware / tenant-scoped repo wrapper.

**Bottom line:** the #1 SaaS launch risk is well-engineered + holds under verification. 4 low-severity hardening items, no blockers.
