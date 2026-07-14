# Sports Security Blocker — Tracked Feed-Signing Secret

**Severity:** P0 / credential exposure  
**Audit snapshot:** `3f274702`; current handoff HEAD has removed the literal from source.  
**Status:** PARTIALLY COMPLETE—source removal is complete; rotation, revocation, exposure review, shared-key migration, and verification remain OPEN/UNVERIFIED.

At the audit snapshot, a tracked production-capable integration script exposed signing material. The value, exact historic locator, and introduction commit are intentionally **not reproduced in this distributable report**; keep them in the restricted incident record until revocation is cryptographically proven. The feed-token implementation also allowed fallback from the sports signing key to the shared device key, so the blast radius may extend far beyond sports.

## Immediate incident response

1. Open a restricted incident record with incident commander, accountable approvers, environment inventory, and exact timeline. Treat the credential as compromised; do not wait to prove abuse. Preserve a forensic snapshot of key identifiers/fingerprints, configuration, token versions, encrypted-row counts, and relevant logs before changing state.
2. Determine in a non-logging, access-controlled process whether the value matches any current/historical sports or device key. Never emit either value into shell history, screenshots, tickets, audit artifacts, or generated reports.
3. Freeze issuance/ingest or enforce one database-backed cutover epoch. Install a dedicated versioned sports key with at least 32 cryptographically random bytes and strict boot validation. Transactionally revoke old tokens, drain all old replicas, verify none remains, then re-enable ingest with one short-lived smoke credential. Monitor rejected old-key/old-epoch attempts. Rollback may pause service but must never restore the compromised key.
4. Remove query-string token authentication and preserve/redact proxy, CDN, WAF, analytics, browser-history/referrer, and application records that may already contain tokens. Accept protected headers or device-authenticated channels only.
5. Replace bare/non-expiring tokens with API-issued tenant/game/scope-bound credentials containing `kid`, `jti`, issued-at, short expiry, and token version. Do not return reusable curl commands containing credentials.
6. The live integration test must have zero root-key access. It accepts only an API-issued short-lived game-scoped token, defaults to staging, requires recorded break-glass approval for a production host, redacts request/response credentials, and revokes the token/deletes the test game in `finally`.
7. If the exposed value ever served as the shared device key, **do not blindly rotate it**. It also protects WS/Redis signing, screen/GPIO HMAC, AI BYOK, MFA secrets, streaming credentials, Clever state, and other wrapped material.
8. Inventory every shared-key consumer and back up/count every encrypted row. Introduce purpose-specific versioned keys with new-primary/old-decrypt-only or dual-verify support before retirement.
9. Rewrap and reconcile all decryptable records; use an approved MFA re-enrollment path where rewrap is impossible; reissue/re-pair devices only where required. Record old/new key version, object counts/hashes, and reversible checkpoints.
10. Exercise emergency trigger, signed fan-out, physical/player receipt/acknowledgement, and all-clear during overlap. Retire the old shared key only after every dependent is migrated, old replicas are drained, and the emergency path is proven healthy.
11. Preserve/review Railway/CDN/WAF ingress, deploy/CI artifacts, secret-manager access, application AuditLog/GameEvent, and infrastructure records from earliest possible public/deployed exposure through final-replica cutover. Record telemetry gaps explicitly; missing logs are not proof of no abuse. Document affected environments/games, abuse assessment, and the accountable customer/legal notification decision.
12. Search source history, build artifacts, release bundles, caches, and shared copies. If canonical history is rewritten, retain a restricted forensic archive first. Revocation—not history rewriting—is the closure control because clones cannot be recalled.
13. Enable blocking current/history secret scanning and prove the rule with a non-secret canary fixture.

## Structural remediation

- Give sports feed keys their own versioned KMS/secret-manager identity; require at least 32 random bytes; never fall back to the device key.
- Put `kid`, issuer, tenant ID, game ID, scopes, token version, issued-at, expiry, and unique `jti` in every feed token.
- Validate exact tenant/game/scope and current key/token version for every ingest operation.
- Support overlapping-key rotation with an explicit, short migration window; then retire the old key.
- Add rate limits, replay/idempotency protection, source/device enrollment, and a visible feed-connection health/audit timeline.
- Record source IP/proxy chain, non-reversible token fingerprint, outcome/reason, correlation ID, game/tenant, and accepted sequence without logging bearer material.

## Acceptance gates

- The old key and every old bare-v0, structured, expiring, and non-expiring token fail in every environment and replica; a game created during cutover cannot accept the old epoch.
- A new short-lived tenant/game/scope token succeeds only for its intended operation; cross-game, cross-tenant, expired, replayed, malformed, and revoked credentials fail consistently.
- The integration test has no root-secret access, defaults to non-production, logs no credential, and always revokes/cleans up.
- Query-string tokens are rejected; a protected header/device-auth path succeeds.
- Every replica enforces the same cutover epoch; no old-key replica remains; rollback never reinstalls the compromised key.
- Every old deployment and secret-manager key version is retired; no signer key or bearer token exists in source, stdout, generated reports/curl commands, URLs, CI logs, artifacts, or telemetry.
- No AI BYOK, MFA secret, streaming credential, Clever flow, or other encrypted dependent is lost or rendered undecryptable.
- Screen/GPIO authentication and signed WS/Redis traffic work across the key overlap and after retirement.
- Emergency trigger, player receipt, acknowledgement, and all-clear remain continuously available and are verified before shared-key retirement.
- A repository/history secret scan is clean, and an injected canary secret makes CI fail.
- Infrastructure/application evidence, telemetry gaps, affected environments/games, abuse assessment, and customer/legal notification decision are recorded; absence of logs is never reported as proof of no abuse.
- Rotation/revocation is exercised in staging, then production evidence records exact cutover time, environment/replica fingerprints, smoke/rejection results, and responsible approvers before the incident is called remediated.
