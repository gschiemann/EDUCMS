/**
 * Bulletin Board theme — real classroom cork-board.
 * Paper crafts, push pins, jute string, tape, polaroids, sticky notes,
 * index cards, torn-paper banners. Cheerful "I made this myself" energy
 * for elementary lobby/hallway displays. Tan cork background with
 * fiber/dot texture rendered as an inline SVG data URI.
 */
import { registerTheme } from '../registry';
import {
  BulletinBoardLogo,
  BulletinBoardText,
  BulletinBoardClock,
  BulletinBoardWeather,
  BulletinBoardCountdown,
  BulletinBoardAnnouncement,
  BulletinBoardCalendar,
  BulletinBoardStaffSpotlight,
  BulletinBoardImageCarousel,
  BulletinBoardTicker,
} from '../bulletin-board';

const BULLETIN_BOARD_BG = (() => {
  // Build cork texture: warm tan base + many small dark-brown dots
  // (pressed cork pores) + short fiber strokes. Deterministic layout
  // via LCG so every tenant sees the same cork — no random flicker on
  // re-render.
  let seed = 1337;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const dots: string[] = [];
  for (let i = 0; i < 320; i++) {
    const x = Math.floor(rand() * 1920);
    const y = Math.floor(rand() * 1080);
    const r = (rand() * 1.6 + 0.6).toFixed(2);
    const op = (0.18 + rand() * 0.22).toFixed(2);
    dots.push(`<circle cx='${x}' cy='${y}' r='${r}' fill='%238D6B4A' opacity='${op}'/>`);
  }
  const fibers: string[] = [];
  for (let i = 0; i < 140; i++) {
    const x1 = Math.floor(rand() * 1920);
    const y1 = Math.floor(rand() * 1080);
    const len = 6 + rand() * 14;
    const ang = rand() * Math.PI * 2;
    const x2 = Math.floor(x1 + Math.cos(ang) * len);
    const y2 = Math.floor(y1 + Math.sin(ang) * len);
    const op = (0.12 + rand() * 0.18).toFixed(2);
    fibers.push(`<line x1='${x1}' y1='${y1}' x2='${x2}' y2='${y2}' stroke='%238D6B4A' stroke-width='0.8' opacity='${op}'/>`);
  }
  // Highlight flecks for warm depth
  const flecks: string[] = [];
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(rand() * 1920);
    const y = Math.floor(rand() * 1080);
    const r = (rand() * 1.2 + 0.4).toFixed(2);
    const op = (0.18 + rand() * 0.22).toFixed(2);
    flecks.push(`<circle cx='${x}' cy='${y}' r='${r}' fill='%23E8C79A' opacity='${op}'/>`);
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080' preserveAspectRatio='xMidYMid slice'>
    <rect width='1920' height='1080' fill='%23C69C6D'/>
    <g>${flecks.join('')}</g>
    <g>${fibers.join('')}</g>
    <g>${dots.join('')}</g>
  </svg>`;
  const encoded = svg.replace(/\n/g, '').replace(/\s{2,}/g, ' ').replace(/"/g, "'");
  return `url("data:image/svg+xml;utf8,${encoded}") center/cover, #C69C6D`;
})();

registerTheme({
  id: 'bulletin-board',
  name: '📌 Bulletin Board',
  description: 'Classroom cork board: construction paper, push pins, jute string, tape, polaroids, sticky notes, and hand-cut letters. Every widget is a real classroom craft.',
  background: BULLETIN_BOARD_BG,
  bgColor: '#C69C6D',
  widgets: {
    LOGO:            BulletinBoardLogo,
    TEXT:            BulletinBoardText,
    RICH_TEXT:       BulletinBoardText,
    CLOCK:           BulletinBoardClock,
    WEATHER:         BulletinBoardWeather,
    COUNTDOWN:       BulletinBoardCountdown,
    ANNOUNCEMENT:    BulletinBoardAnnouncement,
    CALENDAR:        BulletinBoardCalendar,
    STAFF_SPOTLIGHT: BulletinBoardStaffSpotlight,
    IMAGE_CAROUSEL:  BulletinBoardImageCarousel,
    TICKER:          BulletinBoardTicker,
  },
});
