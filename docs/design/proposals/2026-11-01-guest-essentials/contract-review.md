# Guest Essentials contract review

Read-only mechanical review of the three proposal HTML studies, `README.md`, `validation.json`, the handoff, and the binding flagship template standards. No app/browser was run and no repository files were changed.

## Findings

- **Visible text fields:** no missing `data-field` found in A, B, or C. All visible text nodes are inside a field; hidden theme data is also field-tagged. Duplicate field keys: none in all three files.
- **Image slots:** each study has a replaceable `brand.logo` slot and a replaceable `hero.photo` slot. All referenced default photos resolve locally (`lobby.jpg` or `pool.jpg`). No un-slotted `<img>` elements or other image references were found.
- **Theme contract:** all three contain the canonical 12 theme fields: `brand`, `brand2`, `accent`, `accent2`, `ink`, `bg`, `pos`, `neg`, `fDisplay`, `fBody`, `fMono`, and `scale`.
- **Assets and notices:** all four packaged font files have corresponding SIL OFL notice files. Local font/photo paths resolve. README and handoff explicitly state the photos are reused from the existing hospitality library and their provenance still needs confirmation before publication; the reviewed package does not itself establish photo licensing/provenance.
- **Claims vs evidence:** no concrete contradiction found between the recorded default-render claims and `validation.json`. The 12 validation cases represent 3 designs × 2 orientations × 2 engines, with empty errors/violations/collisions and `minFont: 50`, matching the stated 50px supporting-text floor. The package itself also clearly limits these claims to authored defaults and says CMS/save/reopen/hot-zone/media and production integration remain unverified.

## Limits

This was a static attribute/reference audit, not a rerun or independent reproduction of the browser measurements. It does not verify photo provenance, arbitrary edited copy, or CMS behavior; those limits are already disclosed in the reviewed documents.
