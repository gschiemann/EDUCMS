# VenueOS Apps Library — research (2026-06-30)

Goal (Greg): add the **top 20 app integrations** (OptiSigns advertises ~140 — Instagram,
X, Facebook, TikTok, YouTube…) into the **template editor**, designed better than
OptiSigns. Research first, then a ranked list + "do it better" design + build plan.

## Status
Research ran as background workflow `wf_526ddf92-23a` (5 parallel researchers →
synthesis). It hit the session usage limit mid-run. **All agent work is saved to
`raw/` so nothing is lost.**

| Agent | Captured | Notes |
|---|---|---|
| social-feasibility | ✅ full (16 apps, 44 sources) | the crux: 2026 embed reality per social app |
| map-to-venueos | ✅ full (20 apps, 8 UX notes) | maps each app → our existing widgets |
| data-utility-feasibility | ✅ apps (25) + sources; missing uxNotes | Slides/Calendar/News/Weather/Docs/etc. |
| optisigns-catalog | ⚠️ prose summary only (~30k) | structured app[] didn't finish before limit |
| competitors | ⚠️ prose summary only (~30k) | Yodeck/ScreenCloud/Rise/Xibo/Play/NoviSign |
| synthesize-top20 | ✅ **lead-authored** → `00-SYNTHESIS.md` | workflow synth step kept dropping on API limits; senior-dev synthesized from the captured raw research |

**→ Deliverable: [`00-SYNTHESIS.md`](00-SYNTHESIS.md)** — ranked Top 20 + leapfrog moats + "do it better" design + phased build plan.

Raw captures: `raw/agent-*.json` (each `{label, findings}`).

## To finish
Usage reset → resume the workflow (completed agents return from cache, only the
failed ones + synthesis re-run):

```
Workflow({ scriptPath: ".../app-library-research-wf_526ddf92-23a.js", resumeFromRunId: "wf_526ddf92-23a" })
```

Then persist the synthesis deliverable here as `00-SYNTHESIS.md` and present the
ranked top-20 to Greg.

## Grounding (already true in VenueOS)
We already have editor widgets: WEBPAGE (sandboxed iframe of any URL), SOCIAL_FEED,
RSS_FEED, STREAMING (YouTube/Twitch/Vimeo iframe + HLS/DASH), VIDEO/VIDEO_CAROUSEL,
IMAGE/IMAGE_CAROUSEL, EXTERNAL_HTML, LIVE_DATA, WEATHER, CALENDAR, CHART, MUSIC_PLAYER,
QUICK_POLL — plus an Integration-Discovery service and the AI Concierge. The new
feature = a curated **"Apps"** library in the editor with per-app smart config +
Concierge auto-setup, not raw URL pasting.
