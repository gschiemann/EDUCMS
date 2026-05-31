# Live Menu Feed for QSR/Restaurant boards — research (2026-05-31)

Goal: make restaurant/QSR menu-board templates feed live (prices, availability/86)
the way the sports CTS integration feeds scoreboards.

- **[01-cts-feed-architecture.md](01-cts-feed-architecture.md)** — the CTS pattern to copy. Key insight: CTS is a **fast poll + render-time freshness overlay**, not a Redis push. Reusable pieces: live-overlay JSON namespace, public cached poll endpoint (+serverTime), React poll provider, a field-binding catalog (`cts-fields.ts`), HMAC feed token.
- **[02-menu-feed-readiness-and-gap.md](02-menu-feed-readiness-and-gap.md)** — current menu state. Backend (catalog, per-location price-book, auto-86, Square sync, `GET /screens/:id/menu`) is REAL; React menu widgets already poll it (30 s). **Gap:** the 71 HTML signage menu boards' `data-source`/`data-feed`/`data-field-path` attributes are decorative — the sandboxed iframe only gets static text. Fix = parent React widget polls `/screens/:id/menu` and `postMessage`s the resolved menu into the iframe, where an extended V3 shim applies it to `data-field-path`/`data-field` nodes (prices + 86 styling).

Decision: match the CTS bar (poll + overlay), reuse the existing menu backend, and close the
HTML-board gap via the parent→iframe postMessage path (sandbox-safe).
