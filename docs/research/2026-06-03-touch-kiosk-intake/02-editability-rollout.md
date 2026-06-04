# Kiosk editability + button-wiring — rollout record (2026-06-04)

All 6 Touch Kiosks are now Dominos-parity editable in the builder: click-to-edit
text, swap images, recolor/brand, AND wire any meaningful button to a real
platform touch-action. Shipped to master across these commits:

| Commit | Scope |
|---|---|
| `e1c0f346` | Brand/font editability on all 6 (edit-shim reference) — prior |
| `8f3562a7` | food: data-field/data-img markers + static manifest + shim multi-match image fix |
| `960e894d` | Button wiring infra: editor "When tapped…" picker + WidgetRenderer `?actions=` + shim `educms-action` + player `dispatchTouchAction` exec; food `order.send` reference |
| `9a69b831` | real-estate markers + manifest |
| `cf7d2762` | museum markers + manifest |
| `25c47a3d` | office markers + manifest |
| `f9b3680e` | gym markers + manifest |
| `4cfb215e` | school markers + manifest |

## Architecture (reuses the proven EXTERNAL_HTML + touch-action stack)
- **Discovery** — editor (`PropertiesPanel.ExternalHtmlTextEditor`) statically
  `fetch`+`DOMParser` the kiosk HTML and lists every `[data-field]` (text),
  `[data-img]`/`[data-slot]` (images), and `[data-action]` (wireable buttons).
  Because the kiosk builds its DOM in JS, each kiosk carries a hidden
  `<div id="venueos-fields">` manifest enumerating every key with default copy —
  that's what the static parse reads.
- **Apply** — `WidgetRenderer` encodes `cfg.brand/textOverrides/_styles/
  imageOverrides/actionOverrides` as base64url URL params; the in-iframe
  `_edit-shim.js` applies brand→CSS vars, text→`[data-field]`, images→
  `[data-img]` (ALL matches, not just first), and re-applies after every
  `Kiosk._render` so overrides survive screen swaps.
- **Button wiring** — operator picks "When tapped…" per `[data-action]` button
  → `cfg.actionOverrides[key]={type,target}`. In the player, a tap posts
  `educms-action` to the parent, which runs it through the existing
  security-gated `dispatchTouchAction` (http-only / no private IPs / no
  javascript:). Builder preview never executes (preview only). The kiosk's own
  handler still runs (no preventDefault).

## Per-kiosk marker counts (verified from master)
| Kiosk | data-field | data-img | data-action |
|---|---|---|---|
| food | 49 | 15 | 1 (order.send) |
| real-estate | 99 | 19 | 13 (tour/shortlist ×6 + confirm-tour) |
| museum | 115 | 8 | 6 (audio-guide ×stations) |
| office | 117 | 9 | 7 (checkin.notify + room confirms) |
| gym | 97 | 11 | 4 (class/trainer/recovery book + pass buy) |
| school | 215 | 12 | 6 (visitor checkin, office call, schedule email, directions, staff contact/call) |

## Verification (independent, from master — not just agent self-reports)
- `scratch/verify-food-edit.mjs` — food full loop: discovery (49 fields + 15 imgs),
  text/brand/image apply on live render, 0 errors. PASS + screenshot
  `/tmp/food-edit-applied.png`.
- `scratch/verify-food-actions.mjs` — button wiring: discovery finds order.send;
  player tap posts `educms-action {webhook}`; edit-mode tap posts
  `field-click(action)` with 0 leaked action msgs; 0 errors. PASS.
- `scratch/verify-all-kiosks.mjs` — all 6 from master: discovery (3 marker types
  all > 0), kiosk renders, brand `--accent` applies, 0 init page errors. ALL PASS.
- Each of the 5 agents also ran a per-template harness (APPLY text+brand+image +
  ACTIONS tap) printing PASS / 0 errors before merge (reports below).
- Web `tsc --noEmit` clean.

## Agent rollout (worktree-isolated; lead reviewed + cherry-picked + removed trees)
5 sonnet agents, one per kiosk, each worktree-isolated, each touching ONLY its
template file. All returned PASS with 0 page errors; lead audited each diff
(isolated to attribute additions + manifest, no shim/React edits), cherry-picked
to master, re-verified, then removed all worktrees + branches.

- real-estate → branch worktree-agent-ab1f4e1bd4a74b638, commit 048180ac
- museum → worktree-agent-addcce890c15c7376, commit d7248e46
- office → worktree-agent-a84aa98d2eae09d68, commit 395e141b
- gym → worktree-agent-a8fcab8e043fb00bf, commit 0da9a416
- school → worktree-agent-a2b579faf03d1d411, commit 2f2b0398

## Remaining
- Live builder UI screenshot verification on Vercel (editor "When tapped…" +
  field list rendering for a kiosk) — in progress.
- Phase 1b (#240): self-host kiosk Google Fonts for offline panels.
- Phases 2-4 (#241-243): native multi-scene kiosk builder (queued).
