/**
 * Regenerates the system-presets.ts with a pre-launch curated set:
 *   - All 19 shape-based themes kept as Welcome/Lobby presets.
 *   - 45 new presets: each of 15 shape themes tagged for Hallway,
 *     Cafeteria, and Athletics with a category-appropriate layout.
 *   - ~64 total presets (user asked for 60+). Legacy non-shape
 *     presets are dropped.
 *
 * Each NEW preset reuses an existing theme but picks the ZONE LAYOUT
 * that suits the physical use-case:
 *   Hallway  — fewer/bigger widgets, wayfinding focus
 *   Cafeteria — big food-photo carousel + menu-list
 *   Athletics — matchup-centric, countdown + standings
 */
const fs = require('fs');
const path = 'apps/api/src/templates/system-presets.ts';

const THEMES = [
  // { slug, cls, schoolLevel, emoji, label }
  { slug: 'rainbow-ribbon',   cls: 'RainbowRibbon',   level: 'ELEMENTARY', emoji: '🌈', label: 'Rainbow Ribbon',   bg: '#BFE8FF', bgGradient: 'linear-gradient(180deg,#BFE8FF 0%,#FFE0EC 55%,#FFD8A8 100%)' },
  { slug: 'bulletin-board',   cls: 'BulletinBoard',   level: 'ELEMENTARY', emoji: '📌', label: 'Bulletin Board',   bg: '#C69C6D' },
  { slug: 'field-day',        cls: 'FieldDay',        level: 'ELEMENTARY', emoji: '🏆', label: 'Field Day',        bg: '#1E2A4A' },
  { slug: 'storybook',        cls: 'Storybook',       level: 'ELEMENTARY', emoji: '📖', label: 'Storybook',        bg: '#FBF0DC' },
  { slug: 'scrapbook',        cls: 'Scrapbook',       level: 'ELEMENTARY', emoji: '📎', label: 'Scrapbook',        bg: '#FFF8E7' },
  { slug: 'track-day',        cls: 'TrackDay',        level: 'ELEMENTARY', emoji: '🏃', label: 'Track Day',        bg: '#4FB06B' },
  { slug: 'locker-hallway',   cls: 'LockerHallway',   level: 'MIDDLE',     emoji: '🔐', label: 'Locker Hallway',   bg: '#6B727C' },
  { slug: 'spirit-rally',     cls: 'SpiritRally',     level: 'MIDDLE',     emoji: '📣', label: 'Spirit Rally',     bg: '#1A365D' },
  { slug: 'stem-lab',         cls: 'StemLab',         level: 'MIDDLE',     emoji: '🔬', label: 'STEM Lab',         bg: '#0A192F' },
  { slug: 'morning-news',     cls: 'MorningNews',     level: 'MIDDLE',     emoji: '📺', label: 'Morning News',     bg: '#0F172A' },
  { slug: 'art-studio',       cls: 'ArtStudio',       level: 'MIDDLE',     emoji: '🎨', label: 'Art Studio',       bg: '#FBF7F0' },
  { slug: 'scorebug',         cls: 'Scorebug',        level: 'MIDDLE',     emoji: '📊', label: 'Scorebug',         bg: '#0B111C' },
  { slug: 'varsity-athletic', cls: 'VarsityAthletic', level: 'HIGH',       emoji: '🥇', label: 'Varsity',          bg: '#0F1F3A' },
  { slug: 'senior-countdown', cls: 'SeniorCountdown', level: 'HIGH',       emoji: '🎓', label: 'Senior Countdown', bg: '#F5EFE1' },
  { slug: 'news-studio-pro',  cls: 'NewsStudioPro',   level: 'HIGH',       emoji: '🎬', label: 'News Studio Pro',  bg: '#0B0F17' },
  { slug: 'campus-quad',      cls: 'CampusQuad',      level: 'HIGH',       emoji: '🏛️', label: 'Campus Quad',      bg: '#F7F5F0' },
  { slug: 'achievement-hall', cls: 'AchievementHall', level: 'HIGH',       emoji: '🏅', label: 'Achievement Hall', bg: '#3D2817' },
  { slug: 'jumbotron-pro',    cls: 'JumbotronPro',    level: 'HIGH',       emoji: '🏟️', label: 'Jumbotron Pro',    bg: '#050A14' },
];

