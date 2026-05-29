# Themed-Widget Font-Size Audit — Final Report

> Opus 4.8 read-only audit, 2026-05-28 (Wave 2). Measures the ~170 EDU themed
> widget components whose font sizes are baked into the React JSX/CSS (NOT in
> preset `defaultConfig`, which a prior pass already fixed). Goal: the HONEST
> number on "a lot of them are tiny" + a targeted, screenshot-verifiable
> shortlist — NOT a blind sweep (CLAUDE.md: no batch design changes).

## Bottom line (the honest number Greg asked for)

**"A lot of them are tiny" is NOT accurate for the EDU daily-driver scene widgets.**
Of the ~170 themed widgets, genuinely-too-small **primary readable content** lives
in roughly **6–9 widgets**, and most are *borderline* (1–8px under floor), not
egregious. The flagship daily-drivers (Welcome, Bell Schedule, all 5 Cafeteria
menus, Morning News body, Bus Board, Achievement hero, Main Entrance, all portrait
variants) are **well-sized or use legitimate auto-fit** (`clamp(min, Ncqh, max)`
driven by `container-type: size`).

The reason a naive sweep looks alarming (910 raw "below-floor" `font-size`
declarations) is that dense MS/HS/Bulletin/Scrapbook/Storybook scenes are **packed
with intentionally-small secondary text** — `cdLbl`, `clockAp` (AM/PM), `date`,
`eyebrow`, `sub`, `chefRole`, `allergen`, `tickerStamp`, `byline`, `room`, folder-
tab labels, ribbon/tagline garnish. Those *should* be small. Blind-sweeping them is
exactly the regression the brief warned against.

### Canvas taxonomy (corrected)
| Family | Landscape | Portrait |
|---|---|---|
| Animated*/Bulletin*/Scrapbook*/Storybook* | 1920×1080 | 1080×1920 (most) or 2160×3840 (Cafeteria/Welcome/Schedule portraits) |
| MS pack (`ms/`) | 3840×2160 (4K) | 2160×3840 (4K) |
| HS pack (`hs/`) | 3840×2160 (4K) | 2160×3840 (4K) |
| Fitness (`fitness/`) | 3840×2160 (4K) | n/a |

All sizes are scene-space px scaled by `transform: scale(N)` (`CANVAS_W/H` +
`setScale(min(w/CANVAS_W, h/CANVAS_H))`, e.g. `AnimatedWelcomeWidget.tsx:95,165`;
`HsStage.tsx:37,99`). Normalized to a 1920-wide reference (`px × 1920/sceneWidth`)
= viewing-distance-correct apparent size; one floor applies (title<64, header<40,
body<30, fine<24). "apparent@4K" = px when the scene fills a native-4K-width wall.

---

## 1. Ranked table — verified primary/near-primary content below floor

Each render site hand-verified (class → JSX `{data}` binding) so roles reflect
what actually renders. (`.bh-name` etc. are list ROW names, not titles.)

