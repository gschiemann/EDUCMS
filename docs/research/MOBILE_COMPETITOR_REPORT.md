# Mobile App Competitor Report — Digital Signage CMS

**Date:** 2026-05-14
**Prepared for:** EduCMS mobile-app roadmap (PWA → Capacitor → React Native)
**Question this answers:** What do competitors ship for mobile, and where can we leapfrog them?

EduCMS is a K-12-first, multi-vertical digital signage and emergency platform. Our differentiation is **safety-first** (signed pub/sub, immutable AuditLog, per-screen emergency overrides, offline-first player) and **K-12 operational depth** (CONTRIBUTOR review workflow, district hierarchy, FERPA). This report maps the mobile-app landscape so the next agent / sprint can ship a phone experience that no competitor can match.

---

## Per-competitor breakdown

### 1. Yodeck

- **Native app:** ❌ NO dedicated admin/operator app. The Yodeck **Player** APK exists for Android (and a separate Raspberry Pi image), but there is **no iOS or Android admin app for content management**. Operators run the dashboard from mobile Safari/Chrome only.
- **Why this is a real gap:** Multiple reviews on G2, Capterra, and SoftwareAdvice cite this — operators want quick phone-based actions (push a new playlist, see a screen status, emergency-override). Yodeck punts to "the web is responsive."
- **Reviews summary:** 4.7–4.8 across G2/Capterra. Loved for ease of setup. Complaints: no mobile app, Wi-Fi setup friction, clunky content editor, weak TV-level controls (no IR / power scheduling).
- **Pricing impact on mobile:** N/A — there is no app. Web access is included at all paid tiers ($8/mo starting).
- **Last update / activity:** Player APK updated quarterly; web dashboard ships incrementally.
- **Opportunity:** Anything we ship on phone leapfrogs Yodeck by definition.

### 2. Rise Vision

- **Native app:** ✅ iOS + Android, but **single-purpose — "Rise Vision Share"** is a *screen-sharing* app, not a content-management app. Lets a teacher beam their phone screen onto a classroom display via a join code. Requires iOS 17.5+.
- **Headline mobile features:** Standard + Moderated screen-share modes (moderator approves before student-shared content appears). Released February 2025.
- **What's missing:** Cannot manage playlists, schedules, screens, alerts, or users from the app. Admin work is web-only.
- **Reviews summary:** Educators love the share workflow. K-12-specific positioning is strong (Common Alerting Protocol integration on the desktop, but not in the mobile app).
- **Pricing impact on mobile:** Share app is included with any paid plan.
- **Last update:** Active, February 2025 release added mobile screen sharing.
- **Opportunity:** Rise has the right brand position (K-12, CAP alerts) but their mobile app is one-trick. We can ship a real operator console *and* a teacher screen-share equivalent.

### 3. OptiSigns

- **Native app:** ✅ Two separate apps — **OptiSigns Admin** (iOS + Android, the operator console) and **OptiSigns Digital Signage** (the player APK). The Admin app is the best-in-class competitor on phone today.
- **Headline mobile features:**
  - Screen management (status, group assignment, pair via QR scan)
  - Playlist build/edit (add, reorder, delete assets)
  - Upload photos/videos directly from camera roll
  - Push content to screens
- **App-Store-level limitations** (per Apple reviews):
  - "Media" tab on mobile lacks `Push to Screen` and other web-only options
  - No emergency-override / takeover button (one reviewer explicitly requested this)
  - No "set expire" or "set live" scheduling for assets
  - Some users report iOS app crashes and sync delays
- **Reviews:** App is praised as clean and modern. Billing complaints are about the web side, not the app. Requires iOS 11+.
- **Pricing impact:** Mobile admin is included with any paid plan; no extra fee.
- **Opportunity:** OptiSigns shows the *floor* of what phone management should do. We should match every feature, then go further on emergency + safety.

### 4. ScreenCloud

