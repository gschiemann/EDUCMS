# A rebrand replaces a widget's sample text nobody typed (2026-11-23)

**Status.** Branch `claude/rebrand-placeholders`, cut from `origin/master` 31ebf86e7 (after #347 a884ada3b and #351). Committed, not pushed, no pull request, **not merged**. No schema change, no migration, no new environment variable, no new database read. Not life-safety: nothing under `apps/api/src/emergency/`, the player sync path or Taurus CSS changed.

Author: a Claude Code cloud session (workflow agent). Review round 1 (a different session): changes required. The must-fix (fill-blanks overwrote a GENERIC word the tenant typed, such as 'WILDCATS', 'WHS' or 'Central Administration') is fixed in the branch's second commit; see "Generic placeholders" below.

## Situation

The owner: "make sure that when I rebrand something everything gets updated that's available". #347 made a rebrand write the organisation name, tagline, initials and logo, and replace the previous brand's values. Its round-2 review named the gap this branch closes:

- In Settings > Brand > Apply to templates (fill-blanks), a value that is still the system preset's OWN placeholder (a themed widget's `schoolName` "WESTRIDGE WILDCATS", a v2 logo's "Roosevelt Academy") is not blank and not a previous brand, so it was never replaced — not at clone time and not on rebrand.
- A non-HS, non-LOGO widget was only renamed when its saved config already had a `schoolName` key, so the MS, fitness and animated welcome scenes never got the name or the logo.

## What changed

- **`packages/api-types/src/brand-identity-keys.ts`** (new, exported from `@cms/api-types`). One renderer-proven registry, read by the API and the web (the `QUARANTINED_BOARD_URLS` precedent, no PARITY copy):
  - `WIDGET_IDENTITY_KEYS`: widget type → the flat config keys its renderer reads, each with a role (name, tagline, initials, logo), `upper`, `onlyIfPresent` / `absentWhen`, and the placeholder literals the renderer paints when the key is absent (with an optional variant / theme selector).
  - `EXCLUDED_IDENTITY_KEYS`: identity-looking keys deliberately not written, each with its reason.
  - `normaliseIdentityText`, `selectorMatches`, `placeholdersFor`, `identityKeysFor`, `identityKeyApplies`.
- **The rule** (`apps/api/src/branding/brand-identity.ts`). In fill-blanks a zone identity value may be replaced when (a) it is blank or absent in a key the renderer reads, (b) it equals a previous brand's value (#347, unchanged), or (c) NEW: it equals one of that renderer's own placeholders for that key, compared after NBSP → space, whitespace collapsed, trimmed, lowercased. A placeholder marked `generic` matches under (c) only when no previous brand of the template has a value for that role (`rolesWithHistory`; a name counts for initials too). Override is unchanged. A value the brand lacks is never written. #347's `sameText` is unchanged; the collapsed comparison is used only for placeholders.
  - `patchZoneIdentity` drives every registered type from the registry (it replaces the hard-coded LOGO and `HS_*` branches); EXTERNAL_HTML boards and the unregistered `'schoolName' in cfg` fallback are unchanged.
  - Dotted keys are written flat. A nested shadow (`cfg.school.name`, from an old inline edit pick() never read) that holds typed text keeps the flat key in fill-blanks; a shadow equal to the placeholder does not.
- **`applyBrandToTemplates`** (`apps/api/src/branding/branding.controller.ts`). #347's tenant-scope follow-up: the zone write is now `templateZone.updateMany({ where: { id, templateId, template: { tenantId, isSystem: false } } })`, and anything but one row throws, so the whole rebrand (with its audit row) rolls back.
- **Clone, duplicate, create from preset** (`apps/api/src/templates/templates.controller.ts`) pick the registry up through `patchZoneIdentity`. The duplicate passes the SOURCE template's brand history as `opts.history` (`previous` stays null), so a copy keeps exactly the generic words the source's own Apply would keep. The history only blocks generic matching; it does not make the source brand's values replaceable. `POST /templates` (the editor's "Save as copy" posts the tenant's own zones there, and `importTemplate()` reuses it) passes `genericPlaceholders: false`: its zones carry no source id, so a generic word in them is treated as typed. Clone from a preset and the AI generator keep generic matching (no tenant typed those zones).
- **"Brand this template"** (`apps/web/src/components/template-builder/brand-kit-actions.ts`) writes every registry key of a zone unconditionally (it is an explicit action), including the logo on MS, fitness and welcome scenes; `HS_TERMINAL` / `HS_TRANSIT` no longer get `schoolName`. `identitySnapshot(cfg, widgetType)` sees the registry's text keys, and the new `zoneLogoChanged` counts their logo keys in the toast (`BrandKitPanel.tsx`).
- **Copy.** `settings.cc.brand.applyTemplatesHelp` now says "… wherever a spot is blank, still shows the template's sample name, tagline or logo, or still shows a previous brand …" in en, es and zh.

### Registry contents (each literal copied from the renderer; `identity-registry.spec.ts` pins them)

| Type(s) | Keys written | Placeholders |
|---|---|---|
| LOGO | logoUrl, assetUrl, schoolName, tagline, initials (only if present, or on the athletics crest) | 'Roosevelt Academy' / 'Excellence · Honor · Service' on logo-neon, logo-paper, logo-crayon, logo-glass, logo-ops; 'CENTRAL ADMINISTRATION' (generic) on logo-dashboard / theme office-dashboard; 'HS' initials (generic) on logo-athletics / theme high-school-athletics |
| HS_VARSITY(_PORTRAIT) | schoolName (upper), schoolInitials | 'WESTRIDGE WILDCATS' / 'WILDCATS' (generic); 'WHS' (generic) |
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

## Generic placeholders (review round 1 must-fix)

Five placeholders are generic words a tenant could type as their own, not a fictional sample organisation: HS_VARSITY_PORTRAIT `schoolName` 'WILDCATS' (one of the commonest mascots; that slot is the big wordmark), HS_VARSITY(_PORTRAIT) `schoolInitials` 'WHS' (the real abbreviation of many schools), LOGO office-dashboard `schoolName` 'CENTRAL ADMINISTRATION' (a district office would type it), LOGO athletics `initials` 'HS'. They carry `generic: true` in the registry, and `identity-registry.spec.ts` (6) pins exactly that set and that every initials placeholder is generic.

A generic placeholder counts as nobody's only on a template whose brand history (the `brandKit` snapshot and its `stamped` list) has no value for that role. The reasoning: since 2026-05-07 the clone path fills `schoolName` / `schoolInitials` from the brand, and #347 fills LOGO's, so on a template a brand has named, the placeholder word back in the key can only have been typed. Without a brand history the word can still be the pre-f2c247dfb click-blur capture of the sample, so it is still replaced.

- Typed 'WILDCATS' / 'WHS' / 'Central Administration' / 'HS' on a template with a named previous brand survive fill-blanks (unit: `brand-identity.spec.ts`; controller: `branding-apply-rebrand.spec.ts`; duplicate and Save as copy: `clone-brand-identity.spec.ts`; and the real-database run below).
- The same review finding applied to the editor's "Save as copy" (`POST /templates`), which the review did not name: fixed the same way (`genericPlaceholders: false`).
- The same words on a template with no brand history are still replaced; override replaces them either way.
- A previous brand with no name (logo or palette only) never named the role, so it does not block.

Cost of this choice (a conservative miss, never a lost value): a legacy template that #347's Apply has ALREADY named (it wrote the snapshot without replacing the sample, which was the gap) and that still holds the click-blur 'WILDCATS' / 'WHS' keeps it on every later fill-blanks Apply. The fix for that template is "Brand this template" in the editor or Apply in override mode.

A legacy template with no `brandKit` whose HS_VARSITY `schoolInitials` is 'WHS' takes the organisation's initials on the next Apply. `branding-apply-rebrand.spec.ts` ("no brandKit snapshot") pins this. A tenant whose own brand derives 'WHS' rewrites 'WHS' with 'WHS': no change.

## What a typed value can still lose in fill-blanks

The remaining placeholders are the fictional sample organisation and its lines, matched on every template: 'WESTRIDGE WILDCATS', 'WESTRIDGE HIGH', 'The Westridge Review', 'Westridge Weekly', 'The Westridge High School Review', 'WESTRIDGE HIGH · EST 1956', 'WESTRIDGE!', 'WESTRIDGE.MS', 'Westridge Middle', 'Westridge', 'WESTRIDGE', 'Roosevelt Academy', 'Excellence · Honor · Service', 'every day a new adventure'. Several are also REAL school names ('Westridge', 'Westridge Middle', 'WESTRIDGE HIGH', 'Roosevelt Academy'), so a real Westridge or Roosevelt school that typed its own name there gets it replaced. The replacement is that tenant's own organisation name (or tagline) from Settings > Brand, which for such a school is normally the same name, so the effect is mild, but it is a real false positive, not only "someone retyping the sample". It is listed in the owner rows.

A generic word ('WILDCATS', 'WHS', 'HS', 'Central Administration') typed on a template that no brand has ever named (no `brandKit` with a name) is also still replaced on the first Apply: there it cannot be told apart from the click-blur capture of the sample. After that Apply the template is named, so a word typed back survives.

## Owner rows to confirm or strike (each needs a screenshot)

| Row | What changes on screen | Evidence so far |
|---|---|---|
| Hallway tagline | `ANIMATED_HALLWAY_SCHEDULE` shows the organisation tagline instead of "every day a new adventure" | Jest render test; Chromium screenshot `chromium-13-long-name-ms-hallway.png` |
| Studio ".MS" and Fieldnotes "& Otters" lockups | the name is followed by the scene's own ".MS" / "& Otters" | same screenshot: both wrap to two lines with a long name |
| Fitness and welcome logo slots | an empty slot / an emoji becomes the organisation logo | Jest render test (img src) |
| Long names in fixed MS slots | Arcade's name is Press Start 2P at 76px | same screenshot: wraps to two lines in the header |
| HS_TERMINAL / HS_TRANSIT write removed | the editor no longer writes `schoolName` there (nothing read it) | Jest |
| Sample names that are real school names | a school that typed 'Westridge', 'Westridge Middle', 'WESTRIDGE HIGH' or 'Roosevelt Academy' in a slot whose sample that is gets its Settings > Brand name there instead (see "What a typed value can still lose") | Jest |
| **No opt-out from the newly filled slots — confirm before merge** | fitness `gymLogoUrl`, the Animated Welcome `logoUrl` (the logo replaces the emoji), the hallway `tagline`, and the MS name and logo keys are absent on every existing zone, so the next Apply fills them on EVERY existing MS, fitness, welcome and hallway template. A tenant cannot keep them empty: absent or `''` counts as blank and is refilled on every Apply (pre-existing (b)), and the hallway's sample tagline cannot be kept at all (it is a placeholder, so it is replaced whenever the brand has a tagline). This changes what is on the glass on the next Apply. | consistent with the design's owner rows; the owner has not confirmed it |

## Legacy templates

- Absent registered keys (every MS, fitness, welcome and hallway zone, most HS and LOGO zones) are filled on the next Apply.
- Placeholders saved by the pre-f2c247dfb click-blur inline edit match rule (c).
- MS click-blur saves from 2026-05-03 to 2026-10-27 went nested (a dead shadow): the shadow test above. A shadow holding typed text (`cfg.school.name = 'Typed'`) blocks the flat key in fill-blanks, so that zone keeps showing the sample ('WESTRIDGE.MS') indefinitely: conservative (no typed text is lost) but not rebranded. See pre-existing issue (a). A non-string shadow (a number, an object) is treated as typed the same way (comment in `patchZoneIdentity`, test in `brand-identity.spec.ts`).
- On the following rebrand rule (b) takes over, because Apply writes the snapshot.

## Evidence (run in this worktree)

Review round 1 fix (second commit):

- API Jest `src/branding src/templates src/tenant-isolation`: 69 suites, 2022 tests passed. New: the generic-placeholder block in `brand-identity.spec.ts` (the reviewer's three reproductions, no-history, unnamed previous brand, override, sample organisation, typed back after the first Apply, `opts.history`, `rolesWithHistory`, non-string nested shadows); the "generic word typed on a named template" block in `branding-apply-rebrand.spec.ts`; the duplicate and `POST /templates` cases in `clone-brand-identity.spec.ts`; `identity-registry.spec.ts` (6) the generic set and (7) LOGO logo keys per renderer.
- One real-database Apply on a test tenant: a throwaway local Postgres 16 (127.0.0.1:55432, schema from `prisma db push`, deleted afterwards), driven through a real `PrismaService` (manifest hook armed) and `BrandingController.applyBrandToTemplates`. 4 of 4 passed: (1) an audit-row failure (unknown user, FK) rolled back every zone write and the snapshot; (2) fill-blanks replaced a legacy template's 'WILDCATS' / 'WHS' and filled an MS_ARCADE scene, kept the typed 'WILDCATS' / 'WHS' / 'Central Administration' on a template whose `brandKit` names a brand, wrote one audit row, and left a system preset's zone and another tenant's zone untouched; (3) the `updateMany` relation filter `template: { tenantId, isSystem: false }` returned count 0 for a preset's zone and another tenant's zone and 1 for the caller's; (4) a second Apply patched 0 zones. The spec was not committed (it needs a live database).
- `node apps/api/tools/check-tenant-isolation.cjs`: 0 unscoped, baseline 0. `node apps/web/tools/check-i18n-parity.cjs`: 7691 keys (no string changed). Web Jest `brand-kit-actions.test.ts` + `brand-identity-render.test.tsx`: 56 passed (web code unchanged in this round). `tsc --noEmit -p apps/api/tsconfig.build.json`: 0 errors. `packages/api-types` build: exit 0.

First commit:

- API Jest `src/branding src/templates src/tenant-isolation`: 69 suites, 1942 tests passed.
- New `apps/api/src/branding/identity-registry.spec.ts`: 234 tests. A mutation run (a wrong HS_VARSITY placeholder, MS_PAPER dropped, FITNESS_CORNERMAN registered) failed 6 of them, as it should; the registry was restored.
- Web Jest `brand-kit-actions.test.ts` (44) and the new `widgets/__tests__/brand-identity-render.test.tsx` (12).
- `node apps/api/tools/check-tenant-isolation.cjs`: 0 unscoped, baseline unchanged. `node apps/web/tools/check-i18n-parity.cjs`: OK.
- `pnpm --filter api build` (nest build): exit 0. `npx tsc --noEmit -p apps/web/tsconfig.json`: 0 errors.
- Playwright `builder-brand-tab.spec.ts`, Chromium only, against `next dev` with the API mocked: 6 of 6 passed, including the two new cases. The long-name screenshot shows: Arcade wraps the name to two lines in its header; Studio wraps "RIVERSIDE ACADEMY OF SCIENCE AND TECHNOLOGY .MS" to two lines beside ON AIR, close to "GOOD MORNING"; Fieldnotes wraps "… & Otters" to two lines; the hallway tagline sits under "LEARN · GROW · SHINE". The toast read "4 of 4 widgets restyled · 3 logos filled · your name and tagline filled". Screenshots are in the gitignored `docs/research/2026-10-12-brand-tab/` (`chromium-12-…`, `chromium-13-…`).

## Unverified

- `builder-brand-tab.spec.ts` under `--project=webkit`: the WebKit browser now downloads (`/opt/pw-browsers/webkit-2272`) but this container lacks its host libraries (libwoff2dec, libmanette, libenchant-2, libsecret-1, libGLESv2, libwayland-server, ...); `playwright install-deps webkit` is a system-wide apt install and was not run in this shared container. The web code is unchanged since the first commit. Also not run: Chromium against the production build (`next start`) rather than `next dev`.
- Apply against the production Postgres (Supavisor session mode) rather than a local one; a bench screen showing a rebranded HS and MS scene; `/api/v1/health` reporting the merge SHA.
- The production catalogue count below (needs a production database the agent does not have). Expected 0; if not, add those literals to the static placeholders. Never add a runtime DB or audit read.

```sql
SELECT count(*) FROM template_zones z JOIN templates t ON t.id=z.template_id
WHERE t.is_system AND t.tenant_id IS NULL
  AND z.default_config ~ '"(schoolName|schoolInitials|tagline|initials|school\.name|brand\.name|school\.logoUrl|brand\.logoUrl|masthead\.logoUrl|gymLogoUrl|logoUrl|assetUrl|textOverrides|imageOverrides)"';
```

## Deliberately not built

Design A's `brandKit.origin`, its audit_logs recovery and its system-preset DB read: they match nothing today (no preset has shipped identity values, which the catalogue invariant test now enforces), they add a query per rebrand, and they change the shape of `brandKit`.

## Pre-existing issues found (reported, not fixed here)

- (a) BuilderZone's inline edit writes dotted MS and fitness fields nested through `setByPath`, but their `pick()` reads the flat key, so an inline edit of `school.name` never reaches the screen. Needs its own test and fix. **Whoever fixes `setByPath` must also revisit the nested-shadow branch in `patchZoneIdentity`**: today a typed nested shadow keeps the flat key (the screen keeps the sample 'WESTRIDGE.MS'); once inline edits write the flat key, the shadow branch should probably migrate the typed shadow into the flat key instead.
- (b) A deliberately emptied `''` counts as blank and is refilled by the next Apply.
- (c) `logo-principals` renders a hard-coded "WASHINGTON" and never reads `schoolName`.
- (d) `apps/api/src/branding/apply-brand-to-zone.ts` has no production importer (dead code).
- (e) Retrying the editor's `stamped` POST is still open.
- `HS_TRANSIT schoolCode` ('WHS', an airport-style code chip) is not registered; the owner may want it treated as initials.
- LOGO: Apply fills both `logoUrl` and `assetUrl` (#347), so a typed `logoUrl` is kept while `assetUrl` gains the organisation logo (and the reverse). Checked which key each LOGO renderer reads: the five v2 variants read only `logoUrl`; LogoWidget and every themed crest (theme switch and variant-registered) read only `assetUrl` or no image at all; none reads both, so a typed logo in the key its renderer reads cannot be shadowed. `identity-registry.spec.ts` (7) pins this per component. Switching a zone between a v2 variant and a theme changes which key shows, as it did before.

## Rollback

Revert the PR. Everything written is ordinary zone config, which the previous build renders the same way; there is no schema or migration.