| file:line | role (renders) | current px | scene | apparent@4K | recommend | daily-driver | confidence |
|---|---|---|---|---|---|---|---|
| `AnimatedCafeteriaFoodtruckWidget.tsx:652` (`.ft-nm`) | **menu item name** | 22 | 1920×1080 | 44 | **38–42** | Y | HIGH — outlier; sibling cafés auto-fit at 42 |
| `AnimatedMorningNewsWidget.tsx:415` (`.mn-storyTitle`) | **news story headline** | `clamp(17,30cqh,28)`→cap **28** | 1920×1080 | 56 | raise cap **36–40** | Y | HIGH — primary headline capped low |
| `AnimatedMorningNewsWidget.tsx:475` (`.mn-bText`) | breaking-news body | 22 | 1920×1080 | 44 | **30** | Y | MED |
| `AnimatedHallwayScheduleWidget.tsx:405` (`.hs-name`) | **class/period name (row)** | 34 | 1920×1080 | 68 | →**40** | Y | MED — fixed while sibling bell-sched auto-fits; Caveat cursive reads smaller |
| `AnimatedHallwayScheduleWidget.tsx:404` (`.hs-time`) | class time (row) | 30 | 1920×1080 | 60 | **34** | Y | MED |
| `AnimatedHallwayScheduleWidget.tsx:406` (`.hs-room`) | room # (row) | 26 | 1920×1080 | 52 | **28** | Y | LOW |
| `AnimatedAchievementShowcaseWidget.tsx:380` (`.as-nm`) | honor-roll names (list) | 18 | 1920×1080 | 36 | **24–26** | Y | MED — dense sidebar, real names |
| `ScrapbookHallwayWidget.tsx:293` (`.sbh-name`) | roster row name | 34 | 1920×1080 | 68 | ok/**36** | Y | LOW — at floor |
| `BulletinHallwayWidget.tsx:338` (`.bh-name`) | roster row name | 32 | 1920×1080 | 64 | **34** | Y | LOW — at floor |
| `StorybookHallwayWidget.tsx:352` (`.sh-name`) | roster row name | 30 | 1920×1080 | 60 | **34** | Y | LOW — at floor |
| `ms/MsHomeroomWidget.tsx:879` (agenda) | homeroom agenda body | 50 | 3840×2160 | 50 | **64** | Y | LOW — 4K scene; ~25px@1920, fine at native 4K |
| `ms/MsPaperWidget.tsx:879` (deck) | newspaper deck/body | 50 | 3840×2160 | 50 | **64** | partial | LOW — novelty theme |
| `ms/MsHomeroomWidget.tsx:1172` (card-t) | bottom card body | 26 | 3840×2160 | 26 | **44** | partial | LOW — dense 4K |

> NOT actually tiny (initially mis-flagged): `.bc-cardTitle` (`BulletinCafeteriaWidget.tsx:387`, 42px) = lunch item name, fine. `.hs-name` (`AnimatedWelcomeHighWidget.tsx:717`, 24px) = `c.teacherName` secondary label, hero is 96px+. Portrait cafeteria item names (`.hsp-itemName` 78px, `.msp-itemName` 76px, `.ftp-nm` 80px on 2160-wide) are healthy.

---

## 2. Shortlist — the ~6 to fix FIRST (screenshot-verify each)

1. **`AnimatedCafeteriaFoodtruckWidget.tsx:652` `.ft-nm` 22 → ~40px** — clearest bug. Item names 22px while 4 sibling cafeteria widgets auto-fit at `clamp(20px,38cqh,42px)`. Fix: match siblings → `clamp(22px,36cqh,42px)`. Also `.ft-allergen:656` 16→22.
2. **`AnimatedMorningNewsWidget.tsx:415` `.mn-storyTitle` cap 28 → 38–40px** — `.mn-story` is `flex:1 1 0`; with 4 stories the `30cqh` lands at the 28 cap. Raise clamp max. Also `.mn-bText:475` 22→30.
3. **`AnimatedHallwayScheduleWidget.tsx:404–406`** — convert fixed `.hs-name`/`.hs-time`/`.hs-room` (34/30/26) to the container-query pattern its sibling `AnimatedBellScheduleWidget` already uses (`.bs-pname`=`clamp(20px,36cqh,40px)`, `:456`). Caveat cursive reads smaller than its px.
4. **`AnimatedAchievementShowcaseWidget.tsx:380` `.as-nm` 18 → 24–26px** — honor-roll names; tight sidebar but 18px strains at distance.
5. **Bulletin/Scrapbook/Storybook Hallway roster names** (`bh-name:338`, `sbh-name:293`, `sh-name:352`, 30–34) → 36px. Low risk (simple list rows).
6. **`ms/MsHomeroomWidget.tsx`** agenda/card body (`:879` 50px, `:1172` 26px) — only if Homeroom is in the pilot's daily rotation.

---

## 3. Correctness flag — viewport / non-scene units
**Clean.** Zero `font-size` uses `vw`/`vh`/`%` in any scene family. The `cqh`/`cqw`
font-sizes are correct intentional auto-fit, each paired with local
`container-type: size` (`AnimatedBellScheduleWidget.tsx:425`;
`AnimatedMorningNewsWidget.tsx:380`; `AnimatedCafeteriaHighWidget.tsx:591`).
`themes/FitText.tsx` uses a JS binary-search fitter — also correct. No port-break risk.

---

## 4. Honest scope summary
- **`themes/` (~37 files): confirmed fine** — `FitText`/`em`/`clamp` auto-fit.
- **Animated landscape daily-drivers:** primary content large fixed-px (hero 96–280px) or auto-fits via `cqh`. Real issues: Foodtruck `.ft-nm`, MorningNews headline cap, HallwaySchedule fixed rows. **~3 widgets.**
- **Animated portrait (2160-wide 4K):** menu/row names 76–80px ≈ healthy. Fine.
- **Bulletin/Scrapbook/Storybook (12 files):** roster-row names 30–34 borderline; rest is garnish. **~3–4 borderline, none egregious.**
- **MS pack (16 files):** 4K; heroes 124–256px. Sub-30px-equiv is dense info-graphic garnish. MsHomeroom/MsPaper bodies arguable, only on 1080p downscale. Novelty boards, lower priority. **~1–2 arguable.**
- **HS pack (16 files):** 4K; smallest is metadata/captions (44–52px-scene); titles/names 60–320px. Fine for 4K wall.
- **Fitness (24 files):** gym vertical, not core EDU. 8 responsive (`cqh`); rest 4K large-hero. A few borderline labels. Deferred — out of EDU daily-driver scope.

**Net:** the "a lot are tiny" perception is most likely (a) the **Foodtruck menu**
(real 22px bug, high-visibility), (b) the **MorningNews headline** capping at 28px,
(c) **HallwaySchedule** rows looking small next to the auto-fitting BellSchedule —
plus general MS/Bulletin scene density where intentional small garnish coexists with
big content. Fixing the 6-item shortlist addresses the real complaints without the
regression risk of a blanket sweep. Screenshot-verify each against the approved
mockup per the CLAUDE.md workflow — these are hand-tuned fixed-scene layouts.
