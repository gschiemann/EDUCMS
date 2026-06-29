# AI Designer (full-HTML boards) — design + staged plan (2026-06-28)

Greg: the engine-generated boards "look like MS Paint." He wants **designer-level
only**, the **3-candidate flow at that quality**, and to **match or beat the
cutting-edge template tools** (Canva / Adobe Express / etc.). This is one of the
most important features in the product.

## The core insight (why a better model alone didn't fix it)
Today the LLM is ONLY an art-director: it emits an `ArtDirectorSpec`
(archetype + theme + copy) and **our engine stamps a fixed layout**. So the visual
ceiling = our templates, NOT the model. GPT-5 → 5.5 sharpens copy, not design.
To reach designer-level the AI must **author the whole board**, and THAT is where
a top model pays off.

## Proof (validated live 2026-06-28)
A Chrome Coffee menu authored as a full self-contained HTML document (latte-art
photo + graphite duotone + coral edge, Fraunces wordmark with a coral period,
"COFFEE · COMMUNITY · QUALITY" eyebrow, two-column menu with dotted leaders, coral
tabular prices, sectioned ESPRESSO/SLOW BAR/PASTRIES, footer with real address +
hours) rendered live in the browser = genuinely designer-grade. Same brand + menu
as the templated version that looked amateur. **The architecture, not the model,
was the gap.**

## Rendering pipeline (grounded in code)
`ExternalHtmlWidget` (apps/web/src/components/widgets/WidgetRenderer.tsx:3623)
renders a **null-origin sandboxed iframe** (`sandbox="allow-scripts"`, NO
allow-same-origin) — the exact containment we want for AI HTML. Today it only
loads a hosted `config.url` (static files under public/templates/) + applies
operator overrides via base64 URL params read by the baked shim
(inject-shim-v2.cjs), + live menu via postMessage.

**DECISION: inline `srcdoc`.** AI boards are per-tenant runtime content (can't be
build-time public files). Store the generated HTML in the zone's
`defaultConfig.html` (the rich-text widgets already store `config.html`) and
render via `<iframe srcdoc={html} sandbox="allow-scripts">`. Same null-origin
containment; no hosting/CDN/offline-cache problem (the HTML rides in the template
payload, so the player service-worker caches it automatically). Tradeoff vs the
url path: overrides must apply via **postMessage** (no URL params on srcdoc) — the
shim already listens for `educms-overrides` (menu), so editability extends that.

## Staged build
- **Phase 1 — srcdoc render (foundation).** Extend `ExternalHtmlWidget` to render
  `config.html` inline via srcdoc (additive; url path unchanged). Prove an AI/hand
  HTML board renders in our real pipeline (builder + player). [SMALL, do first.]
- **Phase 2 — AI Designer backend.** New generation service: a TOP model (GPT-5 /
  Claude Opus, BYOK + tiering) authors a complete premium HTML board from the
  scraped brand + real content. A strict system prompt = a world-class signage
  designer + the design system (Taurus-safe CSS — no inset/gap; loaded fonts only;
  the venue palette; dimensions; layout craft; NO placeholders) + few-shot
  exemplars (the Chrome menu). A **sanitizer** (the srcdoc sandbox already
  contains JS; still strip/validate, allowlist font/img hosts, enforce Taurus
  rules). Emits the HTML into a single EXTERNAL_HTML zone.
- **Phase 3 — 3 designer candidates.** Fan out 3 DISTINCT designs (different
  layout/art direction), all on-brand — the pick-a-winner grid at designer
  quality. Thumbnails = the frozen srcdoc iframe / a poster.
- **Phase 4 — editability.** AI bakes `data-field` / `data-imgslot` hooks; the
  shim applies brand/text/image edits via postMessage (click-to-edit, the
  flagship-template contract). Operators tweak copy/photo/colors without code.
- **Phase 5 — make it the premium default.** AI-Designer becomes the default for
  AI template generation; the current art-director engine stays the instant/cheap
  fallback. Cost: a premium model writing a full doc costs more + is slower per
  board — gated/tiered; worth it for "designer-level only."

## Guardrails
- Security: srcdoc sandbox = null origin, no parent/cookie/storage access (same
  trust model as today's EXTERNAL_HTML). Add a sanitizer + (follow-up) an iframe
  CSP. Never trust AI HTML beyond the sandbox.
- Taurus (Chromium 83): the prompt MUST forbid `inset`/`gap` shorthands + require
  longhand; loaded fonts only; the board self-scales to the iframe (auto-fit JS).
- Verify-before-claim: every phase live-rendered + screenshot before "done."

## Status
Plan locked + proof validated. Phase 1 (srcdoc render) building now.
