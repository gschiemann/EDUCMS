# Score/Data Ingestion Landscape & Gap Analysis
**Slice 3 of 6 · getting the live clock + score + stats INTO the system · read-only research**

## TL;DR
1. **Existing CTS bridge is correct + validated** (RS-232 9600/8/E/1, 1/4" jack, 32-ch) — but CTS (Colorado Time Systems) is **aquatics/water-polo, the LEAST common console in mainstream HS football/basketball gyms.** Our strength is in the least-prevalent console for the big-3 sports.
2. **#1 gap = Daktronics All Sport 5000** — "the most common control console in US schools." We can't read it. **MIT-licensed open-source decoders exist** (19200/8/N/1, all sports). Buildable in **days–weeks** by porting the field-offset table into a TS parser sibling of `@cms/scoreboard-cts`. **Single highest-ROI data-in investment.**
3. **Console-reader market + league-feed market both funnel to ONE owner: Genius Sports** (bought Sportzcast in 2020 — 194+ console models, 6,000+ venues — AND owns the enterprise stats feed). Building our own readers = a deliberate "don't depend on a competitor" decision.
4. **League/stats feeds (Genius/Sportradar/Stats Perform) are a DEAD END for HS** — enterprise-only, $500–1,000+/mo, custom contracts, **and no HS coverage (college+pro only).** Honest HS position: data-in = manual + console tap-off, full stop.
5. **HS scorekeeping apps not consumable** — GameChanger (no API/webhooks, CSV/PDF only, scraping=ToS violation), MaxPreps (aggregator that ingests, no partner API — possible *outbound* destination later). ScoreStream has a partner API but it's crowd-sourced/unofficial (ticker only, never the live board).
6. **OCR-from-broadcast = real free last-resort tier** (ScoreSight/Tesseract/OpenCV) on the **EP6N's HDMI-IN** — for the un-wireable long tail (old Nevco coax).

## Console tap-off matrix (ranked by HS prevalence)
| Rank | Console | Protocol | Read it? | Effort | Notes |
|---|---|---|---|---|---|
| 1 | **Daktronics All Sport 5000/5500/3000** (+All Sport Pro 2025) | RTD serial 19200/8/N/1 via Port Expander; FTDI cable | **YES** — MIT decoders (zabackary/daktronics-allsport-5000-rs + Python/C# ports) | **days–weeks**, ~$15 cable + ~$100-200 expander | THE win. Validate per-sport offsets vs real console/simulator |
| 2 | **OES ISC9000** | DB9 RS-232 "GAME OUT" + 4-pin XLR RS-422 | **YES** — public manual PDF | days–weeks, $15-25 | basketball/Northeast + NBA/NCAA arenas |
| 3 | **CTS System6/Gen6** | RS-232 9600/8/E/1, 1/4" jack | **DONE** (water-polo) | shipped | aquatics niche; add non-aquatic sport maps |
| 4 | **Electro-Mech LX/MP/MM** | RS-232, format not public (vendor receptive, building data-out) | partial→yes | weeks (sniff/factory spec) | budget HS; worth a vendor relationship |
| 5 | **Nevco newer (MPCW-6/7)** | data-out exists (Sportzcast reads it), not public | maybe | weeks–months | football-heavy |
| 6 | **Nevco older (MPC-5)** | **NON-STD 262KHz 1-wire BCD over coax** | **HARD** (needs MCU/scope) | months/custom hw | **don't DIY** → OCR or buy Sportzcast |
| 7 | Daktronics Omnisport 2000 | RS-232 (decoder ref exists) | yes, niche | days | timing console (swim/track) |

**Buy-vs-build shortcut:** Sportzcast ScoreLink/ScoreBot (~$300-500 + $250/yr, 194+ models) & Scorebird decode everything → publish to THEIR cloud. **Catch: Sportzcast = Genius Sports.** Depending on them for the core "two clocks" promise erodes our hardware-agnostic edge. **Rec: build our own for top-3 (Daktronics, OES, CTS-done); offer "bring your Sportzcast feed" interop for the long tail, not the default.**

## League/stats feed matrix — all NO for HS beachhead
Genius (no HS, owns Sportzcast too), Sportradar ($500-1,000+/mo, no HS), Stats Perform (enterprise, no HS) → college-tier only, post-funding, stats-overlays-not-clock. MaxPreps (ingest-only aggregator; outbound destination later). GameChanger (closed garden, no API). ScoreStream (crowd-sourced; "scores around the district" ticker only). NFHS/Hudl (walled streaming destinations, no data-out).

## ScoreSource abstraction is NOT real (the architectural gap)
Verified in code: **no `ScoreSource` table** — score state lives on `Game` columns + `Game.stats.cts` JSON; the "abstraction" is conceptual, implemented as ad-hoc converging endpoints (`/sports/games/:id/cts-snapshot` operator-auth + `/sports/board/:id/cts-snapshot` HMAC-public + generic `/feed` `/ingest`). Feed token (`sports-feed-token.ts`) good design, per-game revocation is a known TODO (needs stored version → migration).

**To make it real (priority order):**
1. **`consoleProfile`/parser registry** keyed by console family → {serial settings, parser, per-sport field map}. Bridge already takes serial params via query string; extend to select the parser too → Daktronics/OES drop in as registry entries.
2. **`source` provenance field + server-authoritative precedence resolver** encoding "two clocks" in ONE place: console-clock > manual-clock; console|manual score latest-wins w/ staleness fallback; feed = stats only. (Today merge is client-side in `cts-merge.ts`.)
3. **Staleness/heartbeat per source** (`lastSeenAt`) → board shows "CONSOLE LIVE / STALE — switching to manual"; auto-celebrate won't fire on a stale jump.
4. **Normalized ingest contract** — make the generic `/feed` neutral shape (`clockMs/clockRunning/segment/homeScore/awayScore`) the canonical write; every parser emits it + optional sport-specific extension blob.
5. **Per-game feed-token revocation** (one nullable column) — the documented TODO; low urgency (clamped, one transient game).
6. **4th tier: OCR ingest** (ScoreSight-class, EP6N HDMI-IN) emitting the same contract — "put a number on ANY board, even one we can't wire." No competitor offers a clean fallback.
7. **Sportzcast/Scorebird interop adapter** (optional) — consume their cloud as just another source; flag the Genius dependency.

## Brutal honesty
- "Most common console = Daktronics" is a vendor/reseller claim, not a market study — directionally well-supported, treat as confident heuristic.
- Protocols are reverse-engineered/"proprietary" (no-warranty decoders); reading the customer's own data-out port is industry norm (Sportzcast/Scorebird/NewBlue do it commercially) but Daktronics could change framing in firmware → pin parsers to firmware ranges + keep OCR fallback.
- Daktronics offsets vary per-sport/per-mode → budget per-sport QA.
- OCR on a real gym 7-seg board under gym lighting/angles is finicky → credible fallback, not a primary.

## Sources
Daktronics RTD/All Sport 5000 KBs · MIT decoder github.com/zabackary/daktronics-allsport-5000-rs · NewBlue/live-score-app Daktronics guides · XY Kao Omnisport+Nevco MPC-5 reverse-engineering · OES ISC9000 manual (sportngin CDN) · Electro-Mech consoles · Marco's Corner CTS protocol · Genius acquires Sportzcast (geniussports newsroom + PRNewswire 194+/6000+) · Sportradar/Genius dev portals · GameChanger-no-API (getdugout) · MaxPreps stat-import-partners · ScoreStream API · NFHS manual-score/Pixellot · ScoreSight (github.com/royshil/scoresight) + OBS forums.
