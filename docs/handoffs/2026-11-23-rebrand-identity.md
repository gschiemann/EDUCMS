# A rebrand applies the name, tagline, initials and logo, and replaces the old brand (2026-11-23)

**Status.** Branch `claude/rebrand`, cut from `origin/master` 1292fd287. Not pushed, no pull request, **not merged**. No schema change, no migration, no new environment variable. Not life-safety: nothing under `apps/api/src/emergency/` or the player changed.

Author: a Claude Code cloud session with workflow agents. Review: two rounds in a separate session from the same vendor, under the owner's written waiver ("Don't worry about another model review"). Round 1 asked for changes, round 2 approved.

## Situation

The owner, before a demo: "when I update the branding it does give me the new logo but it doesn't try to apply the new name and tagline ... make sure that when I rebrand something everything gets updated that's available".

On `master`, three paths put a brand onto a template. None of them wrote the tagline. Only the clone path wrote a name, and only on `HS_*` widgets.

1. **The template editor, Brand tab, "Brand this template"** (`apps/web/src/components/template-builder/brand-kit-actions.ts`, `BrandKitPanel.tsx`). It wrote colours, fonts, `cfg.brand` and the board logo slots. It never wrote `textOverrides`, and `BrandKitLike` had no tagline.
2. **Settings > Brand, "Apply to templates"** (`POST /branding/apply-to-templates`, `apps/api/src/branding/branding.controller.ts`, mode `fill-blanks`). It wrote colours, fonts and the accent, plus the board `cfg.brand` when that was undefined. It wrote no logo, name, tagline or initials. Because it only filled blanks, a second brand never replaced what the first had stamped.
3. **A new template from a preset** (`apps/api/src/templates/templates.controller.ts`, `applyBrandToZoneConfig`). It filled the name and initials on `HS_*` widgets only, and its `Template.brandKit` snapshot had no tagline.

## What changed

- **`apps/api/src/branding/brand-identity.ts`** (new, pure). It holds:
  - the board field keys;
  - the initials rule;
  - the brand-owned rule;
  - the zone identity and style patchers;
  - the snapshot and history helpers.

  The web editor holds a copy of the key lists and the initials rule in `brand-kit-actions.ts`. Both test suites pin the same lists and examples. Each also reads the other side's source to check that they still match. Both files carry a `PARITY` comment.
- **Board text fields** (cfg.textOverrides; the shim ignores a key a board lacks):
  - name: `brand.name`, `school.name`, `brand.restaurant`;
  - tagline: `brand.tagline`, `school.motto`;
  - initials: `school.initials`, `brand.initials`, `brand.mark`;
  - monogram, one letter: `brand.monogram`;
  - logo slots (cfg.imageOverrides): `brand.logo`, `school.logo`.

  These keys are deliberately left alone because their meaning varies by board: `brand.tag`, `school.sub`, `brand.promise`, `brand.descriptor`, `school.systemName`.
- **React widgets:**
  - `LOGO` gets `schoolName` and `tagline`.
  - `HS_*` gets `schoolName` (uppercased) and `schoolInitials`.
  - Any other widget gets identity keys only when its config already carries `schoolName`, and only the keys it already has. This way a person's initials or a sponsor's tagline is never touched.
- **Initials.** Split the name on whitespace, `-`, `_` and `/`. Skip the/of/at/and/for/in/a/an. Take the first letter of up to 3 words, uppercased. The monogram is the first letter.
- **"Apply to templates"** writes the identity and extends the brand-owned rule to the colour, font, accent, board-token and background keys. In the same transaction as the audit row, it writes the new brand (tagline included) into each template's `brandKit` and keeps the replaced snapshot as history. The transaction has a 30 s timeout and a 10 s maxWait. A template with no change is not rewritten. The response adds `identityZonesPatched`, and the Settings success line shows those counts.
- **"Brand this template"** writes the name, tagline, initials and logo unconditionally, as it already did for colours. It is an explicit action on one template. The checklist lists the name and the tagline, and the toast says they were filled. When the brand used is the organisation's, it calls the new **`POST /branding/templates/:templateId/stamped`**:
  - It adds the current `TenantBranding` to a `stamped` history inside `Template.brandKit`. The brand is read on the server, never from the body.
  - It is tenant-scoped and refuses presets.
  - The mutation and the `RECORD_TEMPLATE_BRAND_STAMP` audit row share one transaction.
  - A repeat call changes nothing.