- **Native app:** ⚠️ Player app on iOS/Android/AppleTV (turns the device itself into a display), plus a meeting-room booking app for iPads. **No dedicated operator/admin app.** Operators use the web dashboard via mobile browser.
- **Reviewer pain points:**
  - "Cannot create or edit playlists on mobile phones"
  - Users explicitly ask for "a mobile-friendly site"
  - Offline notifications were repeatedly requested (only email screen-down alerts ship today)
- **Headline features that are mobile-adjacent:** Email screen-status notifications with configurable downtime thresholds. Canvas design tool (free with Studio) — web-only.
- **Pricing impact on mobile:** N/A
- **Opportunity:** ScreenCloud is enterprise-priced but has a phone gap. Any K-12 customer evaluating them will be looking for the kind of phone-first experience we can build.

### 5. Raydiant

- **Native app:** ⚠️ Mixed. Web dashboard is mobile-responsive ("Displai Dashboard"). **Raydiant Engage** is a separate iOS app — but it's the *employee engagement* product, not screen management. There is no clear admin/operator app for managing playlists from a phone.
- **Reviews summary:** 4.7/5 over ~317 reviews. Praised for ease-of-use and multi-screen support. Complaints: Wi-Fi instability on devices, slow support during outages, limited menu templates.
- **Headline features that touch phones:** Remote display management is a top-rated feature (98% of users call it "important or highly important") but again — that's web-on-phone, not a native app.
- **Pricing impact on mobile:** N/A
- **Opportunity:** Raydiant is restaurant/retail-heavy. Our K-12 + emergency angle is a wide-open niche.

### 6. NoviSign

- **Native app:** ❌ Player APK only (Android, Chrome OS, Windows). No iOS/Android admin app — admin is browser-based.
- **Headline features:** Strong widget library (RSS, social, weather, touch, kiosk-builder). Caches all content locally so playback continues without internet.
- **Reviews summary:** Strong on touch-kiosk builds. Mid-tier brand awareness.
- **Pricing impact on mobile:** N/A
- **Opportunity:** Same gap — no mobile operator app.

### 7. Mvix (XhibitSignage)

- **Native app:** ❌ Cloud dashboard only, browser-based. No native iOS/Android admin app surfaced in the App Stores. Player APK ships bundled with their hardware (one-time fee).
- **Customer base:** 15,000+ including NASA, Sodexo, Nike — enterprise-skewed. They emphasize 150+ data integrations on web.
- **Pricing impact on mobile:** N/A
- **Opportunity:** Mvix is hardware-tied. They don't compete on mobile UX at all.

### 8. TelemetryTV

- **Native app:** ⚠️ Player APK on Android (incl. Android TV, mobile/tablet). **No standalone admin app** — the platform is built around a polished web dashboard. The Android app is for *display devices*, not for operators.
- **Headline features:** Native Canva integration, SAML SSO, 70+ app integrations, alerting + screen override system on web.
- **Pricing impact on mobile:** N/A
- **Reviews summary:** Strong technical reputation, enterprise positioning.
- **Opportunity:** Their alerting/override is web-only. A phone-first emergency trigger UX is open territory.

### 9. Xibo

- **Native app:** ✅ Both iOS and Android Player apps. Open-source, self-hostable. **Admin work is web-only** (CMS dashboard). The "mobile apps" are players, not admin consoles.
- **Headline features:** Display monitoring, remote screenshots of what's currently playing, push updates, manage display groups. Built-in widgets for weather, RSS, social, clocks, calendars, DataSets.
- **Pricing impact on mobile:** Free (self-hosted) or Xibo Cloud subscription. Players are free.
- **Reviews summary:** Beloved by tech-savvy operators; intimidating to non-technical K-12 staff.
- **Opportunity:** Open-source player ecosystem is mature, but operator phone UX is a gap across the entire community.

### 10. Singlewire (InformaCast) / Visix

- **Native app:** ✅ **InformaCast** (iOS + Android) is the closest competitor to what we want to build, but framed as a *mass-notification platform* rather than a signage CMS.
- **Headline mobile features (this matters most for our positioning):**
  - **Mobile panic button** — system admins create configurable buttons in the web interface that appear on designated end-users' phones. One tap triggers an emergency, displays instructions, and connects user to safety teams via phone call from the app.
  - **Location sharing on activation** — admins see the user's location and can send follow-up messages.
  - **Event tracking for first responders** — every panic event is logged for handoff.
  - **Send-and-receive notifications** with text/image/audio support based on org templates, roles, permissions.
  - **Mounted + virtual + wearable panic button integrations.**
