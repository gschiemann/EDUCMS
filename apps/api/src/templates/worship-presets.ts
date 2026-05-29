/**
 * Worship / house-of-worship vertical — system template presets.
 *
 * Kept in its own file (not appended to system-presets.ts) so the EDU
 * vertical stays uncontaminated and the seed loader can tag every row
 * with `vertical='WORSHIP'` in one shot (see ensure-system-presets.ts).
 *
 * Why this file exists: WORSHIP is fully wired in the taxonomy
 * (packages/api-types/src/verticals.ts), signup, branding URLs,
 * DistrictSchoolsCard, AND the public IndustryShowcase marketing card —
 * a pastor can sign up as WORSHIP — but until now `grep -ci worship
 * apps/api/src/templates/*.ts` returned 0, so a brand-new WORSHIP tenant
 * landed on a completely empty gallery (the gallery gate is strict:
 * `vertical: callerVertical`, no fallback). This pack closes that gap
 * with a set of genuinely useful, editable worship-signage layouts.
 *
 * Visual DNA — deliberately distinct from EDU / GYM / BAR / RETAIL:
 *   - Sanctuary palette: warm parchment cream (#fbf6ec), deep cathedral
 *     navy (#0e1430 / #141a3a), burgundy (#5b1224), soft gold (#c9a449).
 *   - Layered radial + linear gradient backgrounds that read as shafts
 *     of stained-glass light through a sanctuary window.
 *   - Elegant serif type via a robust system serif stack so it renders
 *     identically in every browser AND on the Chromium-83 Taurus player
 *     (no Google-font load risk — the generic core widgets apply
 *     `config.fontFamily` as a raw CSS family name and do NOT @import).
 *   - Gold accent rails (ANNOUNCEMENT accent bar), gold dividers, and
 *     reverent spacing. No bare "rounded rectangle with a shadow."
 *
 * Widgets used (ALL pre-existing in WidgetRenderer.tsx — verified to
 * render AND to be editable in PropertiesPanel):
 *   • TEXT          — welcome line, scripture, sermon series, appeals
 *   • ANNOUNCEMENT  — greeting, giving goal, gift levels (gold accent rail)
 *   • COUNTDOWN     — service-start / campaign-deadline countdown
 *   • TICKER        — rolling announcements strip
 *   • CLOCK         — current time on the lobby board
 *   • CALENDAR      — week-ahead events list
 *   • BELL_SCHEDULE — neutral time-list, retitled "Service Times" /
 *                     "Today's Songs" (indigo chrome, title overridable)
 *   • IMAGE         — series art / sanctuary photo / leadership headshot
 *
 * Every text/announcement/countdown field is operator-editable (content,
 * font, size, color, background) so a church can make these their own in
 * minutes — the §19 Template + Widget Editability Standard.
 */

import type { SystemPreset } from './system-presets';

// Robust serif stack — renders an elegant serif everywhere (macOS,
// Windows, Android System WebView, Chromium 83) with zero font-loading
// risk. The generic core widgets apply this as a raw CSS family name.
const SERIF = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif";

// Sanctuary palette — single source so every preset stays consistent.
const NAVY = '#0e1430';
const NAVY_2 = '#141a3a';
const GOLD = '#c9a449';
const CREAM = '#fbf6ec';
const BURGUNDY = '#5b1224';

// Layered "stained-glass light" background over deep cathedral navy.
const SANCTUARY_BG =
  'radial-gradient(1100px 620px at 78% 8%, rgba(201,164,73,0.16), transparent 60%),' +
  'radial-gradient(900px 520px at 14% 96%, rgba(91,18,36,0.30), transparent 62%),' +
  'radial-gradient(680px 420px at 50% 40%, rgba(120,140,220,0.07), transparent 65%),' +
  `linear-gradient(165deg, ${NAVY} 0%, ${NAVY_2} 52%, #0b1026 100%)`;

