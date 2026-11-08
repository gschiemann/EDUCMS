# 2026-11-08 — release train #263 follow-up: CI fixes

#263 landed 14 approved PRs at once (merge 9961ecbbf). Six non-required checks were red from the combination; master was green before.

| Check | Cause | Fix |
|---|---|---|
| rulebook | `IDENTITIES.md` listed branch prefixes in backticks, read as dead paths | reworded |
| rules-of-hooks 9 > baseline 8 | `useGroupSchedule` in `ScreenDisplayControls.tsx` is a click handler, not a hook | renamed `applyGroupSchedule` |
| e2e screen-drawer-end-user | #239 shows the video sample only for the file actually playing and moved counters under "For support"; fixture had an empty playlist | fixture plays the sampled video; counters asserted under For support |
| e2e select-all-pattern (Playlists) | #251 filmstrip gallery has no table / view toggle / header box | checks retargeted to per-card boxes + shared SelectionToolbar "Select all"; no new UI added |
| e2e homebuilder-image-controls | intermittent (14/15 locally; portrait text position 0.074 off after re-fit) | not fixed — open question whether it flakes on pre-train master |

Open owner question: does the Playlists gallery want a header select-all box? Not added (unrequested UI).