function q(s) { return JSON.stringify(s); }

// Category-specific zone LAYOUTS. Each returns an array of zones with
// placement + default content tuned to the physical use case.
// Banner/announcement/ticker/clock/weather references are the same
// widget types — only sizes, positions and defaults change per category.

// WELCOME — main lobby. Signature: BIRTHDAYS celebration strip gives
// a daily human moment; announcement hero in the middle; QUOTE at the
// bottom-left replacing the bare event list.
function welcomeZones(t, content) {
  return [
    { name: 'Logo',          widgetType: 'LOGO',            x: 2,  y: 2,  width: 8,  height: 13, zIndex: 5, sortOrder: 0, defaultConfig: { theme: t.slug } },
    { name: 'Welcome Banner',widgetType: 'TEXT',            x: 10, y: 4,  width: 78, height: 15, zIndex: 4, sortOrder: 1, defaultConfig: { theme: t.slug, content: content.headline, subtitle: content.subtitle } },
    { name: 'Clock',         widgetType: 'CLOCK',           x: 89, y: 2,  width: 9,  height: 13, zIndex: 5, sortOrder: 2, defaultConfig: { theme: t.slug, format: '12h' } },
    { name: 'Weather',       widgetType: 'WEATHER',         x: 2,  y: 22, width: 20, height: 28, zIndex: 3, sortOrder: 3, defaultConfig: { theme: t.slug, location: 'Springfield', units: 'imperial' } },
    { name: 'Announcement',  widgetType: 'ANNOUNCEMENT',    x: 24, y: 22, width: 52, height: 28, zIndex: 10, sortOrder: 4, defaultConfig: { theme: t.slug, message: content.announcement } },
    { name: 'Countdown',     widgetType: 'COUNTDOWN',       x: 78, y: 22, width: 20, height: 28, zIndex: 4, sortOrder: 5, defaultConfig: { theme: t.slug, label: content.countdownLabel, targetDate: '' } },
    { name: 'Teacher',       widgetType: 'STAFF_SPOTLIGHT', x: 2,  y: 54, width: 30, height: 34, zIndex: 3, sortOrder: 6, defaultConfig: { theme: t.slug, staffName: 'Mrs. Johnson', role: 'Teacher of the Week', bio: 'Inspiring students every day.' } },
    { name: 'Events',        widgetType: 'CALENDAR',        x: 34, y: 54, width: 36, height: 34, zIndex: 2, sortOrder: 7, defaultConfig: { theme: t.slug, maxEvents: 3 } },
    { name: 'Birthdays',     widgetType: 'BIRTHDAYS',       x: 72, y: 54, width: 26, height: 34, zIndex: 3, sortOrder: 8, defaultConfig: {} },
    { name: 'Ticker',        widgetType: 'TICKER',          x: 0,  y: 90, width: 100, height: 10, zIndex: 6, sortOrder: 9, defaultConfig: { theme: t.slug, speed: 'medium', messages: content.tickerMessages } },
  ];
}

