# 2026-05-28 — Opus 4.8 Full-App Audit

Greg (2026-05-28): *"do a complete audit of our app now that you are opus 4.8…
leading CMS software for every venue including sports, k-12, qsr everything… so
many bugs still including our widgets that arent editable and our integrations that
dont work… tell me the truth and then lets go fix this shit."*

9 read-only Opus 4.8 agents, all 21 Standard Audit Surface sections, every claim
verified against reality (curl / trace-the-caller / grep), no silent scope-down.

## START HERE
- **`00-MASTER-SYNTHESIS.md`** — the one-paragraph truth, the 21-section coverage
  table, and the single deduplicated P0→P2 ranked fix list + fix-wave plan.

## Per-domain reports
| File | Sections | Agent lens |
|---|---|---|
| `01-02-emergency-realtime-storage.md` | §1, §2 | life-safety realtime + storage |
| `03-ai-surface.md` | §3, §4, §5 | AI providers + surfaces + competitive |
| `06-08-streaming-sports-pos.md` | §6, §7, §8 | integration reality (WORKS/PARTIAL/COSTUME) |
| `09-12-13-comms-imports-alerts.md` | §9, §12, §13 | comms + design-import + public-alert |
| `10-11-auth-billing.md` | §10, §11 | security + payments |
| `14-multi-vertical.md` | §14 | every-venue readiness matrix |
| `15-18-crossbrowser-a11y.md` | §15, §18 | Chromium-83 grep + WCAG |
| `16-17-forensic-operational.md` | §16, §17 | audit coverage + ops/DX |
| `19-widget-editability.md` | §19, §2 | widget A-F editability grades |

## Already fixed this session (before/alongside the audit)
- Celebration pack: migrated Bruins vs Buckeyes off explicit `v1` → `v2`
  (verified live board returns v2). Commit `00bcd97`.

## Headline (full detail in 00-MASTER-SYNTHESIS.md)
Spine is solid + verified (emergency signing, auth/billing, Square/CTS, vertical
plumbing, Chromium-83 defense). Problems cluster in: integration **breadth** (3 of
~30 real), 12 themed widgets can't edit content, 2 life-safety fallback-tier holes,
forensic audit theater, vertical content depth (palette tiles + empty WORSHIP).
**8 P0, 14 P1, ~25 P2.** None rotten-core; all fixable, most cheap.
