// ─── Interim template quarantine denylist — SINGLE SOURCE OF TRUTH ───
//
// Canonical list of EXTERNAL_HTML signage boards the 2026-07-12 world-class
// audit named as launch-blockers (audit W0-08): visible dimension-placeholder
// content, confirmed clipping, or a demo-only brand-licensing risk (the
// Domino's pilot pack, marked "pilot-demo-only" in its CREDITS.txt).
//
// This lives in `@cms/api-types` so BOTH the API and the web layer consume ONE
// list that can never drift:
//   • API — `apps/api/src/templates/ensure-system-presets.ts` re-exports this
//     Set and seeds/keeps matching presets ARCHIVED (hidden from the gallery
//     query) + `templates.controller.ts` rejects cloning a quarantined preset.
//   • Web — `apps/web/src/components/widgets/signage-templates.ts` filters the
//     builder's "Industry Signage" picker so a quarantined URL is never an
//     offerable NEW choice, and `IndustryShowcase.tsx` keeps them off the
//     public marketing funnel.
//
// Until the real TemplateRelease approval pipeline (TPL-002) exists, editing
// this list is a deliberate "this board passed / failed review" decision —
// removing an entry must be paired with the board actually being fixed. See
// docs/research/2026-07-12-world-class-fullapp-audit/07-template-catalog-remediation.md.
//
// Matched by the EXTERNAL_HTML zone's `defaultConfig.url` so it's robust to
// preset-id naming.
export const QUARANTINED_BOARD_URL_LIST: readonly string[] = [
  // Dimension-placeholder boards
  '/templates/signage/bar/05-now-pouring.html',
  '/templates/signage/corporate/07-cafeteria.html',
  '/templates/signage/fashion/01-lookbook-flagship.html',
  // fashion/02 + fashion/05 REMOVED from quarantine 2026-07-23: the redesign
  // (f4eee79c) genuinely cleared the W0-08 dimension-placeholder trigger.
  // Verified by an adversarial per-board review (docs/research/2026-07-23-
  // fashion-quarantine-verify/) — real editorial copy, editable (SHIM-V7 +
  // data-fields), Taurus-safe, no visible placeholder/measurement text. The
  // drop-zone label hides on photo-attach (accepted affordance). 01 + 04 STAY
  // quarantined: their default no-photo state still shows a prominent empty
  // image drop-zone ("CAMPAIGN / LOOK PHOTO" / 4× hardcoded "Product photo").
  '/templates/signage/fashion/04-new-arrivals.html',
  '/templates/signage/fashion/07-shoppable-window.html',
  '/templates/signage/fashion/08-campaign.html',
  '/templates/signage/hospitality/01-lobby-welcome-flagship.html',
  '/templates/signage/hospitality/02-concierge-board.html',
  '/templates/signage/hospitality/04-pool-spa-day.html',
  '/templates/signage/hospitality/07-group-welcome.html',
  '/templates/signage/hospitality/10-brand-story.html',
  '/templates/signage/menus-pos/03-daily-special.html',
  '/templates/signage/qsr/01-drive-thru-flagship.html',
  '/templates/signage/qsr/05-combos-deals.html',
  '/templates/signage/qsr/06-beverages.html',
  // Confirmed clipping candidates
  '/templates/signage/qsr/02-counter-menu.html',
  '/templates/signage/qsr/04-lto-promo.html',
  '/templates/signage/hospitality/05-dining-tonight.html',
  // Brand-licensing risk — Domino's pilot-demo-only asset pack
  '/templates/signage/qsr/11-dominos-pizza-board.html',
];

/** The quarantine denylist as a Set for O(1) `.has()` lookups. */
export const QUARANTINED_BOARD_URLS: ReadonlySet<string> = new Set(
  QUARANTINED_BOARD_URL_LIST,
);

/** True when a board URL is on the interim quarantine denylist. */
export function isQuarantinedBoardUrl(url: string | null | undefined): boolean {
  return url != null && QUARANTINED_BOARD_URLS.has(url);
}