// HALLWAY — wayfinding. Banner top, schedule grid left, attendance
// right, announcement + events below, ticker bottom. Schedule grid is
// the signature hallway widget.
function hallwayZones(t, content) {
  return [
    { name: 'Hallway Banner',  widgetType: 'TEXT',          x: 2,  y: 2,  width: 96, height: 16, zIndex: 4, sortOrder: 0, defaultConfig: { theme: t.slug, content: content.headline, subtitle: content.subtitle } },
    { name: "Today's Schedule", widgetType: 'SCHEDULE_GRID',x: 2,  y: 20, width: 58, height: 52, zIndex: 3, sortOrder: 1, defaultConfig: {} },
    { name: 'Attendance',      widgetType: 'ATTENDANCE',    x: 62, y: 20, width: 36, height: 26, zIndex: 3, sortOrder: 2, defaultConfig: {} },
    { name: 'Clock',           widgetType: 'CLOCK',         x: 62, y: 48, width: 18, height: 24, zIndex: 5, sortOrder: 3, defaultConfig: { theme: t.slug, format: '12h' } },
    { name: 'Weather',         widgetType: 'WEATHER',       x: 82, y: 48, width: 16, height: 24, zIndex: 3, sortOrder: 4, defaultConfig: { theme: t.slug, location: 'Springfield', units: 'imperial' } },
    { name: 'Announcement',    widgetType: 'ANNOUNCEMENT',  x: 2,  y: 74, width: 60, height: 16, zIndex: 10, sortOrder: 5, defaultConfig: { theme: t.slug, message: content.announcement } },
    { name: 'Countdown',       widgetType: 'COUNTDOWN',     x: 64, y: 74, width: 34, height: 16, zIndex: 4, sortOrder: 6, defaultConfig: { theme: t.slug, label: content.countdownLabel, targetDate: '' } },
    { name: 'Ticker',          widgetType: 'TICKER',        x: 0,  y: 92, width: 100, height: 8, zIndex: 6, sortOrder: 7, defaultConfig: { theme: t.slug, speed: 'medium', messages: content.tickerMessages } },
  ];
}

// CAFETERIA — menu-centric. THREE MENU_ITEM cards (entrée + sides +
// drink) replace the generic CALENDAR. Big food photo carousel left,
// menu cards right, daily special banner + next-meal countdown below.
function cafeteriaZones(t, content) {
  return [
    { name: 'Logo',            widgetType: 'LOGO',           x: 2,  y: 2,  width: 10, height: 14, zIndex: 5, sortOrder: 0, defaultConfig: { theme: t.slug } },
    { name: 'Menu Title',      widgetType: 'TEXT',           x: 12, y: 3,  width: 76, height: 14, zIndex: 4, sortOrder: 1, defaultConfig: { theme: t.slug, content: content.menuTitle, subtitle: content.menuSubtitle } },
    { name: 'Clock',           widgetType: 'CLOCK',          x: 89, y: 2,  width: 9,  height: 14, zIndex: 5, sortOrder: 2, defaultConfig: { theme: t.slug, format: '12h' } },
    { name: 'Food Carousel',   widgetType: 'IMAGE_CAROUSEL', x: 2,  y: 20, width: 56, height: 52, zIndex: 3, sortOrder: 3, defaultConfig: { theme: t.slug, intervalMs: 6000 } },
    { name: 'Entrée',          widgetType: 'MENU_ITEM',      x: 60, y: 20, width: 38, height: 17, zIndex: 4, sortOrder: 4, defaultConfig: { itemName: 'Chef Salad', description: 'Romaine, grilled chicken, cherry tomatoes, shaved cheese, ranch.', allergens: ['GF'], price: '' } },
    { name: 'Side',            widgetType: 'MENU_ITEM',      x: 60, y: 38, width: 38, height: 17, zIndex: 4, sortOrder: 5, defaultConfig: { itemName: 'Roasted Veggies', description: 'Carrots, zucchini, bell peppers — olive oil, sea salt.', allergens: ['V', 'GF'], price: '' } },
    { name: 'Dessert',         widgetType: 'MENU_ITEM',      x: 60, y: 55, width: 38, height: 17, zIndex: 4, sortOrder: 6, defaultConfig: { itemName: 'Fruit Cup', description: 'Seasonal fresh fruit — watermelon, pineapple, berries.', allergens: ['V', 'GF'], price: '' } },
    { name: "Today's Special", widgetType: 'ANNOUNCEMENT',   x: 2,  y: 74, width: 60, height: 14, zIndex: 10, sortOrder: 7, defaultConfig: { theme: t.slug, message: content.special } },
    { name: 'Next Meal',       widgetType: 'COUNTDOWN',      x: 64, y: 74, width: 34, height: 14, zIndex: 4, sortOrder: 8, defaultConfig: { theme: t.slug, label: content.countdownLabel, targetDate: '' } },
    { name: 'Nutrition Ticker', widgetType: 'TICKER',        x: 0,  y: 90, width: 100, height: 10, zIndex: 6, sortOrder: 9, defaultConfig: { theme: t.slug, speed: 'slow', messages: content.tickerMessages } },
  ];
}

