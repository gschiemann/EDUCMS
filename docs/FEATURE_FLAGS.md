# Feature Flags

OpenFeature + self-hosted GrowthBook adapter. Flags default **off**.
Graceful fallback to `FF_*` / `NEXT_PUBLIC_FF_*` env vars when GrowthBook is
unreachable or keys are absent — a single `[FeatureFlags]` warning is logged on
the API side.

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

// Synchronous (uses env fallback; GrowthBook result reflected next evaluation):
if (this.ff.isEnabled(FLAGS.SIS_INTEGRATION, { tenantId, userId })) {
  // gated code
}

// Async (preferred where you can await — uses GrowthBook when available):
if (await this.ff.isEnabledAsync(FLAGS.SIS_INTEGRATION, { tenantId, userId })) {
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

The web client is synchronous. Once `initFeatureFlags()` has resolved (called
in `layout.tsx`), evaluations flow through GrowthBook. Until then (first render,
SSR) the env-var fallback is used.

## Running GrowthBook locally

```bash
# Start GrowthBook + MongoDB alongside the rest of the stack
docker compose up growthbook mongodb -d

# Or bring up everything at once
docker compose up -d
```

Open **http://localhost:3100** and complete the setup wizard:

1. Create an account (local only — no internet call needed).
2. Go to **SDK Connections** → **Add Connection** → select **Node.js** (server)
   or **JavaScript** (browser).
3. Copy the generated **Client Key** (looks like `sdk-abc123`).
4. Add to `.env`:
   ```
   GROWTHBOOK_API_HOST=http://localhost:3100
   GROWTHBOOK_CLIENT_KEY=sdk-abc123
   NEXT_PUBLIC_GROWTHBOOK_API_HOST=http://localhost:3100
   NEXT_PUBLIC_GROWTHBOOK_CLIENT_KEY=sdk-abc123
   ```
5. Restart the API (`pnpm dev:api`) — you should see
   `[FeatureFlags] GrowthBook provider ready.` in the logs.

## Creating a flag in GrowthBook

1. Open http://localhost:3100 → **Features** → **Add Feature**.
2. Set the **Feature Key** to match one of the `FLAGS` constants
   (e.g. `template_builder_v2`).
3. Set **Type** to `Boolean` and the default value to `false`.
4. Publish. Toggle it on/off in the GrowthBook UI — no redeploy needed.

## Fallback behavior

| Condition | Behavior |
| --- | --- |
| `GROWTHBOOK_API_HOST` or `GROWTHBOOK_CLIENT_KEY` absent | Env-var fallback; `[FeatureFlags]` warning logged once on startup |
| GrowthBook reachable but flag not defined | Returns `false` (GrowthBook default) |
| GrowthBook unreachable at startup | Provider init throws; env-var fallback; warning logged |
| Provider ready but evaluation throws | Env-var fallback (caught internally) |

## Flipping a flag (env-var fallback mode)

**API (Railway env):** set `FF_<KEY>=true`, redeploy.
**Web (Vercel env):** set `NEXT_PUBLIC_FF_<KEY>=true`, redeploy. Both sides
should stay in sync — if the web is showing the new UI but the API isn't
accepting the new request shape, users will see errors.

## Adding a new flag

1. Add the key to `FLAGS` in both
   `apps/api/src/feature-flags/feature-flags.service.ts` and
   `apps/web/src/lib/feature-flags.ts`.
2. Add `FF_<KEY>`, `NEXT_PUBLIC_FF_<KEY>`, and a GrowthBook feature with the
   same key to `.env.example`.
3. Update this doc's table.
4. Add a new `case` to the fallback `switch` in
   `apps/web/src/lib/feature-flags.ts` (Next.js requires literal
   `process.env.NEXT_PUBLIC_*` reads so dynamic lookup won't work in the
   browser bundle).
5. Create the matching Boolean feature in GrowthBook UI.
