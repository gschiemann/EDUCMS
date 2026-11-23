# A rebrand replaces a widget's sample text nobody typed (2026-11-23)

**Status.** Branch `claude/rebrand-placeholders`, cut from `origin/master` 31ebf86e7 (after #347 a884ada3b and #351). Committed, not pushed, no pull request, **not merged**. No schema change, no migration, no new environment variable, no new database read. Not life-safety: nothing under `apps/api/src/emergency/`, the player sync path or Taurus CSS changed.

Author: a Claude Code cloud session (workflow agent). Review: none yet.

## Situation

The owner: "make sure that when I rebrand something everything gets updated that's available". #347 made a rebrand write the organisation name, tagline, initials and logo, and replace the previous brand's values. Its round-2 review named the gap this branch closes:

- In Settings > Brand > Apply to templates (fill-blanks), a value that is still the system preset's OWN placeholder (a themed widget's `schoolName` "WESTRIDGE WILDCATS", a v2 logo's "Roosevelt Academy") is not blank and not a previous brand, so it was never replaced — not at clone time and not on rebrand.
- A non-HS, non-LOGO widget was only renamed when its saved config already had a `schoolName` key, so the MS, fitness and animated welcome scenes never got the name or the logo.

## What changed

- **`packages/api-types/src/brand-identity-keys.ts`** (new, exported from `@cms/api-types`). One renderer-proven registry, read by the API and the web (the `QUARANTINED_BOARD_URLS` precedent, no PARITY copy):
  - `WIDGET_IDENTITY_KEYS`: widget type → the flat config keys its renderer reads, each with a role (name, tagline, initials, logo), `upper`, `onlyIfPresent` / `absentWhen`, and the placeholder literals the renderer paints when the key is absent (with an optional variant / theme selector).
  - `EXCLUDED_IDENTITY_KEYS`: identity-looking keys deliberately not written, each with its reason.
  - `normaliseIdentityText`, `selectorMatches`, `placeholdersFor`, `identityKeysFor`, `identityKeyApplies`.
- **The rule** (`apps/api/src/branding/brand-identity.ts`). In fill-blanks a zone identity value may be replaced when (a) it is blank or absent in a key the renderer reads, (b) it equals a previous brand's value (#347, unchanged), or (c) NEW: it equals one of that renderer's own placeholders for that key, compared after NBSP → space, whitespace collapsed, trimmed, lowercased. Override is unchanged. A value the brand lacks is never written. #347's `sameText` is unchanged; the collapsed comparison is used only for placeholders.
  - `patchZoneIdentity` drives every registered type from the registry (it replaces the hard-coded LOGO and `HS_*` branches); EXTERNAL_HTML boards and the unregistered `'schoolName' in cfg` fallback are unchanged.
  - Dotted keys are written flat. A nested shadow (`cfg.school.name`, from an old inline edit pick() never read) that holds typed text keeps the flat key in fill-blanks; a shadow equal to the placeholder does not.
- **`applyBrandToTemplates`** (`apps/api/src/branding/branding.controller.ts`). #347's tenant-scope follow-up: the zone write is now `templateZone.updateMany({ where: { id, templateId, template: { tenantId, isSystem: false } } })`, and anything but one row throws, so the whole rebrand (with its audit row) rolls back.
- **Clone, duplicate, create from preset** (`apps/api/src/templates/templates.controller.ts`) pick the registry up through `patchZoneIdentity`; only comments changed ("a preset's own text wins unless it is a registered renderer placeholder").
- **"Brand this template"** (`apps/web/src/components/template-builder/brand-kit-actions.ts`) writes every registry key of a zone unconditionally (it is an explicit action), including the logo on MS, fitness and welcome scenes; `HS_TERMINAL` / `HS_TRANSIT` no longer get `schoolName`. `identitySnapshot(cfg, widgetType)` sees the registry's text keys, and the new `zoneLogoChanged` counts their logo keys in the toast (`BrandKitPanel.tsx`).
- **Copy.** `settings.cc.brand.applyTemplatesHelp` now says "… wherever a spot is blank, still shows the template's sample name, tagline or logo, or still shows a previous brand …" in en, es and zh.

### Registry contents (each literal copied from the renderer; `identity-registry.spec.ts` pins them)

| Type(s) | Keys written | Placeholders |
|---|---|---|
| LOGO | logoUrl, assetUrl, schoolName, tagline, initials (only if present, or on the athletics crest) | 'Roosevelt Academy' / 'Excellence · Honor · Service' on logo-neon, logo-paper, logo-crayon, logo-glass, logo-ops; 'CENTRAL ADMINISTRATION' on logo-dashboard / theme office-dashboard; 'HS' initials on logo-athletics / theme high-school-athletics |
| HS_VARSITY(_PORTRAIT) | schoolName (upper), schoolInitials | 'WESTRIDGE WILDCATS' / 'WILDCATS'; 'WHS' |
| HS_BROADCAST, HS_YEARBOOK, HS_GALLERY, HS_BLUEPRINT, HS_ZINE (+ portraits) | schoolName (upper) | each file's DEFAULTS literal |
| HS_TERMINAL, HS_TRANSIT (+ portraits) | nothing | — |
| MS_ARCADE, MS_ATLAS, MS_HOMEROOM, MS_FIELDNOTES, MS_STUDIO (+ portraits) | 'school.name' or 'brand.name' (upper on Arcade, Atlas, Studio), and its logo key | each file's DEFAULTS literal |
| MS_GREENHOUSE, MS_PLAYLIST, MS_PAPER (+ portraits) | the logo key only | — |
| 13 FITNESS_* scenes | gymLogoUrl | — |
| ANIMATED_WELCOME (6 types) | logoUrl | — |
| ANIMATED_HALLWAY_SCHEDULE(_PORTRAIT) | tagline | 'every day a new adventure' |

Deviations from the design, each with its reason:
- `EXCLUDED_IDENTITY_KEYS` also lists `FITNESS_LIVE_TV channelLogoUrl` (the TV channel's logo; the completeness test found the read) and MS_GREENHOUSE `school.tag` / `school.eye`, MS_PAPER `masthead.tagline`. Variant-specific exclusions use `LOGO/logo-principals` and `LOGO/field-day` record keys.
- The zone-count failure throws a plain `Error` (a 500 the exception filter reports to Sentry) rather than an `HttpException` with a new English message, so no untranslated user-facing string was added.
- The toast counts a logo written into an MS / fitness / welcome logo key as a logo (`zoneLogoChanged`) instead of as "name filled", which `identitySnapshot` would have claimed had it included logo keys.

## Behaviour change to know

A legacy template with no `brandKit` whose HS_VARSITY `schoolInitials` is 'WHS' now takes the organisation's initials, because 'WHS' is the Varsity renderer's own placeholder. `branding-apply-rebrand.spec.ts` ("no brandKit snapshot") pins this. A tenant whose own brand derives 'WHS' rewrites 'WHS' with 'WHS': no change.

## Owner rows to confirm or strike (each needs a screenshot)

| Row | What changes on screen | Evidence so far |
|---|---|---|
| Hallway tagline | `ANIMATED_HALLWAY_SCHEDULE` shows the organisation tagline instead of "every day a new adventure" | Jest render test; Chromium screenshot `chromium-13-long-name-ms-hallway.png` |
| Studio ".MS" and Fieldnotes "& Otters" lockups | the name is followed by the scene's own ".MS" / "& Otters" | same screenshot: both wrap to two lines with a long name |
| Fitness and welcome logo slots | an empty slot / an emoji becomes the organisation logo | Jest render test (img src) |
| Long names in fixed MS slots | Arcade's name is Press Start 2P at 76px | same screenshot: wraps to two lines in the header |
| HS_TERMINAL / HS_TRANSIT write removed | the editor no longer writes `schoolName` there (nothing read it) | Jest |

## Legacy templates

- Absent registered keys (every MS, fitness, welcome and hallway zone, most HS and LOGO zones) are filled on the next Apply.
- Placeholders saved by the pre-f2c247dfb click-blur inline edit match rule (c).
- MS click-blur saves from 2026-05-03 to 2026-10-27 went nested (a dead shadow): the shadow test above.
- On the following rebrand rule (b) takes over, because Apply writes the snapshot.

## Evidence (run in this worktree)

- API Jest `src/branding src/templates src/tenant-isolation`: 69 suites, 1942 tests passed.
- New `apps/api/src/branding/identity-registry.spec.ts`: 234 tests. A mutation run (a wrong HS_VARSITY placeholder, MS_PAPER dropped, FITNESS_CORNERMAN registered) failed 6 of them, as it should; the registry was restored.
- Web Jest `brand-kit-actions.test.ts` (44) and the new `widgets/__tests__/brand-identity-render.test.tsx` (12).
- `node apps/api/tools/check-tenant-isolation.cjs`: 0 unscoped, baseline unchanged. `node apps/web/tools/check-i18n-parity.cjs`: OK.
- `pnpm --filter api build` (nest build): exit 0. `npx tsc --noEmit -p apps/web/tsconfig.json`: 0 errors.
- Playwright `builder-brand-tab.spec.ts`, Chromium only, against `next dev` with the API mocked: 6 of 6 passed, including the two new cases. The long-name screenshot shows: Arcade wraps the name to two lines in its header; Studio wraps "RIVERSIDE ACADEMY OF SCIENCE AND TECHNOLOGY .MS" to two lines beside ON AIR, close to "GOOD MORNING"; Fieldnotes wraps "… & Otters" to two lines; the hallway tagline sits under "LEARN · GROW · SHINE". The toast read "4 of 4 widgets restyled · 3 logos filled · your name and tagline filled". Screenshots are in the gitignored `docs/research/2026-10-12-brand-tab/` (`chromium-12-…`, `chromium-13-…`).

## Unverified

- `builder-brand-tab.spec.ts` under `--project=webkit` (WebKit is not installed here), and under Chromium against the production build (`next start`) rather than `next dev`.
- Apply on a test tenant against real Postgres; a bench screen showing a rebranded HS and MS scene; `/api/v1/health` reporting the merge SHA.
- The production catalogue count below (needs a production database the agent does not have). Expected 0; if not, add those literals to the static placeholders. Never add a runtime DB or audit read.

```sql
SELECT count(*) FROM template_zones z JOIN templates t ON t.id=z.template_id
WHERE t.is_system AND t.tenant_id IS NULL
  AND z.default_config ~ '"(schoolName|schoolInitials|tagline|initials|school\.name|brand\.name|school\.logoUrl|brand\.logoUrl|masthead\.logoUrl|gymLogoUrl|logoUrl|assetUrl|textOverrides|imageOverrides)"';
```

## Deliberately not built

Design A's `brandKit.origin`, its audit_logs recovery and its system-preset DB read: they match nothing today (no preset has shipped identity values, which the catalogue invariant test now enforces), they add a query per rebrand, and they change the shape of `brandKit`.

## Pre-existing issues found (reported, not fixed here)

- (a) BuilderZone's inline edit writes dotted MS and fitness fields nested through `setByPath`, but their `pick()` reads the flat key, so an inline edit of `school.name` never reaches the screen. Needs its own test and fix.
- (b) A deliberately emptied `''` counts as blank and is refilled by the next Apply.
- (c) `logo-principals` renders a hard-coded "WASHINGTON" and never reads `schoolName`.
- (d) `apps/api/src/branding/apply-brand-to-zone.ts` has no production importer (dead code).
- (e) Retrying the editor's `stamped` POST is still open.
- `HS_TRANSIT schoolCode` ('WHS', an airport-style code chip) is not registered; the owner may want it treated as initials.

## Rollback

Revert the PR. Everything written is ordinary zone config, which the previous build renders the same way; there is no schema or migration.