// ATHLETICS — SCOREBOARD hero, STATS row for season record, athlete
// spotlight + coach message + upcoming games. Fresh widgets give
// athletics a completely different feel from the other categories.
function athleticsZones(t, content) {
  return [
    { name: 'Team Logo',         widgetType: 'LOGO',           x: 2,  y: 2,  width: 10, height: 16, zIndex: 5, sortOrder: 0, defaultConfig: { theme: t.slug } },
    { name: 'Matchup Banner',    widgetType: 'TEXT',           x: 12, y: 4,  width: 76, height: 14, zIndex: 4, sortOrder: 1, defaultConfig: { theme: t.slug, content: content.matchup, subtitle: content.matchupDetail } },
    { name: 'Clock',             widgetType: 'CLOCK',          x: 89, y: 2,  width: 9,  height: 16, zIndex: 5, sortOrder: 2, defaultConfig: { theme: t.slug, format: '12h' } },
    { name: 'Live Scoreboard',   widgetType: 'SCOREBOARD',     x: 2,  y: 22, width: 58, height: 34, zIndex: 4, sortOrder: 3, defaultConfig: { homeName: content.homeTeam || 'EAGLES', awayName: content.awayTeam || 'COUGARS', homeScore: 0, awayScore: 0, status: content.matchupDetail, period: 'KICKOFF FRIDAY' } },
    { name: 'Athlete of the Week', widgetType: 'STAFF_SPOTLIGHT', x: 62, y: 22, width: 36, height: 34, zIndex: 3, sortOrder: 4, defaultConfig: { theme: t.slug, staffName: content.athleteName, role: content.athleteRole, bio: content.athleteBio } },
    { name: 'Season Stats',      widgetType: 'STATS',          x: 2,  y: 58, width: 58, height: 20, zIndex: 3, sortOrder: 5, defaultConfig: { stats: [{ value: '8-2', label: 'RECORD' }, { value: '247', label: 'POINTS FOR' }, { value: '4', label: 'STREAK' }] } },
    { name: 'Upcoming Games',    widgetType: 'CALENDAR',       x: 62, y: 58, width: 36, height: 20, zIndex: 2, sortOrder: 6, defaultConfig: { theme: t.slug, maxEvents: 3 } },
    { name: "Coach's Message",   widgetType: 'ANNOUNCEMENT',   x: 2,  y: 80, width: 60, height: 10, zIndex: 10, sortOrder: 7, defaultConfig: { theme: t.slug, message: content.coachMessage } },
    { name: 'Next Game Countdown', widgetType: 'COUNTDOWN',    x: 64, y: 80, width: 34, height: 10, zIndex: 4, sortOrder: 8, defaultConfig: { theme: t.slug, label: content.countdownLabel, targetDate: '' } },
    { name: 'Ticker',            widgetType: 'TICKER',         x: 0,  y: 92, width: 100, height: 8, zIndex: 6, sortOrder: 9, defaultConfig: { theme: t.slug, speed: 'medium', messages: content.tickerMessages } },
  ];
}

