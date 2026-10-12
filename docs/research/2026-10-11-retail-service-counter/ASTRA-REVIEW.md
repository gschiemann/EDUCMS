# Astra retail service-counter review and polish

Scope: **Retail Service Counter final art, design and authored editability** only. This is not a full-application audit. The source is pre-injection; lead owns shared shims, registration, gallery posters and end-to-end editor verification. Astra accepts the revised authored design for lead integration; it is not a deployment claim.

| Standard Audit Surface | Design | UX | Functionality |
|---|---|---|---|
| 1. Real-time + signed pub/sub | N/A | N/A | N/A — static board |
| 2. Storage + content pipeline | Covered — swappable slot design | Deferred — asset picker | Deferred — upload/save pipeline |
| 3. AI providers | N/A | N/A | N/A |
| 4. AI feature surfaces | N/A | N/A | N/A |
| 5. AI-tool comparative scan | Deferred — outside retail source | Deferred | Deferred |
| 6. Streaming integrations | N/A | N/A | N/A |
| 7. Sports data | N/A | N/A | N/A |
| 8. POS / commerce integrations | N/A — no live claims | N/A | N/A — no integration |
| 9. Communications | N/A | N/A | N/A |
| 10. Auth + identity | Deferred — outside source | Deferred | Deferred |
| 11. Billing + commerce | N/A | N/A | N/A |
| 12. Design import | N/A | N/A | N/A |
| 13. Public alerts | N/A | N/A | N/A |
| 14. Multi-vertical surface | Covered — retail service language | Covered — two service paths | Deferred — registration |
| 15. Cross-browser + Chromium 83 | Covered — Chromium/WebKit render | Covered — copy legibility | Covered — authored runtime; C83 hardware deferred |
| 16. Forensic/audit coverage | N/A | N/A | Deferred — no privileged mutations here |
| 17. Operational + DX | N/A | N/A | Deferred — CI/deployment owned by lead |
| 18. Accessibility | Covered — text hierarchy and contrast | Covered — numbered paths plus color | Deferred — complete editor keyboard/axe |
| 19. Template editability | Covered — all strings/slots retained | Covered — authored theme/manual sizing | Deferred — full injected click/save/reopen |
| 20. Three review lenses | Covered | Covered at board boundary | Covered at authored runtime boundary |
| 21. Verification before claim | Covered — actual screenshots | Covered — longer copy | Covered — bounds/runtime evidence; no shipped claim |

## Study decision and substantive changes

Rendered all three Luna studies in Chromium and WebKit, landscape and portrait. Inspected all three Chromium studies in both orientations. Study 01 had the best editorial starting point, but vertically split step digits, placeholder prose, weak spacing and undersized portrait metadata failed acceptance. Study 02 additionally broke landscape hero words; study 03 relied on flat gray cards and large unproductive gaps.

The revised source pairs Cormorant Garamond editorial headings with DM Sans instructions and IBM Plex Mono wayfinding. A forest-green collection panel and terracotta returns panel create immediate path recognition. Portrait receives stacked panels with a full-width introduction. Designed parcel and return-bag vector placeholders replace implementation prose and remain swappable through the original image slots. The logo fallback is a graphic instead of uneditable “Mark” text. Footer fields have actual line-height space; requirement and step boxes reserve room for realistic longer store copy.

All 38 original data-field keys and three image-slot keys are preserved exactly, verified against Luna commit `b4262fc0`. No fake queue/POS integration or return-policy promises were added. No text is flattened into images. The two-path/two-step layout is fixed capacity.

The authored runtime adopts ServiceUpdate's canonical theme application, orientation and manual-size fitting logic. Explicit operator font sizes take precedence over automatic fitting and theme scale. Shared generic/media shims are deliberately not copied or edited.

## Evidence and acceptance

Evidence directory: `/Users/gschiemann/Desktop/template-flagship-audit/retail-final/`.

- `study-retail-service-counter-0*-{chromium,webkit}-{landscape,portrait}.png`: 12 Luna study renders.
- `final-{chromium,webkit}-{landscape,portrait}-{default,long-copy,theme,manual}.png`: final scenario renders, regenerated after fixes.
- `measurements.json`: actual DOM Range bounds, fitted pixel sizes and page errors for each visible field.

**PASS — 16 final visual/geometry scenarios:** Chromium and WebKit × landscape and portrait × default, realistic longer copy, changed palette/body+heading fonts with 1.1 theme scale, and explicit numeric/px operator sizes. All 400 visible-field measurements pass actual DOM Range containment, scroll containment, containing-region bounds, pairwise text non-overlap and authored body/support floors (60px/50px). No page errors. Captures are complete 1920×1080 and 1080×1920 frames, with measurements normalized to the 3840px authoring canvas.

**PASS — four authored-contract runs:** original 38 field keys / three slots, URL `textStyles` replay at 68px and 66px, explicit sizes remaining absolute through theme scale and resize, display-font token application, clearing manual sizes restoring auto-fit at the 60px floor, no visible uneditable strings, and default text-region non-overlap. `contract-checks.json` contains results. The saved-style URL path is verified; DOM theme changes simulate the shared shim's field application. This does not claim a complete editor save/reopen flow.

**Image framing:** inspected the native parcel/bag illustrations and four `replacement-{engine}-{orientation}.png` captures. Both illustrations fit wholly inside their slots. Replacing both optional illustrations with the existing cobalt-sneaker asset hides the placeholders and displays the entire image with `contain` in both orientations/engines. No subject cropping is introduced. Logo also defaults to contain. These small optional slots are supporting marks/product images, not full photography heroes; tightly cropped operator assets retain their own crop.

**Design judgment:** the authored final is an A-level retail service template: clear editorial hierarchy, distinctive but practical typography, warm/forest path differentiation, purposeful rules, generous instructions and a deliberate portrait layout. The longer-copy scenario remains more dense, as expected, but stays readable. The default art needs no replacement photo to appear finished. It is suitable to join the flagship collection after lead integration checks.

**Still deferred:** shared shim injection, actual click-to-edit, picker Replace/Fit/Rotate, saved theme persistence through the application, Undo/reopen, registration/poster and deployment. Named happy path for lead: choose Service Counter → click store name or a service instruction → replace text → save, under 30 seconds. No claim that an unrun path passed. Arbitrary essays, unlimited steps, unsafe operator-selected tiny/huge fonts, and automatic contrast correction for arbitrary palettes are not supported by this bounded source.

## Handoff

Changed source: `apps/web/public/templates/signage/retail/09-service-counter.html`. No registry, shared injectors, other templates, environment or lock files changed. The original three studies remain untouched. The authored source contains no baked shared shim. Run `astra-verify.cjs` and `astra-contract.cjs` from this worktree for reproducible evidence (their Playwright import points to the lead's installed module).

Lead should inject the generic/media shims, repeat the bounded full editor happy path and check exact injected renders before registration/poster capture. Previous full-library/editor recommendations in `ASTRA-REVIEW.md` under Desktop reports remain open; this work only resolves the new retail draft.
