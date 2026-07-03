# GYM welcome boards port — builder report (2026-07-02, compact)

Branch `gym-welcome-port` (base 8d8f1038), 5 commits, 6 files, +679 lines.
All three APPROVED boards → production EXTERNAL_HTML presets.

- Files: signage/gym/03-welcome-poster.html (31 fields/2 imgslots, de5c0ee3),
  04-welcome-split-duo.html (38/2, ecedc374), 05-welcome-locker-room.html
  (33/2, 501263e7). Registration both sites (57bf8cc2): system-presets.ts
  preset-sig-gym-03/04/05 (GYM, 3840×2160, EXTERNAL_HTML) + signage-templates
  gallery catalog. e2e + poster hot-zone fix (810ae655).
- Convention: siblings won over the brief — signage/gym/ not fitness/
  (fitness/ holds design-reference artifacts only). Scale ×2 uniform
  (1920→3840), sibling stage scaffold + fit script + data-orient.
- Brand tokens mapped to the shim BRAND_MAP vars so operator brand reskins
  the boards; live clock on sibling clock.hhmm self-tick; trainer photo +
  brand logo imgslots with .has-img placeholder-hide.
- Injector: EDUCMS-SHIM-V6 injected 3 / skipped 89 up-to-date; NO-CLICK-TO-EDIT
  sweep empty. Note: current shim marker is V6 (agent docs say V5 — docs stale).
- Poster "01" watermark data-field removed (decorative, occluded center broke
  first-hot-zone click) — aria-hidden, zero visual change.
- Checks: rule-#10 grep PASS · no vw/vh PASS · clickedit e2e chromium+webkit
  10 passed · WebKit native render PASS (0 pageerror, both orientations,
  eyeballed vs reference PNGs) · api tsc PASS · web tsc PASS.
- APPROVED comments baked into all 3 files + both registration blocks.
