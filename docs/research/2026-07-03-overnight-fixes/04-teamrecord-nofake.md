# #295 — TeamRecordWidget: drop the fabricated default record (2026-07-03)

The nofake render-surface gate (8898470d) stopped the seeded '10-1'/'8-3' from
showing on a live player, but two residuals remained: (a) variants-register still
pre-seeded defaultConfig.placeholder '10-1'/'8-3' so the BUILDER drop showed a
realistic fake record, and (b) the gate's `placeholder !== fallback` heuristic
FALSE-BLANKED a legitimately-entered '10-1' home record on a live player.

Fix: removed the fabricated defaultConfig placeholders (variants-register 1524-25);
replaced the value-equality heuristic with `record ? record : (isLiveNoData ? '—'
: 'W–L')` — an explicit operator entry renders on every surface (no false-blank),
an untouched widget shows an obvious 'W–L' prompt on the builder and neutral
dashes on a live unbound player. Tests updated + false-blank regression added.
Lead inline fix; jest nofake-sweep-render-surface green.
