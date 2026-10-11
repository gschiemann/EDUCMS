# Template quality refresh — implementation in progress

User scope: find weak templates throughout the app and rebuild them to flagship standard. Included templates and existing saved instances must retain editing behavior. This is separate from the shipped template-editor usability release.

## Inventory and baseline evidence

The source catalog contains 482 presets across the main, fitness, restaurant, bar, retail, sports and worship packs. Excluding 19 retired IDs and 16 quarantined presets leaves 447 offered presets: 151 native widget layouts and 296 external-HTML presets using 241 distinct board files. The union spans all app verticals; tenant galleries show their relevant subset.

Rendered all 151 native presets and all 340 packaged HTML files (282 regular and 58 holiday), both HTML orientations. All captures completed without navigation failure. This is coverage evidence, not a claim that every design passed the visual standard. Font/overflow measurements are diagnostic and manually reviewed; hidden logo fallbacks, ticker loops and stage scaling need interpretation.

Durable evidence: `/Users/gschiemann/Desktop/template-flagship-audit/`. `catalog.json` maps IDs, source packs and current URLs; `boards/results.json` and `native/results.json` record captures; individual PNGs and contact sheets preserve the baseline before modification.

## Findings and ownership

- School: old middle-school welcome boards rely on emoji food and flat club panels; elementary schedules have faint completed rows and inconsistent fit limits. Lead rebuilding each composition separately.
- Sports: football, basketball and baseball celebration widgets inherit dark text on dark backgrounds. Lead fixes per-scene defaults while honoring user overrides; the shared default for light widgets stays intact.
- Corporate: old lobby, new-hire, KPI, directory, shuttle and events boards have small type and generic panels; person features need actual default photos. Corporate worktree owns that directory, excluding safety-info and the two newer signal boards.
- Healthcare: the ten older boards need legible type, composed layouts and physician photo slots. Healthcare worktree owns that directory; authored clinical content is retained.
- Hospitality: events, wayfinding, check-in and outlook need real signage hierarchy. Hospitality worktree owns four files; newer arrival/resort/atrium boards remain references.
- Restaurant/bar native menu templates often show honest empty states because implicit demo food was intentionally removed. Never restore fake runtime prices or provider fallback data. Examine preset composition separately from live source behavior.
- Holiday: several legacy canonical boards repeat a generic three-panel frame while newer alternatives are stronger. Audit actual holiday route selection before replacement.
- Quarantined and retired templates remain quarantined/retired unless their specific defect is rebuilt and verified. Existing saved references remain supported; no destructive deletion or customer-content overwrite.

## Compatibility and validation contract

Preserve stable template IDs and URLs, all existing field keys, image slots and the runtime/edit shims. HTML revisions reach both new gallery choices and saved instances through the same URL. Preserve metadata-only synchronization of existing system presets; never overwrite customer template zones. Repeaters, theme tokens, long copy, media replacement and editor click targets must work after redesign.

Each board is designed and inspected individually in Chromium and WebKit at landscape and portrait dimensions. After integration, rerun the appropriate scoped shim injector, additive media injector, API exemplar regeneration/freshness gate and poster captures with provenance. Recheck builder editing and shipping guards before release. Record actual results and release state below when implementation is complete.

## Release state

Work in progress on `codex/template-flagship-refresh`; no quality-refresh release has been pushed yet. Production currently serves `25cb9af4`, containing the earlier editor fixes. Its general CI workflow has unrelated player-information and accessibility failures, recorded in the earlier editor handoff; do not call that workflow green.
