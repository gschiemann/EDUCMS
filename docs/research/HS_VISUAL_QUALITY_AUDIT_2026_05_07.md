**Audit date:** 2026-05-07
**Auditor:** Claude (Opus 4.7)
**Demo:** HS district pilot, 2026-05-08 (TOMORROW)
**Scope:** 8 HS pack widget pairs (16 files) + 6 HS holiday HTMLs (18 incl. ES/MS) + iframe bridge + PropertiesPanel HOLIDAY case

---

## Headline finding

**The "Snow Ball" / Christmas / "can't edit anything" bug is not specific to that template.** All 18 holiday HTMLs ship a JavaScript SyntaxError in the iframe-bridge script that blocks every editable hotspot in every holiday template. Patch is one regex character per file. See "Holiday Snow Ball edit-flow root cause" at the bottom.

The 16 native HS pack widgets (Varsity / Broadcast / Yearbook / Terminal / Transit / Gallery / Blueprint / Zine, landscape + portrait) are well-built: every text node has a `data-field` for click-to-edit, hero text is consistently 130-340px (mid range 90-220px on portrait), the design language is genuinely HS-coded (athletic letter-jackets, broadcast lower-thirds, magazine spreads, terminal phosphor, departure boards, museum catalog, blueprints, photocopied zines). Visual quality scores 4-5/5 across the board.

---

## Punch list (ranked by demo blast radius × ease of fix)

