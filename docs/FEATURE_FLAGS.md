# Feature Flags

Env-backed adapter with an OpenFeature-shaped API. Flags default **off**.
Sprint 2 swaps the implementation for self-hosted GrowthBook + OpenFeature
SDK without changing any call sites.

## Current flags

| Key                    | Scope  | What it gates                                |
| ---------------------- | ------ | -------------------------------------------- |
| `emergency_new_ui`     | Web    | Next-gen panic / emergency overlay redesign. |
| `template_builder_v2`  | Web    | New drag-drop template builder.              |
| `sis_integration`      | Both   | OneRoster / Clever sync features.            |

## Usage

### API (NestJS)

```ts
import { FeatureFlagsService, FLAGS } from './feature-flags/feature-flags.service';

constructor(private readonly ff: FeatureFlagsService) {}

if (this.ff.isEnabled(FLAGS.SIS_INTEGRATION, { tenantId, userId })) {
  // gated code
}
```

`FeatureFlagsModule` is `@Global()` — no per-module import needed.

### Web (Next.js / React)

```ts
import { isFeatureEnabled, FLAGS } from '@/lib/feature-flags';

if (isFeatureEnabled(FLAGS.EMERGENCY_NEW_UI)) {
  return <NewPanicPage />;
}
```

Build-time evaluation — flipping requires a redeploy until Sprint 2.

## Flipping a flag

**API (Railway env):** set `FF_<KEY>=true`, redeploy.
**Web (Vercel env):** set `NEXT_PUBLIC_FF_<KEY>=true`, redeploy. Both sides
should stay in sync — if the web is showing the new UI but the API isn't
accepting the new request shape, users will see errors.

## Adding a new flag

1. Add the key to `FLAGS` in both
   `apps/api/src/feature-flags/feature-flags.service.ts` and
   `apps/web/src/lib/feature-flags.ts`.
2. Add both `FF_<KEY>` and `NEXT_PUBLIC_FF_<KEY>` to `.env.example`.
3. Update this doc's table.
4. For web, add a new `case` to the switch in `isFeatureEnabled` — Next.js
   requires literal `process.env.NEXT_PUBLIC_*` reads so the dynamic lookup
   used on the server side does not work in the browser bundle.

## Sprint 2 migration path

1. Stand up GrowthBook self-hosted (Docker + Mongo). Free for internal use.
2. Install `@openfeature/server-sdk`, `@openfeature/web-sdk`, and the
   GrowthBook OpenFeature provider.
3. Replace the body of `FeatureFlagsService.isEnabled` with an OpenFeature
   client call. Call sites keep the same signature.
4. Web side swaps env reads for an API round-trip against
   `GET /api/v1/feature-flags` (already scaffolded) with SWR caching.
