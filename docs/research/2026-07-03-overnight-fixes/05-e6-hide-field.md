# CRUSH Wave E — E6: hide/blank a field on EXTERNAL_HTML boards (2026-07-03)

Fable-approved executor-safe. THE BUG: clearing a field's text in PropertiesPanel
deletes its textOverride, which resurrects the BOARD'S OWN DEFAULT COPY — operators
had no way to actually blank/hide an element.

FIX (minimal — extends the existing per-field style-override allowlist by ONE key):
- Shim (inject-shim-v2.cjs, marker V6→V7): applyTextAndStyles now reads
  `styles[key].hidden` — `true` → el.style.display='none'; explicit `false` clears
  it back to the template's own CSS; ABSENT → no-op (zero change for existing
  boards). Rides the SAME `_styles`/`textStyles` transport brand/color/fontSize
  already use — no new query param, no new postMessage, no protocol change.
- 84 hs/signage/fitness boards re-baked V6→V7 via the injector. LEAD VERIFIED the
  re-bake is EXACTLY the injector's deterministic output (re-ran injector → 0 diff)
  and every board still carries click-to-edit (CLAUDE.md sweep clean).
- PropertiesPanel ExternalHtmlTextEditor: eye/hide toggle per discovered field row
  (writes _styles[key].hidden, drops the entry cleanly on un-hide, dims the row).

DISCLOSED GAPS (not silent): the 30 hand-crafted applyMenu menu boards (qsr/
menus-pos/bar) and the AI-designer shim (apps/api, out of fence) don't get `hidden`
— same allowlist, separate code paths; future extension.

Proof: new external-html-hide-field.spec.ts (chromium+webkit, 6/6) posts the real
educms-overrides message to hs/achievement.html, asserts computed display→none then
reverses it (+ simultaneous text edit) → restored. Existing click-edit spec 46/46
(no regression). tsc + mobile-perf clean. Commits 56300101, b1268594, e58d459b.
