/**
 * Bar / nightlife / sports-pub vertical — system template presets.
 *
 * Kept in its own file (not appended to system-presets.ts) so the
 * EDU vertical stays uncontaminated and the seed loader can tag the
 * rows with `vertical='BAR'` in one shot. Visual DNA is deliberately
 * different from EDU + GYM:
 *   - Charcoal #0a0a0a / deep amber / neon highlights
 *   - Beer/whiskey amber + neon cyan/magenta accents
 *   - Hand-drawn chalkboard for cocktails (cream-on-slate)
 *   - Big legible type — visible across a noisy bar room
 *   - Solid color blocks + emoji as fallback (🍺 🥃 🍷 🍸 🍹 🎤 🎮 🏈)
 *
 * Widgets used:
 *   • BAR_TAP_LIST              — beer-on-tap menu
 *   • BAR_COCKTAIL_MENU         — chalkboard signature cocktails
 *   • BAR_HAPPY_HOUR_COUNTDOWN  — full-bleed countdown to happy hour end
 *   • BAR_GAME_DAY_SCHEDULE     — sports schedule with channel hint
 *   • BAR_EVENT_TONIGHT         — band/show poster with doors + cover
 *   • BAR_TRIVIA_SCOREBOARD     — round + leaderboard + question countdown
 *   • CLOCK / TICKER / WEATHER / STREAMING — shared with other verticals
 */

import type { SystemPreset } from './system-presets';

