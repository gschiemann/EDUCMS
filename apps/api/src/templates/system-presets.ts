/**
 * System Template Presets — built-in, ready-to-use screen layouts
 * designed specifically for schools. Teachers pick a preset, and the
 * zones are pre-configured with the right widget types for each location.
 *
 * All coordinates are percentage-based (0–100) so they scale to any
 * screen resolution or aspect ratio. The player renders zones as
 * position:absolute CSS divs inside a 100% × 100% container.
 *
 * These are the STARTING POINTS — teachers can duplicate and customize.
 */

export interface SystemPreset {
  id: string;
  name: string;
  description: string;
  category: string;
  orientation: string;
  screenWidth?: number;
  screenHeight?: number;
  // Optional background applied template-wide. Any of these can be set;
  // the player layers them as:  bgImage on top of bgGradient on top of bgColor.
  bgColor?: string;       // solid color fallback — e.g. '#ffffff'
  bgGradient?: string;    // any valid CSS `background:` value (supports layered backgrounds + SVG data URIs)
  bgImage?: string;       // URL to a single background image
  zones: Array<{
    name: string;
    widgetType: string;
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex?: number;
    sortOrder?: number;
    defaultConfig?: Record<string, any>;
  }>;
}

// ═════════════════════════════════════════════════════════════════════════
// PREMIUM THEMED BACKGROUND — Sunny Meadow
// A layered CSS background: illustrated meadow hills at the bottom, stitched
// on top of a sky-blue → warm-yellow → peach gradient. Inline SVG is
// URL-encoded so it ships with the template and doesn't require any asset
// upload or network call.
// ═════════════════════════════════════════════════════════════════════════
const SUNNY_MEADOW_BG = (() => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 600' preserveAspectRatio='none'>
    <!-- distant hills -->
    <path d='M0,360 C320,290 640,410 960,330 C1280,270 1600,410 1920,320 L1920,600 L0,600 Z' fill='#86E09B' opacity='0.9'/>
    <!-- mid hills -->
    <path d='M0,440 C240,390 520,490 820,420 C1160,350 1480,480 1920,410 L1920,600 L0,600 Z' fill='#5BB36C'/>
    <!-- front hills -->
    <path d='M0,520 C300,480 620,550 960,510 C1280,475 1600,550 1920,505 L1920,600 L0,600 Z' fill='#4A9D5C'/>
    <!-- yellow flowers -->
    <g fill='#FFD166'>
      <circle cx='140' cy='540' r='7'/><circle cx='360' cy='560' r='6'/><circle cx='580' cy='535' r='7'/>
      <circle cx='820' cy='565' r='6'/><circle cx='1080' cy='540' r='7'/><circle cx='1320' cy='560' r='6'/>
      <circle cx='1560' cy='538' r='7'/><circle cx='1800' cy='565' r='6'/>
    </g>
    <!-- pink flowers -->
    <g fill='#FF8FAB'>
      <circle cx='230' cy='565' r='5'/><circle cx='490' cy='550' r='5'/><circle cx='720' cy='570' r='4'/>
      <circle cx='980' cy='558' r='5'/><circle cx='1220' cy='548' r='4'/><circle cx='1460' cy='565' r='5'/>
      <circle cx='1700' cy='550' r='4'/>
    </g>
    <!-- white flowers -->
    <g fill='#FFFFFF' opacity='0.85'>
      <circle cx='300' cy='548' r='4'/><circle cx='660' cy='555' r='4'/><circle cx='1020' cy='568' r='4'/>
      <circle cx='1400' cy='548' r='4'/><circle cx='1640' cy='572' r='4'/>
    </g>
  </svg>`;
  // URL-encode ( # and < and > and space etc ) so it's safe inside a CSS url("...")
  const encoded = svg
    .replace(/\n/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/#/g, '%23')
    .replace(/"/g, "'");
  return `url("data:image/svg+xml;utf8,${encoded}") no-repeat bottom / 100% 38%, linear-gradient(180deg, #BFE4FF 0%, #FFF1B8 55%, #FFD8A8 100%)`;
})();

