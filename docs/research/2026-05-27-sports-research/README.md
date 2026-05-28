# 2026-05-27 Sports research team — recovered from agent transcripts

**Why this exists.** Greg dispatched 4 research agents on 2026-05-27 to
audit VenueOS against pro sports-control / gaming-broadcast systems
(CTS Gen 6, Daktronics All Sport, ANC LiveSync, ScoreVision,
Sportzcast). All 4 agents returned full reports before the
conversation was compacted, but the lead (me) failed to persist them
to disk in real time. After compaction, the conversation summary kept
only the *fact* that they ran — not the *content*.

**Recovery.** Per CLAUDE.md "Recovery via transcripts": every agent's
full transcript persists at
`/Users/gschiemann/.claude/projects/-Users-gschiemann-Desktop-EDU-CMS/
 4129bcd1-4636-4065-90ea-207bae54cd20/subagents/agent-<id>.jsonl`.
I extracted the final text block from each agent and wrote it here.
Total ~11,800 words across the four reports.

**The 4 reports:**

| File | Scope | Lens |
|---|---|---|
| `01-operator-ux-game-console.md` | Live-game operator console (`apps/web/src/app/[schoolId]/sports/[gameId]/`) | Sports-broadcast operator (back-room scorekeeper / show caller) |
| `02-display-surface-render-rules.md` | Display widgets, scoreboards, ribbon, broadcast scorebug, concourse | TV broadcast designer + LED-wall integrator |
| `03-external-console-integration.md` | CTS Gen 6, Daktronics All Sport, Sportzcast, ScoreVision, Genius Sports inbound | Industrial-controls + broadcast engineer |
| `04-sport-engine-clock-state-machine.md` | `apps/api/src/sports/sports.service.ts` clock/score/segment state machine across 18 sports | Sports-tech product analyst |

**Process rule going forward (also added to CLAUDE.md).** When any
agent returns substantive findings (≥500 words of report-form output,
or a punch list ≥3 items), the lead MUST write the report to a
markdown file under `docs/research/<date>-<topic>/` BEFORE the
next user-facing summary. Do not rely on conversation context to
hold agent work — context can compact at any time and the work
becomes unrecoverable from chat history (still recoverable from disk
transcripts, but that's the emergency path, not the design).
