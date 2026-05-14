# EduCMS Mobile App — Roadmap

**Owner:** Integration Lead
**Started:** 2026-05-14
**Status:** Phase 1 scaffolding in progress

---

## North Star

A mobile experience that is **demonstrably easier** than any signage-CMS
mobile app on the market. The operator should be able to add content,
schedule a playlist, and publish from their phone in under 30 seconds —
no docs, no fumbling. Safety actions (panic, lockdown, all-clear) one
tap away from any screen. Content review approvals dispatched via push
and resolved in three taps.

This document is the durable plan. Implementation tickets get filed
against it; this file gets updated as we land work.

## Three phases, each shippable on its own

### Phase 1 — Mobile-first PWA (2–3 weeks)
Make the existing Next.js dashboard work beautifully on a phone.
Single codebase, no app store, no native build pipeline. Installable
to home screen.

**Deliverables:**
1. **PWA manifest + service worker** (`public/manifest.webmanifest`,
   `public/sw-mobile.js`) so iOS Safari and Android Chrome offer
   "Add to Home Screen". Service worker handles offline shell only —
   API calls still hit the network (the player has its own SW for
   asset caching; we're not duplicating that here).
2. **Mobile-first routes:**
   - `/[schoolId]` — bottom-tab home with widgets for "today's content,"
     "screens online," "pending reviews," and a panic-bar at the top.
   - `/[schoolId]/content` — content library, camera-roll picker,
     swipe-to-delete.
   - `/[schoolId]/playlists` — touch-reorder list, "+" floating action
     button for new playlist.
   - `/[schoolId]/screens` — list of screens with status pills, tap
     for detail.
   - `/[schoolId]/alerts` — emergency triggers + history.
   - `/[schoolId]/account` — switch tenants, sign out.
3. **Bottom-tab navigation** — `<MobileTabBar />` component renders
   when `useMediaQuery('(max-width: 768px)')`. Desktop sidebar
   unchanged.
4. **Camera capture upload** — `<input type="file" accept="image/*"
   capture="environment">` triggers native camera; goes through the
   existing presign upload chain.
5. **Web Push notifications** — Firebase Cloud Messaging for web push.
   Operator subscribes on first login from a mobile device; tokens
   stored in `UserPushSubscription` row. Server fires push on:
   - Submission needs review (admin)
   - Playlist approved / rejected (contributor)
   - Screen offline > 10 min
   - Emergency triggered (everyone in tenant)
   - OTA install completed / failed
6. **Touch interactions** — swipe gestures via `@use-gesture/react`:
   - Swipe-left on a list row → reveal Archive/Delete actions
   - Pull-down on a list → refresh
   - Long-press on a screen tile → context menu (Pair, Unpair, View, Sync)
7. **Optimistic UI** — every tap renders the success state immediately
   while the API call runs in the background. Errors surface as
   inline retries, not modal alarms.

**Success criteria:**
- Lighthouse PWA score ≥ 90 on a representative mobile-route URL.
- Operator can: take a photo, drop it into a playlist, schedule that
  playlist to a screen — all from phone, under 30 seconds.
- Push notification arrives within 5 seconds of server-side event.
- "Add to Home Screen" works on both iOS Safari 17+ and Android
  Chrome 100+.

### Phase 2 — Capacitor wrap to native iOS + Android (1–2 weeks)
Take the Phase 1 PWA, wrap with [Capacitor](https://capacitorjs.com/),
ship to App Store + Play Store.

**Deliverables:**
1. `apps/mobile-app/` directory with `capacitor.config.ts` pointing
   at our Vercel deployment URL. iOS and Android shells generated.
2. Native plugins wired:
   - **Camera** — Capacitor Camera (better UX than web's
     `<input type="file">`)
   - **Push** — Capacitor Push Notifications using APNs (iOS) +
     FCM (Android)
   - **Filesystem** — Capacitor Filesystem for offline asset caching
     of recently-uploaded content
   - **NFC** — Capacitor NFC plugin for screen pair-by-tap
   - **Haptics** — Capacitor Haptics for tap feedback
   - **Share** — Capacitor Share for outbound share sheets
3. Native splash + icon adaptive on iOS 17 / Android 14.
4. Biometric unlock via Capacitor Biometric Auth (FaceID / TouchID /
   Android fingerprint).
5. Live Updates via Capacitor's update channel — bug fixes ship via
   web reload without an App Store review.
6. Code-signing + CI pipeline for builds (Xcode Cloud or GitHub
   Actions + Fastlane).

**Success criteria:**
- App Store + Play Store builds pass review on first submission
  (no rejections for safety, privacy, or design).
- TestFlight beta of 10 operators uses the app for a week without
  reporting crashes.

### Phase 3 — Differentiation polish (4–6 weeks)
The features that make ours uniquely amazing vs. every signage-CMS
mobile app on the market. Ranked by leverage:

1. **NFC pair** — stick a programmable NFC tag on each LED enclosure
   during install. Operator taps phone → app reads the screen's
   pairing code → posts to `/screens/pair` → done in 5 seconds. No
   typing, no errors. The tag is just a sticker (~$1 in bulk) carrying
   a URL like `https://educms.app/p?c=KYNVSX`.

2. **AR screen finder** — open camera in a building, app uses WebXR
   (or Capacitor Camera + a custom overlay) to scan QR codes printed
   on each screen's bezel. Each detected screen gets an AR badge
   floating in the camera view showing its name + status. Tap badge →
   detail view. Game-changing for SROs walking the building during a
   drill.

3. **Voice-to-announcement** — long-press the mic button, speak
   "Cafeteria menu Friday: pizza, salad, fruit, milk." Whisper
   transcription (server-side Anthropic API call) → drops into an
   announcement widget on the cafeteria screen. Approve with one tap.

4. **Emergency on lock screen** — Apple Live Activity / Android
   notification-shade widget showing the current emergency status of
   the school. Tap-and-hold from the lock screen to trigger or clear
   alerts. Tested with SROs / building admins.

5. **Approve from anywhere** — admin gets push with content preview
   + Approve/Reject buttons in the notification itself (iOS notification
   actions / Android quick actions). No login, single signed token
   with 5-minute TTL. Content publishes the moment the admin taps.

6. **Snap-to-screen** — point phone camera at a TV / LED, app reads
   a small QR badge in the corner, drops you into that screen's
   content scheduler. Photo you take → goes onto THAT screen as the
   next playlist item.

7. **Quick-publish chips** — frequently-used playlists pinned to the
   home tab. "Push today's lunch menu" → one tap → published.

8. **Drill mode** — admin opens drill mode on phone → 30-day
   countdown to scheduled drill → on day-of, hold-to-trigger fires
   the practice emergency with the immutable audit trail flagged as
   `drillRun: true`. Post-drill report auto-generates a PDF.

9. **Mobile dashboard for principals** — non-admin "viewer" role
   on the phone shows district-wide screen health, recent emergencies,
   review queue depth, and a one-tap "tour the building" AR mode.
   Read-only; principals never sign content but want visibility.

10. **Offline content draft** — author content offline (in airplane
    mode on a bus, etc.), drafts sync the moment connectivity
    returns. Same indexed-DB pattern the offline player uses.

**Success criteria (Phase 3):**
- At least 3 of these features are demonstrably absent in every
  competitor's mobile app (per the competitor research report).
- Net-promoter survey of pilot operators rates mobile experience
  ≥ 60 (industry benchmark for SaaS mobile is 40s).
- Average operator session on mobile contains at least one publish /
  approve / trigger action (i.e. it's used for WORK, not just
  monitoring).

## Tech stack — confirmed picks

| Layer | Choice | Why |
|---|---|---|
| Shell | **Capacitor 6+** | Same React codebase → iOS + Android |
| State | **Zustand** (existing) | No reason to switch |
| Routing | **Next.js App Router** (existing) | Server components + edge runtime |
| Push | **Firebase Cloud Messaging** | Free, works web + iOS + Android |
| Camera | **Capacitor Camera** (native) / `getUserMedia` (PWA fallback) | Best UX per platform |
| Storage | **Supabase Storage** (existing) | Same upload chain |
| Auth | **Existing JWT + cookie flow + Capacitor Biometric Auth** | Single source of truth |
| Forms | **React Hook Form + Zod** (existing) | No change |
| Animations | **Framer Motion** + reduced-motion respecting | Native-feel page transitions |
| Gestures | **@use-gesture/react** | Touch interactions |
| QR / NFC | **html5-qrcode** (PWA) / **Capacitor NFC** (native) | Per-platform |
| Voice | **Anthropic Claude (Whisper-style) via existing /ai gateway** | We already have it wired |
| Icons | **lucide-react** (existing) | No change |
| Build | **Capacitor + EAS-style cloud build** | One command to ship |

## What we are NOT building

- **A separate React Native rewrite.** One codebase. Capacitor wraps
  the same React tree. If Capacitor performance ever bottlenecks on a
  specific screen, we'll rewrite THAT screen in RN — not the whole
  app.
- **A custom drag-drop builder ON mobile.** Template authoring is a
  desktop job. The mobile app lets you browse, duplicate, and
  re-skin templates — but the zone-drag builder stays on desktop
  where it's good.
- **A separate iPad app.** iPad gets the PWA / Capacitor universal
  app — auto-adapts to tablet form factor via responsive breakpoints.

## Non-goals for v1

- Hardcore offline mode (more than draft caching). Player needs
  offline-first; phone operators are online 99% of the time.
- Multi-tenant admin tooling. Mobile is for operators IN their
  tenant. Cross-tenant admin lives on desktop `/super`.
- Player-side functionality (the Android Player APK stays as-is —
  this is the DASHBOARD's mobile app).

## Open questions

1. Capacitor or React Native long-term? Capacitor is simpler now but
   has a soft ceiling on native performance. Re-evaluate after Phase 2.
2. Push notification provider — Firebase vs. OneSignal vs. native
   APNs/FCM direct. Firebase is the cheapest and most flexible; let's
   start there.
3. NFC tag printing logistics — sourcing, programming, embedding
   into the screen install workflow. Talk to the hardware partner.
4. AR feature — WebXR is limited; iOS doesn't support it in Safari.
   Probably need Capacitor + ARKit/ARCore plugins. Or punt to Phase 4.
5. Voice-to-text accuracy — Whisper-class via Anthropic is solid for
   short utterances but not perfect for technical vocabulary
   (curriculum codes, etc.). May need a manual edit step.

## What ships THIS WEEK

- ✅ PWA manifest + service worker stub (Phase 1.1)
- ✅ Mobile-first home route at `/[schoolId]` (Phase 1.2)
- ✅ Sandbox template `preset-sandbox-dynamic` for layout experiments
- 📊 Competitor research report (`docs/research/MOBILE_COMPETITOR_REPORT.md`)
- 📋 This roadmap (you are here)
