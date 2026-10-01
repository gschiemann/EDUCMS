# Corporate homebuilder templates

Approved on 2026-09-30 for the 2026-10-01 demo. The v5 Brookfield compositions and supporting-type refinements are retained; the original green collection uses the fictional Alderhaven Homes / Willow Grove identity. Prior review packages on the operator's Desktop remain unchanged.

The Corporate system catalog adds seven designs in landscape and portrait, using preset-sig-corporate-13 through 19 and their -portrait siblings. The existing Corporate presets are retained. Brookfield boards are installed as CUSTOM, isSystem=false, bound to the confirmed Brookfield tenant; they are deliberately absent from SIGNAGE_TEMPLATES and SYSTEM_TEMPLATE_PRESETS.

Every copy field, logo, photo, floor-plan image, palette token, font, type scale, media fit/focus/alternative text and QR destination is editable through the existing EXTERNAL_HTML shim and Properties panel. Floor-plan artwork is replaceable as an image; its embedded drawing labels are part of the artwork. Geometry remains the authored HTML/CSS composition.

Native IMAGE_CAROUSEL playback is shared through NativeImageCarousel.tsx. WidgetRenderer uses it for native zones; the homebuilder HTML adapter mounts the same component into each image slot. The production bundle is rebuilt by the web build. The adapter only translates existing imageOverrides/textOverrides, preserves the template scrims, and stops the shim's legacy timer. Photos and floor plans default to seven seconds with a fade. Single image retains the list and pauses rotation. Logos and QR codes start as single images. Floor plans default to contain.

Default image lists appear in the CMS editor. Operators can replace images, append several from the existing Media Library, reorder/remove them, select playback mode, edit crop/focus and change timing/transition. CMS save uses the existing zone configuration, so no schema migration or new storage format is needed.

The source assets were collected for this approved demo from official Brookfield property pages. Photography and floor-plan provenance is retained in the v7 review package's research/asset-sources.json. Embedded local fonts avoid font requests from opaque-origin frames. Media assets are shared build assets; only template records and catalog visibility are tenant scoped.

## Installation

Run scripts/install-homebuilder-templates.cjs with --tenant-id, --expected-tenant-name, --operator-id and an environment file. It defaults to a dry run. --apply creates missing records and default scenes/zones in one transaction, and writes an AuditLog entry for all 28 installation records. Existing template contents are preserved. IDs must match their expected system/tenant ownership. The installer validates the source digest and the exact active Corporate tenant name. It uses the repository's Supabase CA with full TLS verification.

Deploy the web assets before applying the intake. The API's normal preset reconciliation seeds the green system records on boot; the intake also handles those records when API deployment finishes later. Brookfield tenant IDs are supplied at installation time, never embedded in the global catalog.

## Verification

The scoped browser check is apps/web/tests/cross-browser/homebuilder-cms.cjs. It verifies all 28 files in Chromium and WebKit, within the real allow-scripts null-origin sandbox, including text fit, fonts/media, both orientations, seven-second timing, single-image pause and contained floor plans. It also captures the actual gallery posters. Editor proof and live installation/deployment proof are saved in the operator's review-package handoff.

Local release checks: all 60 sandbox render/playback cases passed in Chromium and WebKit. The real CMS Properties panel passed copy, slide reorder, timing, single-mode and contained-floor-plan checks in both engines. The test harness was removed before the production build. Deployment and installation receipts are retained with the Desktop review package.