- **Pricing:** Enterprise-only, quote-based. Used by 7,000+ orgs across 50 countries.
- **Reviews summary:** Heavyweight in K-12 safety, but the broader CMS / signage experience is bolted onto AxisTV Alert (Visix) or partner integrations. Operators have to use multiple products for one workflow.
- **Opportunity (and existential threat):** Singlewire is the safety-first competitor. The gap they leave open is **signage + safety in one product**. Today districts buy signage from one vendor and safety from Singlewire — we collapse those into one purchase.

---

## Synthesis

### Common feature set — what every signage CMS mobile app does (or aspires to)

1. **QR-code screen pairing** — universal. Scan a code on the screen, pair to the tenant.
2. **Player APK on Android** — every vendor has one. iOS player is rarer (only OptiSigns and ScreenCloud ship native iOS players in addition to web).
3. **Status notifications** — usually email, sometimes in-app. Threshold-configurable on ScreenCloud, real-time on others.
4. **Mobile-responsive web dashboard** — 100% coverage. Used as a substitute for a real native app by 7 of 10 competitors.
5. **Cache content locally** for playback during outages (NoviSign, Yodeck, OptiSigns, Xibo, Rise Vision).

### Differentiators — features only 1–2 competitors have

- **Dedicated operator admin app on phone (iOS + Android)** — only **OptiSigns** ships this. Everyone else is web-on-phone. This alone is a moat-sized gap.
- **Mobile screen-share from teacher's phone to display** — only **Rise Vision** (and Moderated Mode is unique to them). Big in K-12 classrooms.
- **In-app mobile panic button with location reporting** — only **Singlewire InformaCast**. The K-12 safety angle is theirs to lose.
- **Wearable panic button integration** — Singlewire only.
- **Multiple alert delivery channels from one phone trigger (screens + speakers + desktops + SMS + voice)** — Singlewire only; bolted-on for everyone else.

### Gaps — pain points that show up across multiple competitors' reviews

1. **No phone-based emergency control.** One OptiSigns reviewer explicitly asked for it. Singlewire owns this niche but doesn't ship signage. **Our biggest single opportunity.**
2. **Mobile cannot do what desktop does.** OptiSigns reviewers list missing features (push-to-screen, expire/live scheduling). ScreenCloud reviewers ask for full mobile playlist editing. Universal phone-app feature gap.
3. **Offline-aware status notifications.** Competitors mostly email when a screen drops; few send rich push notifications, none ship "the network is down for this whole building" cohort alerts.
4. **Live preview from phone.** OptiSigns has a "Virtual Screen" preview, but it's a web feature. No competitor ships *real-time WYSIWYG preview of what's on the screen right now* from a phone.
5. **Wi-Fi pairing friction.** Yodeck and Raydiant both lose customers here. Anyone who solves first-time setup in <60 seconds wins.
6. **Confusing scheduling on small screens.** OptiSigns reviewers cite this. Time-window logic + per-day rules collapse on a 6" phone.
7. **No multi-screen targeting from phone.** Zone-based or building-based emergency targeting is desktop-only everywhere.

### UX patterns to copy

- **QR-code pair flow.** OptiSigns + Xibo nail this. Camera opens → square → done.
- **Tab structure: Screens / Playlists / Media / (Alerts).** OptiSigns Admin uses this and reviewers find it intuitive.
- **Direct camera-roll upload** as a first-class flow (not buried in file picker). OptiSigns gets this right.
- **Moderated screen-share** (Rise Vision) — teacher hits "share to display," admin/teacher gets approval prompt. This is K-12 gold.
- **Configurable in-app panic button + location handoff** (Singlewire). Exactly the safety-first surface we should own.
- **Email + in-app notification on screen down with threshold** (ScreenCloud) — prevents alert fatigue from 30-second blips.

