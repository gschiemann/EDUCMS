# Sports Tier-1 + Menu Platform — build reports (2026-05-29)

Agent-built deliverables from the "spin up the team again / make this app
ready for the real world" push. Code is in git (commit SHAs below); these
docs preserve the agents' full reports — especially **operational
checklists that aren't in the code** (S2's unverified Daktronics offsets).

Persisted per Agent Dispatch Protocol rule #8 (persist substantive agent
output to disk the moment it returns; never rely on chat context).

## Shipped to master this session

| ID | Scope | Commit | CI |
|----|-------|--------|----|
| M1 | Menu platform **backend** (catalog/override/PosLocation models + `resolveMenuForLocation` + device `GET /screens/:id/menu` + auto-86 + custom-webhook ingest) | `f993faa` | green |
| M2 | Menu platform **frontend** (50-location bulk price-book console at `/[schoolId]/menu` + MenuBoardWidget device wire-up + BYO field-binding + self-serve onboarding) | `e54d8f7` | green |
| S1 | Streaming **scorebug overlay** (transparent OBS/vMix/Hudl browser-source at `/overlay/[gameId]`) | `6cd57a3` | green |
| S2 | **Daktronics All Sport 5000** console parser + `consoleProfile` selector (in `@cms/scoreboard-cts`) | `8174c08` | green |
| S3 | Player **render-proof heartbeat** + Sentry (frozen kiosk flips RED, not "online") | `90a6e89` | green |
| G3 | CI: real **blocking** API-test gate (removed `continue-on-error` theater) + Trivy SHA-pin + workspace-package build-order fix | `580928a` | green |

## In flight
- **M3** — menu console **admin API** (`/menu/catalog`, `/menu/locations`, `/menu/overrides`, `/bulk`, `/import`). Closes the gap M2 flagged: the console renders + degrades honestly today but can't *save* overrides / *import* until these land. (agent `a8e809d0a82edea16`)

## Reports in this folder
- `01-S2-daktronics-parser-and-unverified-offsets.md` — the parser design + **the field-validation checklist** for a real console.
- `02-M2-menu-console-frontend.md` — what the console does, how it degrades, and the merge note.

## Greg action items
- `pnpm db:push` on prod for the two additive migrations (M1 menu tables + S3 render-proof columns). Dormant + zero-risk until run.
- Rotate `JWT_SECRET` / `SESSION_SECRET` (standing item).
