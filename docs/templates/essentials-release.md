# Essentials and unfinished-board release — November 3, 2026

Owner approval: “i say do them all” (all three designs and business adaptations), “update any remaining templates that are not fully designed”, and “release your templates”.

## Scope

The Guest Edit, Easy Days and City Guide each have Hospitality, Corporate, Gym and Healthcare adaptations. Twelve HTML sources produce 24 landscape/portrait presets. Each business receives six options. The presets have explicit verticals and appear in both API and web catalogs. Sample copy describes manually editable venue information, without implying live operational integrations.

Real-estate Availability, Museum Today and Bar Hours receive composed layouts, readable typography, editable copy/photos/logos/theme/fonts, native image carousels and three missing portrait registrations. Existing operator layouts are not bulk-rewritten. Catalog total: 564 presets / 342 canonical board files.

The layout runtime preserves partial messages: an omitted text/image/style map means unchanged; an explicit empty map restores defaults. This fixes Bar Hours losing its saved photo when its menu update arrives. Every photo uses the shared native carousel (10-second default), and text stays real editable HTML.

## Validation

- Required `pnpm preflight`: API, workspace packages, web production build passed on the updated main baseline.
- 48 real production-app editor cases passed in Chromium and WebKit: new Hospitality exemplars and all three legacy repairs × both orientations; text/font and photo replacement, Fit/Rotate, Undo/Redo, Save/reopen. API calls are mocked; this is not a live-account or physical-player claim.
- Portable `apps/web/tests/cross-browser/essentials-cms.cjs`: 24 business-source/browser cases passed, including theme, click editing, URL restore, partial updates, explicit Remove/Restore, auto orientation and representative carousel rotation/pause.
- API catalog specs: 8 passing. Rulebook, editability, designer-exemplar and poster-source checks pass. Original default geometry evidence covers all 60 source/orientation/browser combinations.
- Evidence: `docs/handoffs/2026-11-02-essentials-reports/`. Final PR/CI/deployment results are recorded separately at publication.

## Asset provenance

All assets remain replaceable. No template text is baked into a photograph.

| Asset | Origin / retained source evidence |
| --- | --- |
| Hospitality lobby and pool | Existing Pexels library images, byte-for-byte reuse. Commit `2f517de8e` records photo IDs 38197473 (lobby) and 23696826 (pool). |
| Corporate reference workplace | Existing AI-generated fictional interior; `docs/templates/corporate-directory-touch-install-manifest.json` records its description and hash. |
| Gym club floor | Existing original locally stored hero from `scratch/design/gym-pf-refresh`. Its implementation handoff calls the three heroes original and says no production dependency on third-party campaign imagery. The released file is SHA-256 identical to that source; introduced by `8cb3edd3b`. This record does not invent a stock provider or photographer. |
| Healthcare default | Existing Pexels 17829429 by Tessy Agbonome. Photographer, source and license links are retained in `public/templates/signage/healthcare/assets/README.md`. |
| Museum Light & Time | Generated specifically for this batch with the built-in OpenAI image generation tool on November 2, 2026. Fictional museum/light-installation imagery; source generation artifact `exec-0e60fb08-0757-40f6-891f-66514f953190.png`. |
| Real-estate apartment living room | Generated with the built-in OpenAI image generation tool on November 3, 2026; artifact `exec-27217647-8970-427c-89d5-c922f770963c.png`. Prompt: fictional contemporary apartment living room, limestone/oak, ivory sofa, soft daylight, centered seating for both crops; no people, text, logo or watermark. Replaces the earlier Brookfield private-concept photograph in this public preset. |

Manrope, Newsreader, Space Mono and Syne reuse the commercial-touch pack and its SIL OFL notices. Cormorant Garamond and Fraunces are bundled in `refresh-assets` with their SIL OFL notices. Their font sources are the corresponding Google Fonts families.

## Deployment and rollback

Merge deploys web assets/previews and API catalog reconciliation. It adds system presets and updates shared template sources; existing boards using the three repaired source URLs receive the refreshed rendering while retaining their saved overrides. No new schema migration, credential change, forced screen refresh or fleet command is part of this release. Revert this PR to restore prior sources/catalog registration; do not delete operator-created templates.