### UX patterns to avoid

- **Don't ship a "responsive web on phone" disguised as an app.** Yodeck, NoviSign, Raydiant, Mvix all do this and reviewers notice. A wrapped webview that doesn't use phone affordances (camera, push, NFC, haptics) is a tax.
- **Don't ship a feature on mobile that's missing the web equivalent.** OptiSigns reviewers complain when `Push to Screen` is desktop-only. Either ship parity or skip the feature.
- **Don't gate emergency on a paid tier.** Singlewire enterprise-only pricing leaves smaller districts cold. Safety has to be in every tier.
- **Don't force a separate app per task** (Rise Vision Share is a separate app from their player from their web). Three apps to learn = none get learned.
- **Don't surface raw cron-syntax scheduling on phone.** Reviewers across OptiSigns and ScreenCloud cite this. Use natural-language or visual day/time grid.

---

## 5–10 mobile features we should ship that NO competitor has

These are the moves that take us from "another signage app on a phone" to "the safety-first phone console for districts."

1. **Hold-to-trigger emergency from the phone, with per-zone scoping.** Yodeck/Rise/OptiSigns/ScreenCloud have no panic button. Singlewire has one but it triggers one fan-out — not per-floor / per-wing routing. We already have signed pub/sub + Sprint 8b floor plans. Phone shows a thumbnail of the building floor plan, operator taps zones, holds the trigger 3s, sends. **Crown-jewel feature.**

2. **NFC pairing of screens — tap-to-pair, no QR.** Every competitor uses QR. NFC has 8–12% tap-through vs 2–3% for QR. Hold the phone to an NFC-equipped player and it pairs in 2 seconds. Bonus: the same tag becomes "tap-to-monitor" so a teacher can hold their phone to the lobby screen and instantly see what's playing, what the cache state is, and a "report problem" button.

3. **AR screen finder.** Camera overlay: point your phone down a hallway, every nearby paired screen gets a floating tag (name, status, current playlist, last sync). Tap a tag to drill in. Solves the universal "which screen is acting up?" problem in a 100-screen district. Builds on Sprint 8 lat/lng + Sprint 8b floor plans.

4. **Live mirror of what's on the screen, in real time.** Today's competitors offer "remote screenshot" (Xibo) or "preview before push" (OptiSigns Virtual Screen). Neither ships a *live thumbnail stream* of the actual current render. We have signed pub/sub already — a 1 fps mjpeg or WebRTC stream over the existing channel lets operators see exactly what's playing on every screen, from their phone. Massive for "is the emergency message actually showing?"

5. **Voice-to-announcement.** Hold phone to mouth, say "Bus 14 will be 20 minutes late." Phone transcribes (on-device Whisper), shows preview, operator confirms, banner is on every screen in <5 seconds. No competitor offers this and it's the single highest-frequency operator action.

6. **Proof-of-display ACK panel — "what did each screen actually render?"** When an emergency is triggered, the phone shows a live list of every screen + a green check the moment its player ACKs the alert. This is auditable evidence that the alert actually landed. We already have AuditLog + heartbeat; surface it on the phone for incident commanders. **Litigation-defense feature for districts.**

7. **Cohort/building-outage push.** "The Lincoln HS east wing has 8 screens that haven't checked in for 4 minutes." Not per-screen email (alert fatigue) but cohort-level smart push. Sprint Phase B already has cohort outage detection on the server — we just need the rich push payload.

8. **One-tap drill mode.** Mobile lets safety officers run a lockdown drill that signs + audits exactly like a real trigger but flips a `DrillRun` flag the players honor — no real takeover. Singlewire has drill logging on web; nobody ships it on phone.

9. **Submitter / reviewer queue with swipe-to-approve.** Sprint 1.5's reviewer workflow on phone: pending submissions land in a Tinder-style queue, swipe right to approve, left to reject (with a forced reason text field). Solves the CONTRIBUTOR → ADMIN bottleneck for districts where the admin only checks their phone between classes.