// School-level-specific default copy
const COPY = {
  ELEMENTARY: {
    welcome: { headline: 'Welcome, Friends!', subtitle: 'today is going to be amazing', announcement: 'Book Fair starts Monday! 📚 Come find your new favorite story.', countdownLabel: 'Field Trip in',
      tickerMessages: ['Welcome back, Stars! ⭐', 'Picture day is Friday', 'Reading Challenge: 20 minutes a day! 📖', 'Parent-teacher conferences next Tuesday'] },
    hallway: { headline: 'LEARN · GROW · SHINE', subtitle: 'every day a new adventure', announcement: 'Assembly in the gym Friday at 2 PM — all classes welcome!', countdownLabel: 'Field Day in',
      tickerMessages: ['Walk, don\'t run in the halls 🚶', 'Reading Challenge: 20 minutes a day', 'Wear school colors on Spirit Friday! 🎉'] },
    cafeteria: { menuTitle: "Today's Menu", menuSubtitle: 'what\'s cooking in the kitchen', special: 'Pizza Friday is BACK! 🍕 Cheese + pepperoni in line 2.', countdownLabel: 'Next meal in',
      tickerMessages: ['Eat the rainbow — fruits + veggies every day 🌈', 'Drink water, stay hydrated! 💧', 'Free + reduced meals — ask the office'] },
    athletics: { matchup: 'GO TIGERS!', matchupDetail: 'home of the champions', countdownLabel: 'Field Day in', athleteName: 'Morgan P.', athleteRole: 'Student of the Month', athleteBio: 'Kindness + teamwork on and off the field.',
      coachMessage: 'Everyone plays, everyone matters. See you at practice!',
      tickerMessages: ['Jump Rope for Heart next Friday 🪢', 'Field Day coming up — bring water + sunscreen ☀️', 'PE rocks — remember sneakers on gym days'] },
  },
  MIDDLE: {
    welcome: { headline: 'WELCOME BACK, EAGLES', subtitle: 'this is going to be a great year', announcement: 'Student council elections next Friday. Nominations open through Wednesday.', countdownLabel: 'Fall Break in',
      tickerMessages: ['Picture day is Friday — wear school colors', 'Clubs fair Thursday after school in the gym', 'Join the Student Council — nominations open', 'Reminder: phones off during class'] },
    hallway: { headline: 'BE KIND · WORK HARD · BE PROUD', subtitle: 'every day a fresh start', announcement: 'Pep rally this Friday at 2:30 — bring your spirit!', countdownLabel: 'Next half-day in',
      tickerMessages: ['Hall passes required during class time', 'Late to class = no pass needed if teacher signs', 'Library is open until 4 PM every day'] },
    cafeteria: { menuTitle: "Today's Menu", menuSubtitle: 'lunch line + à la carte', special: 'Build-your-own salad bar today! Line 3.', countdownLabel: 'Next lunch period in',
      tickerMessages: ['Keep it clean — clear your tray', 'Allergens listed by each dish', 'Vegetarian options every day'] },
    athletics: { matchup: 'EAGLES vs COUGARS', matchupDetail: 'Homecoming · Friday 7pm · Home field', countdownLabel: 'Homecoming in', athleteName: 'Jordan Miller', athleteRole: 'Point Guard · 8th grade', athleteBio: 'Season avg: 18.4 PPG, 6 assists, 3 steals.',
      coachMessage: 'Work hard. Play smart. Lift each other up. Go Eagles!',
      tickerMessages: ['Girls volleyball states next Saturday', 'Cheer tryouts Monday 3 PM', 'JV soccer wins 4-1 vs Central!', 'Wrestling sign-ups close Friday'] },
  },
  HIGH: {
    welcome: { headline: 'WELCOME, SENIORS', subtitle: 'make this one count', announcement: 'Senior portraits next week. Sign-up sheet in the main office.', countdownLabel: 'Graduation in',
      tickerMessages: ['Senior trip sign-ups close Friday', 'College fair in the gym Thursday 6 PM', 'FAFSA workshop Tuesday in the library', 'Yearbook orders due end of month'] },
    hallway: { headline: 'EXCELLENCE · INTEGRITY · LEGACY', subtitle: 'carry it forward', announcement: 'Assembly Friday — guest speaker on mental wellness.', countdownLabel: 'Prom in',
      tickerMessages: ['Hall passes required', 'Counseling office open during all lunches', 'Tutoring available in the library 3-5 PM'] },
    cafeteria: { menuTitle: "Today's Menu", menuSubtitle: 'cafeteria + grab-and-go', special: 'Chef\'s special: Korean BBQ bowls at the grill line.', countdownLabel: 'Next period in',
      tickerMessages: ['Grab-and-go available until 1 PM', 'Allergen info posted by each station', 'Free + reduced meal program — ask admin'] },
    athletics: { matchup: 'EAGLES vs COUGARS', matchupDetail: 'HOMECOMING · FRI 7PM · HOME FIELD', countdownLabel: 'Kickoff in', athleteName: 'Alex Rivera', athleteRole: 'QB #7 · Senior', athleteBio: '32 TDs · 4,112 yds · 68% completion — All-Conference.',
      coachMessage: 'GO EAGLES. Play smart, play hard, play together.',
      tickerMessages: ['FINAL: Varsity 28 — Central 14', 'Girls volleyball advances to state finals', 'JV soccer moves on to regionals', 'Pep rally Friday @ 2:30 in the gym'] },
  },
};

