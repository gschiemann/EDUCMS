# Competitor Capability Matrix — Pro/College/HS Sports-Venue Game Presentation
**Slice 1 of 6 · VenueOS Sports (Sprint 13) pro-venue gap analysis · 2026-05-29 · read-only research**

## Executive summary (read first)

Three findings reframe strategy:

1. **VenueOS's headline edge — "hardware-agnostic vs incumbents who chain software to hardware" — is only HALF true, and the false half is aimed at our beachhead.** ScoreVision (our closest archetype) now markets itself *"virtually agnostic… regardless of the LED display you choose,"* runs on consumer/commercial TVs via Apple TV or Samsung Smart Signage + an iPad scoring app + offline game mode — nearly the identical pitch VenueOS planned to lead with. ANC LiveSync also brands "hardware agnostic." The genuinely hardware-locked players are the legacy/premium tier (Daktronics, Nevco, Watchfire, Mitsubishi), NOT the software-first HS disruptor we want to displace. **We need a sharper wedge than "hardware-agnostic."**

2. **The real defensible edge = the "dark 95% of the time" everyday-signage + native-emergency story.** Gym/stadium board as daily K-12 signage AND game system AND life-safety on one platform. No competitor unifies all three. That, not hardware-agnosticism, is the moat.

3. **Pro/college expect a deep stack we don't have yet:** broadcast-grade real-time 3D graphics, genlocked frame-accurate multi-surface sync, instant replay, IPTV/concourse distribution, CV sponsorship measurement, SMPTE-2110/NDI broadcast integration. MAJOR→CRITICAL gaps for pro — sequence late (as Sprint 13 says), but the list is specific below.

## 1. Capability matrix
Legend: ✅ ships · ⚠️ partial/add-on/unclear · ❌ no · Lock: Y=own hardware, N=agnostic, ⚠️=mixed

| Capability | Daktronics | ANC | ScoreVision | Nevco | Watchfire | Ross Tessera | Colosseo | Mitsubishi | Electro-Mech/OES |
|---|---|---|---|---|---|---|---|---|---|
| Target | HS→College→**Pro** | College→Pro | **HS** | HS→College | HS→sm.college | College→Pro | Pro/intl | Pro | HS/rec value |
| HW lock | **Y** | ⚠️ "agnostic" | **N** (any 1080p+, even TVs) | **Y** | **Y** | ⚠️ | **Y** | **Y** | **Y** |
| Scoring | ✅ | ✅ | ✅ iPad | ✅ | ✅ 4 games | ⚠️ feeds | ✅ | ⚠️ | ✅ basic |
| Video-board | ✅ | ✅ | ✅ | ✅ | ✅ | ✅✅ 3D | ✅ | ✅ | ❌ |
| Ribbon/fascia | ✅ | ✅ venue canvas | ⚠️ tables | ✅ | ⚠️ | ✅✅ region-map | ✅ | ✅ | ❌ |
| Show control | ✅ Plus/Max | ✅ timeline | ⚠️ light | ⚠️ | ⚠️ | ✅ Take-ID | ✅ | ⚠️ | ❌ |
| Celebration triggers | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ❌ |
| Sponsorship inventory | ✅ +DSM sells for you | ⚠️ | ✅✅ +DMS sells for you | ✅ | ✅ | ⚠️ render-only | ✅ | ❌ | ❌ |
| Proof-of-play | ⚠️ | ❌ | ✅ impressions+duration | ⚠️ | ⚠️ | ❌ | ⚠️ | ❌ | ❌ |
| Instant replay | ✅ | ⚠️ | ⚠️ highlight | ⚠️ | ✅ | ❌ | ✅✅ IP replay | ⚠️ | ❌ |
| Broadcast/stream overlay | ✅ | ✅✅ 16-ch switcher+stream | ✅ stream+highlight | ✅ | ⚠️ | ✅✅ heritage | ✅ IPTV | ⚠️ | ❌ |
| Multi-surface sync | ✅ | ✅ one canvas | ⚠️ board+tables | ✅ | ✅ | ✅✅ pixel-accurate | ✅ | ✅ | ❌ |
| Multi-venue/district | ✅ Venus cloud | ✅ cloud | ✅✅ cloud+sponsor rot. | ⚠️ | ✅ OPx | ❌ | ⚠️ | ❌ | ❌ |
| Fan engagement | ✅ | ✅✅ Famous Group | ✅ Fan App | ⚠️ | ✅ | ⚠️ 3rd-party | ✅✅ kiss/dance cam | ⚠️ | ❌ |
| Emergency/weather | ⚠️ | ✅ explicit | ❌ | ❌ | ❌ | ❌ | ⚠️ | ❌ | ❌ |

