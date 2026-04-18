const fs = require('fs');
const path = 'apps/api/src/templates/system-presets.ts';
let src = fs.readFileSync(path, 'utf8');

const presets = [
  { id: 'preset-lobby-scrapbook',        name: '📎 Scrapbook',           theme: 'scrapbook',        level: 'ELEMENTARY', bgColor: '#FFF8E7', headline: 'Welcome, Friends!',            sub: 'look who showed up today ★',         fieldTripLabel: 'Field Trip in',   desc: 'Elementary polaroid-scrapbook welcome. Washi tape, handwriting, paper clips, doodle frames.' },
  { id: 'preset-lobby-locker-hallway',   name: '🔐 Locker Hallway',      theme: 'locker-hallway',   level: 'MIDDLE',     bgColor: '#6B727C', headline: 'WELCOME BACK, EAGLES',         sub: 'go grab your locker combo',          fieldTripLabel: 'Field Trip in',   desc: 'Middle school locker-row welcome. Magnetic letter tiles, combination-lock clock, notebook-paper announcements.' },
  { id: 'preset-lobby-spirit-rally',     name: '📣 Spirit Rally',        theme: 'spirit-rally',     level: 'MIDDLE',     bgColor: '#1A365D', headline: "LET'S GO TIGERS!",              sub: 'hype it up for the big game',        fieldTripLabel: 'Game Day in',     desc: 'Middle school pep-rally welcome. Megaphones, foam fingers, scoreboard LED, jumbotron energy.' },
  { id: 'preset-lobby-stem-lab',         name: '🔬 STEM Lab',            theme: 'stem-lab',         level: 'MIDDLE',     bgColor: '#0A192F', headline: 'WELCOME TO THE LAB',           sub: '// today is launch day',             fieldTripLabel: 'Launch in',       desc: 'Middle school STEM classroom welcome. Circuit-board card, rocket countdown, oscilloscope ticker, terminal announcements.' },
  { id: 'preset-lobby-morning-news',     name: '📺 Morning News',        theme: 'morning-news',     level: 'MIDDLE',     bgColor: '#0F172A', headline: 'GOOD MORNING',                 sub: 'Your top stories this morning',      fieldTripLabel: 'Field Trip in',   desc: 'Middle school morning-show welcome. Lower-third chyrons, LIVE badge, breaking-news countdown, station-ID logo.' },
  { id: 'preset-lobby-art-studio',       name: '🎨 Art Studio',          theme: 'art-studio',       level: 'MIDDLE',     bgColor: '#FBF7F0', headline: 'make something today',         sub: '~ paint outside the lines ~',        fieldTripLabel: 'Gallery Night in', desc: "Middle school art-room welcome. Painter's palette logo, canvas easels, watercolor weather, spray-paint countdown." },
  { id: 'preset-lobby-varsity-athletic', name: '🥇 Varsity Athletic',    theme: 'varsity-athletic', level: 'HIGH',       bgColor: '#0F1F3A', headline: 'GO TIGERS!',                   sub: 'HOME OF THE CHAMPIONS',              fieldTripLabel: 'Kickoff in',      desc: 'High school stadium-jumbotron welcome. Chrome crest, amber LED scoreboard, flip-card countdown, jersey-card events.' },
  { id: 'preset-lobby-senior-countdown', name: '🎓 Senior Countdown',    theme: 'senior-countdown', level: 'HIGH',       bgColor: '#F5EFE1', headline: 'CLASS OF 2027',                sub: 'making memories together',           fieldTripLabel: 'Graduation in',   desc: 'High school senior-class welcome. Parchment + gold foil, grandfather clock, diploma-scroll announcements, laurel-wreath seals.' },
  { id: 'preset-lobby-news-studio-pro',  name: '🎬 News Studio Pro',     theme: 'news-studio-pro',  level: 'HIGH',       bgColor: '#0B0F17', headline: 'BREAKING',                     sub: 'Your student news network',          fieldTripLabel: 'T-Minus',         desc: 'High school premium broadcast welcome. Glass panels, network-blue accent, italic-serif ticker, hot-red LIVE indicator.' },
  { id: 'preset-lobby-campus-quad',      name: '🏛️ Campus Quad',         theme: 'campus-quad',      level: 'HIGH',       bgColor: '#F7F5F0', headline: 'Welcome',                      sub: 'This week on campus',                fieldTripLabel: 'Days until',      desc: 'High school editorial welcome. Massive Fraunces serif, accent-red hairlines, line-art weather icons, generous whitespace.' },
  { id: 'preset-lobby-achievement-hall', name: '🏅 Achievement Hall',    theme: 'achievement-hall', level: 'HIGH',       bgColor: '#3D2817', headline: 'HALL OF FAME',                 sub: 'honoring excellence',                fieldTripLabel: 'Ceremony in',     desc: 'High school trophy-hall welcome. Engraved brass plaques, velvet backing, ornate gold frames, Roman-numeral clock.' },
];

