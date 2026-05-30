# `docs/research/` — index

Dated research + audit folders. Each holds the **full reports** from
worktree-isolated agent fleets (persisted per the Agent Dispatch Protocol so
agent work survives context compaction). Newest at the top.

> **Canonical current state:** `2026-05-28-opus48-audit/00-MASTER-SYNTHESIS.md`
> is the code-verified status of the whole app — start there. Everything else
> is a deeper slice or a later follow-up.
>
> **Status legend:** Some folders contain *build* reports (code already landed,
> SHAs noted inside) and some are *research only* (findings to decide on, no
> code shipped). The "Kind" column flags which.

| Folder | Kind | Topic |
|--------|------|-------|
| `2026-05-29-sports-provenue-gap/` (8) | Research (ON HOLD) | Pro-venue sports gap analysis — every sport × every competitor; what we'd need to match Daktronics/ANC/ScoreVision. Fixes on hold pending review of `00-SYNTHESIS`. |
| `2026-05-29-sports-and-menu-tier1/` (3) | Build | Sports Tier-1 + Menu platform build reports — agent deliverables from the "make it real-world-ready" push; operational notes + commit SHAs. |
| `2026-05-29-rules-review/` (1) | Research | Governance & rules review (principal-engineer + tech-writing lens) — read CLAUDE.md + memory + all docs vs actual code; suggestions only, no files changed. **Origin of this governance-docs work.** |
| `2026-05-29-mobile-ux-audit/` (6) | Research | Mobile/responsive UX audit of the dashboard — per-tab punch lists (screens, playlists/schedules, assets/templates, settings, nav/emergency) + consolidated list. |
| `2026-05-29-menu-mgmt-scale/` (2) | Research | Menu-management-at-scale — BYO template → POS-per-location pricing → real-time Pi → auto-86 across 50 locations; codebase reality + competitor architecture. |
| `2026-05-29-field-mapping-spec/` (3) | Spec | Field-to-system mapping build spec — let the editor map a widget field to a live source (CTS for sports, POS for menus). |
| `2026-05-29-editability-sweep/` (1) | Research | App-wide template/widget editability sweep — "edit every field, upload logos/images everywhere" (Greg's recurring complaint). |
| `2026-05-29-dominos-build/` (2) | Research | Domino's-style menu-board reference pack — brand, real imagery, pricing, layout — to drive a menu-board mockup. |
| `2026-05-28-opus48-audit/` (32) | **Audit (canonical)** | **Opus 4.8 full-app audit** — all 21 Standard Audit Surface sections, every claim verified against reality. `00-MASTER-SYNTHESIS.md` = the one to read. |
| `2026-05-28-cts-live-test/` (1) | Test report | CTS Gen 6 live integration test — scripted console sequence driven through the live path. |
| `2026-05-27-sports-research/` (6) | Research (recovered) | Sports-control / broadcast systems research (CTS Gen 6, Daktronics All Sport, ANC LiveSync, ScoreVision, …) — recovered from agent transcripts after a context compaction. |

*(parenthetical number = file count in the folder)*

---

## Conventions

- **Naming:** `YYYY-MM-DD-<short-topic>/`.
- **Lead file:** each folder should open with a `README.md` or a `00-*` synthesis
  that states who commissioned it, the prompt, and the verdict. Several
  pre-existing folders predate this convention — add one when you touch them.
- **Persistence rule (why this tree exists):** when an agent returns substantive
  findings, the lead writes the full report here **before** summarizing to the
  user — context can compact and chat-only work vanishes (CLAUDE.md "Agent
  Dispatch Protocol" §8; the 2026-05-28 lost-reports incident).
- **Historical vs current:** these are point-in-time snapshots. Where a later
  audit contradicts an earlier one, the **newer** folder wins. For the canonical
  *current* state, always defer to the latest `*-audit/` synthesis, not an older
  research note.
