# Rule-#10 third variant — serialized-inset-shorthand sweep (2026-07-03)

Greg-directed follow-up to a bug found while building v3 StadiumChaseScene.

**The bug (invisible to grep — no file contains "inset").** A React inline
style object with all FOUR physical sides (top/right/bottom/left) gets
re-serialized by the browser CSSOM into the `inset` shorthand in the DOM style
attribute. A non-uniform set whose serialized `top` starts with digit 0 (bare 0,
'0px', '0%', even '0.5%') produces e.g. `<inset> 0px 0px 0px 560px`, which the
player/layout.tsx Chromium-83 polyfill's `[style*="<inset> 0"]` substring
selector matches and force-zeroes ALL sides !important — destroying the offset.
Manifests on MODERN player Chromium (the CSSOM collapse is universal); only the
ORIGINAL inset bug is Chromium-83-specific. Empirically reproduced live.

**Fixed (8/8 landmines):** scorebug reel, scrapbook ruled-lines, Celebrations
{Baseball,Basketball,Football} center columns, player/page.tsx + KioskSplash
top-left pinning idiom (right/bottom:'auto' omitted), and RibbonCelebrationStrip
center column (lead-fixed, was fenced under widgets/sports/**). Pattern: 3 sides
+ explicit width/height — a 3-side object can never serialize to `inset`.

**Durable protection:** apps/web/tools/check-inset-serialization.cjs — AST
detector (TS compiler API) flagging any style object with all 4 sides present,
not all identical, top-value leading-zero. Exits non-zero on a hit. Plus a
real-browser Playwright regression test (chromium+webkit, verified fail-pre/
pass-post). CLAUDE.md rule #10 extended with the third variant.

**Polyfill hardening DEFERRED (correct call):** a precise selector can't
discriminate uniform vs non-uniform for container-query units (cqi/ch don't
collapse uniform-zero to the 1-value form), so hardening could silently stop
protecting a real cq-unit Chromium-83 landmine. Not provably regression-free →
left the polyfill as-is + documented the JS getComputedStyle alternative for a
future attempt. The widget fixes + detector fully close the current exposure.

Commits: 578cddc8 detector, 1a0fc905/345d7574/3a68d901/0ae66d0a widget fixes,
9d0f69f9 test, 73317819 docs, + lead ribbon fix. Sweep agent verified taurus-
safety/tsc/mobile-perf/Playwright green.