10. **Tap-to-monitor + tap-to-report-problem combined NFC + AR experience.** When ANY staff member taps their phone to a screen's NFC tag (no login required), they get a one-screen view: "This screen is showing the lunch menu. Last updated 9:42 AM. Tap if there's a problem." Tap → preset categories (wrong content / blank / frozen / sound issue / other) → ticket lands in the operator's reviewer queue with the screen ID prefilled. Turns every staff member into a passive monitoring agent. **No K-12 signage product ships this.**

These features map cleanly onto the existing architecture (signed pub/sub, AuditLog, floor plans, offline-first player, Submission model) — they're not green-field bets. They're a coherent phone-first product narrative built on infrastructure we already have.

---

## Sources

- [Yodeck — G2 Reviews](https://www.g2.com/products/yodeck/reviews)
- [Yodeck — Capterra Reviews](https://www.capterra.com/p/228571/Yodeck/)
- [Yodeck — SoftwareAdvice Reviews](https://www.softwareadvice.com/android-kiosk/yodeck-profile/reviews/)
- [Yodeck Digital Signage Player on Google Play](https://play.google.com/store/apps/details?id=com.yodeck.android)
- [Rise Vision Share App on App Store](https://apps.apple.com/us/app/rise-vision-share/id6670492603)
- [Rise Vision Apps directory](https://apps.risevision.com/)
- [Rise Vision Capterra Reviews](https://www.capterra.com/p/87694/Rise-Display-Network/reviews/)
- [OptiSigns Admin on App Store](https://apps.apple.com/us/app/optisigns-admin/id1574826252)
- [OptiSigns Admin — App Store Reviews](https://apps.apple.com/us/app/1574826252?see-all=reviews&platform=iphone)
- [OptiSigns Mobile App page](https://www.optisigns.com/mobile-app)
- [OptiSigns Mobile Admin App help docs](https://support.optisigns.com/hc/en-us/articles/30003143806099-How-to-Use-the-OptiSigns-Mobile-Admin-App)
- [ScreenCloud Player on App Store](https://apps.apple.com/us/app/screencloud-player/id1047602090)
- [ScreenCloud Mobile App overview](https://www.softwaresuggest.com/screencloud/mobile-app)
- [ScreenCloud Screen Status Notifications](https://screencloud.com/product-updates/digital-signage/screen-notifications-feature)
- [Raydiant on G2](https://www.g2.com/products/displai/reviews)
- [Raydiant on Research.com](https://research.com/software/reviews/raydiant)
- [Raydiant Engage Mobile App](https://support.raydiant.com/s/article/Employee-Engagement-Mobile-App)
- [NoviSign Digital Signage on Google Play](https://play.google.com/store/apps/details?id=com.novisign.android.player)
- [NoviSign Mobile App listing](https://www.softwaresuggest.com/novisign/mobile-app)
- [Mvix XhibitSignage on Capterra](https://www.capterra.com/p/123169/XhibitSignage/)
- [TelemetryTV Digital Signage on Google Play](https://play.google.com/store/apps/details?id=com.telemetrytv.mediaplayer)
- [TelemetryTV Capterra page](https://www.capterra.com/p/182701/TelemetryTV/)
- [Xibo for Android](https://xibosignage.com/xibo-for-android)
- [Xibo on GitHub](https://github.com/xibosignage/xibo)
- [Singlewire InformaCast](https://www.singlewire.com/informacast)
- [Singlewire InformaCast App on App Store](https://apps.apple.com/us/app/informacast/id691285264)
- [Singlewire Mobile Panic Button announcement](https://www.singlewire.com/news/mobile-panic-button-launch)
- [Visix AxisTV Alert](https://www.visix.com/news/visix-is-now-shipping-axistv-alert/)
- [Khazina — QR + NFC Handoff trend 2026](https://khazinadigital.com/blogs/digital-signage-for-business/qr-code-nfc-handoff-for-digital-signage-2026-moving-the-screen-to-the-phone-khazina-digital)
- [Friendlyway — Digital Signage Trends 2026](https://www.friendlyway.com/exploring-top-7-digital-signage-trends-2025/)