Key verified facts: ScoreVision runs on AppleTV/Samsung Smart Signage + commercial TVs + iPad + offline mode (most strategically important fact). Watchfire Ignite Sports = FREE w/ display, no annual license (coupled to their hardware). ANC = NDI/SMPTE-2110, "hardware agnostic" (scope unverified — marketing). Daktronics Show Control on own DMP-8000 (can it drive 3rd-party LED? unverified — sales-gated).

## 2. Gaps VenueOS appears to LACK (ranked; tier = which market it blocks)

### CRITICAL
1. **Broadcast-grade real-time 3D graphics + pixel-map across dozens of synced surfaces** (Ross Tessera / Dak Show Control render real-time 3D, one Take-ID fires all surfaces frame-matched). VenueOS = HTML/CSS + transform:scale + ~150ms content sync. Pro: 150ms below bar (center-hung+ribbon+fascia must frame-match on 4K bowl). **Pro CRITICAL, College MAJOR, HS MINOR (150ms fine).**
2. **Frame-accurate genlock / multi-surface sync** — every pro incumbent assumes genlock; VenueOS defers it to "pro-tier add-on." Until it exists, "pro-venue level" not credible. **Pro CRITICAL.**
3. **True instant replay** (not highlight capture) — Colosseo/Watchfire ship it, Dak has clip playback. VenueOS lists replay as "god-tier stretch." **Pro/College CRITICAL, HS MINOR.**

### MAJOR
4. **Broadcast-infra integration (SMPTE-2110/NDI/12G-SDI I/O, virtual switcher)** — ANC 16-ch switcher+streaming, Ross broadcast-native. VenueOS is HTTP/WS, outputs into 3rd-party processor via "source mode," no native SDI/2110. EP6N HDMI-IN helps capture not pro playout. **Pro/College MAJOR.**
5. **CV-based sponsorship measurement** — pro moved to Relo/Zoomph/Visua (logo dwell, clarity, share-of-voice, broadcast impressions). VenueOS AuditLog proves *what played* not *who saw it / how it read on camera*. **Pro/College MAJOR; HS = PARITY (AuditLog proof-of-play matches ScoreVision — not a gap).**
6. **IPTV/concourse-TV distribution** — Colosseo/ANC push game+replay to concourse/suites/IPTV. VenueOS has the fleet model but no sports-IPTV product. **Pro MAJOR, College MINOR.**
7. **"They sell your sponsors for you" managed service** — DECISIVE buying trigger. Daktronics DSM (avg ~$40K/yr raised, 100% to school) + ScoreVision DMS ($50K indoor/$100K+ outdoor/yr) sell the ads FOR the school. The close isn't software — it's "someone fills the inventory and it pays for itself." VenueOS plans ad-inventory *tech* but not the *sales service*. **HS MAJOR (this is the actual close), College MAJOR.**

### MINOR
8. Fan-engagement content depth (AR/second-screen/interactive) — ANC+Famous Group, YinzCam/Tagboard/SQWAD. Usually 3rd-party content rendered on-board → VenueOS can render+integrate, not build. **Pro MINOR.**
9. Console tap-off for live clock from Daktronics All Sport (owned by live-data slice). College MAJOR there.