export const SYSTEM_TEMPLATE_PRESETS: SystemPreset[] = [
  // ─────────────────────────────────────────────────────
  // ★ PREMIUM — Sunny Meadow (elementary lobby showcase)
  // Teachers pick this, configure names/messages, hit publish. Done.
  // ─────────────────────────────────────────────────────
  {
    id: 'preset-lobby-sunny-meadow',
    name: '☀️ Sunny Meadow — Elementary Welcome',
    description: 'A bright, illustrated welcome screen designed for elementary school lobbies. Playful rounded typography, animated sun, hand-drawn accents, and a polaroid-style Teacher of the Week. Zero design work needed — just fill in names and messages.',
    category: 'LOBBY',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgGradient: SUNNY_MEADOW_BG,
    zones: [
      {
        name: 'School Logo',
        widgetType: 'LOGO',
        x: 2, y: 3, width: 14, height: 14,
        sortOrder: 0,
        defaultConfig: { fitMode: 'contain' },
      },
      {
        name: 'Welcome Headline',
        widgetType: 'TEXT',
        x: 17, y: 3, width: 54, height: 14,
        sortOrder: 1,
        defaultConfig: {
          content: 'Welcome to Sunnyside Elementary! ☀️',
          fontSize: 64,
          alignment: 'center',
          color: '#3A2E2A',
          bgColor: 'transparent',
        },
      },
      {
        name: 'Clock',
        widgetType: 'CLOCK',
        x: 72, y: 3, width: 26, height: 14,
        sortOrder: 2,
        defaultConfig: {
          format: '12h',
          theme: 'sunny-meadow',
        },
      },
      {
        name: 'Weather',
        widgetType: 'WEATHER',
        x: 2, y: 20, width: 32, height: 26,
        sortOrder: 3,
        defaultConfig: {
          location: 'Springfield',
          units: 'imperial',
          theme: 'sunny-meadow',
        },
      },
      {
        name: 'Teacher of the Week',
        widgetType: 'STAFF_SPOTLIGHT',
        x: 2, y: 48, width: 32, height: 40,
        sortOrder: 4,
        defaultConfig: {
          staffName: 'Mrs. Johnson',
          role: 'Teacher of the Week',
          bio: 'Inspiring 3rd graders every day with creativity, kindness, and a big smile!',
          theme: 'sunny-meadow',
        },
      },
      {
        name: 'Today\'s Announcements',
        widgetType: 'ANNOUNCEMENT',
        x: 36, y: 20, width: 42, height: 42,
        sortOrder: 5,
        defaultConfig: {
          message: 'Book Fair starts Monday! Come explore hundreds of new books in the library. Don\'t forget to bring your reading log.',
          priority: 'normal',
        },
      },
      {
        name: 'School Photos',
        widgetType: 'IMAGE_CAROUSEL',
        x: 36, y: 64, width: 42, height: 24,
        sortOrder: 6,
        defaultConfig: {
          transitionEffect: 'fade',
          intervalMs: 5000,
          fitMode: 'cover',
        },
      },
      {
        name: 'Upcoming Events',
        widgetType: 'CALENDAR',
        x: 80, y: 20, width: 18, height: 42,
        sortOrder: 7,
        defaultConfig: { maxEvents: 4 },
      },
      {
        name: 'Countdown to Field Trip',
        widgetType: 'COUNTDOWN',
        x: 80, y: 64, width: 18, height: 24,
        sortOrder: 8,
        defaultConfig: {
          label: 'Field Trip in',
          targetDate: '',
        },
      },
      {
        name: 'Rolling Ticker',
        widgetType: 'TICKER',
        x: 0, y: 91, width: 100, height: 9,
        sortOrder: 9,
        defaultConfig: {
          speed: 'medium',
          messages: [
            'Welcome back, Sunnyside Stars! ⭐',
            'Picture day is this Friday — wear your school colors!',
            'Parent-teacher conferences next Tuesday',
            'Lunch menu updates every Monday',
          ],
        },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // LOBBY — the main entrance display
  // ─────────────────────────────────────────────────────
  {
    id: 'preset-lobby-welcome',
    name: 'Lobby Welcome Board',
    description: 'Main entrance display with school logo, announcements, upcoming events, and a scrolling ticker at the bottom.',
    category: 'LOBBY',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'School Logo',
        widgetType: 'LOGO',
        x: 0, y: 0, width: 25, height: 20,
        sortOrder: 0,
        defaultConfig: { fitMode: 'contain' },
      },
      {
        name: 'Welcome Message',
        widgetType: 'TEXT',
        x: 25, y: 0, width: 50, height: 20,
        sortOrder: 1,
        defaultConfig: { content: 'Welcome to Our School!', fontSize: 36, alignment: 'center' },
      },
      {
        name: 'Clock & Weather',
        widgetType: 'CLOCK',
        x: 75, y: 0, width: 25, height: 10,
        sortOrder: 2,
        defaultConfig: { format: '12h', showSeconds: false },
      },
      {
        name: 'Weather',
        widgetType: 'WEATHER',
        x: 75, y: 10, width: 25, height: 10,
        sortOrder: 3,
        defaultConfig: { units: 'imperial', showForecast: false },
      },
      {
        name: 'Main Announcements',
        widgetType: 'ANNOUNCEMENT',
        x: 0, y: 20, width: 60, height: 70,
        sortOrder: 4,
        defaultConfig: { priority: 'normal' },
      },
      {
        name: 'Upcoming Events',
        widgetType: 'CALENDAR',
        x: 60, y: 20, width: 40, height: 70,
        sortOrder: 5,
        defaultConfig: { daysToShow: 7, showWeekend: false },
      },
      {
        name: 'Bottom Ticker',
        widgetType: 'TICKER',
        x: 0, y: 90, width: 100, height: 10,
        sortOrder: 6,
        defaultConfig: { speed: 'medium', direction: 'left', messages: ['Welcome!'] },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // LOBBY — visitor information display
  // ─────────────────────────────────────────────────────
  {
    id: 'preset-lobby-info',
    name: 'Lobby Info Board',
    description: 'Visitor-focused display with a large video/slideshow area, school info, and wayfinding.',
    category: 'LOBBY',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'Header Bar',
        widgetType: 'TEXT',
        x: 0, y: 0, width: 80, height: 12,
        sortOrder: 0,
        defaultConfig: { content: 'Springfield Elementary School', fontSize: 32, alignment: 'center', bgColor: '#1e3a5f', color: '#ffffff' },
      },
      {
        name: 'Clock',
        widgetType: 'CLOCK',
        x: 80, y: 0, width: 20, height: 12,
        sortOrder: 1,
        defaultConfig: { format: '12h' },
      },
      {
        name: 'Main Slideshow',
        widgetType: 'IMAGE_CAROUSEL',
        x: 0, y: 12, width: 65, height: 78,
        sortOrder: 2,
        defaultConfig: { transitionEffect: 'fade', intervalMs: 8000, fitMode: 'cover' },
      },
      {
        name: 'Today at a Glance',
        widgetType: 'CALENDAR',
        x: 65, y: 12, width: 35, height: 40,
        sortOrder: 3,
        defaultConfig: { daysToShow: 1 },
      },
      {
        name: 'Quick Announcements',
        widgetType: 'ANNOUNCEMENT',
        x: 65, y: 52, width: 35, height: 38,
        sortOrder: 4,
      },
      {
        name: 'Scrolling Updates',
        widgetType: 'TICKER',
        x: 0, y: 90, width: 100, height: 10,
        sortOrder: 5,
        defaultConfig: { speed: 'medium', direction: 'left' },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // HALLWAY — high-traffic corridor display
  // ─────────────────────────────────────────────────────
  {
    id: 'preset-hallway-trizone',
    name: 'Hallway Tri-Zone',
    description: 'Three horizontal bands: header with logo/clock, large media area in the middle, announcements at the bottom.',
    category: 'HALLWAY',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'Logo',
        widgetType: 'LOGO',
        x: 0, y: 0, width: 20, height: 15,
        sortOrder: 0,
        defaultConfig: { fitMode: 'contain' },
      },
      {
        name: 'Header Title',
        widgetType: 'TEXT',
        x: 20, y: 0, width: 60, height: 15,
        sortOrder: 1,
        defaultConfig: { content: 'Eagle News', fontSize: 28, alignment: 'center' },
      },
      {
        name: 'Clock',
        widgetType: 'CLOCK',
        x: 80, y: 0, width: 20, height: 15,
        sortOrder: 2,
      },
      {
        name: 'Main Content',
        widgetType: 'IMAGE_CAROUSEL',
        x: 0, y: 15, width: 100, height: 60,
        sortOrder: 3,
        defaultConfig: { transitionEffect: 'slide', intervalMs: 6000, fitMode: 'cover' },
      },
      {
        name: 'Bottom Announcements',
        widgetType: 'ANNOUNCEMENT',
        x: 0, y: 75, width: 100, height: 25,
        sortOrder: 4,
      },
    ],
  },

  {
    id: 'preset-hallway-portrait',
    name: 'Hallway Portrait Display',
    description: 'Portrait-oriented display for narrow hallway spaces. Stacked layout: logo, photo slideshow, upcoming events, and ticker.',
    category: 'HALLWAY',
    orientation: 'PORTRAIT',
    screenWidth: 2160,
    screenHeight: 3840,
    zones: [
      {
        name: 'School Logo',
        widgetType: 'LOGO',
        x: 0, y: 0, width: 100, height: 12,
        sortOrder: 0,
        defaultConfig: { fitMode: 'contain' },
      },
      {
        name: 'Photo Slideshow',
        widgetType: 'IMAGE_CAROUSEL',
        x: 0, y: 12, width: 100, height: 40,
        sortOrder: 1,
        defaultConfig: { transitionEffect: 'fade', intervalMs: 7000, fitMode: 'cover' },
      },
      {
        name: 'Events & Announcements',
        widgetType: 'CALENDAR',
        x: 0, y: 52, width: 100, height: 30,
        sortOrder: 2,
        defaultConfig: { daysToShow: 5, showWeekend: false },
      },
      {
        name: 'Staff Spotlight',
        widgetType: 'STAFF_SPOTLIGHT',
        x: 0, y: 82, width: 100, height: 18,
        sortOrder: 3,
        defaultConfig: { rotateIntervalMs: 15000 },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // CAFETERIA — lunch and dining display
  // ─────────────────────────────────────────────────────
  {
    id: 'preset-cafeteria-menu',
    name: 'Cafeteria Menu Board',
    description: 'Large lunch menu with daily specials, a photo area, and countdown to next lunch period.',
    category: 'CAFETERIA',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'Header',
        widgetType: 'TEXT',
        x: 0, y: 0, width: 70, height: 12,
        sortOrder: 0,
        defaultConfig: { content: "Today's Menu", fontSize: 36, alignment: 'center', bgColor: '#2d5016', color: '#ffffff' },
      },
      {
        name: 'Clock',
        widgetType: 'CLOCK',
        x: 70, y: 0, width: 30, height: 12,
        sortOrder: 1,
      },
      {
        name: 'Lunch Menu',
        widgetType: 'LUNCH_MENU',
        x: 0, y: 12, width: 55, height: 78,
        sortOrder: 2,
        defaultConfig: { meals: [
          { label: 'Main Entrée', items: ['Update in settings'] },
          { label: 'Side Options', items: ['Update in settings'] },
          { label: 'Drinks', items: ['Milk', 'Juice', 'Water'] },
        ]},
      },
      {
        name: 'Food Photos',
        widgetType: 'IMAGE_CAROUSEL',
        x: 55, y: 12, width: 45, height: 50,
        sortOrder: 3,
        defaultConfig: { transitionEffect: 'fade', intervalMs: 5000, fitMode: 'cover' },
      },
      {
        name: 'Next Period Countdown',
        widgetType: 'COUNTDOWN',
        x: 55, y: 62, width: 45, height: 28,
        sortOrder: 4,
        defaultConfig: { label: 'Next lunch period in', showHours: true, showDays: false },
      },
      {
        name: 'Nutrition Ticker',
        widgetType: 'TICKER',
        x: 0, y: 90, width: 100, height: 10,
        sortOrder: 5,
        defaultConfig: { speed: 'slow', messages: ['Remember to eat your fruits and vegetables!', 'Allergy info available at the front counter'] },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // CLASSROOM — teacher-friendly in-class display
  // ─────────────────────────────────────────────────────
  {
    id: 'preset-classroom-daily',
    name: 'Classroom Daily Board',
    description: 'In-class display with bell schedule, daily agenda, and a rotating photo/announcement area.',
    category: 'CLASSROOM',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'Class Title',
        widgetType: 'TEXT',
        x: 0, y: 0, width: 75, height: 12,
        sortOrder: 0,
        defaultConfig: { content: 'Room 204 — Mrs. Johnson', fontSize: 24, alignment: 'left' },
      },
      {
        name: 'Clock',
        widgetType: 'CLOCK',
        x: 75, y: 0, width: 25, height: 12,
        sortOrder: 1,
        defaultConfig: { format: '12h', showSeconds: true },
      },
      {
        name: 'Bell Schedule',
        widgetType: 'BELL_SCHEDULE',
        x: 0, y: 12, width: 30, height: 78,
        sortOrder: 2,
        defaultConfig: { showCurrentHighlight: true },
      },
      {
        name: 'Daily Agenda / Announcements',
        widgetType: 'RICH_TEXT',
        x: 30, y: 12, width: 40, height: 78,
        sortOrder: 3,
        defaultConfig: { html: '<h2>Today\'s Agenda</h2><ol><li>Warm-up activity</li><li>Lesson</li><li>Group work</li><li>Wrap-up</li></ol>' },
      },
      {
        name: 'Class Photos / Spotlight',
        widgetType: 'IMAGE_CAROUSEL',
        x: 70, y: 12, width: 30, height: 50,
        sortOrder: 4,
        defaultConfig: { transitionEffect: 'fade', intervalMs: 10000, fitMode: 'cover' },
      },
      {
        name: 'Countdown to Event',
        widgetType: 'COUNTDOWN',
        x: 70, y: 62, width: 30, height: 28,
        sortOrder: 5,
        defaultConfig: { label: 'Days until field trip', showDays: true, showHours: false },
      },
      {
        name: 'Bottom Updates',
        widgetType: 'TICKER',
        x: 0, y: 90, width: 100, height: 10,
        sortOrder: 6,
        defaultConfig: { speed: 'slow', messages: ['Remember: Science project due Friday!'] },
      },
    ],
  },

  {
    id: 'preset-classroom-simple',
    name: 'Classroom Simple',
    description: 'Minimal two-zone layout for teachers who want just an agenda and a visual area. No clutter.',
    category: 'CLASSROOM',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'Agenda / Instructions',
        widgetType: 'RICH_TEXT',
        x: 0, y: 0, width: 50, height: 100,
        sortOrder: 0,
        defaultConfig: { html: '<h2>Today</h2><p>Update this with your daily agenda...</p>' },
      },
      {
        name: 'Visual Content',
        widgetType: 'IMAGE_CAROUSEL',
        x: 50, y: 0, width: 50, height: 100,
        sortOrder: 1,
        defaultConfig: { transitionEffect: 'fade', intervalMs: 8000, fitMode: 'cover' },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // OFFICE — front office & admin display
  // ─────────────────────────────────────────────────────
  {
    id: 'preset-office-dashboard',
    name: 'Office Dashboard',
    description: 'Front office display with visitor info, staff directory spotlight, calendar, and emergency-ready announcement area.',
    category: 'OFFICE',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'School Logo & Name',
        widgetType: 'LOGO',
        x: 0, y: 0, width: 30, height: 15,
        sortOrder: 0,
        defaultConfig: { fitMode: 'contain' },
      },
      {
        name: 'Welcome Text',
        widgetType: 'TEXT',
        x: 30, y: 0, width: 45, height: 15,
        sortOrder: 1,
        defaultConfig: { content: 'Welcome — Please check in at the front desk', fontSize: 20, alignment: 'center' },
      },
      {
        name: 'Clock & Weather',
        widgetType: 'CLOCK',
        x: 75, y: 0, width: 25, height: 15,
        sortOrder: 2,
      },
      {
        name: 'Announcements',
        widgetType: 'ANNOUNCEMENT',
        x: 0, y: 15, width: 50, height: 50,
        sortOrder: 3,
      },
      {
        name: 'Staff Spotlight',
        widgetType: 'STAFF_SPOTLIGHT',
        x: 50, y: 15, width: 50, height: 25,
        sortOrder: 4,
        defaultConfig: { rotateIntervalMs: 20000 },
      },
      {
        name: 'School Calendar',
        widgetType: 'CALENDAR',
        x: 50, y: 40, width: 50, height: 25,
        sortOrder: 5,
        defaultConfig: { daysToShow: 5, showWeekend: false },
      },
      {
        name: 'Visitor Info / Web Embed',
        widgetType: 'WEBPAGE',
        x: 0, y: 65, width: 100, height: 25,
        sortOrder: 6,
        defaultConfig: { scrollEnabled: false },
      },
      {
        name: 'Alert Ticker',
        widgetType: 'TICKER',
        x: 0, y: 90, width: 100, height: 10,
        sortOrder: 7,
        defaultConfig: { speed: 'medium', messages: ['Visitors: please remember to sign in and wear your badge'] },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // GYM — athletics & events display
  // ─────────────────────────────────────────────────────
  {
    id: 'preset-gym-scoreboard',
    name: 'Gym & Athletics Board',
    description: 'Large visual display for gym or multi-purpose room with video, event countdown, and team announcements.',
    category: 'GYM',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'Team Logo / School Logo',
        widgetType: 'LOGO',
        x: 0, y: 0, width: 20, height: 20,
        sortOrder: 0,
      },
      {
        name: 'Event Title',
        widgetType: 'TEXT',
        x: 20, y: 0, width: 60, height: 20,
        sortOrder: 1,
        defaultConfig: { content: 'Go Eagles!', fontSize: 42, alignment: 'center', bgColor: '#8b0000', color: '#ffd700' },
      },
      {
        name: 'Game Countdown',
        widgetType: 'COUNTDOWN',
        x: 80, y: 0, width: 20, height: 20,
        sortOrder: 2,
        defaultConfig: { label: 'Next Game', showDays: true, showHours: true },
      },
      {
        name: 'Main Video / Hype Reel',
        widgetType: 'VIDEO',
        x: 0, y: 20, width: 65, height: 70,
        sortOrder: 3,
        defaultConfig: { autoplay: true, muted: true, loop: true, fitMode: 'cover' },
      },
      {
        name: 'Schedule & Scores',
        widgetType: 'RICH_TEXT',
        x: 65, y: 20, width: 35, height: 40,
        sortOrder: 4,
        defaultConfig: { html: '<h3>This Week</h3><p>Update with game schedule...</p>' },
      },
      {
        name: 'Team Roster Spotlight',
        widgetType: 'STAFF_SPOTLIGHT',
        x: 65, y: 60, width: 35, height: 30,
        sortOrder: 5,
        defaultConfig: { rotateIntervalMs: 10000 },
      },
      {
        name: 'Spirit Ticker',
        widgetType: 'TICKER',
        x: 0, y: 90, width: 100, height: 10,
        sortOrder: 6,
        defaultConfig: { speed: 'fast', messages: ['Spirit Week is coming!', 'Wear your school colors Friday!'] },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // LIBRARY — quiet, information-focused display
  // ─────────────────────────────────────────────────────
  {
    id: 'preset-library-info',
    name: 'Library Info Board',
    description: 'Quiet, information-rich display for library entrance with new arrivals, reading events, and a website embed.',
    category: 'LIBRARY',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'Library Header',
        widgetType: 'TEXT',
        x: 0, y: 0, width: 75, height: 12,
        sortOrder: 0,
        defaultConfig: { content: 'Media Center', fontSize: 28, alignment: 'center', bgColor: '#1a3a1a', color: '#ffffff' },
      },
      {
        name: 'Clock',
        widgetType: 'CLOCK',
        x: 75, y: 0, width: 25, height: 12,
        sortOrder: 1,
      },
      {
        name: 'New Arrivals Slideshow',
        widgetType: 'IMAGE_CAROUSEL',
        x: 0, y: 12, width: 50, height: 55,
        sortOrder: 2,
        defaultConfig: { transitionEffect: 'fade', intervalMs: 8000, fitMode: 'cover' },
      },
      {
        name: 'Reading Events / Programs',
        widgetType: 'CALENDAR',
        x: 50, y: 12, width: 50, height: 55,
        sortOrder: 3,
        defaultConfig: { daysToShow: 14, showWeekend: true },
      },
      {
        name: 'Library Catalog / Website',
        widgetType: 'WEBPAGE',
        x: 0, y: 67, width: 60, height: 23,
        sortOrder: 4,
        defaultConfig: { scrollEnabled: false, refreshIntervalMs: 300000 },
      },
      {
        name: 'Book of the Week',
        widgetType: 'STAFF_SPOTLIGHT',
        x: 60, y: 67, width: 40, height: 23,
        sortOrder: 5,
        defaultConfig: { rotateIntervalMs: 30000 },
      },
      {
        name: 'Reading Ticker',
        widgetType: 'TICKER',
        x: 0, y: 90, width: 100, height: 10,
        sortOrder: 6,
        defaultConfig: { speed: 'slow', messages: ['Read-a-thon starts next Monday!', 'Book Club meets every Wednesday at 3pm'] },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // UNIVERSAL — flexible layouts for any location
  // ─────────────────────────────────────────────────────
  {
    id: 'preset-fullscreen-media',
    name: 'Full Screen Media',
    description: 'Simple full-screen layout for playing a single video, image, or slideshow. No distractions.',
    category: 'CUSTOM',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'Full Screen Content',
        widgetType: 'IMAGE_CAROUSEL',
        x: 0, y: 0, width: 100, height: 100,
        sortOrder: 0,
        defaultConfig: { transitionEffect: 'fade', intervalMs: 8000, fitMode: 'cover' },
      },
    ],
  },

  {
    id: 'preset-split-50-50',
    name: 'Split Screen (50/50)',
    description: 'Equal left-right split. Put any content on each side — great for before/after, bilingual, or side-by-side info.',
    category: 'CUSTOM',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'Left Panel',
        widgetType: 'EMPTY',
        x: 0, y: 0, width: 50, height: 100,
        sortOrder: 0,
      },
      {
        name: 'Right Panel',
        widgetType: 'EMPTY',
        x: 50, y: 0, width: 50, height: 100,
        sortOrder: 1,
      },
    ],
  },

  {
    id: 'preset-thirds-horizontal',
    name: 'Three Rows',
    description: 'Three equal horizontal bands. Header on top, main content in the middle, footer info on the bottom.',
    category: 'CUSTOM',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'Top Band',
        widgetType: 'EMPTY',
        x: 0, y: 0, width: 100, height: 33.33,
        sortOrder: 0,
      },
      {
        name: 'Middle Band',
        widgetType: 'EMPTY',
        x: 0, y: 33.33, width: 100, height: 33.34,
        sortOrder: 1,
      },
      {
        name: 'Bottom Band',
        widgetType: 'EMPTY',
        x: 0, y: 66.67, width: 100, height: 33.33,
        sortOrder: 2,
      },
    ],
  },

  {
    id: 'preset-url-video-carousel',
    name: 'Web + Video + Photos',
    description: 'Three stacked zones: a website/embed on top, video in the middle, and a photo carousel on the bottom. The layout you asked for!',
    category: 'CUSTOM',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'Website / Web App',
        widgetType: 'WEBPAGE',
        x: 0, y: 0, width: 100, height: 30,
        sortOrder: 0,
        defaultConfig: { url: '', scrollEnabled: false, refreshIntervalMs: 60000 },
      },
      {
        name: 'Video Player',
        widgetType: 'VIDEO',
        x: 0, y: 30, width: 100, height: 40,
        sortOrder: 1,
        defaultConfig: { autoplay: true, muted: false, loop: true, fitMode: 'contain' },
      },
      {
        name: 'Photo Carousel',
        widgetType: 'IMAGE_CAROUSEL',
        x: 0, y: 70, width: 100, height: 30,
        sortOrder: 2,
        defaultConfig: { transitionEffect: 'slide', intervalMs: 5000, fitMode: 'cover' },
      },
    ],
  },

  {
    id: 'preset-l-shaped',
    name: 'L-Shape Layout',
    description: 'Large main area with a sidebar and bottom bar — great for news-style displays with a sidebar for quick info.',
    category: 'CUSTOM',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'Main Content',
        widgetType: 'EMPTY',
        x: 0, y: 0, width: 70, height: 75,
        sortOrder: 0,
      },
      {
        name: 'Sidebar',
        widgetType: 'EMPTY',
        x: 70, y: 0, width: 30, height: 75,
        sortOrder: 1,
      },
      {
        name: 'Bottom Bar',
        widgetType: 'EMPTY',
        x: 0, y: 75, width: 100, height: 25,
        sortOrder: 2,
      },
    ],
  },

  {
    id: 'preset-grid-four',
    name: 'Four-Panel Grid',
    description: 'Equal four-panel grid layout. Perfect for showing four different content areas at once.',
    category: 'CUSTOM',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'Top Left',
        widgetType: 'EMPTY',
        x: 0, y: 0, width: 50, height: 50,
        sortOrder: 0,
      },
      {
        name: 'Top Right',
        widgetType: 'EMPTY',
        x: 50, y: 0, width: 50, height: 50,
        sortOrder: 1,
      },
      {
        name: 'Bottom Left',
        widgetType: 'EMPTY',
        x: 0, y: 50, width: 50, height: 50,
        sortOrder: 2,
      },
      {
        name: 'Bottom Right',
        widgetType: 'EMPTY',
        x: 50, y: 50, width: 50, height: 50,
        sortOrder: 3,
      },
    ],
  },

  {
    id: 'preset-picture-in-picture',
    name: 'Picture-in-Picture',
    description: 'Full-screen background with a small overlay in the corner — like a weather widget over a slideshow.',
    category: 'CUSTOM',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'Background Content',
        widgetType: 'IMAGE_CAROUSEL',
        x: 0, y: 0, width: 100, height: 100,
        zIndex: 0,
        sortOrder: 0,
        defaultConfig: { transitionEffect: 'fade', intervalMs: 8000, fitMode: 'cover' },
      },
      {
        name: 'Overlay Widget',
        widgetType: 'WEATHER',
        x: 72, y: 3, width: 25, height: 20,
        zIndex: 10,
        sortOrder: 1,
        defaultConfig: { units: 'imperial', showForecast: false },
      },
    ],
  },
];
