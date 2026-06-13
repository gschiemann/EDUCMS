# Every-sport audit (2026-06-13)

18 sports audited by 6 read-only Opus 4.8 agents across config/console/board/ribbon/scorebug/celebrations.

- `00-RAW-FINDINGS.md` — all 60 findings + per-sport verdicts, by family.
- `01-FIX-PLAN.md` — same findings clustered by file-domain (drives the Wave-2 parallel fix dispatch).

Headline: only basketball + water polo verified `solid`; 9 sports `broken`, 7 `gaps`. 13 P0 / 18 P1 / 29 P2.

Tier-2 (architectural, NOT blind-agented): decimal judged scores (gymnastics/cheer — score stored as Int), full LEADERBOARD board render mode for meet sports, per-quarter line-score box. Handled deliberately.