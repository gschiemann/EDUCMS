# Guest Essentials catalog audit

**Scope:** read-only review of `essentials-presets.ts`, `ensure-system-presets.ts`, the web `signage-templates.ts` registry, relevant existing catalog tests and the three repaired source paths. No app was run and no tests were run.

## Findings

- The API source defines **12 unique base designs** and expands each into landscape and portrait, for **24 generated presets**. Base IDs are unique and use the `preset-essentials-{vertical}-{design}` form; portrait IDs append `-portrait`.
- The 24 Essentials IDs are unique against the other statically declared API preset IDs. `ensure-system-presets.ts` includes `...ESSENTIALS_TEMPLATE_PRESETS` in `ALL_PRESETS`, then applies all entries of `ESSENTIALS_PRESET_VERTICALS` to the vertical lookup. The web registry contains the matching 24 Essentials IDs, with no extra or missing IDs relative to the generated base/suffix set.
- There are four exact business / vertical / group mappings, each with three designs and both orientations:

  | Business | API vertical tag | Web group | Presets |
  |---|---|---|---:|
  | hospitality | `HOSPITALITY` | Hospitality | 6 |
  | corporate | `CORPORATE` | Corporate | 6 |
  | gym | `GYM` | Gym | 6 |
  | healthcare | `HEALTHCARE` | Healthcare | 6 |

  These are the values intentionally placed in the vertical map; the Essentials entries do not rely on the general preset-ID inference/default path.
- Orientation metadata and URLs agree: landscape uses `LANDSCAPE`, 3840×2160, and the bare `.html` URL; portrait uses `PORTRAIT`, 2160×3840, and the same source URL with `?o=portrait`. All **12** source HTML files exist under `public/templates/signage/essentials/{corporate,gym,healthcare,hospitality}/` (three per vertical). Each source has portrait-specific CSS and reads the `o`/`orientation` query parameter, so the query suffix selects its authored portrait mode.
- The three repaired existing sources (`museum/01-today-flagship.html`, `real-estate/01-availability-flagship.html`, and `bar/09-hours-location.html`) currently have only landscape preset registrations in both the API and web registries. No matching `-portrait` preset IDs were found. This is a catalog finding; it does not assess whether their HTML itself responds to a portrait viewport.

## Existing tests and suggested minimal test

There is no Essentials-specific catalog spec in the inspected tests. `gap-presets.spec.ts` already demonstrates the useful contract: assert each new preset is registered exactly once in `ALL_PRESETS`, orientation dimensions and URL suffix match, and the vertical resolves correctly. `portrait-vertical-parity.spec.ts` only iterates `SYSTEM_TEMPLATE_PRESETS`, so it does not cover this separately spread Essentials pack.

A compact `essentials-presets.spec.ts` should iterate `ESSENTIALS_TEMPLATE_PRESETS` and assert: (1) exactly 24 entries, 12 per orientation, (2) each ID occurs once in `ALL_PRESETS`, (3) landscape/portrait siblings share the same source path and have the expected `?o=portrait` suffix and dimensions, and (4) each entry resolves to the expected one of the four vertical tags. If desired, a static source-existence assertion can strip the query and resolve the URL under `apps/web/public`; the registry-level test is the more important regression guard.

## Catalog strings and localization

The registries contain literal English `name`/`group` values; no translation keys or localization helper is used in these catalog files. In the API, preset names are seed data, then the templates gallery reads and renders `preset.name` / `template.name` directly. In the web picker, `PropertiesPanel` renders each `SIGNAGE_TEMPLATES` entry's `name` and `group` directly as the `<option>` and `<optgroup>` text. Thus the Essentials labels follow the same static-English convention as the surrounding catalog entries. The root rulebook says user-facing strings ship in English, Spanish, and Chinese; these catalog names appear directly in UI, and the inspected registries do not show how that rule is satisfied for them. If the rule is intended to include catalog names, current registry behavior merits a localization follow-up; this audit cannot infer an exception or translation behavior outside these paths.

## Evidence boundaries

This was a source inspection and static count/path check only. It does not validate runtime seeding, actual tenant filtering, gallery rendering, or the visual quality of the boards.

## Follow-up from the parent

The parent agent plans to add portrait siblings for the three repaired legacy boards to `REVIEWED_BOARD_PORTRAITS` in `system-presets.ts`; those IDs were absent when this audit was performed. The focused API test draft is available separately at `work/essentials-presets.spec.ts` for review and possible application in the repository.