- **Per-template adopt** (`POST /branding/templates/:id/adopt`) now saves the tagline it detected.
- **Clone and duplicate** fill the name, tagline, initials and logo where they are blank. The snapshot carries the tagline.
- **Copy.** The Settings help text and the new checklist, toast and success-line strings are in en, es and zh.

## The brand-owned rule

A field may be written when either:

- it is blank or absent; or
- it still equals what one of the template's previous brands produced.

The previous brands are the template's `Template.brandKit` snapshot plus its `stamped` history. That history holds the organisation brand the editor stamped, and the snapshots a rebrand or an adopt replaced; it is capped at 6.

- The comparison is trimmed and case-insensitive, so an uppercased `HS_*` name still matches.
- Text an operator typed by hand (not blank and not a previous brand's value) survives `fill-blanks`.
- `override` replaces everything.
- A value the new brand does not have is never written: an empty name, tagline or logo never blanks out content.
- A template with no snapshot behaves as before and gets blanks only.

## What the owner should know before the demo

- **Fill in the tagline (and the logo) on the new brand.** A rebrand to a brand without a tagline leaves the old tagline on screen, because the rule never writes empty over content.
- **Themed widgets with a placeholder name.** A themed React widget whose saved config has no `schoolName` key is not renamed. Nor is a preset's own placeholder name: it is neither blank nor a previous brand. Boards, `LOGO` and `HS_*` are covered. For any other template, use the editor's "Brand this template", which writes unconditionally. (Superseded on `claude/rebrand-placeholders`: see `docs/handoffs/2026-11-23-rebrand-placeholders.md`.)
- **A brand detected for one template in the editor** (a snapshot without `inheritedFrom`) is now replaced by the organisation brand on "Apply to templates". The help text says so. This reverses the earlier rule that "the per-template kit stays per-template", so it needs the owner's confirmation after the demo.
- **Recording the editor's stamp is best-effort.** If the `stamped` POST fails, the console logs it and the next Settings rebrand will not recognise what the editor stamped on that template.

## Evidence

The local equivalents of the required checks were run on this branch and are listed in the PR body (`claude/rebrand`). Targeted suites:

- API Jest: `src/branding`, `src/templates`, `src/tenant-isolation`;
- web Jest: the full suite;
- Chromium Playwright: `builder-brand-tab.spec.ts` against the production build.

There was also a throwaway Chromium check, not committed. It confirmed three things:

- the editor checklist shows the organisation name and tagline;
- "Brand this template" puts the organisation name into the corporate lobby board's `brand.name`, inside the sandboxed iframe;
- the toast says the name and tagline were filled.

## Unverified

- **WebKit.** It is not available in this environment. Run `builder-brand-tab.spec.ts` under `--project=webkit` before calling it done.
- **Real screens.** No player or screen showed a rebranded template. Every check ran in the editor against mocked APIs, or in Jest against mocked Prisma.
- **A real database.** Settings > Brand "Apply to templates" was exercised only with a mocked Prisma client. It has not been run against Postgres with a tenant's real templates.
- **The deploy.** It is not on `master`, and `/api/v1/health` has not reported this commit.

## Follow-ups (not in this branch)

- ~~Treat a system preset's own placeholder value as replaceable, so themed widgets get the organisation name on clone and on rebrand.~~ Done on `claude/rebrand-placeholders`: `docs/handoffs/2026-11-23-rebrand-placeholders.md`.
- ~~Add the parent template's tenant constraint to `templateZone.update` in `applyBrandToTemplates`. It is unchanged from `master` and the tenant-isolation gate passes.~~ Done on the same branch (`updateMany` with the template's `tenantId` and `isSystem: false`; anything but one row rolls back).
- Retry the editor's `stamped` POST, or show a toast when it fails.
- Get the owner's confirmation on replacing a per-template detected brand.

## Rollback

Revert the PR. There is no schema or migration, so the previous build reads the same `brandKit` JSON. The extra `tagline`, `stamped` and `appliedDefaults` keys are simply ignored.
