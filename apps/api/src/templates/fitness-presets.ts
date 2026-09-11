/**
 * Fitness vertical — template presets.
 *
 * Kept in its own file (not appended to system-presets.ts) so the
 * EDU vertical stays uncontaminated and we can later gate these
 * behind Tenant.vertical = 'FITNESS' without touching the K-12
 * preset list.
 *
 * Visual DNA (deliberately different from EDU's warm / playful /
 * Fredoka palette):
 *   - Dark charcoal backgrounds
 *   - Neon accent colors per zone (green for music, red for live
 *     TV, amber for ads)
 *   - Outfit / Inter Mono typography
 *   - High contrast, high energy — Peloton / Equinox aesthetic
 *
 * Widgets used:
 *   • FITNESS_LIVE_TV           — live/streaming video pane
 *   • FITNESS_MUSIC_PLAYER      — now-playing + equalizer
 *   • FITNESS_AD_BANNER         — rotating promo creative
 *   • FITNESS_CLASS_SCHEDULE    — today's gym classes
 *   • FITNESS_TRAINING_VIDEO    — equipment tutorial loop
 *   • FITNESS_WORKOUT_TIMER     — HIIT/Tabata countdown
 *   • FITNESS_MOTIVATIONAL_QUOTE — rotating quotes
 *   • CLOCK / TICKER / WEATHER  — shared with EDU (vertical-agnostic)
 */

import type { SystemPreset } from './system-presets';

