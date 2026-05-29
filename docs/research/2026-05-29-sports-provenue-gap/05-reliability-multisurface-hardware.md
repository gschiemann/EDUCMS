# Reliability, Multi-Surface Sync & LED Hardware Topology
**Slice 5 of 6 · does it hold up at game speed, across many surfaces, on the right hardware? · read-only research**

## Bottom line
Architecture is **genuinely sound for HS and most college**; the two headline claims are **half-true**; the hardware choice is right for source-mode but **"player runs ON the Taurus" is the single weakest link in the plan.** Reliability is the explicit ask → led with where it breaks.

## Reliability/sync gap table (🔴 critical / 🟠 high / 🟡 medium / 🟢 fine)
| Requirement | Today | HS | Col | Pro | Sev |
|---|---|---|---|---|---|
| R1 Clock correct+fast | RS232 console tap-off read LOCALLY on EP6N ("two clocks") | ✅ | ✅ | ✅ | 🟢 right design (matches Sportzcast/broadcast) |
| R2 No mid-game blackout | error-boundary + `onRenderProcessGone→reload` + bounded crash-reload (3 strikes→backoff) | ⚠️ | ⚠️ | ❌ | 🟠 recovers RENDERER crash; no native watchdog ABOVE the WebView |
| R3 **Operator knows instantly a screen froze** | 30s web heartbeat + lastPingAt; **foreground-svc heartbeat UNCHECKED, Sentry UNCHECKED** | ⚠️ | ❌ | ❌ | 🔴 frozen kiosk that answers TCP looks "online" — worst live-game failure |
| R4 Failover/redundancy | **NONE** — 1 player = 1 surface, SPOF | ⚠️ | ❌ | ❌ | 🔴 Daktronics ships backup DMP+SyncBack; Megapixel/Brompton dual-path |
| R5 Survive WiFi loss | offline-first never-evict SHA-verified pre-cache | ✅ | ✅ | ⚠️ | 🟢 cached; 🟡 pro expects wired+redundant |
| R6 Multi-surface content sync | signed pub/sub ~150ms | ✅ | ⚠️ | ❌ | 🟠 fine for independent; wrong for spanned image/sync count-up |
| R7 Frame-accurate genlock | deferred to "pro-tier add-on" | n/a | ⚠️ | ❌ | 🟠 honest to defer; can't claim "one dynamic canvas" until processor genlocks |
| R8 Ribbon bowl-wrap pixel-map | virtual-canvas concept | ✅concept | ⚠️ | ⚠️ | 🟡 concept right BUT one Android player CAN'T render+drive 11520×192 — processor/media-server job |
| R9 Drive large wall at full res | EP6N HDMI-OUT 4K → NovaStar/Brompton/Megapixel (source mode) | ✅ | ✅ | ⚠️ | 🟢 processor does heavy lifting |
| R10 **Player runs ON the Taurus** | claimed mode; Chromium-83 constraints | ⚠️ | ❌ | ❌ | 🔴 see below — riskiest claim |
| R11 Sub-frame celebration across surfaces | pub/sub ~150ms | ✅ | ⚠️ | ❌ | 🟡 "boom" on 6 surfaces 150ms apart = ripple not hit; fine HS, weak pro |
| R12 Heavy content decode | RK3576: 1× comfortable 4K stream | ✅ | ⚠️ | ❌ | 🟡 one 4K is the real cap; multi-layer/replay = media server |

