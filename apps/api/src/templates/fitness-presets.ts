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
          showDemoWhenEmpty: true,
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
          showDemoWhenEmpty: true,
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
          showDemoWhenEmpty: true,
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
];
