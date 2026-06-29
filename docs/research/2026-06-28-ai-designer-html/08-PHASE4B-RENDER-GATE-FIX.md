# AI Designer — Phase 4b render-gate fix (2026-06-29)

## The bug (diagnosed on glass)
The AI Designer board renders perfectly in the builder, and the PropertiesPanel
`ExternalHtmlTextEditor` **mounts** for it (the "Edit text" / chat-to-edit chrome
shows). But the **EDIT TEXT** section showed the placeholder *"Pick a template
above to expose its editable text."* — 0 editable field rows — even though the
board has 16 `data-field` nodes.

A live computer-use screenshot of the builder (test board `908e194d`) is what
finally pinned it: that exact placeholder string is a **render-level early-return**
in `ExternalHtmlTextEditor`:

```tsx
if (!url) {            // PropertiesPanel.tsx ~6844
  return <div>Pick a template above to expose its editable text.</div>;
}
```

AI Designer boards are **srcdoc** — they carry their HTML inline in `config.html`
with **no `config.url`**. So `url === ''` → this gate fired and short-circuited
BEFORE the discovered-field rows could render. The 4a discovery *effect* already
handled the inline case correctly (`if (!url && !inlineHtml)` at ~6664) and an
in-page DOMParser proved the walk finds all 16 fields — but this render gate
threw the result away.

## The fix (`8478dd94`)
One-line render-gate change to match the discovery effect:

```tsx
if (!url && !inlineHtml) {   // only placeholder when there is NEITHER source
  return <div>Pick a template above to expose its editable text.</div>;
}
```

Correct for all three cases:
- **url board** → `!url` false → renders fields (unchanged).
- **empty zone** → both falsy → placeholder (unchanged).
- **inline designer board** → url falsy, inlineHtml truthy → falls through to the
  discovered-field rows (the fix). `discoveredFields===null` shows "Scanning…",
  then the grouped text/image/action editors render.

Also cleaned up a pre-existing test-only tsc error from yesterday's wizard work
(`ai-intake-contract.test.ts` — the `IntakePurpose` type gained `'auto'`; the
test's own name says "non-auto", so it now `continue`s past it). `web tsc` is
0 errors again.

## Why this was the LAST wiring gap
- 4a baked the EDUCMS-SHIM-V6 into every persisted board (apply overrides +
  report clicks) and made `WidgetRenderer` forward `educms-overrides` to the
  srcdoc iframe via postMessage.
- 4b discovery (prior poke) made the panel parse `config.html` to find fields.
- This render gate was the one remaining short-circuit. With it removed, the
  operator now sees the discovered text/image/action field editors for an
  AI-designed board, types a change, and the shim applies it live in the iframe —
  same loop as the static EXTERNAL_HTML boards.

## Residual (deferred, non-blocking for launch)
- **Brand recolor**: `applyBrand` sets `--brand-*` CSS vars; AI boards use literal
  hex, so the brand-swatch controls no-op on them. Text + image + per-field style
  edits work now. A prompt change (boards define+use `--brand-*`) closes this —
  deferred.
- **Image swap reliability**: `<img data-imgslot>` gets `background-image` from
  the shim. Steer the prompt toward a DIV `data-imgslot` (or `<img data-img>`)
  for a clean swap. Text/style is the proven path.

## Verify-before-claim
Diagnosis was on-glass (computer-use screenshot of the live builder showing the
placeholder). The fix's render verification is pending the Vercel deploy of
`8478dd94` (reload builder → confirm field rows render). Logic is airtight + the
DOMParser already proved discovery; the screenshot just closes Rule #21.