## Two headline claims — honest verdict
**A. "Player runs ON the NovaStar Taurus" → partly true, weakest link 🔴.** Technically possible (newer Taurus TB = Android 11; OnSign/Navori/Xibo document APK install via ViPlex Express + disabling NovaStar's native PlayService). BUT: (1) **sideload is fragile + integrator-only** — a Xibo user reports a "very tight android rom" they couldn't sideload; not the "pair in 30s" story; EP6N eval itself flags sideload as unverified. (2) **WebView is old + frozen + non-updating** — Android 11 default WebView is **Chromium 87** (not 83; 83 = older Android-8-era TB1/TB2); **correct CLAUDE.md to "Chromium 83–87, assume the floor."** (3) **Pixel ceiling low** — single Taurus RJ45 ~650K px; a 1920×1080 board = 2.07M px already past one port; ribbon impossible. (4) **collapses 2 roles into one failure domain** — player crash = whole wall dark, no fallback. **Verdict: keep Taurus-native as an integrator-installed BUDGET option for small single-zone gym boards; LEAD every quote with EP6N source-mode** (newer WebView, known sideload, HDMI-OUT into a real processor, dual RS232, 24/7).

**B. "~150ms content sync" → honest+adequate for HS; visibly wrong for spanned content; weak for pro 🟠.** Human AV synchrony window ≈185ms wide, so two SEPARATE screens ~150ms apart read as "together" (ScoreVision does exactly this, cloud, no genlock). BUT: one image spanning board+ribbon, or a wipe traveling across surfaces, or a sync count-up = **visible tear** (detection floor ~20ms). And 150ms is a TYPICAL not a BOUND (widens under jitter/polling-fallback; no frame clock). Pro genlock (Brompton/Megapixel) = sub-ms to 4-8ms. **Verdict: re-word to "independent surfaces sync within ~150ms (sub-frame genlock available in source mode via the LED processor)." Never imply pixel-continuous canvas sync.**

## LED-processor integration gaps (priority)
1. 🔴 **EDID/exact-resolution output discipline (test FIRST)** — Brompton ultra-low-latency only works if the source respects the processor's EDID. Custom non-standard resolutions out of an Android HDMI port are the #1 silent breaker. Test EP6N HDMI-OUT into NovaStar MX/COEX + Brompton S4 at off-spec res before quoting.
2. 🟠 **Genlock pass-through awareness** — document that in source mode VenueOS does NOT sync; the processor does (positioning fix).
3. 🟠 **Processor redundancy invisible to us** — Megapixel HELIOS/Brompton do dual-path tile redundancy; document source-mode installs get it free + support dual HDMI feeds (two EP6Ns → A/B inputs) so a player failure also fails over (closes R4).
4. 🔴 **Pixel-map ownership for ribbons (architectural)** — our virtual-canvas should AUTHOR the layout and hand slices to the PROCESSOR's pixel-mapping (NovaStar canvas / Brompton per-port), not try to be the renderer. Test a real multi-panel ribbon end-to-end before claiming bowl-wrap.
5. 🟡 **NovaStar/Brompton control-plane integration** — read processor health + command blackout/test-pattern on emergency (force a known-safe state even if player content fails).
6. 🔴 **Untested matrix (honesty flag)** — per EP6N eval the box is "not yet field-tested," paper-only. NO VenueOS→processor combo has a verified integration test. Every "we support source mode into a pro processor" claim is UNVERIFIED until the matrix is run.

## Reliability hardening list
**Tier 1 (before ANY paid live game — close the 🔴s):**
1. **Native watchdog ABOVE the WebView** — foreground-service that pings the WebView + hard-restarts the activity if it stops rendering (white screen/ANR/frozen-alive). README lists "foreground svc heartbeat" UNCHECKED — ship it.
2. **Render-proof heartbeat** — current 30s ping proves TCP not pixels. Add last-rendered-frame-id / `lastRenderedIncidentId` to the heartbeat → a frozen kiosk shows RED on the fleet map. **Single highest-leverage reliability fix.**
3. **Crash reporting → Sentry** (README UNCHECKED) — free tier exists.
4. **Backup-content auto-cut** — when the player can't render game content, fall back to a pre-cached static board (last score + sponsor loop), not black. Extend the never-evict tier with a "game-fallback" asset.

**Tier 2 (college/multi-surface "best reliability"):** 5. hot-standby A/B player for the main board (processor cuts to B on heartbeat loss). 6. pre-cache game-day content (hype/celebration/sponsor) SHA-verified before kickoff. 7. wired-network default; WiFi = fallback. 8. local LAN trigger path / edge broker for cues (V2 WS-1 pattern) so celebrations survive WAN drop.

**Tier 3 (sync quality where contract needs it):** 9. hand frame-sync to the processor in source mode (don't tighten 150ms in software). 10. NPU auto-celebration must fail safe (never fire on false positive, never block manual; feature-flag, manual override wins).

**Already solid — keep:** renderer-crash→reload + onRenderProcessGone ✅; error boundary bounded cadence ✅; offline-first SHA pre-cache ✅; CTS serial auto-reconnect ✅; "two clocks" discipline ✅.

## Hardware verdict (EP6N/RK3576)
Correct for source-mode HS/college; adequate for a single 4K board; **NOT a media server.** RK3576 = HDMI2.1 4K@120 out, 6 TOPS NPU (capable silicon) but real cap = one comfortable 4K stream (4GB/Mali-G52). Dual RS232+GPIO+HDMI-IN genuinely close gaps (CTS+Stream Deck on one box, hw panic/fire dry-contact, broadcast capture w/o a $180-400 card). BUT paper-only/not-field-tested, 7 open questions. **Order one + run the matrix before any paid live install.** Media server (disguise/7thSense/Watchout) becomes MANDATORY for: any ribbon/fascia canvas, pixel-continuous spanned content, multi-layer compositing, genlocked multi-surface cues, distributed bowl rendering. Below that line, EP6N + processor is the right cost-killing stack that beats ScoreVision's hardware-lock on flexibility.

## 3 things to fix first
1. 🔴 Render-proof heartbeat + native watchdog + Sentry (codebase is ~60% there) — gap between "looks online" and "is playing."
2. 🔴 Stop selling Taurus-native as flagship; lead w/ EP6N source-mode; correct CLAUDE.md Chromium to "83–87, assume floor."
3. 🔴 Run the LED-processor integration matrix (off-spec res into NovaStar/Brompton/Megapixel) before any "pro processor" claim; scope "~150ms" to independent surfaces.

## Sources
NovaStar Taurus specs/pixel-caps (oss.novastar.tech TB40, ledscreenparts, controller-led) · Taurus APK + disable-PlayService (OnSign, Navori) · Xibo community TB3 sideload thread (anecdotal) · Android 11→Chromium 87 (apkmirror, android.googlesource) · RK3576 datasheet (rock-chips) · RJ45 650K-px/port (ledincloud) · Brompton genlock + ultra-low-latency (EDID dependency) · Megapixel HELIOS NanoSync + dual-path · Daktronics backup-DMP+SyncBack + Show Control · ANC LiveSync frame-accurate · ScoreVision LED-agnostic+offline · Sportzcast 1-2s cloud lag · AV simultaneity ~185ms / 20ms floor (Frontiers in Psych) · disguise/7thSense media servers · AWS Elemental failover norms · repo: apps/web/src/app/player/page.tsx, apps/player/README.md, components/player/CtsBridge.tsx, docs/EP6N_HARDWARE_EVAL.md.