export const BAR_TEMPLATE_PRESETS: SystemPreset[] = [
  // ════════════════════════════════════════════════════════════════
  // Preset 1 — Tap List Board
  // The default screen behind the bar: 16-tap craft list dominates
  // the canvas, a clock + bar logo pin the top corners, and a
  // "what's pouring" ticker scrolls along the bottom. Designed for
  // landscape 4K wall mounts visible from the entire room.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'bar-tap-list-board',
    name: 'Tap List Board',
    description:
      'Beer-on-tap menu for a craft taproom or sports pub. Up to 16 taps with brewery, style, ABV, IBU, and price. Renders in two columns with colored tap-handle indicators so the bartender can match the screen to the actual tap order. Works full-bleed on any 16:9 wall TV behind the bar.',
    category: 'TAPS',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#0a0a0a',
    bgGradient:
      'radial-gradient(900px 500px at 80% 100%, rgba(180,83,9,0.10), transparent 60%),' +
      'radial-gradient(700px 400px at 10% 0%, rgba(245,158,11,0.07), transparent 60%),' +
      'linear-gradient(160deg, #0a0a0a 0%, #0f0f10 50%, #0a0a0a 100%)',
    zones: [
      // ── Tap list — anchors the screen ──
      {
        name: 'Tap List',
        widgetType: 'BAR_TAP_LIST',
        x: 2, y: 4, width: 96, height: 84,
        zIndex: 2,
        sortOrder: 1,
        defaultConfig: {
          title: 'ON TAP',
          subtitle: '16 CRAFT & IMPORTS',
          columns: 2,
          accentColor: '#f59e0b',
        },
      },
      // ── Bottom ticker — what's new, what's running low ──
      {
        name: 'Bar Ticker',
        widgetType: 'TICKER',
        x: 2, y: 90, width: 96, height: 8,
        zIndex: 2,
        sortOrder: 2,
        defaultConfig: {
          messages: [
            '🍺 Cask night every Thursday · 8pm til kicked',
            '🥃 Whiskey flight $18 · pick any 3 American or Irish',
            '🎟️ $1 off pints with student ID · valid all week',
            '🌶️ Spicy margarita is back on the cocktail list',
          ],
          speed: 'normal',
          textColor: '#fef3c7',
          bgColor: 'rgba(0,0,0,0.55)',
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Preset 2 — Cocktail Menu
  // Chalkboard cocktail list — deep slate background, hand-lettered
  // titles, dotted-leader rows, garnish stamps. The "house & classics"
  // menu lives full-bleed; the eyebrow header keeps it grounded.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'bar-cocktail-menu',
    name: 'Cocktail Menu',
    description:
      "Chalkboard-style signature cocktail menu for a craft cocktail bar or speakeasy. Hand-lettered titles, ingredient lists, tasting notes, and garnish stamps in a slate texture with chalk-stroke dividers. Designed full-bleed for the wall behind the bar.",
    category: 'TAPS',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#1c1917',
    bgGradient:
      'radial-gradient(900px 500px at 30% 20%, rgba(255,255,255,0.04), transparent 60%),' +
      'radial-gradient(700px 400px at 80% 90%, rgba(255,255,255,0.03), transparent 60%),' +
      'linear-gradient(160deg, #1c1917 0%, #1f1d1b 50%, #1a1916 100%)',
    zones: [
      {
        name: 'Cocktail Menu',
        widgetType: 'BAR_COCKTAIL_MENU',
        x: 0, y: 0, width: 100, height: 100,
        zIndex: 2,
        sortOrder: 1,
        defaultConfig: {
          title: 'COCKTAILS',
          subtitle: 'House & Classics',
          footer: 'Ask your bartender · Tip well, drink well',
          columns: 2,
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Preset 3 — Game Day Hub
  // Sports bar centerpiece: a streaming pane up top (live game), a
  // full-width sports schedule below, a tap-list strip in a side
  // column for what to drink, and the bar ticker keeps the room
  // feeling alive between plays.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'bar-game-day-hub',
    name: 'Game Day Hub',
    description:
      "Sports-bar centerpiece for game day. Live stream pane in the top half, today's matchups schedule below it, a tap-list sidebar so customers know what to order, and a scrolling shoutout ticker along the bottom. Works full-bleed on the main TV in a sports bar.",
    category: 'SPORTS',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#0a0a0a',
    bgGradient:
      'radial-gradient(900px 500px at 80% 20%, rgba(239,68,68,0.10), transparent 60%),' +
      'radial-gradient(700px 400px at 20% 80%, rgba(34,211,238,0.07), transparent 60%),' +
      'linear-gradient(160deg, #0a0a0a 0%, #0c0a14 50%, #0a0a0a 100%)',
    zones: [
      // ── Live stream — main game pane ──
      {
        name: 'Main Game',
        widgetType: 'STREAMING',
        x: 2, y: 4, width: 64, height: 50,
        zIndex: 2,
        sortOrder: 1,
        defaultConfig: {
          channelId: '',
          channelName: 'MAIN GAME',
          accentColor: '#ef4444',
          muted: true,
        },
      },
      // ── Tap list sidebar — quick-glance "what to order" ──
      {
        name: 'Drinks On Tap',
        widgetType: 'BAR_TAP_LIST',
        x: 68, y: 4, width: 30, height: 70,
        zIndex: 2,
        sortOrder: 2,
        defaultConfig: {
          title: 'ON TAP',
          subtitle: 'GAME DAY POURS',
          columns: 1,
          accentColor: '#f59e0b',
        },
      },
      // ── Game schedule — bottom-left, today's matchups ──
      {
        name: "Today's Matchups",
        widgetType: 'BAR_GAME_DAY_SCHEDULE',
        x: 2, y: 56, width: 64, height: 34,
        zIndex: 2,
        sortOrder: 3,
        defaultConfig: {
          title: 'GAME DAY',
          subtitle: "TODAY'S MATCHUPS",
          accentColor: '#ef4444',
          maxRows: 5,
        },
      },
      // ── Happy hour countdown — bottom-right pocket ──
      {
        name: 'Happy Hour',
        widgetType: 'BAR_HAPPY_HOUR_COUNTDOWN',
        x: 68, y: 76, width: 30, height: 14,
        zIndex: 2,
        sortOrder: 4,
        defaultConfig: {
          title: 'HAPPY HOUR',
          subtitle: 'Tap drinks · Apps · House wine',
          startsAt: '4:00 PM',
          endsAt: '7:00 PM',
          accentColor: '#ec4899',
        },
      },
      // ── Bottom ticker — bar shoutouts + specials ──
      {
        name: 'Sports Ticker',
        widgetType: 'TICKER',
        x: 2, y: 92, width: 96, height: 6,
        zIndex: 2,
        sortOrder: 5,
        defaultConfig: {
          messages: [
            '🏈 Sunday football package on every TV · 13 games at once',
            '🍺 $5 domestic drafts during every game · all season',
            '🎉 Win prediction contest · scan QR at the bar',
            '🏆 Trivia night Tuesdays at 8 · winning team drinks free',
          ],
          speed: 'normal',
          textColor: '#fef3c7',
          bgColor: 'rgba(0,0,0,0.55)',
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Preset 4 — Live Event Tonight
  // Full-bleed gig poster — band name takes the screen, doors-open
  // and showtime cards beneath, cover charge in a stamp chip. The
  // EventTonightWidget handles all the layout; we just give it a
  // canvas to live on.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'bar-live-event-tonight',
    name: 'Live Event Tonight',
    description:
      'Gig-poster announcement for the night\'s live music, DJ set, or comedy show. Full-bleed artist name with magenta + cyan neon, doors-open and showtime cards, cover-charge stamp, and a footer line for door policy (21+, cash bar, etc). Status pivots automatically: BEFORE → DOORS OPEN → ON STAGE → AFTER.',
    category: 'EVENTS',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#160730',
    zones: [
      {
        name: 'Tonight Poster',
        widgetType: 'BAR_EVENT_TONIGHT',
        x: 0, y: 0, width: 100, height: 92,
        zIndex: 2,
        sortOrder: 1,
        defaultConfig: {
          eyebrow: 'TONIGHT',
          artist: 'THE STARLINERS',
          subtitle: 'with special guest Mara & The Beat',
          doorsAt: '8:00 PM',
          showAt: '9:00 PM',
          cover: '$10 cover',
          footer: '21+ · Cash bar · Doors close at midnight',
          accentColor: '#d946ef',
          accent2: '#22d3ee',
        },
      },
      {
        name: 'Showtime Ticker',
        widgetType: 'TICKER',
        x: 0, y: 92, width: 100, height: 8,
        zIndex: 2,
        sortOrder: 2,
        defaultConfig: {
          messages: [
            '🎟️ Tickets at the door · Cash + card accepted',
            '🎤 Open mic Wednesdays · Sign up at the bar',
            '🎶 Live music every Friday + Saturday',
            '📸 Tag us @yourbar to be featured on the wall',
          ],
          speed: 'normal',
          textColor: '#fef3c7',
          bgColor: 'rgba(0,0,0,0.55)',
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Preset 5 — Happy Hour Promo
  // Full-bleed countdown to happy hour end + featured drink prices.
  // Designed to live on a TV near the door from 4-7pm to pull in
  // walk-bys ("only 23 minutes left at $5 a pint").
  // ════════════════════════════════════════════════════════════════
  {
    id: 'bar-happy-hour-promo',
    name: 'Happy Hour Promo',
    description:
      "Full-bleed countdown to happy hour end with featured drink prices. Auto-pivots state through the day: BEFORE happy hour shows when it starts, ACTIVE shows the live countdown with strike-through prices, ENDED shows tomorrow's start time. Designed to live on a screen near the door to pull walk-bys in.",
    category: 'PROMO',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#18012a',
    zones: [
      {
        name: 'Happy Hour',
        widgetType: 'BAR_HAPPY_HOUR_COUNTDOWN',
        x: 0, y: 0, width: 100, height: 92,
        zIndex: 2,
        sortOrder: 1,
        defaultConfig: {
          title: 'HAPPY HOUR',
          subtitle: 'Tap drinks · House wine · Apps',
          startsAt: '4:00 PM',
          endsAt: '7:00 PM',
          accentColor: '#ec4899',
          drinks: [
            { name: 'Drafts',     regularPrice: '$8',  happyPrice: '$5',  emoji: '🍺' },
            { name: 'Wells',      regularPrice: '$11', happyPrice: '$7',  emoji: '🥃' },
            { name: 'House Red',  regularPrice: '$12', happyPrice: '$8',  emoji: '🍷' },
            { name: 'Margarita',  regularPrice: '$13', happyPrice: '$9',  emoji: '🍸' },
          ],
        },
      },
      {
        name: 'Promo Ticker',
        widgetType: 'TICKER',
        x: 0, y: 92, width: 100, height: 8,
        zIndex: 2,
        sortOrder: 2,
        defaultConfig: {
          messages: [
            '🍻 Happy hour every weekday 4-7pm',
            '🍕 $5 happy hour bites · pizza, wings, sliders',
            '🎉 Happy hour all day Sunday',
            '⏰ Power hour Tuesdays · half off everything 7-8pm',
          ],
          speed: 'normal',
          textColor: '#fef3c7',
          bgColor: 'rgba(0,0,0,0.55)',
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Preset 6 — Trivia Night Scoreboard
  // Trivia centerpiece: live leaderboard with medals + score deltas
  // + per-question countdown, room for a clock in the corner so the
  // host can pace the round, and a ticker with house rules / hashtag
  // / next round teaser.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'bar-trivia-night',
    name: 'Trivia Night Scoreboard',
    description:
      "Live trivia night centerpiece. Big leaderboard with medals for the top 3, score deltas (▲ +6 / ▼ -2), per-question countdown timer that flashes red in the last 10 seconds, and round / question status pills. Pairs with the host's tablet feeding scores. Designed for the main TV during Tuesday/Wednesday trivia nights.",
    category: 'EVENTS',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#06080a',
    zones: [
      // ── Scoreboard — anchors the canvas ──
      {
        name: 'Leaderboard',
        widgetType: 'BAR_TRIVIA_SCOREBOARD',
        x: 2, y: 4, width: 76, height: 84,
        zIndex: 2,
        sortOrder: 1,
        defaultConfig: {
          title: 'TRIVIA NIGHT',
          subtitle: 'LIVE LEADERBOARD',
          roundNumber: 3,
          totalRounds: 6,
          questionNumber: 4,
          totalQuestions: 10,
          accentColor: '#22c55e',
          maxRows: 6,
        },
      },
      // ── Side rail — clock + happy-hour mini countdown ──
      {
        name: 'Clock',
        widgetType: 'CLOCK',
        x: 80, y: 4, width: 18, height: 14,
        zIndex: 2,
        sortOrder: 2,
        defaultConfig: {
          theme: 'default',
          format: '12h',
          showSeconds: false,
          showDate: true,
        },
      },
      // ── Side rail — sponsor / next event teaser via announcement ──
      {
        name: 'Next Up',
        widgetType: 'ANNOUNCEMENT',
        x: 80, y: 20, width: 18, height: 30,
        zIndex: 2,
        sortOrder: 3,
        defaultConfig: {
          title: 'NEXT ROUND',
          message: 'Pop Culture · 80s & 90s movies, music, TV',
          accentColor: '#fbbf24',
        },
      },
      // ── Side rail — featured cocktail / round-1 prize ──
      {
        name: 'Round Prize',
        widgetType: 'ANNOUNCEMENT',
        x: 80, y: 52, width: 18, height: 36,
        zIndex: 2,
        sortOrder: 4,
        defaultConfig: {
          title: 'TONIGHT\'S PRIZE',
          message: '$50 bar tab + 2 t-shirts for the winning team · Bonus: free shots for the round leaders every round',
          accentColor: '#22c55e',
        },
      },
      // ── Bottom ticker — house rules + hashtag ──
      {
        name: 'Trivia Rules Ticker',
        widgetType: 'TICKER',
        x: 2, y: 90, width: 96, height: 8,
        zIndex: 2,
        sortOrder: 5,
        defaultConfig: {
          messages: [
            '🎯 No phones during questions · We see you, Smarty Pints',
            '🏆 Tag us with #YourBarTrivia for a chance at next week\'s prize',
            '🍻 Every wrong answer · take a sip · house rules',
            '⏰ 30 seconds per question · We\'re strict about it',
          ],
          speed: 'normal',
          textColor: '#fef3c7',
          bgColor: 'rgba(0,0,0,0.55)',
        },
      },
    ],
  },
];
