# Feature Flags

**Last verified against code:** 2026-11-09

OpenFeature + self-hosted GrowthBook adapter. Flags default **off**.
Graceful fallback to `FF_*` / `NEXT_PUBLIC_FF_*` env vars when GrowthBook is
unreachable or keys are absent — a single `[FeatureFlags]` warning is logged on
the API side.

## Current flags

Declared in `FLAGS` in `apps/api/src/feature-flags/feature-flags.service.ts` and `apps/web/src/lib/feature-flags.ts`. The earlier `emergency_new_ui` and `sis_integration` flags were removed (they gated nothing); do not look for them.

| Key                    | Scope | What it gates                                         | Env fallback (when GrowthBook is off) |
| ---------------------- | ----- | ----------------------------------------------------- | ------------------------------------- |
| `template_builder_v2`  | Web (declared on the API too, no API call site) | The template builder. On the web it is **always on** in the env fallback (the old `NEXT_PUBLIC_FF_TEMPLATE_BUILDER_V2` kill switch was removed); default-true if GrowthBook is ready but does not define it. | web: none (always on); API: `FF_TEMPLATE_BUILDER_V2=true` |
| `auto_branding`        | Web   | Auto-branding in `BrandingSettingsCard`. Default on everywhere. | `NEXT_PUBLIC_FF_AUTO_BRANDING=false` turns it off |
| `sports_player_stats`  | Both  | Player stats in the sports roster/game pages and `sports.service.ts`. Default off. | `FF_SPORTS_PLAYER_STATS=true` (API), `NEXT_PUBLIC_FF_SPORTS_PLAYER_STATS=true` (web) |

## Usage

### API (NestJS)

```ts
import { FeatureFlagsService, FLAGS } from './feature-flags/feature-flags.service';

constructor(private readonly ff: FeatureFlagsService) {}

// Synchronous: ALWAYS reads the FF_<KEY> env variable. It never consults
// GrowthBook, even when the provider is ready.
if (this.ff.isEnabled(FLAGS.SPORTS_PLAYER_STATS, { tenantId, userId })) {
  // gated code
}

// Async: uses GrowthBook when the provider is ready, else the env variable.
// This is the only call that honours a GrowthBook toggle (the sports service uses it).
if (await this.ff.isEnabledAsync(FLAGS.SPORTS_PLAYER_STATS, { tenantId, userId })) {
  // gated code
}
```

The env fallback reads `FF_` plus the upper-cased flag key and is true only for the exact string `true`.

`FeatureFlagsModule` is `@Global()` — no per-module import needed.

### Web (Next.js / React)

```ts
import { isFeatureEnabled, FLAGS } from '@/lib/feature-flags';

if (isFeatureEnabled(FLAGS.SPORTS_PLAYER_STATS)) {
  return <PlayerStats />;
}
```

The web client is synchronous. `initFeatureFlags()` (in `apps/web/src/lib/feature-flags-init.ts`) would switch evaluation to GrowthBook, but **nothing in `apps/web/src` calls it today** (symbol search, 2026-11-09), so on the web the build-time `NEXT_PUBLIC_FF_*` fallback is what actually runs. The earlier text said `layout.tsx` calls it; it does not. Whether to wire it in is an open product decision, not a documentation fix.

## Running GrowthBook locally

```bash
# Start GrowthBook + MongoDB alongside the rest of the stack
docker compose up growthbook mongodb -d
```

(`docker-compose.yml` is dev-only; see `docs/SECURITY_HYGIENE.md`.)

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
| GrowthBook reachable but flag not defined | API: `false`. Web: the per-flag intended default in `FLAG_DEFAULTS` (builder and auto-branding true, sports stats false) |
| GrowthBook unreachable at startup | Provider init throws; env-var fallback; warning logged |
| Provider ready but evaluation throws | Env-var fallback (caught internally) |

## Flipping a flag (env-var fallback mode)

**API (Railway env):** set `FF_<KEY>=true`, redeploy. Variables are declared in `docs/ENVIRONMENT.md` (`FF_SPORTS_PLAYER_STATS`, `FF_TEMPLATE_BUILDER_V2`, `GROWTHBOOK_API_HOST`, `GROWTHBOOK_CLIENT_KEY`).
**Web (Vercel env):** set `NEXT_PUBLIC_FF_<KEY>=true`, redeploy (build-time value). Both sides
should stay in sync — if the web is showing the new UI but the API isn't
accepting the new request shape, users will see errors.

## Adding a new flag

1. Add the key to `FLAGS` in both
   `apps/api/src/feature-flags/feature-flags.service.ts` and
   `apps/web/src/lib/feature-flags.ts`.
2. Add `FF_<KEY>` and `NEXT_PUBLIC_FF_<KEY>` to `.env.example`, declare them in
   `docs/ENVIRONMENT.md`, and create a GrowthBook feature with the same key.
3. Update this doc's table.
4. Add the flag's intended default to `FLAG_DEFAULTS` and a new `case` to the fallback `switch` in
   `apps/web/src/lib/feature-flags.ts` (Next.js requires literal
   `process.env.NEXT_PUBLIC_*` reads so dynamic lookup won't work in the
   browser bundle).
5. Create the matching Boolean feature in GrowthBook UI.