// Warm parchment background for the lighter "verse of the day" board.
const PARCHMENT_BG =
  'radial-gradient(900px 520px at 20% 12%, rgba(201,164,73,0.18), transparent 60%),' +
  'radial-gradient(760px 460px at 84% 92%, rgba(91,18,36,0.10), transparent 62%),' +
  `linear-gradient(160deg, ${CREAM} 0%, #f3ead8 55%, #efe3cc 100%)`;

export const WORSHIP_TEMPLATE_PRESETS: SystemPreset[] = [
  // ════════════════════════════════════════════════════════════════
  // Preset 1 — Welcome / Greeting Board
  // The board in the narthex/lobby as people arrive: a warm "Welcome
  // Home" greeting card with a gold rail, the current time, and a
  // rolling announcements ticker so first-time guests instantly feel
  // oriented. The everyday default for the foyer screen.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'worship-welcome-board',
    name: 'Welcome Board',
    description:
      'Warm welcome / greeting board for the narthex or lobby as people arrive for service. A large "Welcome Home" greeting with a gold accent rail, a serif sub-line for first-time guests, the current time, and a rolling announcements ticker along the bottom. Every line is editable — change the greeting, colors, and ticker messages to your congregation. Designed full-bleed for a 16:9 wall display in the foyer.',
    category: 'SERVICE',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: NAVY,
    bgGradient: SANCTUARY_BG,
    zones: [
      // ── Greeting card — anchors the board ──
      {
        name: 'Welcome Greeting',
        widgetType: 'ANNOUNCEMENT',
        x: 8, y: 16, width: 84, height: 50,
        zIndex: 2,
        sortOrder: 1,
        defaultConfig: {
          title: 'Welcome Home',
          message:
            'However you arrived this morning — weary, joyful, searching, or sure — there is a place for you here. We are so glad you came.',
          badgeLabel: 'GRACE & PEACE',
          icon: '✝️',
          cta: 'Find a greeter in the lobby — we would love to meet you',
          color: CREAM,
          bgColor: 'rgba(20,26,58,0.55)',
          fontFamily: SERIF,
        },
      },
      // ── Clock — quiet gold-on-navy in the upper-left ──
      {
        name: 'Now',
        widgetType: 'CLOCK',
        x: 8, y: 4, width: 26, height: 10,
        zIndex: 3,
        sortOrder: 2,
        defaultConfig: {
          format: '12h',
          showSeconds: false,
          showDate: true,
        },
      },
      // ── Service-name line in the upper-right ──
      {
        name: 'Gathering Line',
        widgetType: 'TEXT',
        x: 50, y: 4, width: 42, height: 10,
        zIndex: 3,
        sortOrder: 3,
        defaultConfig: {
          content: 'Sunday Worship · 9:00 & 11:00am',
          fontSize: 56,
          color: GOLD,
          alignment: 'right',
          fontFamily: SERIF,
        },
      },
      // ── Verse band beneath the greeting ──
      {
        name: 'Welcome Verse',
        widgetType: 'TEXT',
        x: 8, y: 68, width: 84, height: 14,
        zIndex: 2,
        sortOrder: 4,
        defaultConfig: {
          content:
            '"This is the day the Lord has made; let us rejoice and be glad in it." — Psalm 118:24',
          fontSize: 56,
          color: '#e9ddc2',
          alignment: 'center',
          italic: true,
          fontFamily: SERIF,
        },
      },
      // ── Announcements ticker ──
      {
        name: 'Announcements Ticker',
        widgetType: 'TICKER',
        x: 0, y: 92, width: 100, height: 8,
        zIndex: 4,
        sortOrder: 5,
        defaultConfig: {
          messages: [
            '☕ Coffee & fellowship in the Welcome Center after each service',
            '👶 Nursery & kids ministry available — check in at the lobby',
            '🙏 Prayer team is up front following the service',
            '📱 Connect with us — text WELCOME to your church number',
          ],
          speed: 'normal',
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Preset 2 — Service Times Board
  // A clean directory of the day's gatherings — service name + time —
  // with a countdown to the next service so latecomers know exactly how
  // long they have. Pairs the neutral time-list (BELL_SCHEDULE, retitled
  // "Service Times") with a full COUNTDOWN.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'worship-service-times',
    name: 'Service Times',
    description:
      "Directory of today's gatherings — service name and time — alongside a live countdown to the next service so arriving guests know exactly how long they have. The time list is fully editable: add, rename, or reorder each service. Set the countdown to your next start time. Designed for the lobby or entrance display before and between services.",
    category: 'SERVICE',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: NAVY,
    bgGradient: SANCTUARY_BG,
    zones: [
      // ── Header line ──
      {
        name: 'Header',
        widgetType: 'TEXT',
        x: 6, y: 6, width: 88, height: 12,
        zIndex: 3,
        sortOrder: 1,
        defaultConfig: {
          content: 'Gather With Us',
          fontSize: 120,
          color: GOLD,
          alignment: 'center',
          bold: true,
          fontFamily: SERIF,
        },
      },
      // ── Service-times list (neutral time list, retitled) ──
      {
        name: 'Service Times',
        widgetType: 'BELL_SCHEDULE',
        x: 6, y: 22, width: 56, height: 64,
        zIndex: 2,
        sortOrder: 2,
        defaultConfig: {
          title: 'Service Times',
          showCurrent: false,
          schedule: [
            { label: 'Sunrise Prayer', start: '7:30 AM', end: '8:15 AM' },
            { label: 'First Service', start: '9:00 AM', end: '10:15 AM' },
            { label: 'Bible Class (all ages)', start: '10:15 AM', end: '10:45 AM' },
            { label: 'Second Service', start: '11:00 AM', end: '12:15 PM' },
            { label: 'Wednesday Midweek', start: '7:00 PM', end: '8:15 PM' },
          ],
        },
      },
      // ── Countdown to next service ──
      {
        name: 'Next Service Countdown',
        widgetType: 'COUNTDOWN',
        x: 64, y: 22, width: 30, height: 40,
        zIndex: 2,
        sortOrder: 3,
        defaultConfig: {
          eyebrow: 'Doors are open',
          label: 'Until Worship Begins',
          color: GOLD,
          bgColor: 'rgba(20,26,58,0.55)',
          fontFamily: SERIF,
        },
      },
      // ── Welcome note under the countdown ──
      {
        name: 'Note',
        widgetType: 'ANNOUNCEMENT',
        x: 64, y: 64, width: 30, height: 22,
        zIndex: 2,
        sortOrder: 4,
        defaultConfig: {
          title: 'New here?',
          message:
            'Stop by the Welcome Center for a gift and a warm hello. There is no wrong way to join us.',
          badgeLabel: 'GUESTS',
          icon: '🤝',
          color: CREAM,
          bgColor: 'rgba(91,18,36,0.40)',
          fontFamily: SERIF,
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Preset 3 — Sermon Series Title Card
  // A cinematic series/sermon title card to set behind the platform or
  // run in the lobby during a teaching series. Big series title over a
  // full-bleed art image, the week's message title + speaker, and a
  // passage reference. The IMAGE zone holds the series artwork.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'worship-sermon-series',
    name: 'Sermon Series Card',
    description:
      "Cinematic sermon-series title card for the platform backdrop or lobby during a teaching series. A full-bleed series-art image sits behind a large series title, this week's message title, the speaker's name, and the scripture passage — all editable. Drop in your series artwork via the image field and rename the titles for each new series or week.",
    category: 'SERMON',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#080b1c',
    bgGradient:
      'radial-gradient(1000px 700px at 70% 30%, rgba(201,164,73,0.14), transparent 60%),' +
      `linear-gradient(180deg, #080b1c 0%, #0e1430 60%, #05060f 100%)`,
    zones: [
      // ── Series art (background image plate) ──
      {
        name: 'Series Art',
        widgetType: 'IMAGE',
        x: 0, y: 0, width: 100, height: 70,
        zIndex: 1,
        sortOrder: 1,
        defaultConfig: {
          url: '',
          fit: 'cover',
          alt: 'Sermon series artwork',
        },
      },
      // ── Eyebrow: which week ──
      {
        name: 'Series Eyebrow',
        widgetType: 'TEXT',
        x: 8, y: 60, width: 84, height: 7,
        zIndex: 3,
        sortOrder: 2,
        defaultConfig: {
          content: 'CURRENT SERIES · WEEK 3 OF 6',
          fontSize: 48,
          color: GOLD,
          alignment: 'center',
          bold: true,
          fontFamily: SERIF,
        },
      },
      // ── Series title (the big one) ──
      {
        name: 'Series Title',
        widgetType: 'TEXT',
        x: 6, y: 67, width: 88, height: 14,
        zIndex: 3,
        sortOrder: 3,
        defaultConfig: {
          content: 'Rooted: A Study in the Psalms',
          fontSize: 128,
          color: CREAM,
          alignment: 'center',
          bold: true,
          fontFamily: SERIF,
        },
      },
      // ── This week's message + speaker ──
      {
        name: 'Message & Speaker',
        widgetType: 'TEXT',
        x: 8, y: 82, width: 84, height: 9,
        zIndex: 3,
        sortOrder: 4,
        defaultConfig: {
          content: 'Today: "Streams in the Desert"  ·  Pastor Daniel Reyes',
          fontSize: 60,
          color: '#e9ddc2',
          alignment: 'center',
          fontFamily: SERIF,
        },
      },
      // ── Passage reference strip ──
      {
        name: 'Passage',
        widgetType: 'TEXT',
        x: 8, y: 91, width: 84, height: 7,
        zIndex: 3,
        sortOrder: 5,
        defaultConfig: {
          content: 'Psalm 1:1–6',
          fontSize: 48,
          color: GOLD,
          alignment: 'center',
          italic: true,
          fontFamily: SERIF,
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Preset 4 — Song / Hymn Board (Next Songs)
  // The order-of-worship board for the foyer or fellowship hall — the
  // set list of today's songs and hymns so the congregation can follow
  // along. Uses the neutral time-list retitled "Today's Songs" (the
  // "time" column doubles as hymn numbers / keys), plus a header.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'worship-song-board',
    name: 'Song & Hymn Board',
    description:
      "Order-of-worship song board for the foyer or fellowship hall — today's set list of worship songs and hymns so the congregation can follow along. The list is fully editable: each row holds the song title and an optional hymn number or key. Retitle the board, add or reorder songs, and recolor to your church. Pairs naturally with the Sermon Series card on a second screen.",
    category: 'SERVICE',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: NAVY,
    bgGradient: SANCTUARY_BG,
    zones: [
      // ── Header ──
      {
        name: 'Header',
        widgetType: 'TEXT',
        x: 6, y: 6, width: 88, height: 12,
        zIndex: 3,
        sortOrder: 1,
        defaultConfig: {
          content: 'This Morning We Sing',
          fontSize: 120,
          color: GOLD,
          alignment: 'center',
          bold: true,
          fontFamily: SERIF,
        },
      },
      // ── Song list (neutral time-list, retitled) ──
      {
        name: "Today's Songs",
        widgetType: 'BELL_SCHEDULE',
        x: 10, y: 20, width: 80, height: 64,
        zIndex: 2,
        sortOrder: 2,
        defaultConfig: {
          title: "Today's Songs",
          showCurrent: false,
          schedule: [
            { label: 'Come Thou Fount of Every Blessing', start: 'Hymn 2' },
            { label: 'Great Are You Lord', start: 'Key of A' },
            { label: 'How Great Thou Art', start: 'Hymn 10' },
            { label: 'Goodness of God', start: 'Key of C' },
            { label: 'Doxology', start: 'Hymn 815' },
          ],
        },
      },
      // ── Footer invitation ──
      {
        name: 'Footer',
        widgetType: 'TEXT',
        x: 10, y: 86, width: 80, height: 8,
        zIndex: 2,
        sortOrder: 3,
        defaultConfig: {
          content: 'Lyrics on screen in the sanctuary · Sing along, all are welcome',
          fontSize: 48,
          color: '#e9ddc2',
          alignment: 'center',
          italic: true,
          fontFamily: SERIF,
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Preset 5 — Weekly Events & Announcements
  // The "what's happening this week" board — a week-ahead events list
  // (CALENDAR) beside a featured announcement and a rolling ticker.
  // Keeps the congregation connected to small groups, outreach, and
  // upcoming gatherings.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'worship-weekly-events',
    name: 'Weekly Events',
    description:
      "The \"what's happening this week\" board for your church — a week-ahead events list beside a featured announcement and a rolling ticker. Add your small groups, outreach, youth nights, and special services; every event title, date, and message is editable. Designed for the lobby or fellowship hall to keep the congregation connected all week.",
    category: 'EVENTS',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: NAVY,
    bgGradient: SANCTUARY_BG,
    zones: [
      // ── Header ──
      {
        name: 'Header',
        widgetType: 'TEXT',
        x: 5, y: 5, width: 90, height: 11,
        zIndex: 3,
        sortOrder: 1,
        defaultConfig: {
          content: 'This Week at Church',
          fontSize: 120,
          color: GOLD,
          alignment: 'center',
          bold: true,
          fontFamily: SERIF,
        },
      },
      // ── Week-ahead events list ──
      {
        name: 'Upcoming Events',
        widgetType: 'CALENDAR',
        x: 5, y: 18, width: 56, height: 68,
        zIndex: 2,
        sortOrder: 2,
        defaultConfig: {
          title: 'Upcoming Gatherings',
          maxEvents: 6,
          events: [
            { title: 'Sunday Worship — 9:00 & 11:00am', date: 'Sunday', color: GOLD },
            { title: "Men's Prayer Breakfast", date: 'Tuesday · 7:00am', color: '#9bb0e6' },
            { title: 'Midweek Bible Study', date: 'Wednesday · 7:00pm', color: GOLD },
            { title: 'Youth Group — Grades 6–12', date: 'Friday · 6:30pm', color: '#9bb0e6' },
            { title: 'Community Food Pantry', date: 'Saturday · 9:00am', color: GOLD },
            { title: 'Baptism Sunday', date: 'Next Sunday', color: '#e0879a' },
          ],
        },
      },
      // ── Featured announcement ──
      {
        name: 'Featured',
        widgetType: 'ANNOUNCEMENT',
        x: 63, y: 18, width: 32, height: 44,
        zIndex: 2,
        sortOrder: 3,
        defaultConfig: {
          title: 'Fall Outreach Sunday',
          message:
            'Join us as we serve our neighbors. Sign up to volunteer at the Welcome Center or online — every pair of hands matters.',
          badgeLabel: 'GET INVOLVED',
          icon: '🤲',
          cta: 'Sign up at the Welcome Center',
          color: CREAM,
          bgColor: 'rgba(91,18,36,0.42)',
          fontFamily: SERIF,
        },
      },
      // ── Verse / encouragement under featured ──
      {
        name: 'Encouragement',
        widgetType: 'TEXT',
        x: 63, y: 64, width: 32, height: 22,
        zIndex: 2,
        sortOrder: 4,
        defaultConfig: {
          content:
            '"And let us consider how we may spur one another on toward love and good deeds." — Hebrews 10:24',
          fontSize: 48,
          color: '#e9ddc2',
          alignment: 'center',
          italic: true,
          fontFamily: SERIF,
        },
      },
      // ── Ticker ──
      {
        name: 'Events Ticker',
        widgetType: 'TICKER',
        x: 0, y: 92, width: 100, height: 8,
        zIndex: 4,
        sortOrder: 5,
        defaultConfig: {
          messages: [
            '🎶 Choir rehearsal Thursdays at 6:30pm — new voices always welcome',
            '☕ Newcomers Lunch next Sunday after second service',
            '📖 New small groups forming — pick one up at the kiosk',
            '💍 Marriage Enrichment retreat registration now open',
          ],
          speed: 'normal',
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Preset 6 — Giving / Tithe Board
  // The generosity board — a campaign goal with the amount raised, a
  // countdown to the campaign deadline, and the giving channels (text,
  // app, envelope). Built from editable ANNOUNCEMENT + COUNTDOWN + TEXT
  // so a church can update the running total each week.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'worship-giving-board',
    name: 'Giving & Tithe Board',
    description:
      'Generosity board for a building fund, missions campaign, or weekly tithe push. Shows the campaign name and the amount raised toward the goal, a countdown to the campaign deadline, the appeal, and the ways to give (text, app, in-person). Update the running total and goal each week — every figure and line is editable. Designed for the lobby during a giving season.',
    category: 'GIVING',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: NAVY,
    bgGradient:
      'radial-gradient(1000px 600px at 50% 0%, rgba(201,164,73,0.22), transparent 60%),' +
      'radial-gradient(820px 520px at 16% 96%, rgba(91,18,36,0.28), transparent 62%),' +
      `linear-gradient(165deg, ${NAVY} 0%, ${NAVY_2} 55%, #0b1026 100%)`,
    zones: [
      // ── Campaign header ──
      {
        name: 'Campaign Header',
        widgetType: 'TEXT',
        x: 6, y: 6, width: 88, height: 11,
        zIndex: 3,
        sortOrder: 1,
        defaultConfig: {
          content: 'Building for the Next Generation',
          fontSize: 120,
          color: GOLD,
          alignment: 'center',
          bold: true,
          fontFamily: SERIF,
        },
      },
      // ── Goal / raised "thermometer" via announcement ──
      {
        name: 'Goal Progress',
        widgetType: 'ANNOUNCEMENT',
        x: 6, y: 18, width: 54, height: 50,
        zIndex: 2,
        sortOrder: 2,
        defaultConfig: {
          title: '$184,500 raised of $250,000',
          message:
            '74% of the way there — thank you, church! Every gift moves us closer to a home for student ministry and community outreach.',
          badgeLabel: 'CAMPAIGN GOAL',
          icon: '🏛️',
          cta: 'Pledge your part — cards at the Welcome Center',
          color: CREAM,
          bgColor: 'rgba(91,18,36,0.45)',
          fontFamily: SERIF,
        },
      },
      // ── Countdown to campaign close ──
      {
        name: 'Campaign Countdown',
        widgetType: 'COUNTDOWN',
        x: 62, y: 18, width: 32, height: 30,
        zIndex: 2,
        sortOrder: 3,
        defaultConfig: {
          eyebrow: 'Campaign closes',
          label: 'Days to Give',
          color: GOLD,
          bgColor: 'rgba(20,26,58,0.55)',
          fontFamily: SERIF,
        },
      },
      // ── Ways to give ──
      {
        name: 'Ways to Give',
        widgetType: 'ANNOUNCEMENT',
        x: 62, y: 50, width: 32, height: 18,
        zIndex: 2,
        sortOrder: 4,
        defaultConfig: {
          title: 'Three ways to give',
          message: 'Text GIVE to your church number · Giving app · Offering box in the lobby',
          badgeLabel: 'GIVE',
          icon: '💛',
          color: CREAM,
          bgColor: 'rgba(20,26,58,0.55)',
          fontFamily: SERIF,
        },
      },
      // ── Scripture footer on generosity ──
      {
        name: 'Generosity Verse',
        widgetType: 'TEXT',
        x: 6, y: 70, width: 88, height: 22,
        zIndex: 2,
        sortOrder: 5,
        defaultConfig: {
          content:
            '"Each of you should give what you have decided in your heart to give, not reluctantly or under compulsion, for God loves a cheerful giver." — 2 Corinthians 9:7',
          fontSize: 60,
          color: '#e9ddc2',
          alignment: 'center',
          italic: true,
          fontFamily: SERIF,
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Preset 7 — Verse of the Day
  // A quiet, parchment-toned scripture card — a single verse set large
  // and centered with the reference beneath, framed by a warm light.
  // For the prayer room, hallway, or a calm rotation between services.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'worship-verse-of-the-day',
    name: 'Verse of the Day',
    description:
      'A quiet, parchment-toned scripture card — a single verse set large and centered with the reference beneath, framed by warm light. Edit the verse text and reference for each day or season; change the colors and font to match your church. Perfect for a prayer room, hallway, or a calm rotation on the lobby screen between services.',
    category: 'SERMON',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: CREAM,
    bgGradient: PARCHMENT_BG,
    zones: [
      // ── Eyebrow ──
      {
        name: 'Eyebrow',
        widgetType: 'TEXT',
        x: 12, y: 14, width: 76, height: 8,
        zIndex: 3,
        sortOrder: 1,
        defaultConfig: {
          content: 'VERSE OF THE DAY',
          fontSize: 48,
          color: BURGUNDY,
          alignment: 'center',
          bold: true,
          fontFamily: SERIF,
        },
      },
      // ── The verse (large, centered) ──
      {
        name: 'Verse',
        widgetType: 'TEXT',
        x: 8, y: 24, width: 84, height: 46,
        zIndex: 2,
        sortOrder: 2,
        defaultConfig: {
          content:
            '"The Lord is my shepherd, I lack nothing. He makes me lie down in green pastures, he leads me beside quiet waters, he refreshes my soul."',
          fontSize: 96,
          color: '#1c2440',
          alignment: 'center',
          italic: true,
          lineHeight: 1.3,
          fontFamily: SERIF,
        },
      },
      // ── Reference ──
      {
        name: 'Reference',
        widgetType: 'TEXT',
        x: 12, y: 72, width: 76, height: 10,
        zIndex: 2,
        sortOrder: 3,
        defaultConfig: {
          content: '— Psalm 23:1–3',
          fontSize: 56,
          color: BURGUNDY,
          alignment: 'center',
          bold: true,
          fontFamily: SERIF,
        },
      },
      // ── Gentle footer line ──
      {
        name: 'Footer',
        widgetType: 'TEXT',
        x: 12, y: 84, width: 76, height: 8,
        zIndex: 2,
        sortOrder: 4,
        defaultConfig: {
          content: 'Be still, and know.',
          fontSize: 48,
          color: '#7a6a48',
          alignment: 'center',
          italic: true,
          fontFamily: SERIF,
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Preset 8 — Welcome Lobby Hub
  // The all-in-one foyer board for churches with a single screen: a
  // greeting, the current time, a service countdown, this week's top
  // events, and an announcements ticker — everything a guest needs in
  // one glance. The most "loaded" preset; great as a starting canvas.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'worship-lobby-hub',
    name: 'Welcome Lobby Hub',
    description:
      'All-in-one foyer board for a church running a single lobby screen — a welcome greeting, the current time, a countdown to the next service, this week\'s top events, and a rolling announcements ticker, all in one reverent layout. Every panel is editable and recolors to your church. The richest starting canvas: trim what you don\'t need or build from here.',
    category: 'SERVICE',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: NAVY,
    bgGradient: SANCTUARY_BG,
    zones: [
      // ── Greeting headline ──
      {
        name: 'Greeting',
        widgetType: 'TEXT',
        x: 4, y: 4, width: 62, height: 14,
        zIndex: 3,
        sortOrder: 1,
        defaultConfig: {
          content: 'Welcome — We\'re Glad You\'re Here',
          fontSize: 96,
          color: GOLD,
          alignment: 'left',
          bold: true,
          fontFamily: SERIF,
        },
      },
      // ── Clock (top-right) ──
      {
        name: 'Now',
        widgetType: 'CLOCK',
        x: 68, y: 4, width: 28, height: 14,
        zIndex: 3,
        sortOrder: 2,
        defaultConfig: {
          format: '12h',
          showSeconds: false,
          showDate: true,
        },
      },
      // ── Service countdown (left column) ──
      {
        name: 'Service Countdown',
        widgetType: 'COUNTDOWN',
        x: 4, y: 20, width: 30, height: 38,
        zIndex: 2,
        sortOrder: 3,
        defaultConfig: {
          eyebrow: 'Next gathering',
          label: 'Worship Begins In',
          color: GOLD,
          bgColor: 'rgba(20,26,58,0.55)',
          fontFamily: SERIF,
        },
      },
      // ── Welcome note (left column, under countdown) ──
      {
        name: 'Guest Note',
        widgetType: 'ANNOUNCEMENT',
        x: 4, y: 60, width: 30, height: 30,
        zIndex: 2,
        sortOrder: 4,
        defaultConfig: {
          title: 'First time here?',
          message:
            'Stop by the Welcome Center for a gift, a map, and a friendly face. Kids check-in is just inside the main doors.',
          badgeLabel: 'GUESTS',
          icon: '✝️',
          color: CREAM,
          bgColor: 'rgba(91,18,36,0.42)',
          fontFamily: SERIF,
        },
      },
      // ── This week's events (right two-thirds) ──
      {
        name: 'This Week',
        widgetType: 'CALENDAR',
        x: 36, y: 20, width: 60, height: 50,
        zIndex: 2,
        sortOrder: 5,
        defaultConfig: {
          title: 'This Week at Church',
          maxEvents: 5,
          events: [
            { title: 'Sunday Worship — 9:00 & 11:00am', date: 'Sunday', color: GOLD },
            { title: 'Midweek Bible Study', date: 'Wednesday · 7:00pm', color: '#9bb0e6' },
            { title: 'Youth Group — Grades 6–12', date: 'Friday · 6:30pm', color: GOLD },
            { title: 'Community Food Pantry', date: 'Saturday · 9:00am', color: '#9bb0e6' },
            { title: 'Newcomers Lunch', date: 'Next Sunday', color: '#e0879a' },
          ],
        },
      },
      // ── Verse band (right, under events) ──
      {
        name: 'Verse',
        widgetType: 'TEXT',
        x: 36, y: 72, width: 60, height: 18,
        zIndex: 2,
        sortOrder: 6,
        defaultConfig: {
          content:
            '"Let everything that has breath praise the Lord." — Psalm 150:6',
          fontSize: 60,
          color: '#e9ddc2',
          alignment: 'center',
          italic: true,
          fontFamily: SERIF,
        },
      },
      // ── Announcements ticker ──
      {
        name: 'Announcements Ticker',
        widgetType: 'TICKER',
        x: 0, y: 92, width: 100, height: 8,
        zIndex: 4,
        sortOrder: 7,
        defaultConfig: {
          messages: [
            '☕ Coffee & fellowship after every service in the Welcome Center',
            '🙏 Need prayer? Our team is up front following the message',
            '📱 Text CONNECT to your church number to get plugged in',
            '👶 Safe, loving kids ministry for every age — check in at the lobby',
          ],
          speed: 'normal',
        },
      },
    ],
  },
];
