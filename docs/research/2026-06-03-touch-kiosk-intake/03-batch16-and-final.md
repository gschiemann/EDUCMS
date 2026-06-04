# Touch Kiosks — batch-16 intake + final all-green/live record (2026-06-04)

## Library is now 9 fully-editable, button-wireable Touch Kiosks
| # | Preset | Vertical | data-field | data-img | data-action |
|---|---|---|---|---|---|
| 1 | 🥗 Self-Order (QSR) — food | ALL | 49 | 15 | 1 |
| 2 | 🏢 Commercial Leasing — real-estate | ALL | 99 | 19 | 13 |
| 3 | 🏛️ Museum / Exhibits — museum | ALL | 115 | 8 | 6 |
| 4 | 🏢 Workplace / Lobby — office | ALL | 117 | 9 | 7 |
| 5 | 🏋️ Fitness Club — gym | ALL | 97 | 11 | 4 |
| 6 | 🎓 Campus Hub — school | ALL | 215 | 12 | 6 |
| 7 | 🍔 Fast-Food Self-Order — qsr (batch-16) | ALL | 63 | 16 | 2 |
| 8 | 🍸 Bar & Tap House — bar (batch-16) | ALL | 89 | 7 | 1 |
| 9 | 🩺 Patient Check-In — clinic (batch-16) | ALL | 58 | 8 | 2 |

## Batch-16 commits
- `88da8ca7` — intake qsr/bar/clinic as KIOSK presets (inlined EXTERNAL_HTML, shared engine + _edit-shim, vertical ALL). system-presets.ts + ensure-system-presets.ts. API tsc clean.
- `aad28350` — qsr/bar/clinic markers + manifests (3 worktree agents: 945d4c6b/70da5f2c/d2cce189), cherry-picked + re-verified + worktrees removed.

## Final verification (all from master / live prod)
- **CI (commit aad28350): 9/9 workflows green** — CI & Security, Emergency Path, Deploy Reliability, Accessibility (axe), Cross-Browser, Taurus Safety, Android Player APK, Prod Smoke, OTA Wiring Integrity.
- **DB (prod):** 9 rows `category='KIOSK'`, all `vertical='ALL'` — Railway redeployed + ensureSystemPresets seeded the 3 new ones. Every tenant's Touch Kiosks gallery shows 9.
- **Vercel (prod, venue-os.app):** all 3 new kiosks serve their `#venueos-fields` manifest + data-action markers (qsr action=5 incl manifest, bar=2, clinic=4).
- **Headless (scratch/verify-all-kiosks.mjs):** all 9 pass discovery (every marker type > 0) + render + brand `--accent` recolor, 0 page errors.
- **Per-kiosk apply+action loops** agent-verified (text/image/brand override applies on live render; player tap posts educms-action; edit-mode tap posts field-click; 0 errors), lead re-verified from master.
- **tsc:** web + api clean.

## One caveat (honest)
The in-app builder properties-panel pixels (the "When tapped…" picker + field-row list rendering) were NOT screenshotted in an authenticated session — entering a login password is disallowed by the assistant's safety rules. It is verified by equivalence instead: the panel's field discovery is the SAME static fetch+DOMParser path proven headless against the live-served files, the apply transport (WidgetRenderer ?text/img/brand/actions params) + shim are proven end-to-end, and the React renders tsc-clean. If a pixel screenshot is wanted, an already-logged-in browser session can open any kiosk template → select its full-screen zone → the Images / text sections + "When tapped…" panel render from the manifest.

## Feedback for Claude design (next batch)
- Keep shipping the self-contained per-kiosk folder (engine+css+data+app+index) — the inliner handles it cleanly. The newer shared kiosk-core engine is fine (still exposes _render/sheet/go/screens so the edit-shim hooks unchanged).
- Self-host the Google Fonts (offline panels) — still the one open polish item (Phase 1b / #240).
- Standard brand var names (--bg/--surface/--text/--accent/--font-display/--font-body) continue to line up perfectly with the brand editor — keep them.