function q(s) { return JSON.stringify(s); }

function buildPreset(p) {
  return `  {
    id: ${q(p.id)},
    name: ${q(p.name)},
    description: ${q(p.desc)},
    category: 'LOBBY',
    orientation: 'LANDSCAPE',
    schoolLevel: ${q(p.level)},
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: ${q(p.bgColor)},
    zones: [
      { name: 'School Logo',       widgetType: 'LOGO',            x: 2, y: 2, width: 8, height: 13, zIndex: 5, sortOrder: 0, defaultConfig: { theme: ${q(p.theme)} } },
      { name: 'Welcome Banner',    widgetType: 'TEXT',            x: 10, y: 4, width: 78, height: 15, zIndex: 4, sortOrder: 1,
        defaultConfig: { theme: ${q(p.theme)}, content: ${q(p.headline)}, subtitle: ${q(p.sub)} } },
      { name: 'Clock',             widgetType: 'CLOCK',           x: 89, y: 2, width: 9, height: 13, zIndex: 5, sortOrder: 2, defaultConfig: { theme: ${q(p.theme)}, format: '12h' } },
      { name: 'Weather',           widgetType: 'WEATHER',         x: 2, y: 22, width: 20, height: 26, zIndex: 3, sortOrder: 3, defaultConfig: { theme: ${q(p.theme)}, location: 'Springfield', units: 'imperial' } },
      { name: 'Announcement',      widgetType: 'ANNOUNCEMENT',    x: 24, y: 22, width: 52, height: 26, zIndex: 10, sortOrder: 4,
        defaultConfig: { theme: ${q(p.theme)}, message: 'Book Fair starts Monday! 📚 Come find your new favorite story in the library.', priority: 'normal' } },
      { name: 'Countdown',         widgetType: 'COUNTDOWN',       x: 78, y: 22, width: 20, height: 26, zIndex: 4, sortOrder: 5, defaultConfig: { theme: ${q(p.theme)}, label: ${q(p.fieldTripLabel)}, targetDate: '' } },
      { name: 'Teacher Spotlight', widgetType: 'STAFF_SPOTLIGHT', x: 2, y: 52, width: 30, height: 36, zIndex: 3, sortOrder: 6,
        defaultConfig: { theme: ${q(p.theme)}, staffName: 'Mrs. Johnson', role: 'Teacher of the Week', bio: 'Inspiring students every day.' } },
      { name: 'Upcoming Events',   widgetType: 'CALENDAR',        x: 34, y: 52, width: 64, height: 36, zIndex: 2, sortOrder: 7, defaultConfig: { theme: ${q(p.theme)}, daysToShow: 7, maxEvents: 3 } },
      { name: 'Ticker',            widgetType: 'TICKER',          x: 0, y: 90, width: 100, height: 10, zIndex: 6, sortOrder: 8,
        defaultConfig: { theme: ${q(p.theme)}, speed: 'medium',
          messages: ['Welcome back, Stars! ⭐', 'Picture day is this Friday', 'Parent-teacher conferences next Tuesday', 'Reading Challenge: 20 minutes a day'] } },
    ],
  },`;
}

const marker = "id: 'preset-lobby-storybook',";
const markerIdx = src.indexOf(marker);
if (markerIdx < 0) throw new Error('Storybook marker not found');
// Find end of storybook preset block (closing }, line after marker)
const end = src.indexOf('\n  },', markerIdx) + 5;
const insertion = '\n\n' + presets.map(buildPreset).join('\n');
src = src.slice(0, end) + insertion + src.slice(end);
fs.writeFileSync(path, src);
console.log('OK added', presets.length, 'presets');
