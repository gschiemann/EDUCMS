# HANDOFF — sports + dining redesigns (usage wall hit 2026-07-30, resets 6:10pm PT)

## State at the wall

1. **Sports big-game redesign — IN FLIGHT, crashed on the session limit.**
   Worktree survives with uncommitted WIP: `.claude/worktrees/agent-a11e771e124203f1a`
   (branch `worktree-agent-a11e771e124203f1a`): modified `apps/web/public/templates/hs/ath-biggame.html`
   + new `hs/assets/` baked photo dir. Agent had diagnosed an auto-fit bug
   (line-height .88 → scrollHeight > clientHeight at every size, crushing
   multi-line fields) and was mid-rewrite with a parent-box height test.
   **Resume:** SendMessage to that agent id after reset ("continue; finish
   gates; commit") — it retains context. If the session is gone, spawn a fresh
   venueos-template-designer agent (worktree) pointed at the WIP file as its
   starting draft, with the original brief: broadcast-package look, VECTOR
   school crests (shield/monogram/banner SVG, data-imgslot-swappable),
   dark stadium photo grade, lower-third matchup, sponsor strip, countdown,
   ticker; gates = key-gate zero-removed vs master, taurus greps, both-engine
   both-orientation 0-error renders, crest crispness at full + thumb scale;
   lead then: inject-shim-v2 hs, clickedit e2e, poster regen + POSTER_VERSION
   bump, marketing JPG, showcase swap (SPORTS entry), preflight, push, CI.

2. **Full-service dining redesign — ORDERED by Greg ("hurry and finish full
   service dining"), NOT STARTED.** Current homepage slot = stopgap wine list
   (menus-pos/02). Target: `apps/web/public/templates/signage/menus-pos/01-fullservice-menu.html`.
   Use the dining brief from this session (2026-07-30): photo-forward upscale
   dinner-menu board, ⚠ MUST preserve the hand-crafted applyMenu()/live-POS +
   auto-86 machinery and every data-field key (key-gate), baked Pexels food/
   interior photo in `menus-pos/assets/`, Brass Rail brand continuity, same
   gates as above + `inject-click-shim.cjs signage` (menu-board shim, NOT
   inject-shim-v2). Then: fresh JPG, showcase RESTAURANT entry swap, poster
   regen + version bump, preflight, push, CI watch.

3. Poster gate reminder: ANY board-HTML change requires poster regen
   (`node apps/web/scripts/gen-template-posters.cjs http://localhost:8123`
   with `python3 -m http.server 8123` in apps/web/public) + POSTER_VERSION
   bump in ScaledTemplateThumbnail.tsx, and the template-quarantine spec pins
   the denylist COUNT (currently 16) — update if quarantine changes.

## Everything already shipped this stretch (all CI-green, live on venue-os.app)

Marketing sample swaps (K-12 untouched): QSR coffee flagships, retail
Storefront Gallery, fashion Lookbook, worship Live Commons, bar Gold Room,
corporate Signal Ribbon, sports Pack-the-Gym (interim), healthcare clinic
kiosk, dining wine list (interim), hospitality **"Golden Hour"** full redesign
(de-quarantined + reactivated in live DB, ACTIVE). Industry-name consistency
(localizedVerticalIndustry, en/es/zh) in the settings switcher. 3 finished
bar redesigns harvested (04/07/08). Shim-V7 sweep across 50 boards; 193
posters regenerated (POSTER_VERSION 20260730a).