function buildPreset(t, category, zones, copy) {
  const labelByCat = {
    LOBBY: 'Welcome',
    HALLWAY: 'Hallway',
    CAFETERIA: 'Cafeteria',
    ATHLETICS: 'Athletics',
  };
  const catLabel = labelByCat[category];
  const id = `preset-${category.toLowerCase()}-${t.slug}`;
  const name = `${t.emoji} ${t.label} · ${catLabel}`;
  const desc = `${catLabel} layout — ${t.label} theme. Shape-based widgets, auto-fit text, inline-edit in the builder.`;
  return {
    id, name, description: desc,
    category,
    orientation: 'LANDSCAPE',
    schoolLevel: t.level,
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: t.bg,
    ...(t.bgGradient ? { bgGradient: t.bgGradient } : {}),
    zones,
  };
}

// Build all presets
const presets = [];
for (const t of THEMES) {
  const lvlCopy = COPY[t.level];
  // WELCOME (lobby) — 18 total
  presets.push(buildPreset(t, 'LOBBY',     welcomeZones(t, lvlCopy.welcome),       lvlCopy.welcome));
  // HALLWAY — 18 total
  presets.push(buildPreset(t, 'HALLWAY',   hallwayZones(t, lvlCopy.hallway),       lvlCopy.hallway));
  // CAFETERIA — 18 total
  presets.push(buildPreset(t, 'CAFETERIA', cafeteriaZones(t, lvlCopy.cafeteria),   lvlCopy.cafeteria));
  // ATHLETICS — 18 total
  presets.push(buildPreset(t, 'ATHLETICS', athleticsZones(t, lvlCopy.athletics),   lvlCopy.athletics));
}

// Serialize. We keep the existing file header up to the
// `export const SYSTEM_TEMPLATE_PRESETS: SystemPreset[] = [` line and
// replace everything after with our generated presets.
let src = fs.readFileSync(path, 'utf8');
const headerMarker = 'export const SYSTEM_TEMPLATE_PRESETS: SystemPreset[] = [';
const headerIdx = src.indexOf(headerMarker);
if (headerIdx < 0) throw new Error('SYSTEM_TEMPLATE_PRESETS marker not found');

const header = src.slice(0, headerIdx + headerMarker.length);
const body = presets.map((p) => {
  const zonesLines = p.zones.map((z) => `      ${JSON.stringify(z)},`).join('\n');
  const bgGradientLine = p.bgGradient ? `\n    bgGradient: ${q(p.bgGradient)},` : '';
  return `  {
    id: ${q(p.id)},
    name: ${q(p.name)},
    description: ${q(p.description)},
    category: ${q(p.category)},
    orientation: 'LANDSCAPE',
    schoolLevel: ${q(p.schoolLevel)},
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: ${q(p.bgColor)},${bgGradientLine}
    zones: [
${zonesLines}
    ],
  },`;
}).join('\n');

const out = header + '\n' + body + '\n];\n';
fs.writeFileSync(path, out);
console.log('OK — wrote', presets.length, 'presets');