export const FITNESS_TEMPLATE_PRESETS: SystemPreset[] = [
  {
    id: 'fitness-cardio-hub',
    name: 'Cardio Floor Hub',
    description:
      'The default screen for a cardio floor: live TV takes the majority of the canvas, a now-playing music panel sits beside it, rotating ads along the right rail, and a motivational ticker runs along the bottom. Works in landscape on any 16:9 wall-mount TV.',
    category: 'FITNESS',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor: '#07070c',
    // Subtle charcoal gradient + radial glow in the corners so the
    // zones sit on a lit stage rather than a flat black canvas.
    bgGradient:
      'radial-gradient(900px 500px at 20% 10%, rgba(57,255,20,0.08), transparent 60%),' +
      'radial-gradient(800px 450px at 80% 90%, rgba(255,42,77,0.08), transparent 60%),' +
      'linear-gradient(135deg, #07070c 0%, #0f0f16 50%, #07070c 100%)',
    zones: [
      // ── LIVE TV — anchors the scene, ~60% of the canvas ──
      {
        name: 'Live TV',
        widgetType: 'FITNESS_LIVE_TV',
        x: 2, y: 6, width: 60, height: 68,
        zIndex: 2,
        sortOrder: 1,
        defaultConfig: {
          streamType: 'demo',
          channelName: 'GYM-TV',
          accentColor: '#ff2a4d',
          muted: true,
        },
      },
      // ── Music now-playing — right of live TV ──
      {
        name: 'Now Playing',
        widgetType: 'FITNESS_MUSIC_PLAYER',
        x: 64, y: 6, width: 34, height: 44,
        zIndex: 2,
        sortOrder: 2,
        defaultConfig: {
          provider: 'demo',
          trackTitle: 'Titanium',
          artist: 'David Guetta ft. Sia',
          zoneLabel: 'CARDIO FLOOR',
          accentColor: '#39ff14',
          durationSeconds: 245,
        },
      },
      // ── Clock — compact chrome below the music widget, tiny and high-contrast ──
      {
        name: 'Clock',
        widgetType: 'CLOCK',
        x: 64, y: 52, width: 34, height: 12,
        zIndex: 2,
        sortOrder: 3,
        defaultConfig: {
          theme: 'default',
          format: '12h',
          showSeconds: false,
          showDate: true,
        },
      },
      // ── Ad banner — bottom-right corner, rotates promos ──
      {
        name: 'Featured Promotion',
        widgetType: 'FITNESS_AD_BANNER',
        x: 64, y: 66, width: 34, height: 22,
        zIndex: 2,
        sortOrder: 4,
        defaultConfig: {
          rotationMs: 8000,
          accentColor: '#fbbf24',
          showAdBadge: true,
          enableImpressionLogging: true,
        },
      },
      // ── Motivational ticker across the very bottom ──
      {
        name: 'Motivational Ticker',
        widgetType: 'TICKER',
        x: 2, y: 76, width: 60, height: 12,
        zIndex: 2,
        sortOrder: 5,
        defaultConfig: {
          messages: [
            '🔥 You vs. you yesterday · That\'s the only rep that counts',
            '💪 Small steps. Big results. · Keep going',
            '⚡ Strong is the new skinny · Welcome to the grind',
            '🏋️ 10 minutes beats 0 minutes · Always',
          ],
          speed: 'normal',
          theme: 'default',
          textColor: '#ffffff',
          bgColor: 'rgba(0,0,0,0.4)',
        },
      },
      // ── Full-width bottom ad rail — another impression slot ──
      {
        name: 'Bottom Promo Rail',
        widgetType: 'FITNESS_AD_BANNER',
        x: 2, y: 90, width: 96, height: 8,
        zIndex: 2,
        sortOrder: 6,
        defaultConfig: {
          rotationMs: 10000,
          accentColor: '#00d4ff',
          showAdBadge: true,
          enableImpressionLogging: true,
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Preset 2 — Weight Floor Hub
  // For the free-weight and machine floor: equipment tutorials take
  // the majority of the screen, a workout timer sits top-right so
  // members pacing sets can see time at a glance, now-playing music
  // fills the gap, and motivational quotes ticker along the bottom.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'fitness-weight-floor',
    name: 'Weight Floor Hub',
    description:
      'For the free-weight and machine floor: equipment tutorials take the majority of the screen, a workout timer sits top-right so members pacing sets can see time at a glance, now-playing music fills the gap, and motivational quotes ticker along the bottom. Works in landscape on any 16:9 wall-mount TV.',
    category: 'FITNESS',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor: '#07070c',
    // Charcoal base + red/crimson radial glow on the left (where the
    // training video anchors) and a cooler deep-red bleed bottom-right
    // to reinforce the weight-room energy without washing out the timer.
    bgGradient:
      'radial-gradient(900px 500px at 15% 50%, rgba(255,42,77,0.10), transparent 60%),' +
      'radial-gradient(600px 400px at 85% 90%, rgba(180,0,40,0.08), transparent 60%),' +
      'linear-gradient(135deg, #07070c 0%, #100808 50%, #07070c 100%)',
    zones: [
      // ── Training video — anchors the left, ~60% wide × 65% tall ──
      {
        name: 'Equipment Tutorial',
        widgetType: 'FITNESS_TRAINING_VIDEO',
        x: 2, y: 4, width: 59, height: 64,
        zIndex: 2,
        sortOrder: 1,
        defaultConfig: {
          accentColor: '#ff2a4d',
          equipmentName: 'LEG PRESS',
          videoUrl: '',          // operator pastes a URL in the editor
          safetyTips: [
            'Keep your back flat against the pad',
            'Do not lock your knees at full extension',
            'Control the descent — 3 seconds down',
          ],
        },
      },
      // ── Workout timer — top-right quadrant, ~35% wide × 38% tall ──
      {
        name: 'Superset Timer',
        widgetType: 'FITNESS_WORKOUT_TIMER',
        x: 63, y: 4, width: 35, height: 37,
        zIndex: 2,
        sortOrder: 2,
        defaultConfig: {
          mode: 'tabata',
          workSeconds: 40,
          restSeconds: 20,
          totalRounds: 8,
          classTitle: 'SUPERSET TIMER',
          accentColor: '#ff2a4d',
        },
      },
      // ── Music now-playing — bottom-right, below the timer ──
      {
        name: 'Now Playing',
        widgetType: 'FITNESS_MUSIC_PLAYER',
        x: 63, y: 43, width: 35, height: 25,
        zIndex: 2,
        sortOrder: 3,
        defaultConfig: {
          provider: 'demo',
          trackTitle: 'Barbell Symphony',
          artist: 'Iron District',
          zoneLabel: 'WEIGHT FLOOR',
          accentColor: '#ff2a4d',
        },
      },
      // ── Motivational quotes — bottom-left, beside the training video ──
      {
        name: 'Motivational Quotes',
        widgetType: 'FITNESS_MOTIVATIONAL_QUOTE',
        x: 2, y: 70, width: 59, height: 22,
        zIndex: 2,
        sortOrder: 4,
        defaultConfig: {
          accentColor: '#ff2a4d',
          rotationMs: 9000,
          transitionStyle: 'fade',
          quotes: [
            'The bar doesn\'t care about your feelings. Neither do the results.',
            'Strength is built in the moments you want to quit.',
            'Every rep is a vote for the person you\'re becoming.',
            'Don\'t count the reps — make the reps count.',
          ],
        },
      },
      // ── Ticker — very bottom, full width, strength-themed messages ──
      {
        name: 'Strength Tips Ticker',
        widgetType: 'TICKER',
        x: 2, y: 93, width: 96, height: 6,
        zIndex: 2,
        sortOrder: 5,
        defaultConfig: {
          messages: [
            '🏋️ Progressive overload: add 2.5 lb to the bar each session and watch the PRs stack',
            '💪 Compound first — squat, deadlift, press — then accessories',
            '🔴 Rest 2–3 min between heavy sets; your CNS needs it',
            '⚡ Log every lift. If it\'s not tracked, it didn\'t happen.',
          ],
          speed: 'normal',
          theme: 'default',
          textColor: '#ffffff',
          bgColor: 'rgba(0,0,0,0.45)',
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Preset 3 — Lobby Welcome
  // The first screen members see when they check in: today's class
  // schedule dominates the canvas, a rotating ad banner fills the
  // right rail for gym promos and local-business spots, live weather
  // + clock pin the top corners, and motivational quotes run along
  // the bottom.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'fitness-lobby-welcome',
    name: 'Lobby Welcome',
    description:
      'The first screen members see when they check in: today\'s class schedule dominates the canvas, a rotating ad banner fills the right rail for gym promos and local-business spots, live weather + clock pin the top corners, and motivational quotes run along the bottom. Works in landscape on any 16:9 reception or front-desk display.',
    category: 'FITNESS',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor: '#07070c',
    // Charcoal base + cool blue/cyan radial glows — welcoming rather
    // than aggressive; mirrors the vibe of a well-lit gym lobby.
    bgGradient:
      'radial-gradient(800px 450px at 10% 15%, rgba(0,212,255,0.09), transparent 60%),' +
      'radial-gradient(700px 400px at 90% 85%, rgba(0,120,200,0.07), transparent 60%),' +
      'linear-gradient(135deg, #07070c 0%, #070f16 50%, #07070c 100%)',
    zones: [
      // ── Clock — top-left corner, compact ──
      {
        name: 'Clock',
        widgetType: 'CLOCK',
        x: 2, y: 2, width: 18, height: 11,
        zIndex: 2,
        sortOrder: 1,
        defaultConfig: {
          theme: 'default',
          format: '12h',
          showSeconds: false,
          showDate: true,
        },
      },
      // ── Weather — top-right corner, same height as clock ──
      {
        name: 'Weather',
        widgetType: 'WEATHER',
        x: 80, y: 2, width: 18, height: 11,
        zIndex: 2,
        sortOrder: 2,
        defaultConfig: {
          units: 'imperial',
          showForecast: false,
        },
      },
      // ── Class schedule — left band, tall, starts just below the header ──
      {
        name: 'Today\'s Classes',
        widgetType: 'FITNESS_CLASS_SCHEDULE',
        x: 2, y: 15, width: 55, height: 69,
        zIndex: 2,
        sortOrder: 3,
        defaultConfig: {
          accentColor: '#00d4ff',
          title: 'TODAY\'S CLASSES',
          highlightNextClass: true,
          maxRows: 8,
        },
      },
      // ── Ad banner — right rail, mirrors the schedule height ──
      {
        name: 'Featured Promotion',
        widgetType: 'FITNESS_AD_BANNER',
        x: 59, y: 15, width: 39, height: 69,
        zIndex: 2,
        sortOrder: 4,
        defaultConfig: {
          rotationMs: 10000,
          accentColor: '#fbbf24',
          showAdBadge: true,
          enableImpressionLogging: true,
        },
      },
      // ── Motivational quotes — full-width band near the bottom ──
      {
        name: 'Motivational Quotes',
        widgetType: 'FITNESS_MOTIVATIONAL_QUOTE',
        x: 2, y: 86, width: 96, height: 13,
        zIndex: 2,
        sortOrder: 5,
        defaultConfig: {
          accentColor: '#00d4ff',
          rotationMs: 8000,
          transitionStyle: 'crossfade',
          quotes: [
            'The only bad workout is the one that didn\'t happen.',
            'Show up. Every single day. That\'s the whole secret.',
            'Stronger than yesterday — that\'s the only goal.',
            'Your future self is watching you right now. Make it count.',
          ],
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Preset 4 — Streaming Hub
  // A Google-TV-style "app launcher" display — members see every
  // streaming service the gym has configured as a big visual grid.
  // Pair this with a connected streaming stick and the gym can
  // launch Netflix, Peacock, YouTube TV, or any FAST channel on
  // any TV from the dashboard.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'fitness-streaming-hub',
    name: 'Streaming Hub',
    description:
      'A Google-TV-style "app launcher" display — members see every streaming service the gym has configured as a big visual grid. Pair this with a connected streaming stick and the gym can launch Netflix, Peacock, YouTube TV, or any FAST channel on any TV from the dashboard.',
    category: 'FITNESS',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor: '#07070c',
    bgGradient:
      'radial-gradient(900px 500px at 20% 10%, rgba(0,212,255,0.10), transparent 60%),' +
      'radial-gradient(800px 450px at 80% 90%, rgba(168,85,247,0.08), transparent 60%),' +
      'linear-gradient(135deg, #07070c 0%, #0f0f16 50%, #07070c 100%)',
    zones: [
      {
        name: 'App Library',
        widgetType: 'FITNESS_APP_LIBRARY',
        x: 0, y: 0, width: 100, height: 88,
        zIndex: 2,
        sortOrder: 1,
        defaultConfig: {
          title: 'STREAMING LIBRARY',
          stickStatus: 'online',
          stickCount: 1,
          accentColor: '#00d4ff',
        },
      },
      {
        name: 'Motivational Ticker',
        widgetType: 'TICKER',
        x: 0, y: 90, width: 100, height: 10,
        zIndex: 2,
        sortOrder: 2,
        defaultConfig: {
          messages: [
            '🎬 Pick any service · Watch on any TV',
            '💪 Scheduled Netflix at 6pm · CNN at 7am',
            '📺 300+ free channels · Plus all your subscriptions',
          ],
          speed: 'normal',
          theme: 'default',
          textColor: '#ffffff',
          bgColor: 'rgba(0,0,0,0.4)',
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Preset — Stadium (4K Cardio Floor scene, Themed)
  //
  // Sprint 8c follow-up (2026-05-03). Drop-in 4K scene built from the
  // approved scratch/design/fitness/01-stadium.html mockup. Single
  // FITNESS_STADIUM zone fills the canvas — every editable hotspot
  // (LIVE / channel / clock / TV mark / now-playing / promo / stats /
  // ticker) is a `data-field` text node the PropertiesPanel auto-form
  // exposes via the FITNESS_STADIUM_DEFAULTS export.
  //
  // Use case: cardio floor TV, "we want one cool wallpaper" gyms
  // that don't want to lay out individual zones. The scene IS the
  // template.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'fitness-stadium',
    name: 'Stadium — Broadcast Cardio Floor',
    description:
      'Massive Jumbotron-style cardio scene — LIVE scorebug ribbon, 2300×1280 TV pane on the left, music + promo cards on the right rail, four neon-accented stats, scrolling neon-yellow ticker on the bottom. Charcoal + neon yellow + hot red palette. 4K canvas; auto-fits any 16:9 screen.',
    category: 'FITNESS',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#07070c',
    zones: [
      {
        name: 'Stadium scene',
        widgetType: 'FITNESS_STADIUM',
        x: 0, y: 0, width: 100, height: 100,
        zIndex: 1,
        sortOrder: 1,
        defaultConfig: {
          // Defaults are baked into the widget via FITNESS_STADIUM_DEFAULTS;
          // the operator's customizations land here as field overrides.
          liveClock: true,
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Iron — Weight Floor
  // Brutalist concrete + caution-tape header + plate-stack rail.
  // Ported from scratch/design/fitness/02-iron.html.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'fitness-iron',
    name: 'Iron — Weight Floor',
    description:
      'Brutalist concrete weight-floor scene — caution-tape header ribbon, plate-stack rail, giant outlined stencil section number, tutorial pane with form cues, hero countdown timer, dashed quote panel, plate-stack ticker. Hot red + caution yellow on charcoal.',
    category: 'FITNESS',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#181816',
    zones: [{
      name: 'Iron scene', widgetType: 'FITNESS_IRON',
      x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 1,
      defaultConfig: { liveClock: true },
    }],
  },

  // ════════════════════════════════════════════════════════════════
  // Marquee — Events Board
  // Vegas marquee bulb-border events board.
  // Ported from scratch/design/fitness/03-marquee.html.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'fitness-marquee',
    name: 'Marquee — Events Board',
    description:
      'Vegas-style marquee with chasing bulb border, gold-leaf chrome, neon "TONIGHT" headline, three-column event cards with playbills, drop-shadow ticker. Ideal for boutique studios advertising classes / events.',
    category: 'FITNESS',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#0a0a0c',
    zones: [{
      name: 'Marquee scene', widgetType: 'FITNESS_MARQUEE',
      x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 1,
      defaultConfig: { liveClock: true },
    }],
  },

  // ════════════════════════════════════════════════════════════════
  // Channel Guide — Streaming Library
  // Cable-TV channel guide for the gym's streaming app library.
  // Ported from scratch/design/fitness/04-channel-guide.html.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'fitness-channel-guide',
    name: 'Channel Guide — Streaming Library',
    description:
      "Old-school cable-TV channel guide grid for the gym's streaming app library. Now-watching preview pane on top, 16-channel grid below, sidebar with up-next + member CTA. Use this on a streaming hub TV so members see what's available.",
    category: 'FITNESS',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#040816',
    zones: [{
      name: 'Channel Guide scene', widgetType: 'FITNESS_CHANNEL_GUIDE',
      x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 1,
      defaultConfig: { liveClock: true },
    }],
  },

  // ════════════════════════════════════════════════════════════════
  // Discotheque — Disco Energy
  // Strobe + disco ball + lasers + BPM readout.
  // Ported from scratch/design/fitness/05-discotheque.html.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'fitness-discotheque',
    name: 'Discotheque — Disco Energy',
    description:
      'Pink + violet disco energy — animated disco ball glow, strobe-style headline, BPM readout, class promo. Built for studios running cardio / dance / Zumba blocks where the music IS the workout.',
    category: 'FITNESS',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#0c061a',
    zones: [{
      name: 'Discotheque scene', widgetType: 'FITNESS_DISCOTHEQUE',
      x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 1,
      defaultConfig: { },
    }],
  },

  // ════════════════════════════════════════════════════════════════
  // Locker — Locker Room Board
  // Corkboard + polaroid pinned-up vibe.
  // Ported from scratch/design/fitness/06-locker.html.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'fitness-locker',
    name: 'Locker — Locker Room Board',
    description:
      'Locker-room corkboard with pinned polaroids, shift schedule, member-of-the-week, hand-written name tags. Warm cream + hot orange accents. Perfect for the locker room or staff hallway.',
    category: 'FITNESS',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#1a1814',
    zones: [{
      name: 'Locker scene', widgetType: 'FITNESS_LOCKER',
      x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 1,
      defaultConfig: { },
    }],
  },

  // ════════════════════════════════════════════════════════════════
  // Splash — Pool Deck Board
  // Aquatic deck board with lane status + water temp.
  // Ported from scratch/design/fitness/07-splash.html.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'fitness-splash',
    name: 'Splash — Pool Deck Board',
    description:
      'Aquatic deck board — lane status (open / full / closed), pool hours, water temp, weather, lifeguard schedule. Aqua + cyan + chrome palette. Built for the pool wall.',
    category: 'FITNESS',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#04222e',
    zones: [{
      name: 'Splash scene', widgetType: 'FITNESS_SPLASH',
      x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 1,
      defaultConfig: { },
    }],
  },

  // ════════════════════════════════════════════════════════════════
  // Telemetry — Data Bridge
  // Spaceship-style live readout dashboard.
  // Ported from scratch/design/fitness/08-telemetry.html.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'fitness-telemetry',
    name: 'Telemetry — Data Bridge',
    description:
      "Spaceship-style data dashboard — live HH:MM:SS clock with blinking cursor, leaderboard table, gauges, athlete check-in feed. Phosphor green + cyan on midnight black. The closest a gym gets to looking like a NASA control room.",
    category: 'FITNESS',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#020608',
    zones: [{
      name: 'Telemetry scene', widgetType: 'FITNESS_TELEMETRY',
      x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 1,
      defaultConfig: { liveClock: true },
    }],
  },

  // ════════════════════════════════════════════════════════════════
  // Crag — Climbing Route Board
  // Indoor climbing-gym route board.
  // Ported from scratch/design/fitness/09-crag.html.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'fitness-crag',
    name: 'Crag — Climbing Route Board',
    description:
      'Indoor climbing-gym route board — 8-route table with grade, send count, top time, route setter. Stone + earth-tone palette. Built for the climbing wall lobby.',
    category: 'FITNESS',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#1a140e',
    zones: [{
      name: 'Crag scene', widgetType: 'FITNESS_CRAG',
      x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 1,
      defaultConfig: { },
    }],
  },

  // ════════════════════════════════════════════════════════════════
  // Cornerman — Boxing Corner
  // Boxing/MMA corner board — round timer + entrance music.
  // Ported from scratch/design/fitness/10-cornerman.html.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'fitness-cornerman',
    name: 'Cornerman — Boxing Corner',
    description:
      "Boxing / MMA corner board — round timer, current workout block, entrance music vinyl card, opponent / VS card. Ring-rope textures and red-corner accents. For boxing gyms running circuit work.",
    category: 'FITNESS',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#0a0608',
    zones: [{
      name: 'Cornerman scene', widgetType: 'FITNESS_CORNERMAN',
      x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 1,
      defaultConfig: { },
    }],
  },

  // ════════════════════════════════════════════════════════════════
  // Recess — Playful Block
  // Block-letter playground vibe.
  // Ported from scratch/design/fitness/11-recess.html.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'fitness-recess',
    name: 'Recess — Playful Block',
    description:
      'Block-letter playground board — colorful chunky type, kid schedule grid, recess countdown. Built for kids-fitness, after-school programs, or anywhere a playful palette beats the serious one.',
    category: 'FITNESS',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#fff7d6',
    zones: [{
      name: 'Recess scene', widgetType: 'FITNESS_RECESS',
      x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 1,
      defaultConfig: { },
    }],
  },

  // ════════════════════════════════════════════════════════════════
  // Reformer — Boutique Pilates
  // Boutique pilates studio board.
  // Ported from scratch/design/fitness/12-reformer.html.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'fitness-reformer',
    name: 'Reformer — Boutique Pilates',
    description:
      'Boutique pilates studio board — class moves card, spring-tension legend, instructor spotlight, breathing cue ribbon. Sage + cream + brass palette. Built for reformer pilates studios.',
    category: 'FITNESS',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#f4ede0',
    zones: [{
      name: 'Reformer scene', widgetType: 'FITNESS_REFORMER',
      x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 1,
      defaultConfig: { },
    }],
  },

  // ════════════════════════════════════════════════════════════════
  // Trailhead — Outdoor / Running Club
  // Hiking-trail board — running club routes + conditions.
  // Ported from scratch/design/fitness/13-trailhead.html.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'fitness-trailhead',
    name: 'Trailhead — Running Club',
    description:
      'Outdoor running-club / trail-running board — route cards with mile/elevation/condition, sunrise/sunset, weather alert strip. Forest green + earth-tone palette. Built for running clubs, outdoor outfitters, ultra training facilities.',
    category: 'FITNESS',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#0e1a14',
    zones: [{
      name: 'Trailhead scene', widgetType: 'FITNESS_TRAILHEAD',
      x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 1,
      defaultConfig: { },
    }],
  },

  // ════════════════════════════════════════════════════════════════
  // Vault — CrossFit Box WOD Board
  // CrossFit-style WOD whiteboard with leaderboard + foundation stats.
  // Ported from scratch/design/fitness/14-vault.html.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'fitness-vault',
    name: 'Vault — CrossFit WOD Board',
    description:
      'CrossFit-box WOD whiteboard — chalk text on green-board panel, 8-row daily leaderboard, foundation strip with 5 active stats, day/cycle counter. Safety orange + warning yellow on concrete charcoal. The classic box look.',
    category: 'FITNESS',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#3a3a3c',
    zones: [{
      name: 'Vault scene', widgetType: 'FITNESS_VAULT',
      x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 1,
      defaultConfig: { },
    }],
  },

  // ════════════════════════════════════════════════════════════════
  // Lobby — Premium Concierge
  // Boutique-hotel vibe — recovery booking, member greeting.
  // Ported from scratch/design/fitness/15-lobby.html.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'fitness-lobby',
    name: 'Lobby — Premium Concierge',
    description:
      'Premium concierge / spa lobby board — member greeting hero, recovery booking grid (saunas / massage / cryo), valet + coffee + news cards. Warm dark + brass + emerald palette. Built for boutique gyms with hospitality services.',
    category: 'FITNESS',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#13100c',
    zones: [{
      name: 'Lobby scene', widgetType: 'FITNESS_LOBBY',
      x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 1,
      defaultConfig: { },
    }],
  },

  // ════════════════════════════════════════════════════════════════
  // Gym Media Command Center — three directions × two orientations
  // (2026-08-24 design round).
  //
  // Landscape and portrait are SEPARATELY COMPOSED documents, not one
  // scene reflowed: each is a fixed stage at its own design size that
  // scales as a whole, so a 4K panel is an exact 2x of the same
  // composition. Do not merge them into a single reflowing board.
  //
  // Every board renders SOURCE NOT CONFIGURED until a media source is
  // connected and the host resolves real state — the badge is owned by
  // _media-runtime.js, never by operator text. See that file's header
  // for why the status labels are not editable fields.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'fitness-media-pulsecast',
    name: '📺 Media — PulseCast Broadcast Control',
    description:
      'Broadcast-control media board — full-bleed program video with a right-hand programming rail: what is on now, the next three sessions, live club clock, and a source/rights strip along the bottom. Connect a media source directly from the editor; the board states exactly what is connected and never claims a live feed it does not have.',
    category: 'FITNESS',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor: '#0b0911',
    zones: [{
      name: 'Media scene', widgetType: 'EXTERNAL_HTML',
      x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 1,
      defaultConfig: { url: '/templates/fitness/gym-media-pulsecast.html' },
    }],
  },
  {
    id: 'fitness-media-pulsecast-portrait',
    name: '📺 Media — PulseCast Broadcast Control (Portrait)',
    description:
      'Portrait broadcast-control media board — separately composed 1080x1920 stage with stacked program hero, programming queue, club clock and source/rights strip. Same editable fields and same source connection as the landscape board.',
    category: 'FITNESS',
    orientation: 'PORTRAIT',
    screenWidth: 1080,
    screenHeight: 1920,
    bgColor: '#0b0911',
    zones: [{
      name: 'Media scene', widgetType: 'EXTERNAL_HTML',
      x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 1,
      defaultConfig: { url: '/templates/fitness/gym-media-pulsecast-portrait.html' },
    }],
  },
  {
    id: 'fitness-media-soundfloor',
    name: '🎧 Media — Soundfloor Music + Video',
    description:
      'Music-forward media board — program video above a licensed business-music panel showing the current track, provider, audio zone and playback route. The equalizer moves only while the music provider reports playing. Connect both the video and music sources from the editor.',
    category: 'FITNESS',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor: '#f4f1ea',
    zones: [{
      name: 'Media scene', widgetType: 'EXTERNAL_HTML',
      x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 1,
      defaultConfig: { url: '/templates/fitness/gym-media-soundfloor.html' },
    }],
  },
  {
    id: 'fitness-media-soundfloor-portrait',
    name: '🎧 Media — Soundfloor Music + Video (Portrait)',
    description:
      'Portrait music-forward media board — separately composed 1080x1920 stage with the program hero over the now-playing panel, provider/zone/rights lines, upcoming programming and a club note. Same sources and fields as the landscape board.',
    category: 'FITNESS',
    orientation: 'PORTRAIT',
    screenWidth: 1080,
    screenHeight: 1920,
    bgColor: '#f4f1ea',
    zones: [{
      name: 'Media scene', widgetType: 'EXTERNAL_HTML',
      x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 1,
      defaultConfig: { url: '/templates/fitness/gym-media-soundfloor-portrait.html' },
    }],
  },
  {
    id: 'fitness-media-motion-studio',
    name: '🧘 Media — Motion Studio Class Timeline',
    description:
      'Studio-class media board — instructor-led program poster with a class timeline (now, next, and the rest of the evening), coach and level detail, plus separate program and music status. Built for boutique studios running licensed class content on a schedule.',
    category: 'FITNESS',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor: '#0f0d14',
    zones: [{
      name: 'Media scene', widgetType: 'EXTERNAL_HTML',
      x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 1,
      defaultConfig: { url: '/templates/fitness/gym-media-motion-studio.html' },
    }],
  },
  {
    id: 'fitness-media-motion-studio-portrait',
    name: '🧘 Media — Motion Studio Class Timeline (Portrait)',
    description:
      'Portrait studio-class media board — separately composed 1080x1920 stage stacking the class poster, program detail and full evening timeline. Same editable fields and same source connection as the landscape board.',
    category: 'FITNESS',
    orientation: 'PORTRAIT',
    screenWidth: 1080,
    screenHeight: 1920,
    bgColor: '#0f0d14',
    zones: [{
      name: 'Media scene', widgetType: 'EXTERNAL_HTML',
      x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 1,
      defaultConfig: { url: '/templates/fitness/gym-media-motion-studio-portrait.html' },
    }],
  },
];
