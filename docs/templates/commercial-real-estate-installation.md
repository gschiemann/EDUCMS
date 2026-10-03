# Commercial real estate: JLL and reusable Corporate pack

Prepared for design review on 2026-10-03. This pack is not yet published or installed into a live tenant. The JLL collection follows the current JLL identity and the property information structure on official JLL listings. Its matching reusable collection uses the fictional Meridian Commercial Real Estate identity. Both use the same eight compositions, with landscape and portrait presets: 32 installation records backed by 16 responsive HTML files.

| Design | Purpose |
| --- | --- |
| Property Overview | Property identity, address, photography and leasing highlights |
| Amenity Collection | Tenant services, fitness, meeting facilities and hospitality |
| Floor Plans & Availability | Replaceable approved drawing, suite sizes, availability and leasing terms |
| Location & Connectivity | Replaceable map, transport, parking and neighborhood connections |
| Industrial Specifications | Clear height, docks, truck court, power, column spacing, site and office area |
| Investment Offering | Sale proposition, occupancy, lease term and illustrative financial metrics |
| Guided Property Tour | Eight touch sections: overview, gallery, amenities, floor plans, availability, specifications, location and broker handoff |
| Property Finder & Compare | Four editable property cards, property-type filtering, detailed plans and a two-property comparison |

The source research is [JLL](https://www.jll.com/en-us/), [office property services](https://www.jll.com/en-us/property-types/office/), [1 City Centre Drive](https://property.jll.com/en-ca/listings/1-city-centre-drive), [1 Liverpool Street](https://property.jll.co.uk/listings/1-liverpool-street), [Constitution Square](https://property.jll.com/listings/constitution-square-2168-2180-shattuck-ave-berkeley) and [19701 Hamilton Avenue](https://invest.jll.com/se/en/listings/industrial-logistics/19701-hamilton-ave). Assets and source URLs are recorded in the shared `_assets/sources.json`. Photography illustrates the design; it does not depict the fictional sample properties. Sample specifications, rents, financial metrics, travel times, drawings and contact information must be replaced with broker-approved content.

## Existing CMS tools

These are EXTERNAL_HTML scenes with the repository's injected V14 click-to-edit shim and existing Properties panel protocol. No new editor or storage format is required. Each copy element has a stable `data-field` key and a text-fit floor of 50 pixels on the 4K stage. Canonical `theme.*` tokens control palette, display/body/label fonts and type scale. Fonts are embedded for opaque-origin frames.

Operators can edit copy, font size/weight/color/alignment, hide text and save text positions; replace logos, photos, map artwork and floor-plan artwork; and use the existing Media Library to append, reorder or remove gallery images, change timing/transition, choose single-image playback, crop/focus images and edit alternative text. The shared native IMAGE_CAROUSEL component performs image playback. Logos and plans default to contain; photos default to cover. Overview photos and the signage plan gallery rotate every seven seconds; single-image mode pauses rotation.

Floor-plan labels inside the uploaded drawing belong to the artwork. Replace that image to change its rooms or embedded labels. Composition geometry remains authored, as in the Brookfield pack. The finder starts with four editable cards; the tour starts with two editable plan slots. Indexed row groups retain the standard CMS count controls within the authored composition limits.

The tour has Previous/Next, direct section navigation, Start over, contained plan selection, zoom from 100% to 300%, and touch scrolling for enlarged drawings. `tour.startPage` chooses the initial section; set it to `gallery`, `amenities`, `plans`, `availability`, `specifications`, `location` or `contact` to bring that section into view for editing. `tour.idleSeconds` and `finder.idleSeconds` reset the experience after inactivity, bounded to 30–600 seconds and defaulting to 120. Edit mode pauses inactivity resets and makes clicks select fields. The shared text-position helper now discovers hidden tour sections and dynamically created detail dialogs, so saved positions and existing drag tools work in those views as well.

Finder types are Office, Industrial, Retail and Life science. Its type fields should retain those values for the built-in filters; other text and the four listings' content are freely editable. Comparison is limited to two properties, the dialog supports Escape and restores focus to its triggering control. `contact.url` is the editable HTTP(S) listing/brochure/tour-request destination; changing it regenerates the QR code. This handoff uses the customer's existing site. The kiosk does not collect or submit leads itself.

## Catalog and tenant ownership

Only the 16 generic variants enter `ALL_PRESETS` and `SIGNAGE_TEMPLATES`. They are tagged `CORPORATE`, appear under Corporate or Touch Kiosks, and have system ownership. JLL templates are absent from both global registries. The dedicated intake creates them with `isSystem=false` and ownership of the exact confirmed Corporate tenant. Touch templates are marked `isTouchEnabled=true` and use the existing EXTERNAL_HTML zone.

Deploy approved assets before applying the intake. The ordinary API reconciliation will add missing generic system presets on startup. Existing presets are retained. The scoped installer defaults to a read-only dry run:

```bash
node scripts/install-commercial-real-estate-templates.cjs \
  --tenant-id '<confirmed-tenant-id>' \
  --expected-tenant-name '<exact-tenant-name>' \
  --operator-id '<active-super-admin-id>' \
  --env-file '<approved-environment-file>'
```

Add `--apply` only for an approved installation. One serializable Prisma transaction checks the active tenant and operator, validates all source hashes, refuses ownership collisions, creates missing templates/default scenes/zones and writes an AuditLog for every installation record. Existing template contents are preserved. Any audit failure rolls back the entire intake. The installer uses the supplied DATABASE_URL without changing its connection or TLS settings and enforces the repository's session-mode requirements: port 5432, no pgbouncer parameter, low connection limit and pool_timeout=20. Customer ids and secrets are never embedded in the pack.

## Review and verification

Generate a portable review folder with `python3 scripts/package-commercial-real-estate-review.py --output '<review-folder>'`. It contains the paired designs, actual browser posters, source manifest and supporting media. Serve that folder over local HTTP for live touch previews; its index also shows static posters when opened directly.

Run `node apps/web/tests/cross-browser/commercial-real-estate-cms.cjs` for Chromium and WebKit verification in the actual `sandbox="allow-scripts"` opaque-origin iframe. Add `--capture-posters` to refresh only this pack's gallery posters and provenance hashes. The checks cover all 32 variants, all tour sections, plan zoom/switching, finder filtering and comparison limits, modal content and focus, saved copy/style/position edits, click-to-edit messages, gallery replacement/contain/clear, QR destination validation and idle resets.

Run `node --test scripts/install-commercial-real-estate-templates.test.cjs` for installation ownership, authorization, dry-run and audit rollback checks. The existing Brookfield/homebuilder browser suite verifies the shared image adapter's unchanged playback behavior. Web type checking and API production-source type checking are required before review; the repository-wide API test-inclusive type check also contains unrelated pre-existing test typing failures.

Publication requires the repository's design approval, local preflight, real CI completion and deployed render proof. This document is a preparation handoff, not a live deployment receipt.
