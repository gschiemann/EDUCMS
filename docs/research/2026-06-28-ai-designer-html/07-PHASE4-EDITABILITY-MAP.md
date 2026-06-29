# AI Designer — Phase 4 editability wiring map (Explore agent, 2026-06-29)

## The reusable system (no parallel architecture needed)
The static EXTERNAL_HTML boards already have a full edit system. Reuse it verbatim.

### EDUCMS-SHIM-V6 (the baked runtime)
`apps/web/scripts/inject-shim-v2.cjs` lines ~101–136. A minified IIFE injected at
end of `<head>`. It:
- reads overrides from BOTH URL params (`?brand/text/textStyles/img`, base64url)
  AND a `postMessage {type:'educms-overrides', brand, text, textStyles, img}` —
  so it works for srcdoc (no URL) via postMessage.
- applies: `applyBrand` (sets CSS vars on :root), `applyTextAndStyles`
  (textContent + inline styles on `[data-field]`), `applyImages` (src/bg on
  `[data-imgslot]`/`[data-img]`/`[data-slot]`).
- reports clicks: in edit mode, clicking `[data-field]`/`[data-imgslot]`/
  `[data-action]` posts `{type:'educms-field-click', key, kind}`.
- handshake: posts `educms-ready` on load; listens `educms-edit-mode {on}`.

### Protocol
| dir | type | payload |
|---|---|---|
| iframe→parent | `educms-ready` | — |
| iframe→parent | `educms-field-click` | `{key, kind:'text'|'img'|'action'}` |
| parent→iframe | `educms-edit-mode` | `{on}` |
| parent→iframe | `educms-overrides` | `{brand, text, textStyles, img, actions}` |

### Override shape on zone config
`config.brand`, `config.textOverrides`, `config.textStyles` (aka `_styles`),
`config.imageOverrides`, `config.actionOverrides`.

### Delivery today
`WidgetRenderer.tsx` ExternalHtmlWidget (~3623): URL boards get overrides as
base64url query params (`srcWithOverrides`). The srcdoc branch (~3735) currently
sends NOTHING (TODO noted in code). A `postMenu` useCallback (~3716) already
posts `educms-overrides {menu}` to the srcdoc iframe — proves postMessage to
srcdoc works.

### PropertiesPanel
`ExternalHtmlTextEditor` (PropertiesPanel.tsx ~6628–6920) discovers fields by
`fetch(url)` + DOMParser walk of `[data-field]`/`[data-imgslot]`/`[data-action]`,
renders text/image/style editors that write `config.textOverrides` etc., and the
click-to-edit window listener (~6775–6821) is **src-agnostic** (works for srcdoc
unchanged). The only URL-specific bit is field DISCOVERY (fetch) — for srcdoc it
must parse `config.html` instead.

## ⚠️ Gotcha: brand recolor needs CSS vars
`applyBrand` sets CSS vars (`--brand-*`). The static boards USE `var(--brand-*)`.
The AI Designer boards use LITERAL hex → `applyBrand` won't recolor them. So for
AI boards, TEXT + IMAGE overrides work out-of-the-box; brand recolor needs the
board to also define+use brand vars (a prompt change, deferred). Text/image edit
is the high-value path and works now.

## Plan
- **4a (this poke, headless-verifiable):**
  1. Bake the V6 shim into AI board HTML at persist (create-designer) — new
     `DESIGNER_EDIT_SHIM` + injector in designer-prompt.ts; controller injects it.
  2. WidgetRenderer srcdoc branch: forward `educms-overrides` (text/img/styles/
     brand) via postMessage on a top-level useEffect (reuse frameRef; hoist hooks
     — do NOT declare hooks inside the `if (inlineHtml)` block).
  Verify: render board+shim headless, postMessage overrides, confirm a data-field
  text changes + a data-imgslot swaps.
- **4b (next poke):** ExternalHtmlTextEditor — discover fields from `config.html`
  (not fetch) for srcdoc boards; click-to-edit jump already works. Then brand-var
  prompt change for recolor.

## ✅ 4a SHIPPED + verified (`043f8082`)
- `apps/api/src/ai/designer-edit-shim.ts` — `DESIGNER_EDIT_SHIM` (EDUCMS-SHIM-V6
  verbatim) + `injectDesignerEditShim(html)` (idempotent, before </head>).
- `create-designer` injects the shim into the sanitized board before persist.
- WidgetRenderer srcdoc branch: `postDesignerOverrides` forwards brand/text/
  textStyles/img/actions via `educms-overrides` postMessage (reuses frameRef,
  re-posts on load). Stale "wired in a later phase" comment removed.
- 18 designer tests green; api+web tsc clean.
- **Headless proof:** postMessage `educms-overrides {text:{venue:'NOVA CAFÉ'},
  textStyles:{venue:{color:'#00e5ff'}}}` → the data-field text + color updated
  live; `educms-edit-mode {on}` armed the click handlers (`__veArmed:true`).

### 4a nuance to carry into 4b
- `applyBrand` sets CSS vars; AI boards use literal hex → brand recolor needs a
  prompt change so boards define+use `--brand-*` vars. (Text + style + image edits
  work now.)
- `<img data-imgslot>` gets `background-image` (not `src`) from the shim — for
  reliable image SWAP, steer the prompt to a DIV `data-imgslot` (background) or
  add an `<img data-img>` path. Text/style override is the proven path.

## Next: 4b = make it operator-facing
ExternalHtmlTextEditor must, for srcdoc boards (config.html, no url): parse
`config.html` with DOMParser to discover `[data-field]`/`[data-imgslot]`/
`[data-action]`, render the same editors (write config.textOverrides etc.), and
rely on the existing src-agnostic click-to-edit window listener. Then the
WidgetRenderer forwarding (4a) applies them live. Load-bearing panel change —
do with care + a live builder screenshot.
