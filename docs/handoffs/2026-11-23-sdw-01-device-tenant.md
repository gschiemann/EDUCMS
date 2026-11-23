# A device principal belongs to a tenant on the guard surface (SDW-01, 2026-11-23)

**Status.** Integrated on `claude/launch-fixes-6-10` with launch fixes 6-10 (the `claude/fix-sdw-01` change, its review-round commit and the integration follow-ups). The owner gave the go and waived the different-vendor review in writing on 2026-11-23. It is not on `master` or deployed yet, so it is unverified on the fleet until it is deployed and the checks under "After deploy" pass. It touches `apps/api/src/emergency/emergency.controller.ts` (two metadata decorators and their comments, with no behaviour change), so the on-glass drill in step 4 of "After deploy" is required evidence before it is called done.

Model: Claude Opus 5.5, Claude Code cloud session, dispatched by a workflow script as the author. The independent review ran in a separate session.

## What the code now requires

- On `JwtAuthGuard` routes, `DeviceIdentityInterceptor` answers a device principal whose live `Screen` row has no tenant with 401 `DEVICE_SCREEN_UNPAIRED`, unless the route carries `@AllowUnpairedDevice()` (`apps/api/src/security/allow-unpaired-device.decorator.ts`). A context that names no handler is refused.
- Three routes carry the marker: `GET /api/v1/screens/:id/manifest`, `GET /api/v1/emergency/messages` and `GET /api/v1/emergency/status`. Each reads the screen's own row or answers "nothing" without a tenant. The decision table, with the client call site for each route, is `UNPAIRED_ALLOWED` in `apps/api/src/screens/device-principal-routes.spec.ts`. `emergency/status` has no device-credential caller and is kept deliberately, so the emergency controller answers every principal exactly as before. The reason is written beside its entry.
- The pairing flow is not on this surface. Register, the pairing status heartbeat, unpair, orientation, OTA state and the other pairing-time calls use explicit device auth with `allowUnpaired`, and nothing there changed. APKs 1.1.23-1.1.67 and service-worker-cached bundles pair through those routes.
- A paired screen always has a tenant on its live row, so it never reaches the new branch. Its credential lifecycle (unproven claims, epochs, renewal, `requiresRePair`) and its emergency manifest are unchanged.
- Defence in depth (`hasTenantId` in `apps/api/src/auth/require-tenant.ts`): social posts and connection summary answer empty, asset playback answers 404 without a scope, the Google Reviews per-tenant cap and the render-capability mint require a tenant, touch-event ingest refuses and `branding/me` answers null without one.
- `DEVICE_SCREEN_UNPAIRED` is not a credential-recovery signal. The web player starts its one controlled recovery on a 401 from the manifest or telemetry, or on a push-channel `AUTH_FAIL`, and none of those answers with this code. Recorded in `docs/spec/SECURITY_BASELINE.md`, §2.

## Tests

- `apps/api/src/screens/device-principal-routes.spec.ts`: every device-reachable guard-surface route, driven through the real interceptor with its real handler. A credential for a screen with no tenant: 3 admit, 42 refuse. A paired credential: all admit with the live tenant. The marker set must equal the table.
- `apps/api/src/security/device-identity.interceptor.spec.ts`: refusal, opt-in admission, the live row wins over a stale claim, paired unchanged, user principals untouched.
- `apps/api/src/tenant-isolation/tenantless-device-principal.spec.ts` (runs in the required two-tenant matrix job): each defence-in-depth handler against the Prisma double that evaluates `where` the way Prisma does.

## Follow-ups

1. Extend the tenant-isolation static gate (tracked privately). The baseline was not raised.
2. Evaluate Prisma `strictUndefinedChecks` across the API (needs an audit of call sites first).
3. Done in the launch-fixes 6-10 integration: the doc comment above `GET /assets/:id/playback` now says every caller needs a tenant scope and SUPER_ADMIN reads the active workspace (support access, 2026-10-11), never cross-tenant.

## After deploy (bench screens only)

1. `/api/v1/health` reports `commit` equal to the merge SHA.
2. Clear a bench screen's player storage so it registers fresh. The pairing code shows. Pair it, and it leaves the splash within one heartbeat. Repeat on one old-APK bench unit and on a browser player with a cached bundle.
3. While a bench screen is unpaired, the API logs show no `DEVICE_SCREEN_UNPAIRED` for the manifest, `emergency/messages` or the pairing routes.
4. On a paired bench screen, a drill paints and clears as before (required: the change touches the emergency controller).