## 3. Highest-leverage builds to credibly claim "pro-venue level" (impact × distance)
1. **Frame-accurate multi-surface sync, then genlock add-on** — the dividing line between "HS gym product" and "pro venue product." Tight content sync (≤1 frame perceptually) for college; genlock hardware path for pro.
2. **Instant replay-to-board** (camera + ring-buffer + slow-mo to a surface) — converts "scoreboard app" → "game-presentation system" in buyers' eyes.
3. **Virtual-canvas / pixel-map engine firing one cue atomically across ribbon+center-hung (Take-ID equiv)** — HIGHEST impact:effort because the signed pub/sub already does atomic fan-out; only canvas-slicing + per-surface region map is net-new (spec already names this).
4. **CV sponsorship measurement** (EP6N 6-TOPS NPU → on-device impression-estimate) OR integrate Relo/Zoomph — protects the revenue story that is the reason venues buy.
5. **Managed sponsorship-sales service (people+tooling), not just inventory software** — lowest-tech, highest-conversion. Productize a DMS-style offering or rev-share marketplace as a LAUNCH motion, not v2.

**Do NOT chase early:** native SMPTE-2110/SDI I/O + AR fan engagement — integrate via partners/source-mode; poor effort-ratio for the K-12→college beachhead.

## 4. Pricing intelligence — where VenueOS undercuts
- Daktronics: HW $15K–$100K+, control $3K–$10K, support $1K+/yr, free DSM ad-sales (~$40K/yr raised).
- ScoreVision: annual sub (undisclosed); indoor ~$20K / outdoor $150K+; DMS sells ads → $50K/$100K+/yr.
- Watchfire: software FREE, no annual license (monetizes the panel) — **direct threat to a software-subscription model at the low end.**
- KeepTheScore $14/mo (any HDMI) / PC Scoreboards $100–200 one-time / ProScoreboard $2,500/yr macOS — the software-only price floor.
- **Wedge:** Sprint 13 CMS-Core ($5–7/screen/mo) sits between KeepTheScore and ScoreVision — but Watchfire bundles game software for $0 on new boards, so DON'T pitch "cheaper software." Pitch **"the board earns money 5 days/week as signage + safety, not just Friday night"** (everyday-utilization ROI). **Killer packaging: bundle game-presentation + everyday K-12 signage + native emergency into ONE subscription — collapse 3 POs (scoreboard vendor + signage CMS + mass-notification) into one.** Only ANC even mentions emergency; none unify all three. Offer managed ad-sales/rev-share as the conversion lever ("it pays for itself"). Don't race KeepTheScore to the bottom.

## 5. Sources (key)
Daktronics Show Control https://www.daktronics.com/en-us/products/software-and-controllers/show-control · DSM https://www.daktronics.com/en-us/services/daktronics-sports-marketing · ANC LiveSync https://www.anc.com/project/livesync-venue-software-control · Famous Group https://www.sportsvideo.org/2024/11/26/the-famous-group-and-anc-form-strategic-partnership… · ScoreVision cost https://blog.scorevision.com/cost-of-scoreboards-guide · software-driven https://blog.scorevision.com/why-high-schools-are-moving-to-software-driven-scoreboards · DMS https://blog.scorevision.com/digital-media-sales-advertising-sports-scoreboard-interview · Nevco https://www.nevco.com/nevco-software/ · Watchfire Ignite https://www.watchfire.com/watchfire-ignite-sports · Ross Tessera https://www.rossvideo.com/products/graphics-and-virtual/tessera/ · Colosseo https://www.colosseoeas.com/products/colosseo-single-media-platform/ · Relo https://relometrics.com/ · Zoomph https://zoomph.com/blog/sponsorship-roi… · KeepTheScore alts https://keepthescore.com/blog/posts/daktronics-scorevision-alternatives/

**UNVERIFIED:** (a) whether Dak Show Control / ANC LiveSync drive truly any-vendor 3rd-party LED vs own/supported only; (b) exact subscription $ for Dak Venus / ANC / ScoreVision (all "contact sales"); (c) Colosseo/ANC emergency-messaging depth.
