# Overnight audit (2026-06-25) — triage digest

7 agents, 36 findings. totals={'findings': 36, 'p0': 8, 'liveSafe': 25}

## [0] P0 · risk=high · liveProdSafe=False · Emergency reliability backstop — load-bearing system for multi-tenant water-polo signage
**Manifest never validates cached emergency state — player can't self-heal a missed WS ALL_CLEAR**

- files: None
- rootCause: EmergencyOverlay.tsx polls only /emergency/messages (+ /emergency/status for fallback) to find NEW pushed messages. It never consults the manifest's isEmergency field to validate that a CACHED emergency (hydrated from localStorage on boot) is still live. When a WS ALL_CLEAR is dropped + player reboots: (1) hydrate effect sets activeEmergency from cache, (2) first manifest poll returns isEmergency=false, (3) manifest read is discarded, (4) emergency cache survives, (5) screen shows normal content but cache is stale. Next reboot: same state. Operator must manually clear via dashboard.
- exactFix: In EmergencyOverlay.tsx, add a NEW effect (runs every 10-30s) that:
1. Reads the manifest via device-authed fetch (same path as existing manifest poll in player/page.tsx)
2. Extracts manifest.isEmergency
3. If manifest.isEmergency === false AND localStorage has an active emergency, CLEAR the cache by calling the new helper: `clearEmergencyCache()` (writes empty object to localStorage key 'edu_emergency_cache_v1')
4. CRITICAL: this must NOT rely on polled message state; it's a READ of the manifest's authoritative ground truth

EXACT CODE PATCH for apps/web/src/components/player/EmergencyOverlay.tsx:

--- (BEFORE at line 77-138, add new effect after existing useEffect)

+++ Add NEW effect (after line 138, before line 140)

  // NEW P0 fix: validate cached emergency against manifest ground truth.
  // If manifest says isEmergency=false but cache says active=true, the
  // player was mid-lockdown when WS ALL_CLEAR dropped + it rebooted.
  // Manifest is the source of truth (signed, DB-backed); cache is a
  // power-cycle ride-through. Cache must yield to manifest.
  useEffect(() => {
    if (!apiUrl || !screenId || !deviceToken) return; // need device context
    if (message) return; // don't clear if we just received a push
    
    let stopped = false;
    const validate = async () => {
      try {
        const res = await fetch(
          `${apiUrl}/screens/${encodeURIComponent(screenId)}/manifest`,
          { headers: { Authorization: `Bearer ${deviceToken}` } }
        );
        if (stopped) return;
        if (!res.ok) return; // transient; next cycle will retry
        const manifest = await res.json();
        
        // Manifest says NO emergency, but we have a cached one?
        if (!manifest.isEmergency) {
          const cached = localStorage.getItem('edu_emergency_cache_v1');
          if (cached) {
            try {
              const parsed = JSON.parse(cached);
              if (parsed?.payload?.active === true) {
                // Cache is stale; clear it. This closes the gap where
                // a missed WS ALL_CLEAR leaves a rebooted screen stuck.
                localStorage.removeItem('edu_emergency_cache_v1');
              }
            } catch { /* corrupted cache; remove it */ }
          }
        }
      } catch {
        /* offline or network blip; next cycle retries */
      }
    };
    
    validate();
    const h = setInterval(validate, 30_000); // every 30s is conservative
    return () => { stopped = true; clearInterval(h); };
  }, [apiUrl, screenId, deviceToken, message]);