| # | Template / area | Severity | Issue | Specific fix | Effort |
|---|---|---|---|---|---|
| **1** | All 18 holiday HTMLs | **P0** | Bridge script's `multiline:/<NEWLINE>/.test(t)` is an invalid regex literal split across two source lines. SyntaxError fires at iframe parse time → bridge dies → no `holiday:ready` postMessage → PropertiesPanel HOLIDAY case shows the 4-second loading spinner, then "no editable text fields." Click-to-edit on hotspots also dead. **This is the operator's "Snow Ball" complaint.** | In `apps/web/public/holiday-templates/*.html` line 96-98, change `/<actual newline>/.test(t)` to `/\\n/.test(t)`. Apply to all 18 files. Or replace with `t.indexOf('\n')>=0`. | 5 min (sed across the dir) |
| **2** | All HS holiday HTMLs | **P0** | Even when bridge is fixed, the only edit affordance is text content. There's NO font-size control for any field — operator can fix typos but can't enlarge the hero "Snow Ball." headline if it reads small for their wall distance. This is the operator's "tiny text…couldn't make it larger…no font editor" complaint. | Add a font-size inline slider next to each holiday TextField in `HolidayPanelExtras` (`PropertiesPanel.tsx:3070-3146`). Bridge needs a new `holiday:setFieldStyle` message that writes `style.fontSize` on the matching `[data-field]` element. ~60 lines. | 2-3 hours |
| **3** | HsZineWidget body copy | P1 | `.hs-zn-stats .hs-zn-cap` = 20px, `.hs-zn-pic .hs-zn-name` (event names in polaroid strip) = 28px on the 3840×2160 canvas. After scale-to-fit on a typical 1920×1080 monitor (0.5× scale), these read at 10-14px effective — too small at 8-foot viewing distance. | `apps/web/src/components/widgets/hs/HsZineWidget.tsx` lines 229, 241 — bump `.hs-zn-cap` 20→24px, `.hs-zn-name` 28→34px. | 5 min |
| 4 | HsZineWidget schedule .w lines | P1 | `.hs-zn-poster-sub` 24px and `.sked li .w` 18px — schedule subtitle illegible at distance. | Same file, line 222: bump `.hs-zn-poster-sub` 24→32px. (Schedule .w is portrait-only and already 18px is OK for tertiary detail.) | 5 min |
| 5 | All HS holidays — `.cd p` body | P2 | All HS holiday HTMLs use `font-size:30px` for `.cd p` (card body copy on the 3-column grid). At 0.5× scale that's 15px effective — readable at 3-4 feet, marginal at 10+. ES/MS have the same. | Bump every holiday `.cd p` from 30px → 36px. Sed-able. Same for `.tile p` (26px → 32px) in `hs-thanksgiving.html`. | 10 min |
| 6 | HsTerminalWidget `.hs-tm-sub` | P2 | 40px sub copy with `// ` prefix is fine, but the per-stat `.hs-tm-cap` at 28px and event `.hs-tm-evhead` at 26px feel small inside the stat boxes at viewing distance. Acceptable since terminal aesthetic intentionally crowds. | Optional: bump `.hs-tm-cap` 28→32px (HsTerminalWidget.tsx:286). | 2 min |
| 7 | All HS holidays — schedule `.w` rows | P2 | `font-size:18px` for the per-event sub-line in the bottom `.sked` strip. Tiny on the wall. | 18px → 22px in every `*.html` `.sked li .w` rule. Sed-able. | 5 min |
| 8 | HsZineWidget hero shadow stack | P3 | `.hs-zn-h1` is 320px and looks great, but `transform: rotate(-.6deg)` on the sheet wrapper risks one-pixel anti-aliasing fuzz on the hero. Cosmetic; ignore. | n/a | n/a |
| 9 | HsBroadcastWidget headline 260px shadow | P3 | `.hs-bc-h1` text-shadow is none — broadcast aesthetic would benefit from a faint cyan/red drop to read against the radial gradient. Polish. | Optional polish: add `text-shadow: 0 6px 0 rgba(239,43,43,.18);` to `.hs-bc-h1`. | 2 min |
| 10 | HsTransitWidget row flap animation | P3 | `.hs-trp-row { animation: hsTrpFlip 8s ease-in-out infinite }` — the rotateX(-12deg) keyframe runs every 8s on every row. Subtle distraction. Demo is fine, but on a 30-minute dwell display this becomes annoying. | Lower the frequency to 30s+ or remove the per-row offset. | 2 min |
| 11 | HsVarsityWidget `.hs-varsity-anno-p` | P3 | 28px body inside the announcement panel feels small relative to the 220px hero. | Bump to 34px (HsVarsityWidget.tsx:438). | 2 min |
| 12 | HsBlueprintWidget `.hs-bp-meta` | P3 | 22px monospace meta line. Detail-text role; OK but small. | Optional bump to 26px. | 2 min |
| 13 | HsGalleryWidget `.hs-gl-time` | P3 | 44px italic time + 22px day label. Day label could be 28px for legibility. | HsGalleryWidget.tsx:233. | 2 min |
| 14 | All HS holidays — `meta` text | P3 | `.cd .meta` = 22px monospace caps. Acceptable; matches Canva-style "kicker." No fix needed. | n/a | n/a |
| 15 | Holiday HTMLs — missing portrait variants | P2 | If a customer ever turns on `config.portrait: true` (no system preset does today, but the HOLIDAY case in PropertiesPanel doesn't expose this), the iframe loads `/holiday-templates/<grade>-<variant>-portrait.html` which doesn't exist → 404 → empty iframe. Not blocking demo, but a future trap. | Either author the 18 portrait HTMLs OR have HolidayWidget fall back to landscape with a `.portrait { transform: rotate(90deg) }` wrapper. | 1 day proper, 30 min for the fallback. |
| 16 | All HS holidays — no field "click to focus" UX feedback in HTML | P3 | Bridge sends `holiday:fieldClicked` correctly, but the iframe gives no cursor:pointer / outline:hover hint that hotspots are clickable. Operators don't know to click. | Add `[data-field]:hover { outline: 2px dashed rgba(255,255,255,.4); cursor:pointer; }` to every holiday HTML's `<style>` block. | 5 min sed |
| 17 | HsTransitWidget portrait — flap animation per row | P3 | Same as #10, hsTrpFlip on the portrait variant. | Same fix. | 2 min |

---

## "Tomorrow demo cannot ship without these" (BLOCKERS)

1. **Patch the holiday-bridge regex in all 18 HTMLs** (#1 in table). Without this, the operator demo of any holiday template — which they themselves opened first — appears completely broken: variant dropdown works, but the property panel shows "no editable text fields" and the canvas hotspots don't respond to clicks. This is the *exact* complaint the operator raised. **Risk: high probability the customer opens a holiday template during the demo.** Fix is a 5-minute regex replacement run across the directory.

2. **Bump tiny body text in HsZine + holiday `.cd p`** (#3, #5 in table). The operator's "couldn't make it larger looked ridiculous" complaint maps to either (a) HsZine card captions / event names or (b) the holiday card-body copy. Either way, raising 20-30px to 32-36px on those specific selectors is a 10-minute change that prevents the customer from hitting the same wall.

3. **(Optional but cheap) Add font-size slider for holiday TextFields** (#2). If you can spare 2-3 hours tonight, this turns the operator's "no font editor" complaint from a workaround ("we'll fix it in v1.1") into a delight moment ("we shipped that for the demo").

---

## "Make-it-pretty quick wins" (1-2 hour polish)

- **Hover affordance on holiday hotspots** (#16). One CSS rule per file, sed-replaceable. Makes click-to-edit discoverable in the demo.
- **HsBroadcast hero text-shadow** (#9). Polish.
- **HsTransit flap-animation cadence** (#10). 8s loop is busy; bumping to 30s+ stops eye-distraction without losing the effect.
- **HsZine schedule sub-text bump** (#4). Three numbers changed, instantly more legible.
- **Sweep all holiday `.sked li .w`** (#7). One sed pass, much more legible at distance.

Total: ~45 minutes if you batch it.

---

## "Holiday Snow Ball edit flow root cause" (specific diagnosis)

### Symptom
Operator opens any HS holiday template (e.g. "Christmas — High School" → renders the Snow Ball / Winter Formal scene). Variant + Grade Level dropdowns work in the right rail. The "Editable text" section below shows a "Loading editable fields from the scene…" message for ~4 seconds, then disappears (the failsafe `setTimeout` in `HolidayPanelExtras`). Operator sees no text fields and no click-to-edit response on the canvas.

### Root cause: invalid regex literal in bridge script

Every holiday HTML at `apps/web/public/holiday-templates/*.html` ends with this `<script id="holiday-bridge">` block. Inside the schema-collection function `r()`, the bridge tries to detect multiline default text:

```js
f.push({
  key: k,
  defaultText: t,
  multiline: /
/.test(t) || t.length > 80 || e.tagName === 'P'
});
```

That's a regex literal split across two physical source lines with a real `\n` byte between the `/`s — i.e. the source contains `multiline:/[LF]/.test(t)`. A JavaScript regex literal cannot contain an unescaped line terminator; the parser rejects it as `SyntaxError: Invalid regular expression: missing /`. I confirmed this empirically with `node -e`:

```
$ node -e "Function('var x = /<NEWLINE>/.test(\"hi\");');"
FAILS: Invalid regular expression: missing /
```

When the iframe loads, the entire `holiday-bridge` IIFE fails to parse — including the click handler and the `message` listener. Result:

1. **No `holiday:ready` postMessage is ever sent** to the parent. `HolidayWidget`'s `useEffect` listener (`HolidayWidget.tsx:130-165`) waits forever. `HolidayPanelExtras` (`PropertiesPanel.tsx:3079-3100`) hits its 4-second failsafe timeout and renders the "no editable text fields" empty state.
2. **No click handler on `[data-field]` elements** → canvas-level click-to-edit doesn't fire `holiday:fieldClicked` → `template-edit-field` window event never dispatches → the right rail can't auto-focus a field that the operator clicks.
3. **Field updates ARE delivered downstream** (the parent's `holiday:setField` postMessage works), but only because `HolidayWidget` posts it after the iframe load — except the bridge's listener is also dead from the same parse failure, so even if PropertiesPanel were populated and the operator typed, the iframe wouldn't update either.

### Scope
**All 18 holiday HTMLs are affected** (es/ms/hs × halloween/thanksgiving/christmas/valentines/stpatricks/easter). Confirmed via grep — every file contains the same broken `multiline:/<LF>/`. The auto-scale `<script>` block (separate, single-line) works fine; only the bridge script is broken.

### Fix
Replace the literal newline inside the regex with the `\n` escape sequence. In every `apps/web/public/holiday-templates/*.html` line ~96-98, change

```js
multiline:/
/.test(t)||t.length>80||e.tagName==='P'
```

to

```js
multiline:/\n/.test(t)||t.length>80||e.tagName==='P'
```

Or sidestep the regex entirely:

```js
multiline:t.indexOf('\n')>=0||t.length>80||e.tagName==='P'
```

Either form is a single-character or one-token edit. After patching, the bridge parses, `holiday:ready` fires on iframe load, `HolidayPanelExtras` renders one TextField/TextAreaField per `[data-field]` (~45 fields per HS template), and click-to-edit on hotspots works.

### Why this wasn't caught earlier
The bridge IIFE catches the postMessage call in a `try`/`catch`, so a parse failure in the iframe doesn't surface as a console error in the dashboard's main frame — it's silently isolated by the iframe boundary. Looking at the iframe console (DevTools → "Frame" picker → select the iframe) would have shown the SyntaxError immediately. Recommend adding a one-time integration test that loads `hs-christmas.html` in a headless iframe, listens for `holiday:ready`, and fails if no message arrives within 2 seconds — would have caught this and any future regression.

### Verification steps
1. After patching one file, open it directly in the browser at `/holiday-templates/hs-christmas.html`. Open DevTools console. Should see no SyntaxError.
2. Add an inline `console.log('[bridge] ready', f.length)` next to the postMessage in `r()` for a single-file smoke test. Should see `[bridge] ready ~46`.
3. In the editor, drop a `🎄 Christmas — High School` template. The right rail "Editable text" section should populate within ~500ms of the iframe loading, with one field per `[data-field]` (`headline.t1`, `headline.t2`, `tickets.p`, `dance.p`, `sked.0.e1`, etc.).
4. Click any text node on the canvas — the right rail should scroll to and highlight the matching field input.
5. Type into the field — the canvas should update live.

After verification, run a sed across all 18 files; one regex replace per file is enough.

---

## Per-template scoring (1-5 scale)

| Widget | Visual quality | Proportional sizing | Editability | HS-student polish | Notes |
|---|---|---|---|---|---|
| HsVarsity (landscape) | 5 | 5 | 5 | 5 | Hero 220px Bungee, scoreboard, jersey-num portrait. Best of breed. |
| HsVarsityPortrait | 5 | 5 | 5 | 5 | 200px varsity letter, athletic-card stat row. Gold standard. |
| HsBroadcast | 5 | 4 | 5 | 5 | 260px headline, breaking-news card. `.hs-bc-brk-p` 34px is tight but OK. |
| HsBroadcastPortrait | 5 | 5 | 5 | 5 | 180px hero, lower-third banner is genuinely premium. |
| HsYearbook | 5 | 5 | 5 | 4 | 290px serif Playfair italic. Editorial. May feel "grown-up" for some HS audiences but reads sophisticated, not childish. |
| HsYearbookPortrait | 5 | 5 | 5 | 4 | Two-column lede with drop cap. Magazine-quality. |
| HsTerminal | 5 | 4 | 5 | 5 | VT323 phosphor, scanlines, whoami card. Hits CS-club / coder kid vibe perfectly. `.hs-tm-cap` 28px is small. |
| HsTerminalPortrait | 5 | 4 | 5 | 5 | Crontab/syslog metaphor. Brilliant. Same minor cap-text issue. |
| HsTransit | 5 | 5 | 5 | 5 | Departure board with status chips. 200px hero, 280px gate number. Iconic. |
| HsTransitPortrait | 5 | 5 | 5 | 5 | 280px GATE letter dominates. Per-row flap animation is busy though (#10). |
| HsGallery | 5 | 5 | 5 | 4 | EB Garamond museum catalog. Sophisticated; less "high school" energy than others. Use for AP/IB schools, magnet programs. |
| HsGalleryPortrait | 5 | 5 | 5 | 4 | Gilt frame + dark acquisition card. Genuinely premium. |
| HsBlueprint | 5 | 4 | 5 | 5 | Title block, dimensioned callouts, sheet annotations. STEM/maker space vibes. 280px Archivo hero. |
| HsBlueprintPortrait | 5 | 5 | 5 | 5 | Floor-plan elevation with leader lines. Architectural. |
| HsZine | 4 | 3 | 5 | 5 | 320px Archivo Black, ransom-letter aesthetic. Some body text (20-28px) is tight (#3-4). |
| HsZinePortrait | 5 | 4 | 5 | 5 | Per-glyph-rotated ransom banner is a tour-de-force. Same body-text smallness issue. |
| Holiday HTMLs (all 6 HS) | 4 | 4 | **0** | 4 | Designs themselves are strong (Bebas + Fraunces, varsity letterjacket Christmas, drive-in marquee Halloween, newsprint Thanksgiving, risograph Valentines, terminal St Patrick's, Bauhaus Easter). **Editability score is 0/5 because of the bridge bug — operator gets zero text fields. After fix, editability jumps to 4/5; without font-size control it stops at 4.** |

---

## Closing note for the user

Short version: the native HS pack widgets are genuinely demo-ready. The bridge bug in the holiday HTMLs is the single biggest risk for tomorrow — patch that one regex in 18 files (5 minutes with sed) and the "can't edit anything" complaint goes away across the entire holiday catalog. The "tiny text / no font editor" complaint is partially the same root cause (no editable fields → no way to enlarge anything) and partially a real gap (no font-size slider in the holiday flow yet). Fixing the bridge unblocks the demo; bumping a few body-text sizes (HsZine + holiday `.cd p`) in another 10 minutes makes "tiny" a non-issue at viewing distance. Font-size sliders are nice-to-have for v1.1.
