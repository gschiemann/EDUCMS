# Astra — ten additive design elements, 2026-10-12

Scope: **the ten new Luna data/photo elements only**. This is an authored component design and targeted behavior review, not a full app audit, Canva feature-parity claim or deployment verification. Existing widgets/configuration paths remain available. Retail Service Counter is unchanged.

| Standard Audit Surface | Design | UX | Functionality |
|---|---|---|---|
| 1. Real-time + signed pub/sub | N/A | N/A | N/A |
| 2. Storage/content pipeline | Covered — framing | Covered — retained asset controls | Deferred — storage pipeline |
| 3. AI providers | N/A | N/A | N/A |
| 4. AI features | N/A | N/A | N/A |
| 5. AI comparative scan | Deferred — outside scope | Deferred | Deferred |
| 6. Streaming | N/A | N/A | N/A |
| 7. Sports feeds | N/A | N/A | N/A |
| 8. POS/commerce | N/A | N/A | N/A |
| 9. Communications | N/A | N/A | N/A |
| 10. Auth/identity | Deferred — outside scope | Deferred | Deferred |
| 11. Billing | N/A | N/A | N/A |
| 12. Design imports | Deferred — outside scope | Deferred | Deferred |
| 13. Public alerts | N/A | N/A | N/A |
| 14. Multi-vertical | Covered — neutral editable elements | Covered — existing catalog paths | Deferred — lead registration |
| 15. Cross-browser/C83 | Covered — Chromium/WebKit screenshots | Covered — readable defaults | Covered — modern engines; C83 hardware deferred |
| 16. Forensic/audit | N/A | N/A | Deferred — no privileged mutations here |
| 17. Operational/DX | N/A | N/A | Covered — focused tests and TS; deployment deferred |
| 18. Accessibility | Covered — clear hierarchy/axes/labels | Covered — labels independent of color | Covered — semantic table/status/alt text; full axe deferred |
| 19. Editability | Covered — editable headings, data, images | Covered — font/control paths retained | Covered — unit contracts; integrated save/reopen deferred |
| 20. Three lenses | Covered | Covered at component boundary | Covered at component boundary |
| 21. Verification | Covered — actual source renders | Covered — geometry checks | Covered — local evidence, no shipped claim |

## Verdict and actual changes

Initial four final PNGs rejected for concatenated legends, line labels offset from plotted points, a hairline series without labeled axes, undersized pie and oval Circle frame. Repetitive cream collage mats/shadows also weakened the composition.

| Element | Final design verdict | Revision |
|---|---|---|
| Editable table | Accept | Editable editorial heading font; spacious ruled rows; restrained header band; 60px body and 51px support defaults. Saved cells/extra columns preserved. |
| Bar chart | Accept | Stronger bars, aligned exact values, honest signed domain and endpoint axis; muted cohesive palette; redundant legend off for new configs. Explicit saved legends preserved and spaced. |
| Line chart | Accept | 7px logical stroke, round marks, labeled axis including signed zero; categorical labels and points share centers. Exact values remain legible. |
| Pie chart | Accept | Larger bounded chart, organized legend with exact values and percentages. Zero sectors do not paint a misleading full circle; negative/all-zero data retain explanatory states. |
| Rounded photo frame | Accept | Clean borderless default and restrained corners; existing border/crop/focal/zoom controls retained. |
| Circle photo frame | Accept | True centered circle regardless of rectangular zone dimensions. Cover/contain remain operator choices; contain intentionally shows a dark matte. |
| Arch photo frame | Accept | Clean arch silhouette without default gold border; framing/caption controls retained. |
| Pair collage | Accept | Edge-to-edge diptych, intentional gutter, no cream outer mat or soft card shadows. |
| Featured collage | Accept | Stronger 1.65:1 hero hierarchy, supporting images at right, actual zone filled. |
| Grid collage | Accept | Clean contact-sheet composition; consistent gutters and readable caption scrims. All saved photos retained. |

Photo captions use measured width **and height** so short landscape cells do not inherit giant width-only text. The lower scrim gives white text sufficient separation from varied images. Existing explicit sizes/fonts, legacy URL promotion, focal position, zoom, fit and shape remain supported. The default caption font loads for the player. No new media dependency, baked image text, hidden photo or animation was added.

New data headings use a separately editable `headingFont`. Existing configs with only `fontFamily` retain that face for their heading. New default objects include Cormorant Garamond headings and DM Sans body. Existing explicit palette/config values are honored. No registry files were changed.

## Verification and evidence

Evidence: `/Users/gschiemann/Desktop/template-flagship-audit/astra-elements-polish/`.

- Inspected all ten revised widgets in both Chromium and WebKit via `chromium-data.png`, `webkit-data.png`, `chromium-photo.png`, `webkit-photo.png`; individual crops for every element are also saved.
- Default data sections have 1600×900 client and scroll bounds in both engines, with no page errors.
- 16 existing focused tests passed, plus four new tests covering categorical alignment, saved font/legend compatibility, signed line data/stroke and zero pie sectors.
- Full web TypeScript check passed after building the isolated workspace's API/scoreboard type packages. Focused lint: zero errors, one pre-existing image onError a11y warning (not a mouse/keyboard interaction).
- Final additional signed/zero/explicit-legend and shape/full-zone checks are recorded in `verification.json`; see final status appended below.

The components render in an isolated esbuild React harness served from this worktree on port 8932, not from the main checkout. No app routes, registry, BuilderShell, shared shims, environment, lock file or previously accepted retail HTML were edited.

## Limits and lead handoff

These are improved reusable building blocks; operator composition still determines the whole board's art direction. Dense eight-row charts with long captions, arbitrary essay-length cells/captions, and intentionally oversized operator fonts can exceed the fixed logical region. Saved content remains present; this is not an unbounded-content fitting claim. Actual circle geometry introduces transparent space beside a circle in a non-square zone, by design. Collages have no such stage letterboxing.

Lead should integrate and rerun the existing blank/built-in save/reopen/Undo/Redo flows against these exact revisions, including the new heading-font picker. Named quick path: add an element, edit its content/image in Properties, save; target under 30 seconds. Full integrated persistence and deployment remain lead-owned and were not rerun by Astra in this component harness.
