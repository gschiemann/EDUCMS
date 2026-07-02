# CRUSH Wave A — builder report (2026-07-02, verbatim summary)

Branch `worktree-agent-aa35e471b865a155e` — 10 granular commits on 318587cd,
all files in-fence (template-builder/** only). 57 new tests green; tsc clean;
mobile-perf clean; inset grep clean on the diff.

## Delivered (commit per item)
A1 5a6b3733 grid-visible ≠ movement-quantized (drift-catcher: grid-visible drag
lands on non-grid-multiple element target) · A2 4269183e undo keystroke
coalescing via store-level activeTransaction (idempotent beginTransaction,
no-op re-commits inside open tx, endTransaction; TextField/TextAreaField wrap
focus/blur → all 285 call sites coalesced with zero call-site edits) ·
A3 7ef4f2b3 group resize bounding box · A4 20110c50 alt-drag duplicate
(Cmd-D path byte-identical; duplicates respect open tx) · A5 1850aadb resize
modifiers (aspect-lock corners on media, shift toggles, alt from-center; edge
snap suppressed while constraint active) · A6 580192eb CanvasContextMenu (NEW
file; delegated window contextmenu on data-template-canvas/data-zone-id; shares
shell clipboard via extracted pasteClipboard; Copy/Paste style with STYLE_KEYS
whitelist) · A7 5dcaf98d thirds + equal-gap + real-pixel labels (guideLabelFor
extracted) · A8 fdf33b2f distribute-evenly in MultiAlignButtons section only ·
A9 2127603c brand-apply = ONE undo step (both callers) · bonus bca1178a canvas
file-drop nav guard + upload-and-place at cursor.

## Verification (agent-run)
tsc exit 0 · jest template-builder 162/170 — all 57 new green; 8 failures in 2
suites PRE-EXISTING (proven by stash-run) · mobile-perf OK · inset grep empty.

## Out-of-scope root causes (lead follow-ups)
1. Same 8 pre-existing red tests as Wave B found (NumField aria steppers made
   getByLabelText ambiguous → getByRole('spinbutton')). Lead fixes in merge batch.
2. A2 fence gap: BackgroundPanel gradient/color inputs still snapshot per
   keystroke — needs 4-line onFocus/onBlur begin/end (Wave B owned that file).
3. addZone/applyLayout/removeSelected/toggleLock/moveLayer push history
   unconditionally (don't respect activeTransaction) — future-gesture trap.
4. Worktree DX: dep-less worktrees make `pnpm --filter web exec tsc` silently
   error — dispatch-protocol note.

## Honest unverified
No in-browser pass (dep-less worktree): tactile drag feel, context menu at
viewport edges, real-browser file drop, WebKit — lead's manual pass + CI.
Known cosmetics: locked zones inside group box render but don't scale;
alt-click-no-move still duplicates (single undo removes).
