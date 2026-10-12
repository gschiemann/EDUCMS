# General table and chart widgets — 2026-10-11

## Scope

Adds bounded `CHART` rendering and editing variants stored only in widget config:
`design-table`, `design-chart-bar`, `design-chart-line`, and `design-chart-pie`.
This avoids any API or database schema change. A table config has `heading`, `caption`,
`columns: string[]`, `rows: string[][]`, `textColor`, `headerColor`,
`backgroundColor`, `borderColor`, `fontFamily`, `fontSize`, and `alignment`. A chart
config has `heading`, `caption`, `rows: {label, value, color}[]`, `textColor`,
`backgroundColor`, `gridColor`, `fontFamily`, `fontSize`, `showGrid`, and
`showLegend`.

## Behavior

- The editor offers up to 6 columns and 8 rows for tables, and up to 8 chart rows.
  Add controls disable at capacity; remove remains available. Existing saved arrays
  are not truncated by the readers or renderer. If saved rows contain more cells than
  declared columns, generated editable headings expose every cell. Over-capacity data stays visible and
  can be removed down to the supported editor limit.
- Empty tables and charts render a clear prompt. Bar/line charts support signed values
  and zero-only data. Pie charts report negative values and zero totals rather than
  drawing misleading geometry.
- Renderers use semantic tables, accessible chart names, SVG for pie/line, and simple
  DOM bars for bar charts. All values come from saved config; no live data facade or
  sample fallback is presented as connected data.
- Explicit font sizes are used as saved pixel sizes. Content containers scroll if a
  zone is too small, preserving the full content.

## Validation

Focused unit tests are in the new widget and template-builder `__tests__` folders.
Both focused Jest suites pass (9 tests). ESLint passes for the two new implementation
files and two new test files. The requested `PropertiesPanel.tsx`-inclusive lint run
reports 120 errors and 19 warnings across that large file; the two new implementation
files and tests are lint-clean. `tsc --noEmit` passes after building the workspace type
packages inside this worktree. No production build or browser review has been performed.