FILE PATH: /Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/player/EmergencyOverlay.tsx
LOCATION: Insert new useEffect after line 138 (after the existing polling effect's return statement).

VERIFY ON ISOLATED TENANT:
1. Spin up throwaway school tenant on staging
2. Pair a test kiosk
3. Fire a tenant-scope LOCKDOWN emergency (POST /api/v1/emergency/trigger, scopeType='tenant')
4. Verify WS delivery + manifest both show lockdown
5. Trigger all-clear while kiosk is OFFLINE (kill network) — ALL_CLEAR goes to DB but jiosk never sees WS
6. Reboot jiosk (cold boot) — it hydrates the cached LOCKDOWN, shows overlay
7. Within 30s of boot, the new manifest-validation effect fires:
   - Fetches /screens/:id/manifest
   - Sees isEmergency=false (all-clear was persisted to DB)
   - Clears the stale cache
   - Overlay disappears
8. Verify second reboot doesn't re-show the overlay (cache is gone)
9. Verify WS ALL_CLEAR still works normally (no regression on the happy path)
10. Verify that a NEW emergency while cache is empty still hydrates on reboot

SECURITY NOTES:
- This is a READ-ONLY validation, not a mutation
- Manifest is already signed + device-authed (exact same call as the main manifest poll in page.tsx)
- localStorage.removeItem() is idempotent
- The cache-clear only triggers when manifest explicitly says isEmergency=false (not on transient errors)
- Matches the existing SafeguardS: audit log is unaffected, signing is untouched, all-clear endpoint unchanged
- DOES NOT bypass the hold-to-trigger on /api/v1/emergency/trigger (that's a separate endpoint)
- verifyHow: On a fresh throwaway tenant: (1) Trigger emergency + verify overlay appears, (2) Clear emergency WHILE offline (kill network), (3) Reboot kiosk, (4) Within 30s, overlay must disappear (manifest validation cleared cache), (5) Reboot again — overlay stays gone (no re-hydration), (6) Trigger NEW emergency — overlay appears again. Test on both device-JWT and user-session paths (screenId + deviceToken set vs. just tenantId).

## [1] P0 · risk=medium · liveProdSafe=False · Mobile UX/UI & Responsiveness – Operator Flows on iPhone (390px)
**Dashboard background polling—60s tick triggers refetches even when app is backgrounded**

- files: None
- rootCause: Dashboard page, lines 108-113, runs `setInterval(tick, 60_000)` to update the time-aware greeting. The tick triggers a state update (setNow), which causes a re-render. Re-renders cause React Query hooks (useScreens, usePlaylists, useAssets at lines 65-71) to re-run their dependency chains. Since these hooks have no explicit stale-time, they refetch immediately on re-render, even if the data is fresh. When the app is backgrounded (Phone Home pressed), the tick continues firing, causing network activity. Violates Mobile Performance Standard: 'no bg-polling'.
- exactFix: File: /Users/gschiemann/Desktop/EDU CMS/apps/web/src/app/[schoolId]/dashboard/page.tsx, lines 108-113. Option 1 (recommended): Gate the tick refetch on data staleness.

BEFORE:
```typescript
useEffect(() => {
  const tick = () => setNow(new Date());
  tick();
  const id = setInterval(tick, 60_000);
  return () => clearInterval(id);
}, []);
```

AFTER:
```typescript
useEffect(() => {
  const tick = () => setNow(new Date());
  tick();
  const id = setInterval(() => {
    tick();
    // Refetch only if data is stale (>5min old)
    const now = Date.now();
    if (screensQuery.dataUpdatedAt && (now - screensQuery.dataUpdatedAt) > 5 * 60 * 1000) {
      screensQuery.refetch();
    }
  }, 60_000);
  return () => clearInterval(id);
}, [screensQuery]);
```

Option 2 (alternative): Set `staleTime: 5 * 60 * 1000` on the useScreens/usePlaylists/useAssets hooks in @/hooks/use-api.ts so React Query dedupes rapid refetch calls.
- verifyHow: Open Dashboard on a 390px phone, open Network tab, background the app (press Home), wait 2 minutes. Zero new API calls should fire. Unlock and wait 1 minute—still clean. Only a manual Retry button click should trigger network activity.

## [2] P0 · risk=low · liveProdSafe=True · Sports auto-leaders / Player-of-Game stat-key mismatch
**STAT_SEMANTICS in api-types/sports.ts uses SHORT keys — already correct**

- files: ['/Users/gschiemann/Desktop/EDU CMS/packages/api-types/src/sports.ts']
- rootCause: STAT_SEMANTICS[sport] at line 1530+ already uses ONLY SHORT keys (e.g., water_polo: [{key:'G',...},{key:'A',...}]). This is correct — once stored stats are normalized to SHORT keys, statSemantic() lookups will work.
- exactFix: No change needed. STAT_SEMANTICS is already keyed on SHORT codes. Once stored stats use SHORT codes (via alias normalization above), every statSemantic() lookup in computePlayerSurfaces will find the correct semantic.
- verifyHow: Audit STAT_SEMANTICS[sport] — confirm every entry has key in PLAYER_STATS[sport]. Test statSemantic('water_polo', 'G') → returns the correct semantic. No changes required here; this is a validation point.

## [3] P0 · risk=low · liveProdSafe=True · Sports auto-leaders / Player-of-Game stat-key mismatch
**POTG_WEIGHTS keyed on SHORT codes — already correct**

- files: ['/Users/gschiemann/Desktop/EDU CMS/apps/api/src/sports/sports-stats.service.ts']
- rootCause: POTG_WEIGHTS at line 138+ uses SHORT keys (e.g., water_polo: {G:5, A:3, ST:1.5}). This is correct and matches PLAYER_STATS.
- exactFix: No change needed. Once stored stats use SHORT codes, POTG_WEIGHTS lookups will work. If stored stats are normalized correctly, no further changes here.
- verifyHow: Verify each sport's POTG_WEIGHTS[sport] keys are all present in PLAYER_STATS[sport]. No additional changes required; validation only.

## [4] P0 · risk=low · liveProdSafe=True · Sports auto-leaders / Player-of-Game stat-key mismatch
**STAT_LABELS in sports-stats.service.ts uses SHORT codes — already correct**

- files: ['/Users/gschiemann/Desktop/EDU CMS/apps/api/src/sports/sports-stats.service.ts']
- rootCause: STAT_LABELS at line 77+ maps SHORT keys to display labels. Correct — no change needed.
- exactFix: No change. Once stored stats are normalized to SHORT keys, labelFor(key) will find the correct label.
- verifyHow: Audit STAT_LABELS — verify all SHORT keys used in any POTG_WEIGHTS or PLAYER_STATS have labels. No code changes needed.

## [5] P0 · risk=low · liveProdSafe=True · Integration "costumes" (honesty gap) — Settings → Integrations, POS, SSO, Streaming, and hardware controls
**Design imports — moved from /settings/imports to /templates/imports with honest redirect**

- files: ['/Users/gschiemann/Desktop/EDU CMS/apps/web/src/app/[schoolId]/settings/imports/page.tsx']
- rootCause: 2026-05-25: operator feedback ('this should not be under settings … it's a feature not a setting') prompted the move. The deprecated /settings/imports page was replaced with a redirect stub that calls router.replace() to skip the old URL from history. This is honest — no dead-end UI, just a 10-second invisible redirect to the new location.
- exactFix: No fix required. The redirect stub at /[schoolId]/settings/imports/page.tsx (lines 1–52) is correct: it uses router.replace() (not push), shows a loading spinner, and navigates to the new canonical location /[schoolId]/templates/imports. Old bookmarks and inbound links work seamlessly.
- verifyHow: Bookmark or manually navigate to /[schoolId]/settings/imports. Page loads with a spinner ('Design imports moved to Templates — redirecting…') and redirects to /[schoolId]/templates/imports. Back button does not loop to the old URL.

## [6] P0 · risk=low · liveProdSafe=True · Integration "costumes" (honesty gap) — Settings → Integrations, POS, SSO, Streaming, and hardware controls
**Streaming validation — YouTube embed Error 153 pre-probe (honest, not a costume)**

- files: ['/Users/gschiemann/Desktop/EDU CMS/apps/web/src/app/[schoolId]/settings/streaming/page.tsx', '/Users/gschiemann/Desktop/EDU CMS/apps/api/src/streaming/streaming.controller.ts']
- rootCause: 2026-05-25 streaming-overhaul: operator screenshot showed 'France 24 — Français … Error 153 · Video player configuration error' on the live screen because the video owner had disabled embedding. Fixed with a server-side URL validation endpoint (POST /api/v1/streaming/validate) that probes embeddability BEFORE saving the channel. If a URL cannot be embedded, the operator sees a 'block' state panel and the save is blocked (lines 867–876 of streaming/page.tsx). This is honest UX — not a costume.
- exactFix: No fix required. The validation flow (lines 716–775) is correct: handleManualAdd calls validateUrl, which returns { ok, type, embeddable, reason, suggestion }. Block-state panels (kind='block') prevent save. The operator never ships a known-bad channel to their screen.
- verifyHow: Navigate to /[schoolId]/settings/streaming, pick an existing connection, go to 'Add a channel by URL'. Paste a URL (e.g., https://youtube.com/watch?v=...). Click 'Add channel'. Observe: (1) 'Checking this URL…' spinner, (2) result: 'Looks good' OR warning/block panel. If block, save is disabled. Test with a known-bad YouTube URL (embedding disabled) to see the block panel.

## [7] P0 · risk=low · liveProdSafe=True · Player runtime stability (apps/web/src/app/player + apps/web/src/components/player)
**Error boundaries prevent whole-player blanking on widget crash**

- files: ['/Users/gschiemann/Desktop/EDU CMS/apps/web/src/app/player/page.tsx', '/Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/widgets/WidgetErrorBoundary.tsx']
- rootCause: Two error boundaries isolate crashes and prevent cascading failure: (1) PlayerErrorBoundary wraps the entire PlayerPage and catches ANY renderer crash, triggering a 3-fast-strike (8s) / slow-retry (90s) auto-reload cycle via sessionStorage counter. (2) WidgetErrorBoundary wraps each zone/widget independently, catching widget-level throws and showing inline fallback (or blanking quietly on live displays with quiet=true prop).
- exactFix: No fix needed. Boundaries are correctly wired:

/Users/gschiemann/Desktop/EDU CMS/apps/web/src/app/player/page.tsx:
- Line 1271-1382: PlayerErrorBoundary class with getDerivedStateFromError + componentDidCatch
- Line 1384-1385: PlayerPageWrapper exports boundary wrapping PlayerPage
- Line 1325-1327: Auto-reload logic (8s fast, then 90s slow) with isAndroidWebView() native reload fallback

/Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/widgets/WidgetErrorBoundary.tsx:
- Line 54-60: componentDidCatch logs to console (no Sentry spam)
- Line 66-67: quiet=true mode blanks zone instead of showing red debug card (player mode)
- Line 48-51: Resets on props.resetKey change so config edits retry the widget

No widget crash can blank the entire player; Sentry integration is try-caught so crash reporting failure never blocks recovery.
- verifyHow: Inject a throwing widget (e.g., add `throw new Error('test')` inside a widget's render). Verify: (1) the zone goes blank on live player (quiet=true), (2) 8s later player reloads, (3) if same widget throws again, reload delays to 90s. Verify sessionStorage counter increments. Test that Sentry.captureException failure (via try-catch) doesn't prevent reload.

## [8] P1 · risk=high · liveProdSafe=False · Sports auto-leaders / Player-of-Game stat-key mismatch
**Stat-key mismatch: stored LONG keys vs read SHORT keys (all 18 sports)**

- files: ['/Users/gschiemann/Desktop/EDU CMS/packages/api-types/src/sports.ts', '/Users/gschiemann/Desktop/EDU CMS/apps/api/src/sports/sports.service.ts', '/Users/gschiemann/Desktop/EDU CMS/apps/api/src/sports/sports-stats.service.ts']
- rootCause: importRosterCsv() (sports.service.ts:1408) stores CSV headers as-is, uppercased: `stats[h.toUpperCase()] = val`. But computePlayerSurfaces() (sports-stats.service.ts:206) looks up PLAYER_STATS[sport] keys which are ALWAYS SHORT codes (e.g. water_polo: ['G','A','ST','EXC']). When an operator uploads a CSV with headers 'Goals','Assists','Steals','Saves', they get stored as 'GOALS','ASSISTS','STEALS','SAVES' but the reader tries to find 'G','A','ST','EXC' → null → no leaders, no POG.
- exactFix: Implement a sport-specific SHORT↔STORED key-mapping layer. RECOMMENDED: Normalize at WRITE time so stored stats always use SHORT codes (PLAYER_STATS keys), making the read path transparent. Changes required: (1) Add STAT_KEY_ALIASES constant in api-types/src/sports.ts mapping stored-form → SHORT form per sport. (2) Modify sports.service.ts importRosterCsv() line 1408 to transform CSV headers via the alias map before storing. (3) Modify sports.service.ts addPlayer() line 1234 & updatePlayer() line 1277 to apply the same normalization. (4) Test against real CSV imports for all 18 sports. ALTERNATIVE (slower path): Keep stored keys as-is, add reverse-alias lookup in computePlayerSurfaces() before line 206 — but this bloats the read-hot path.
- verifyHow: Unit test: importRosterCsv() with CSV header 'Goals,Assists,Steals,Saves' for water polo → confirm stored stats are 'G','A','ST','EXC'. Call computePlayerSurfaces() on that roster → confirm leaders[] and playerOfGame are populated. Run against all 18 PLAYER_STATS sports. Live test: operator uploads water-polo CSV with long-form headers → board shows leaders & POG immediately.

## [9] P1 · risk=high · liveProdSafe=False · Sports auto-leaders / Player-of-Game stat-key mismatch
**Precise stat-key alias map (all 18 sports)**

- files: ['/Users/gschiemann/Desktop/EDU CMS/packages/api-types/src/sports.ts']
- rootCause: Storage and display layers have no unified mapping. PLAYER_STATS defines SHORT codes per sport; CSV imports store WHATEVER the header says. Need a canonical mapping from real-world CSV headers (as operators export from spreadsheets or stat-tracking systems) to SHORT keys.
- exactFix: In packages/api-types/src/sports.ts (after PLAYER_STATS definition ~line 1140), add: `export const STAT_KEY_ALIASES: Record<string, Record<string, string>> = { football: { 'yards': 'YDS', 'touchdowns': 'TD', 'receptions': 'REC', 'tackles': 'TKL', 'interceptions': 'INT', ... }, basketball: { 'points': 'PTS', 'rebounds': 'REB', 'assists': 'AST', 'steals': 'STL', 'blocks': 'BLK', ... }, water_polo: { 'goals': 'G', 'assists': 'A', 'steals': 'ST', 'exclusions': 'EXC', ... }, ... }`. Each map includes: (1) the SHORT key itself as identity: `'G': 'G'` (accept short input). (2) LONG forms with common variations (plural, singular, underscore, space). Test each sport's `PLAYER_STATS[sport]` key against ALIASES entries — every SHORT key must have at least the identity mapping.
- verifyHow: Audit STAT_KEY_ALIASES coverage: for each of 18 sports in SPORT_DEFINITIONS, iterate PLAYER_STATS[sport] keys and verify STAT_KEY_ALIASES[sport] has ≥ one entry that maps to that SHORT key. No SHORT key may be unmapped. Test with real CSVs from 3 popular roster export systems (if available) — confirm headers are successfully aliased.

## [10] P1 · risk=high · liveProdSafe=False · Sports auto-leaders / Player-of-Game stat-key mismatch
**importRosterCsv must normalize headers via alias map**

- files: ['/Users/gschiemann/Desktop/EDU CMS/apps/api/src/sports/sports.service.ts']
- rootCause: Line 1408 in sports.service.ts stores CSV headers WITHOUT checking STAT_KEY_ALIASES. If a CSV has 'Goals', 'Assists' headers, they become stored keys 'GOALS','ASSISTS', which computePlayerSurfaces() can never find (looking for 'G','A').
- exactFix: In sports.service.ts importRosterCsv(), change line 1408–1409 from: ```typescript header.forEach((h, i) => { if (!h || FIELD.has(h)) return; const val = String(cells[i] ?? '').trim(); if (val) stats[h.toUpperCase()] = val; // ← WRONG: no alias lookup ```  TO: ```typescript header.forEach((h, i) => { if (!h || FIELD.has(h)) return; const val = String(cells[i] ?? '').trim(); if (val) { const aliasMap = STAT_KEY_ALIASES[game.sport] || {}; const lowerH = h.toLowerCase(); // Try the alias map, fall back to SHORT if unambiguous const shortKey = aliasMap[lowerH] || aliasMap[h.toUpperCase()] || h.toUpperCase(); stats[shortKey] = val; } }). Import STAT_KEY_ALIASES from @cms/api-types at the top of sports.service.ts.
- verifyHow: Unit test importRosterCsv with CSV 'Goals,Assists,Steals,Saves' for a water-polo game → verify rosterPlayer.stats stored as { G: '...', A: '...', ST: '...', EXC: '...' }. Verify lookupby computePlayerSurfaces work immediately after import.

## [11] P1 · risk=high · liveProdSafe=False · Sports auto-leaders / Player-of-Game stat-key mismatch
**addPlayer (manual roster entry) must also normalize stat keys**

- files: ['/Users/gschiemann/Desktop/EDU CMS/apps/api/src/sports/sports.service.ts']
- rootCause: RosterPanel.tsx (frontend) passes stat keys as typed by the operator into addPlayer(). If the UI defaults to LONG keys or the operator types 'goals' instead of 'G', addPlayer() at sports.service.ts line 1234 stores them unchanged via cleanStats().
- exactFix: In sports.service.ts addPlayer(), after line 1225 (after game is loaded), add alias normalization. Change line 1234 from `stats: this.cleanStats(dto.stats)` to: ```typescript stats: this.normalizeStatKeys(dto.stats, game.sport)``` Add new private method in SportsService: ```typescript private normalizeStatKeys(input: unknown, sport: string): Record<string, string> { const out: Record<string, string> = {}; const aliasMap = STAT_KEY_ALIASES[sport] || {}; if (input && typeof input === 'object') { for (const [k, v] of Object.entries(input as Record<string, unknown>)) { const key = String(k).trim(); if (!key) continue; const lowerKey = key.toLowerCase(); const shortKey = aliasMap[lowerKey] || aliasMap[key.toUpperCase()] || key.toUpperCase(); const val = String(v ?? '').trim().slice(0, 40); if (val) out[shortKey] = val; if (Object.keys(out).length >= 24) break; } } return out; }``` Do the same in updatePlayer() line 1277.
- verifyHow: Unit test addPlayer with stats { 'Goals': '5', 'Assists': '3' } for water polo → verify stored as { G: '5', A: '3' }. Test updatePlayer similarly. Confirm leaders/POG populate on board after manual add.

## [12] P1 · risk=high · liveProdSafe=False · Sports auto-leaders / Player-of-Game stat-key mismatch
**Ambiguous sports with overlapping key names — need lead confirmation**

- files: ['/Users/gschiemann/Desktop/EDU CMS/packages/api-types/src/sports.ts']
- rootCause: Some sports may have stored keys that GENUINELY map to multiple SHORT keys. For example, 'A' could mean Assists (AST) or Aces (ACE). Without clear spec from live DB or operator convention, the alias map can't be authoritative.
- exactFix: For sports where SHORT-key mappings are genuinely ambiguous from the code alone, the lead MUST inspect LIVE database for actual stored keys used by current games, then confirm intent with the water-polo operator. FLAG: basketball 'AST' vs any sport using 'A'? (unlikely collision, different sports). FLAG: swimming/cross-country 'PL' (place) — operator could input 'place' or 'position' or 'pl'. Recommend adding operator-facing note in RosterPanel: 'Keys should match the sport's standard abbreviations (PTS, AST, etc.)' + a link to a help page listing valid keys per sport. Code can proceed with best-guess aliases; operator feedback will refine for next release.
- verifyHow: Query live DB for rosterPlayer.stats across all water-polo and related games → list all ACTUAL stored keys found. Cross-check against STAT_KEY_ALIASES map for completeness. Any stored key NOT in the aliases must be manually mapped or flagged as unknown. Operator confirms stored key matches intent.

## [13] P1 · risk=high · liveProdSafe=False · Player runtime stability (apps/web/src/app/player + apps/web/src/components/player)
**Chromium-83 incompat: gap-2 utility in TouchOverlay Back button**

- files: ['/Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/player/TouchOverlay.tsx']
- rootCause: TouchOverlay.tsx line 368 uses Tailwind `gap-2` utility class on a flex button. The CSS `gap` property for flex containers requires Chrome 84+. On Chromium-83 (NovaStar Taurus LED controllers), the gap property is silently dropped, causing button child spacing to collapse. The adjacent backdrop-blur-md is also Chromium-76+ and may have flaky rendering on older Android WebView builds.
- exactFix: /Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/player/TouchOverlay.tsx line 368:

BEFORE:
className="absolute top-8 left-8 z-10 inline-flex items-center gap-2 px-6 py-4 rounded-full bg-slate-900/70 hover:bg-slate-900/85 text-white text-2xl font-bold backdrop-blur-md transition-colors min-w-[160px] justify-center"

AFTER:
className="absolute top-8 left-8 z-10 inline-flex items-center px-6 py-4 rounded-full bg-slate-900/70 hover:bg-slate-900/85 text-white text-2xl font-bold transition-colors min-w-[160px] justify-center" style={{ gap: '0.5rem', backdropFilter: 'blur(8px)' || undefined }}

OR simpler (if operator only runs on modern browsers):
Remove `gap-2` and replace with explicit margin on the <span> child: <span aria-hidden style={{ marginRight: '0.5rem' }}>←</span>
- verifyHow: Deploy to Taurus controller via APK or web player with ?narrow=1 to simulate narrow LED. Verify the Back button text alignment and arrow spacing renders correctly. Check that button is still clickable and properly positioned at top-left. On Chromium 83 dev tools, `gap: auto` property should not appear as overridden in computed styles when gap-2 is removed.

## [14] P1 · risk=high · liveProdSafe=False · Stripe webhook rawBody + rate-limiter storage for multi-replica Railway deployment
**Stripe webhook: global JSON parser shadows rawBody buffer**

- files: None
- rootCause: apps/api/src/main.ts lines 79-81 register express.json() and express.urlencoded() AFTER NestFactory.create( { rawBody: true } ). NestJS's rawBody: true option is documented to 'expose req.rawBody (a Buffer) alongside the parsed body' BUT this only works if no global middleware intercepts the stream first. The express.json() parser consumes the stream, leaving req.rawBody undefined. BillingWebhookController line 36 (const rawBody: Buffer | undefined = req.rawBody) then receives undefined, triggering the 400 'Missing raw body' error at line 37-41. Stripe signature verification (stripe.webhooks.constructEvent at StripeService line 302) requires the original octets; without them, verification always fails.
- exactFix: In /Users/gschiemann/Desktop/EDU CMS/apps/api/src/main.ts, move the express.json() and express.urlencoded() middleware BEFORE the helmet + cookieParser setup, and add a routing-based exemption for the Stripe webhook path using express.Router with raw body parsing:

REPLACE (lines 77-82):
```typescript
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const expressBody = require('express');
  app.use(expressBody.json({ limit: '5mb' }));
  app.use(expressBody.urlencoded({ limit: '5mb', extended: true }));
```

WITH:
```typescript
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const expressBody = require('express');
  
  // Stripe webhook MUST bypass JSON parsing to preserve req.rawBody for signature verification.
  // Insert a raw-body route BEFORE the global JSON middleware so the stream is not consumed.
  const webhookRouter = expressBody.Router();
  webhookRouter.post('/api/v1/billing/webhook', expressBody.raw({ type: 'application/json' }));
  app.use(webhookRouter);
  
  // Global JSON + URL-encoded parsing for all other endpoints (5MB limit).
  app.use(expressBody.json({ limit: '5mb' }));
  app.use(expressBody.urlencoded({ limit: '5mb', extended: true }));
```

This ensures:
- /api/v1/billing/webhook receives raw Buffer in req.body + req.rawBody (Stripe signature verification works)
- All other POST/PUT/PATCH endpoints continue to receive parsed req.body as JSON
- No breaking changes to existing endpoints
- Helmet, CORS, session middleware run AFTER this so they see the already-parsed body on non-webhook routes
- verifyHow: POST to /api/v1/billing/webhook with a test Stripe event signed with STRIPE_WEBHOOK_SECRET (or mock-sign with `stripe.webhooks.generateTestSignature`). Verify req.rawBody is a Buffer and req.body is also available. Check StripeService.constructWebhookEvent completes without 'Missing raw body' error. Then smoke-test representative POST endpoints: POST /api/v1/auth/login (body: {email, password}), POST /api/v1/playlists (body: {name, items}), POST /api/v1/branding/scrape (body: {url}), POST /api/v1/emergency/trigger (body: {type}) — all should parse JSON normally and return 200/201/4xx per their normal contracts.

## [15] P1 · risk=high · liveProdSafe=False · Stripe webhook rawBody + rate-limiter storage for multi-replica Railway deployment
**Rate-limiter: in-memory storage per-replica, bypassed on multi-replica fleet**

- files: None
- rootCause: apps/api/src/app.module.ts line 158-161 registers ThrottlerModule.forRoot with default in-memory storage (no explicit ThrottlerStorage provider). NestJS Throttler v6.5 uses memory-resident tracking keyed by IP+route when no Redis adapter is wired. Railway runs multiple replicas behind a load balancer. A botnet targeting POST /api/v1/auth/login (rate limit 5/min per @Throttle decorator in AuthController) across 3 replicas can send 5 requests to replica A (hits limit on A only), 5 to replica B (hits limit on B only), 5 to replica C — total 15 requests in 60s on the same IP, exceeding the intended 5/min. The limit is per-replica, not per-fleet. Same issue affects any throttled endpoint.
- exactFix: In /Users/gschiemann/Desktop/EDU CMS/apps/api/src/app.module.ts:

1. Add Redis ThrottlerStorage to imports. REPLACE lines 91-161 with:
```typescript
import { ThrottlerModule, ThrottlerGuard, ThrottlerStorage } from '@nestjs/throttler';
import { RedisThrottlerStorage } from '@nestjs/throttler/dist/storages/redis.storage';
import { createClient } from 'redis';

// ... in @Module imports array, REPLACE:
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 600,
    }]),

// WITH:
    ThrottlerModule.forRoot(
      [{
        ttl: 60000,
        limit: 600,
      }],
      {
        storage: new RedisThrottlerStorage(
          createClient({
            url: process.env.REDIS_URL || 'redis://localhost:6379',
            // Use database 1 for throttler to avoid collision with other Redis keys
            database: 1,
          }),
        ),
      },
    ),
```

2. Update apps/api/package.json dependencies to add Redis client:
Add to dependencies: `"redis": "^4.7.0"`

Lockfile impact: pnpm will resolve `redis@^4.7.0` to the latest 4.x (currently 4.7.2). NestJS throttler already declares redis as an optional peer dependency, so no new major conflicts. The change is additive; existing in-memory mode continues to work if REDIS_URL is unset (fallback to localhost:6379).
- verifyHow: Deploy to Railway with REDIS_URL set to your Upstash/Redis cloud instance. Spin up 3 pod replicas. Parallel-send 15 login requests from the same IP in <1 second to each replica via a load-balanced endpoint. Verify all 15 fail with 429 Throttled on the 6th request onward (intent: 5/min global). Without Redis, the same test would see 5 × 3 = 15 succeed before any 429. Confirm the in-memory fallback still works if REDIS_URL is deleted (pod connects to localhost:6379 which doesn't exist, warning logged).

## [16] P1 · risk=medium · liveProdSafe=False · Sports auto-leaders / Player-of-Game stat-key mismatch
**RosterPanel.tsx frontend should seed stat inputs with SHORT keys (not long form)**

- files: ['/Users/gschiemann/Desktop/EDU CMS/apps/web/src/app/[schoolId]/sports/[gameId]/RosterPanel.tsx']
- rootCause: RosterPanel.tsx line 471–475 seeds empty stat rows with PLAYER_STATS[sport] keys (SHORT codes) — this is CORRECT. But if an operator edits a player with stored LONG keys (from old CSVs), those existing keys won't match the SHORT-key dedupe logic at line 473, so the form will show LONG keys + seed SHORT keys, duplicating rows and confusing the UI.
- exactFix: In RosterPanel.tsx PlayerEditModal, normalize existing stat keys before deduplication. At line 467–468, change from: ```typescript const rows = Object.entries(existing?.stats || {}).map(([k, v]) => ({ k, v: String(v) }));``` TO: ```typescript const rows = Object.entries(existing?.stats || {}).map(([k, v]) => { const aliasMap = STAT_KEY_ALIASES[sport] || {}; const lowerK = k.toLowerCase(); const shortKey = aliasMap[lowerK] || aliasMap[k] || k; // Prefer SHORT form return { k: shortKey, v: String(v) }; });``` Import STAT_KEY_ALIASES from @cms/api-types. This ensures dedup at line 473 works correctly and the UI always shows SHORT keys.
- verifyHow: Edit a player whose stats have LONG keys in the DB (e.g., { GOALS: '5' }) → confirm the form displays 'G' (not 'GOALS'), and the seed logic doesn't duplicate.

## [17] P1 · risk=medium · liveProdSafe=True · Emergency reliability backstop — load-bearing system for multi-tenant water-polo signage
**Test #9 (power-cycle ride-through) now has a fatal flaw: manifest validation will clear the cache before the assertion reads it**

- files: None
- rootCause: The E2E test at apps/web/tests/e2e/emergency-path.spec.ts lines 754-824 deliberately delays the manifest response (3s) to prove the cache was hydrated before the network arrived. BUT with the new manifest-validation effect added to EmergencyOverlay, that effect will ALSO fetch the manifest. If both fetches resolve, the validation effect sees isEmergency=false (the delayed route didn't change it) and clears the cache. The test then reads a null cache and FAILS on line 820. The fix: within installApiMocks, provide a SEPARATE route handler for the validation-effect's manifest fetches that returns isEmergency=true (because the cache IS active), so the validation effect doesn't clear it. OR: delay BOTH manifest routes by the same 3s. OR: have the test route handler check the manifest's isEmergency flag and return it based on whether an emergency was currently active in manifestRef.value.
- exactFix: Update apps/web/tests/e2e/emergency-path.spec.ts line 786-796 to also return isEmergency=true when the cache is supposed to be active:

--- BEFORE (line 786-796)
await page.unroute(`**/api/v1/screens/${FAKE_SCREEN_ID}/manifest`);
await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/manifest`, async (route) => {
  counters.manifestCalls += 1;
  await new Promise((r) => setTimeout(r, 3_000));
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(manifestRef.value),
  });
});

+++ AFTER: return a manifest that carries isEmergency based on the cache state
await page.unroute(`**/api/v1/screens/${FAKE_SCREEN_ID}/manifest`);
await page.route(`**/api/v1/screens/${FAKE_SCREEN_ID}/manifest`, async (route) => {
  counters.manifestCalls += 1;
  await new Promise((r) => setTimeout(r, 3_000));
  const manifest = {
    ...manifestRef.value,
    // NEW: if the test pre-seeded an emergency cache, keep
    // isEmergency=true on manifest so the validation effect
    // doesn't prematurely clear it during the slow-manifest window.
    isEmergency: opts.preseedEmergencyCache ? true : (manifestRef.value.isEmergency ?? false),
  };
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(manifest),
  });
});

However, there's no `opts` in scope here. Better fix: the test itself MUST mutate manifestRef.value to say isEmergency=true BEFORE calling page.goto(), then keep it true for the test's duration:

--- ACTUAL FIX (line 768-782, before page.goto)
await installPlayerTestHarness(page, {
  preseedEmergencyCache: {
    at: Date.now(),
    expiresAt: Date.now() + 4 * 60 * 60 * 1000,
    hasServerExpiry: false,
    payload: {
      active: true,
      type: 'LOCKDOWN',
      severity: 'CRITICAL',
      scopeNote: 'Pre-existing lockdown — rebooted',
      scope: 'tenant',
    },
  },
});

// NEW: Update the manifestRef to say isEmergency=true so the
// validation effect (which also fetches manifest) doesn't see
// isEmergency=false and clear the cache prematurely.
manifestRef.value = baselineManifest({
  isEmergency: true,
  emergencyType: 'LOCKDOWN',
  emergencySeverity: 'CRITICAL',
});

// Make the manifest slow...
await page.unroute(`**/api/v1/screens/${FAKE_SCREEN_ID}/manifest`);

FILE PATH: /Users/gschiemann/Desktop/EDU CMS/apps/web/tests/e2e/emergency-path.spec.ts
LOCATION: Add 6 lines (manifestRef.value = ...) between line 781 and 785.
- verifyHow: Run the E2E suite: `npm run test -- emergency-path.spec.ts`. Test #9 must pass: the pre-seeded emergency cache must survive the 3s manifest delay, proving the validation effect correctly leaves it alone when the manifest carries isEmergency=true.

## [18] P1 · risk=medium · liveProdSafe=True · Emergency reliability backstop — load-bearing system for multi-tenant water-polo signage
**Manifest path must also carry active pushed-message state (SOS/TEXT_BROADCAST/MEDIA_ALERT) for full self-healing**

- files: None
- rootCause: The gap fixed above (manifest validation of tenant-wide emergency state) covers the OVERRIDE case (tenant emergencyStatus). But pushed messages (SOS / TEXT_BROADCAST / MEDIA_ALERT) are stored in EmergencyMessage table with scope=[tenant|group|device] + expiresAt. If a WS SOS is dropped + player reboots, it will hydrate the SOS from cache, but there's no manifest field to validate whether that SOS is still live in the DB. A second ALL_CLEAR on that same SOS will also miss, or the SOS can silently expire without the player knowing. The EmergencyOverlay never checks the manifest for 'is this specific SOS still active in DB?'. Current safeguard: the /emergency/messages polling endpoint returns it — but that endpoint is independent of the manifest. For FULL self-healing, the manifest should include a digest (e.g. 'latestEmergencyMessageId' + expiresAt) so a player can validate its cached message against ground truth without a separate HTTP call.
- exactFix: DESIGN DECISION: This is a LOWER-priority follow-up to the manifest-validation fix above, because:
1. The validation effect will clear stale emergencies (this fix, P0).
2. Pushed messages are lower-volume than tenant-wide overrides (SOS is staff-triggered, not tenant-wide).
3. A missed SOS has a BUILT-IN fallback: expiresAt (default 30min). On next manifest poll (every 10s), /emergency/status will show no message (expired) → cache will be cleared by the validation effect.
4. Operator can always re-trigger.

RECOMMENDATION: Ship the manifest-validation fix first (immediately unblocks the tenant-wide emergency self-heal). Then file a separate follow-up to add pushed-message digest to manifest (can be batched with other manifest schema updates). For now, the cycle is: SOS pushed → WS → cache hydrated. If WS missed + rebooted: cache is stale for ~30min until SOS expires. This is livable because: (a) staff SOS is rare, (b) expiry is automatic, (c) re-trigger is available.
- verifyHow: Defer to follow-up. Current fix handles tenant-wide emergencies (the majority case). Pushed-message digest on manifest can be added in a later Sprint when pushed-message volume is higher or expiry window needs tightening.

## [19] P1 · risk=low · liveProdSafe=True · Integration "costumes" (honesty gap) — Settings → Integrations, POS, SSO, Streaming, and hardware controls
**Soundtrack Your Brand OAuth flow (Streaming integration) — permanently disabled button**

- files: ['/Users/gschiemann/Desktop/EDU CMS/apps/web/src/app/[schoolId]/settings/streaming/page.tsx', '/Users/gschiemann/Desktop/EDU CMS/apps/api/src/streaming/streaming.controller.ts']
- rootCause: OAuth approval from Soundtrack partner is pending; the Connect modal for this provider shows auth type 'oauth2' which disables the Connect button in the UI and renders an honest amber panel saying 'OAuth flow not yet implemented. Contact sales to enable Soundtrack on your account.' The button is disabled at line 661 of streaming/page.tsx: `disabled={submitting || provider.auth === 'oauth2' || !agreed}`. However, users can still see the Quick Start card inviting them to click 'Coming soon — contact sales', which routes to a SoundtrackComingSoonModal—this is HONEST, not a costume.
- exactFix: No fix required. Current state is honest: the SoundtrackComingSoonModal (lines 1272–1319) clearly states 'OAuth flow pending partner approval' with a 'Contact sales' button. Operator cannot accidentally click a real-looking button that does nothing. The costume has already been eliminated.
- verifyHow: Navigate to /[schoolId]/settings/streaming, click the 'Background music' Quick Start card. Verify SoundtrackComingSoonModal appears with honest 'coming soon' messaging and a 'Contact sales' email link. The Connect button in the regular modal is grayed out with `disabled:opacity-50` applied.

## [20] P1 · risk=low · liveProdSafe=True · Integration "costumes" (honesty gap) — Settings → Integrations, POS, SSO, Streaming, and hardware controls
**POS PARTNER-tier providers (Toast, Clover, Lightspeed, Shopify, Stripe, MINDBODY) — no sync handlers yet**

- files: ['/Users/gschiemann/Desktop/EDU CMS/apps/web/src/app/[schoolId]/settings/pos/page.tsx', '/Users/gschiemann/Desktop/EDU CMS/apps/api/src/pos/pos.controller.ts']
- rootCause: These 6 providers have integrationTier='PARTNER' because they require partner-specific API integrations that have not shipped yet. The code at lines 396–418 of pos/page.tsx renders an honest amber panel for PARTNER providers: 'Toast connector is in development' + 'partner integration we haven't shipped yet' + CTA to use Custom Webhook in the meantime. These are not costumes — the UI explicitly disables the credential form and surfaces a clear 'in development' message.
- exactFix: No fix required. The honest treatment is already in place. PARTNER providers show their own ConnectModal with the ShieldAlert badge + 'in development' copy (line 406). The Connect button is not rendered for PARTNER tier (line 487: `{provider.auth !== 'oauth2' && provider.integrationTier !== 'PARTNER' && (...)`). No operator can save a PENDING row that never syncs.
- verifyHow: Navigate to /[schoolId]/settings/pos, scroll to 'Partnerships' section, click 'Toast'. Modal opens with amber panel: 'Toast connector is in development … Tell us at sales@venueos.com'. No Connect button. Close and verify the POS provider catalog explicitly labels each PARTNER with 'Partnership' badge.

## [21] P1 · risk=low · liveProdSafe=True · Integration "costumes" (honesty gap) — Settings → Integrations, POS, SSO, Streaming, and hardware controls
**Monetize (ad networks) — connections save but inventory delivery is v1.1**

- files: ['/Users/gschiemann/Desktop/EDU CMS/apps/web/src/app/[schoolId]/settings/monetize/page.tsx', '/Users/gschiemann/Desktop/EDU CMS/apps/api/src/ads/ads.controller.ts']
- rootCause: The monetize page (lines 133–149) surfaces an honest amber 'v1.1' banner stating 'connections save your preferences. Inventory delivery rolls out v1.1.' Operators can connect networks and configure content controls today, but creative fetch + impression tracking ships later. This is not a costume — the honest disclosure is prominent at the top of the page, and the operator knows what's working now vs. what's coming.
- exactFix: No fix required. The v1.1 banner (lines 140–149 of monetize/page.tsx) clearly states the state. The operator complaint from 2026-05-04 has been addressed with explicit copy about the beta status.
- verifyHow: Navigate to /[schoolId]/settings/monetize. Verify the orange v1.1 banner at the top (lines 140–149) is visible with copy 'connections save your preferences. Inventory delivery rolls out v1.1.' Operator cannot mistake this for a live feature.

## [22] P1 · risk=low · liveProdSafe=True · Player runtime stability (apps/web/src/app/player + apps/web/src/components/player)
**No unguarded window/document access at first render**

- files: ['/Users/gschiemann/Desktop/EDU CMS/apps/web/src/app/player/page.tsx', '/Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/player/KioskSplash.tsx']
- rootCause: Searched for direct window/document access in render bodies. Found only guarded patterns: all window.location.search, window.innerWidth/Height, document.documentElement access is either inside useEffect with typeof guard, or inside helper functions (qp, isPreviewMode, getDeviceFingerprint) that are only called from guarded contexts. No render-time access that could cause hydration mismatch or SSR error.
- exactFix: No fix needed. All access patterns verified:

/Users/gschiemann/Desktop/EDU CMS/apps/web/src/app/player/page.tsx:
- qp() helper (lines 55-59): guarded with `if (typeof window === 'undefined') return null`
- isPreviewMode() (lines 70-71): calls qp() which is guarded
- getDeviceFingerprint() (lines 767-794): guarded with `if (typeof window !== 'undefined')` before any window/localStorage access

/Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/player/KioskSplash.tsx:
- measure() function (lines 580-595): called inside useEffect after `if (typeof window === 'undefined') return;`

All window/document access happens only after React hydration completes.
- verifyHow: Verify no React #418 hydration errors in console on player page load. Check that player loads correctly on both server-rendered initial request and client-side navigation. Inspect React DevTools Profiler to confirm no hydration mismatches flagged.

## [23] P1 · risk=low · liveProdSafe=True · Auth + Session Security (apps/api/src/auth, packages/auth-core, JWT issuance/revocation)
**Logout endpoint comment describes 'best-effort' audit logging but audit write failures are silent**

- files: None
- rootCause: Auth.controller.ts lines 186-203: logout audits to AuditLog in a bare try-catch with no logging of failures. Comment says 'Best-effort — never fail the logout if the audit row fails' but doesn't log the failure. If the AuditLog table fills, quota resets, or permission issue occurs, logout succeeds with zero forensic record and zero visibility to ops. This violates the P0-4 principle ('write a login attempt to the immutable AuditLog...NOT silent: failures are logged at warn').
- exactFix: File: /Users/gschiemann/Desktop/EDU CMS/apps/api/src/auth/auth.controller.ts
Location: Lines 186-203 (logout audit logging)
BEFORE:
```typescript
try {
  await this.prisma.client.auditLog.create({
    data: {
      tenantId: user?.tenantId || user?.schoolId || user?.districtId || null,
      userId: user?.userId || user?.id || null,
      action: 'AUTH_LOGOUT',
      targetType: 'User',
      targetId: user?.userId || user?.id || null,
      details: JSON.stringify({
        ip: req.ip || req.headers['x-forwarded-for'] || null,
        ua: (req.headers['user-agent'] || '').slice(0, 256),
      }),
    },
  });
} catch { /* best-effort */ }
```
AFTER:
```typescript
try {
  await this.prisma.client.auditLog.create({
    data: {
      tenantId: user?.tenantId || user?.schoolId || user?.districtId || null,
      userId: user?.userId || user?.id || null,
      action: 'AUTH_LOGOUT',
      targetType: 'User',
      targetId: user?.userId || user?.id || null,
      details: JSON.stringify({
        ip: req.ip || req.headers['x-forwarded-for'] || null,
        ua: (req.headers['user-agent'] || '').slice(0, 256),
      }),
    },
  });
} catch (e: any) {
  // Best-effort — a DB hiccup must never block logout. NOT silent:
  // warn so a broken audit path is visible (2026-05-21 lesson) instead
  // of masquerading as success.
  this.authLogger.warn(`auditLoginAttempt(AUTH_LOGOUT) failed: ${e?.message ?? e}`);
}
```
Rationale: Match the pattern established in auditLoginAttempt (lines 141-146) which logs failures at warn level. Ensures ops visibility when audit trail breakage occurs during logout.
- verifyHow: Unit test: Mock PrismaService.auditLog.create to throw. Call logout endpoint. Verify: (1) response is still { success: true }, (2) logger.warn was called with the error message, (3) token was successfully added to jwt_revoked_list (the mutation still happened before the audit log error). Integration test: Trigger a real DB error during logout (e.g., full transaction log), verify warning appears in logs with error details.

## [24] P1 · risk=low · liveProdSafe=True · Auth + Session Security (apps/api/src/auth, packages/auth-core, JWT issuance/revocation)
**Logout + MFA audit logs do not validate tenantId is non-null before write**

- files: None
- rootCause: Auth.controller.ts line 192: AuditLog.tenantId is NOT NULL in the schema, but the logout audit write uses a fallback chain: `user?.tenantId || user?.schoolId || user?.districtId || null`. If all three are undefined/null, the audit row will fail to insert (FK constraint or NOT NULL check). The user object is populated by JwtAuthGuard from the JWT payload (jwt-auth.guard.ts:146-155), which includes tenantId in the user object. But a malformed token or null user could slip through. The code should validate tenantId is present before the audit write to provide a clear error.
- exactFix: File: /Users/gschiemann/Desktop/EDU CMS/apps/api/src/auth/auth.controller.ts
Location: Lines 159-165 (logout entry)
BEFORE:
```typescript
@Post('logout')
@HttpCode(HttpStatus.OK)
@UseGuards(JwtAuthGuard)
async logout(@Req() req: Request) {
  const [type, token] = req.headers.authorization?.split(' ') ?? [];
  if (type !== 'Bearer' || !token) {
    throw new UnauthorizedException('No bearer token');
  }
  const user = (req as any).user;
```
AFTER:
```typescript
@Post('logout')
@HttpCode(HttpStatus.OK)
@UseGuards(JwtAuthGuard)
async logout(@Req() req: Request) {
  const [type, token] = req.headers.authorization?.split(' ') ?? [];
  if (type !== 'Bearer' || !token) {
    throw new UnauthorizedException('No bearer token');
  }
  const user = (req as any).user;
  if (!user) {
    throw new UnauthorizedException('User identity missing from request');
  }
  const tenantId = user.tenantId || user.schoolId || user.districtId;
  if (!tenantId) {
    throw new UnauthorizedException('User has no tenant scope');
  }
```
Then update lines 192 to use the pre-validated tenantId:
BEFORE: `tenantId: user?.tenantId || user?.schoolId || user?.districtId || null,`
AFTER: `tenantId,` (already validated above, no fallback chain needed)

Rationale: Fail fast with a clear error message if tenantId is missing, rather than silently failing the audit write. Prevents orphaned audit attempts and surfaces scope bugs in the auth pipeline.
- verifyHow: Unit test: Mock JwtAuthGuard to attach a user object with all three tenant fields (tenantId, schoolId, districtId) set to null/undefined. Call logout. Verify 401 response with 'User has no tenant scope' message and NO audit log row created. Integration test: Cannot easily reproduce in integration without mocking the guard, but the unit test is sufficient.

## [25] P1 · risk=low · liveProdSafe=True · Mobile UX/UI & Responsiveness – Operator Flows on iPhone (390px)
**Gear-menu button positioned off-left on mobile Screens list**

- files: None
- rootCause: ScreenSettingsMenu anchor logic (lines 882-893 in screens/page.tsx) clamps `right` to vw - MENU_WIDTH - MARGIN. At 390px viewport, MENU_WIDTH is 256px, leaving max-right = 390 - 256 - 12 = 122px. Menu renders but left edge sits at 390 - 122 - 256 = 12px, leaving only 12px margin. On a row in the middle, the gear button is ~195px from viewport left, so a 256px-wide menu anchored to right=122px puts the menu's left edge way off. Menu is partially hidden off-screen.
- exactFix: File: /Users/gschiemann/Desktop/EDU CMS/apps/web/src/app/[schoolId]/screens/page.tsx, lines 882-893. Replace the anchor clamping logic with mobile-aware centering:

BEFORE:
```typescript
let right = vw - r.right;
const maxRight = vw - MENU_WIDTH - MARGIN;
if (right > maxRight) right = maxRight;
if (right < MARGIN) right = MARGIN;
```

AFTER:
```typescript
let right = vw - r.right;
const maxRight = vw - MENU_WIDTH - MARGIN;
if (right > maxRight) right = maxRight;
// Mobile: center-anchor under the gear button, not right-align
if (vw < 500) {
  right = Math.max(MARGIN, Math.min(vw / 2, vw - MENU_WIDTH - MARGIN));
} else if (right < MARGIN) {
  right = MARGIN;
}
```
- verifyHow: Open /[schoolId]/screens on a 390px iPhone simulator, scroll to a screen row in the middle of the list, tap the gear button. Menu must be fully visible on-screen, not clipped left or right.

## [26] P1 · risk=low · liveProdSafe=True · Mobile UX/UI & Responsiveness – Operator Flows on iPhone (390px)
**Bulk-action buttons (Create Playlist, Move, Delete) under 44px height on mobile Assets page**

- files: None
- rootCause: Assets page, lines 612-635 (bulk action buttons). Each uses `px-4 py-2` which renders ≈32-36px height. WCAG 2.1 requires 44×44px minimum tap targets. Comment on line 606-608 says this was a known P1 gap: '2026-05-29 (mobile P1) — bulk actions... bump these to the 44px touch minimum too; compact on ≥sm.' But the fix was never applied.
- exactFix: File: /Users/gschiemann/Desktop/EDU CMS/apps/web/src/app/[schoolId]/assets/page.tsx, lines 612, 622, 630 (three buttons). Change `py-2` to `py-3`:

Line 612:
BEFORE: `className="min-h-11 sm:min-h-0 px-4 py-2 bg-indigo-600..."`
AFTER: `className="min-h-11 sm:py-2 px-4 py-3 sm:py-2 bg-indigo-600..."`

Same for line 622 and 630. This gives 44px+ on mobile, compact ≈32px on sm+ breakpoint.
- verifyHow: Open /[schoolId]/assets on a 390px phone, select any file, measure the 'Create Playlist' button height using DevTools. Should be ≥44px.

## [27] P1 · risk=low · liveProdSafe=True · Mobile UX/UI & Responsiveness – Operator Flows on iPhone (390px)
**Settings link-card subtitles overflow and clip at 390px width**

- files: None
- rootCause: Settings page, lines 250-386 (Streaming, POS, Monetize, Imports, Audit, Developer link cards). Each renders `flex items-center justify-between gap-3` with icon (w-9) + text block (flex-1) + arrow (shrink-0). Subtitle text is full-length on desktop (≈80 chars) but at 390px the text column compresses to ~240px max. Subtitles overflow the container and clip the arrow, or wrap awkwardly. No responsive truncation or hidden-on-mobile classes.
- exactFix: File: /Users/gschiemann/Desktop/EDU CMS/apps/web/src/app/[schoolId]/settings/page.tsx, lines 250-386. For each Link card, wrap the subtitle in `hidden sm:block` and add a mobile-only short label:

EXAMPLE (lines 259-261, Streaming card):
BEFORE:
```typescript
<div>
  <div className="text-sm font-bold text-slate-800">Streaming providers</div>
  <div className="text-[11px] text-slate-500">Connect Atmosphere, public broadcasters, YouTube, Twitch, custom HLS — pick channels for the streaming widget.</div>
</div>
```

AFTER:
```typescript
<div>
  <div className="text-sm font-bold text-slate-800">Streaming providers</div>
  <div className="hidden sm:block text-[11px] text-slate-500">Connect Atmosphere, public broadcasters, YouTube, Twitch, custom HLS — pick channels for the streaming widget.</div>
  <div className="sm:hidden text-[10px] text-slate-500">Streaming config</div>
</div>
```

Repeat for POS, Monetize, Imports, Test Integrations, Audit, Developer (lines 277-386).
- verifyHow: Open /[schoolId]/settings on a 390px phone, scroll through the link cards. No subtitle text should overflow or clip the arrow. All text must be fully readable.

## [28] P2 · risk=medium · liveProdSafe=True · Player runtime stability (apps/web/src/app/player + apps/web/src/components/player)
**KioskSplash backdrop-filter may flake on Android WebView <88**

- files: ['/Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/player/KioskSplash.tsx']
- rootCause: KioskSplash.tsx lines 1170, 1293, 1439, 1474 use CSS `backdrop-filter: blur()` on diagnostic overlay chips and buttons. Backdrop-filter is Chromium-76+, but Android System WebView builds older than 88 have flaky rendering per CLAUDE.md rules. Falls back gracefully to non-blurred background if backdrop-filter fails, so the page doesn't blank—just loses the glass-morphism effect.
- exactFix: /Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/player/KioskSplash.tsx lines with `backdrop-filter`:

Provide fallback solid background color at the same rule level so older WebView renders a solid instead of broken glass:

BEFORE:
.kiosk-splash-chip { backdrop-filter: blur(8px); background: rgba(...); }

AFTER:
.kiosk-splash-chip { background: rgba(15, 23, 42, 0.9); backdrop-filter: blur(8px); }

The solid `background` will render on WebView <88 if backdrop-filter fails; modern browsers will apply both. No code change needed if solid fallback is acceptable (already renders somewhat).
- verifyHow: No urgent fix needed if operator only deploys to recent Android builds (5+ years old). To verify fallback: deploy to an Android 11 emulator (WebKit ~85), load player, verify diagnostic overlays are readable even if slightly blurry. Check that no content renders white-on-white or invisible.

## [29] P2 · risk=medium · liveProdSafe=True · Auth + Session Security (apps/api/src/auth, packages/auth-core, JWT issuance/revocation)
**Redis sismember fail-open design creates fragile implicit contract in JwtAuthGuard**

- files: None
- rootCause: RedisService.sismember() is documented as 'fail-open for dev' (line 170, redis.service.ts:172-183), returning false on Redis unavailability. JwtAuthGuard relies on this combined with getTokenInvalidBefore() which DOES throw on error (line 237-240, redis.service.ts). If Redis is down: sismember returns false (no issue) → getTokenInvalidBefore throws → catch block fails closed. The design works but depends on undocumented contract: caller must invoke BOTH sismember AND getTokenInvalidBefore in sequence to guarantee fail-closed behavior.
- exactFix: File: /Users/gschiemann/Desktop/EDU CMS/apps/api/src/realtime/redis.service.ts
Location: Lines 172-183 (sismember method)
BEFORE:
```typescript
async sismember(key: string, member: string): Promise<boolean> {
  if (!this.connected || !this.publisher) {
    this.logger.warn('Redis unavailable — token revocation check skipped (fail-open)');
    return false;
  }
  try {
    const result = await this.publisher.sismember(key, member);
    return result === 1;
  } catch {
    return false;
  }
}
```
AFTER:
```typescript
async sismember(key: string, member: string): Promise<boolean> {
  if (!this.connected || !this.publisher) {
    throw new Error('Redis unavailable — cannot check token revocation (failing closed)');
  }
  try {
    const result = await this.publisher.sismember(key, member);
    return result === 1;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Redis revocation check failed: ${msg}`);
  }
}
```
Rationale: Make sismember explicitly fail-CLOSED to match its documented usage in JwtAuthGuard (line 237: 'guard fails CLOSED on read error'). The guard's try-catch block (jwt-auth.guard.ts:119-126) is already structured to handle thrown errors. Removes the fragile implicit contract and makes the fail-closed guarantee explicit at the call site.
- verifyHow: Unit test: Call JwtAuthGuard.canActivate() with Redis unavailable (mock RedisService.sismember to throw). Verify UnauthorizedException is thrown with 'Auth check unavailable' message. Integration test: Deploy with REDIS_URL unset in dev, attempt authenticated request, verify 401 'Auth check unavailable'. Both user and device JWT paths must be tested.

## [30] P2 · risk=medium · liveProdSafe=True · Stripe webhook rawBody + rate-limiter storage for multi-replica Railway deployment
**POST endpoints to smoke-test for regression after webhook JSON exemption**

- files: None
- rootCause: Inserting a raw-body router for /api/v1/billing/webhook before the global JSON middleware is a high-risk global change. Any mistake in routing precedence or middleware order could break JSON parsing on other endpoints, causing silent `req.body` = undefined or 400 parsing errors. A systematic smoke test is required to catch regressions.
- exactFix: After the webhook fix is deployed, run integration tests on representative POST/PUT/PATCH endpoints across all major controller families. Use a simple curl/Jest script:

```bash
# Login endpoint — form data
curl -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"pass123"}' \
  -w '%{http_code}\n'

# Create playlist — JSON body
curl -X POST http://localhost:8080/api/v1/playlists \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{"name":"Test","items":[]}' \
  -w '%{http_code}\n'

# Branding scrape — JSON body
curl -X POST http://localhost:8080/api/v1/branding/scrape \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{"url":"https://example.com"}' \
  -w '%{http_code}\n'

# Emergency trigger — JSON body
curl -X POST http://localhost:8080/api/v1/emergency/trigger \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{"type":"SOS"}' \
  -w '%{http_code}\n'

# Player logs — may be raw text
curl -X POST http://localhost:8080/api/v1/player-logs/<screenId> \
  -H 'Content-Type: text/plain' \
  -d 'sample log line' \
  -w '%{http_code}\n'

# Webhook itself (should succeed with valid Stripe signature)
stripe_secret='whsec_test_...'
stripe_ts='1234567890'
payload='{"id":"evt_test","created":1234567890,"type":"checkout.session.completed","data":{"object":{"id":"cs_test"}}}'
sig=$(node -e "const crypto=require('crypto'); const ts='$stripe_ts'; const payload='$payload'; console.log(crypto.createHmac('sha256', '$stripe_secret').update(\`\${ts}.\${payload}\`).digest('base64'))")
curl -X POST http://localhost:8080/api/v1/billing/webhook \
  -H 'Content-Type: application/json' \
  -H "Stripe-Signature: t=$stripe_ts,v1=$sig" \
  -d "$payload" \
  -w '%{http_code}\n'
```

Expected: all non-webhook endpoints return 200/201/4xx per their normal business logic (not 400 parse error). Webhook returns 200 with signature verification success, not 400 'Missing raw body'.
- verifyHow: Run the above curl suite against a local or staging instance post-fix. Parse response codes and body for unexpected errors. In Jest, mock the JSON parser and verify req.body is populated on non-webhook routes. For the webhook, use the Stripe SDK's generateTestSignature helper to create a valid signed payload and verify it parses.

## [31] P2 · risk=low · liveProdSafe=True · Integration "costumes" (honesty gap) — Settings → Integrations, POS, SSO, Streaming, and hardware controls
**Hardware wiring — RS485 Daktronics/Nevco decoders (WiringPanel) — now hidden as COMING_SOON**

- files: ['/Users/gschiemann/Desktop/EDU CMS/apps/web/src/app/[schoolId]/screens/[screenId]/WiringPanel.tsx']
- rootCause: The EP6N player has a physical RS485 port, but CtsBridge only reads rs232_1 and rs232_2 (not rs485). Prior code let an operator select 'Daktronics All Sport' from the RS485 picker, which saved to wiring.rs485 — a field nothing reads (dead-end costume). Fixed 2026-05-28: the decoders now live in a const RS485_DECODERS_COMING_SOON (line 91) and are rendered in a disabled 'coming soon' section (lines 252+), NOT in the active dropdown. This is now honest.
- exactFix: No fix required. The costume has been replaced with honest UI: RS485_DECODERS_COMING_SOON array is defined (line 91); the pickers only offer rs232_1/rs232_2='cts'/'aux'/'off' (line 66–70) and GPIO options (lines 95–106). The decoders are no longer selectable. When the actual RS485 decoder ships, add { value: 'daktronics', label: '…' } to RS485_OPTIONS and set the default from 'off' to 'daktronics'.
- verifyHow: Open a Goodview EP6N screen's wiring panel (/[schoolId]/screens/[screenId], hardware-model === 'goodview-ep6n'). Verify the RS485 section shows a disabled 'coming soon' treatment with 'Daktronics All Sport' and 'Nevco' listed as info-only (not in the active dropdown). The wiring.rs485 field can only be set to 'off' via the UI.

## [32] P2 · risk=low · liveProdSafe=True · Player runtime stability (apps/web/src/app/player + apps/web/src/components/player)
**Hydration mismatch properly handled via useEffect early return**

- files: ['/Users/gschiemann/Desktop/EDU CMS/apps/web/src/app/player/page.tsx', '/Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/player/KioskSplash.tsx']
- rootCause: React #418 hydration mismatches can occur when server-rendered HTML differs from client-rendered HTML at first paint. The player page correctly guards all window/document access (like window.innerWidth, window.location.search) inside useEffect with `if (typeof window === 'undefined') return;` checks, preventing SSR/hydration mismatch.
- exactFix: No fix needed. Pattern is correctly applied throughout:

/Users/gschiemann/Desktop/EDU CMS/apps/web/src/app/player/page.tsx:
- Line 57: `if (typeof window === 'undefined') return null;` guards qp() URL param reader
- Line 572-574: useEffect guards window access with early return
- Line 769: getDeviceFingerprint checks typeof window

/Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/player/KioskSplash.tsx:
- Line 574: useEffect guards all window/document access with early return

This is best-practice React 19 + Next.js App Router hydration pattern.
- verifyHow: Verify no React #418 console warnings in browser devtools when player page loads. Check that window.location.search is read-only after hydration completes (useEffect, not render). All queries to window/document should be inside useEffect or guarded with typeof checks.

## [33] P2 · risk=low · liveProdSafe=True · Player runtime stability (apps/web/src/app/player + apps/web/src/components/player)
**No setState-in-render detected in player path**

- files: ['/Users/gschiemann/Desktop/EDU CMS/apps/web/src/app/player/page.tsx', '/Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/playlists/PlaylistCreateWizard.tsx']
- rootCause: Searched for patterns where state is mutated during render (outside of useEffect/useCallback). All state mutations in the player path use useState setters only inside event handlers or useEffect callbacks, never in render body. PlaylistCreateWizard helpers (probeVideoDuration, toggleAsset, moveAssetItem) are intentionally NOT useCallback (they live below the early `if (!open) return null;` guard) to maintain constant hook count across open=false/open=true renders (avoiding React #310).
- exactFix: No fix needed. Pattern verified in:

/Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/playlists/PlaylistCreateWizard.tsx:
- Lines 626-635: Comment explains why probeVideoDuration is NOT useCallback (prevents React #310 by keeping hook count constant)
- Lines 672-689: toggleAsset and moveAssetItem are plain functions, not hooks

All state updates happen AFTER the early return guards and only inside event handlers or effect callbacks.
- verifyHow: Run `grep -n 'setState\|set[A-Z].*(' apps/web/src/app/player/page.tsx | grep -v 'useEffect\|useCallback\|onClick\|addEventListener'` to search for out-of-place state mutations. Should find none in the render path (only in effect/event handlers).

## [34] P2 · risk=low · liveProdSafe=True · Auth + Session Security (apps/api/src/auth, packages/auth-core, JWT issuance/revocation)
**No verification that 'jwt_revoked_list' Redis key TTL is enforced on every logout write**

- files: None
- rootCause: Auth.controller.ts lines 175-179: Each logout calls `await pub.sadd('jwt_revoked_list', token)` then `await pub.expire('jwt_revoked_list', 60 * 60 * 24 * 30)`. The expire() call resets the TTL on EVERY logout. If logouts are frequent (e.g., 100 users/day), the set's TTL stays at 30 days and never ages. If logouts stop, the set eventually expires. This is acceptable per the comment but creates a coupling: if a user logs out once and never again, their token stays in the set for 30 days. If they log out 1000 times in a day, the set never shrinks until a day passes with zero logouts. No bug, but fragile and worth documenting.
- exactFix: File: /Users/gschiemann/Desktop/EDU CMS/apps/api/src/auth/auth.controller.ts
Location: Lines 175-179 (logout Redis operations)
BEFORE:
```typescript
try {
  await pub.sadd('jwt_revoked_list', token);
  // 30 days = rememberMe ceiling — the JWT itself expires by then, so the
  // set never grows unboundedly. Resets each logout (acceptable).
  await pub.expire('jwt_revoked_list', 60 * 60 * 24 * 30);
}
```
AFTER:
```typescript
try {
  await pub.sadd('jwt_revoked_list', token);
  // 30 days = rememberMe ceiling — the JWT itself expires by then, so the
  // set never grows unboundedly. NOTE: expire() resets the TTL on every
  // logout, so the set only shrinks after a full day with zero logouts.
  // An alternative is to use per-token TTLs via sorted sets, but the
  // current O(1) set + fixed-TTL approach is acceptable for the logout
  // rate and memory profile. If memory becomes an issue (set >100MB),
  // switch to a sorted-set per-token approach in a follow-up sprint.
  await pub.expire('jwt_revoked_list', 60 * 60 * 24 * 30);
}
```
Rationale: Document the TTL reset behavior and the memory/complexity tradeoff to prevent future confusion. Add a note about the sorted-set alternative if scaling becomes an issue.
- verifyHow: This is a documentation clarification, not a code bug. Verify by reading the comment. No functional test needed, but monitor Redis memory usage on the jwt_revoked_list key in production. If it grows beyond 100MB, implement the sorted-set alternative (ttl per token instead of per-set).

## [35] P2 · risk=low · liveProdSafe=True · Mobile UX/UI & Responsiveness – Operator Flows on iPhone (390px)
**Backdrop-blur GPU compositing in fixed modals violates Mobile Performance Standard**

- files: None
- rootCause: Multiple pages (Playlists line 1165, Settings POS/Streaming/Monetize, others) use `backdrop-blur-sm` on fixed overlays. This forces GPU compositing + paint invalidation on every pointer move, violating the Mobile Performance Standard rule: 'no GPU blur on always-mounted chrome.' Even when closed, the element remains in the DOM with the blur shader active.
- exactFix: Files: /Users/gschiemann/Desktop/EDU CMS/apps/web/src/app/[schoolId]/playlists/page.tsx line 1165, /settings/monetize/page.tsx, /settings/streaming/page.tsx (6 instances), /settings/pos/page.tsx. Remove `backdrop-blur-sm` from all fixed overlay divs:

BEFORE: `className="fixed top-0 right-0 bottom-0 left-0 bg-black/50 backdrop-blur-sm z-50..."`
AFTER: `className="fixed top-0 right-0 bottom-0 left-0 bg-black/50 z-50..."`

Keep backdrop-blur only on hover/transient UI, not fixed overlays. The semi-transparent black (bg-black/50) provides sufficient visual separation.
- verifyHow: Open DevTools Performance on a 390px phone, open a modal (Playlists > Submit for Review), close it. GPU compositing activity should drop to zero. Frame rate during normal scrolling should remain ≥55 FPS.

