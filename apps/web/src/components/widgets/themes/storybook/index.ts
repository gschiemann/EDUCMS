/**
 * Storybook theme — elementary school lobby "open picture book" feel.
 * Parchment pages, illuminated gold drop-caps, hand-drawn illustrations,
 * pop-up book polaroids, ribbon bookmarks, library banners. Warm pastel
 * parchment background with subtle paper-fiber grain rendered as an
 * inline SVG data URI so every tenant sees the same deterministic grain
 * (no flicker on re-render).
 */
import { registerTheme } from '../registry';
import {
  StorybookLogo,
  StorybookText,
  StorybookClock,
  StorybookWeather,
  StorybookCountdown,
  StorybookAnnouncement,
  StorybookCalendar,
  StorybookStaffSpotlight,
  StorybookImageCarousel,
  StorybookTicker,
} from '../storybook';

const STORYBOOK_BG = (() => {
  // Build parchment: cream→beige gradient base + many tiny warm-brown
  // paper-fiber dots + a few slightly larger "foxing" flecks for
  // old-book warmth. Deterministic LCG so re-renders are stable.
  let seed = 2718;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const fibers: string[] = [];
  for (let i = 0; i < 280; i++) {
    const x = Math.floor(rand() * 1920);
    const y = Math.floor(rand() * 1080);
    const r = (rand() * 1.2 + 0.4).toFixed(2);
    const op = (0.14 + rand() * 0.16).toFixed(2);
    fibers.push(`<circle cx='${x}' cy='${y}' r='${r}' fill='%237B5E3C' opacity='${op}'/>`);
  }
  const strokes: string[] = [];
  for (let i = 0; i < 90; i++) {
    const x1 = Math.floor(rand() * 1920);
    const y1 = Math.floor(rand() * 1080);
    const len = 5 + rand() * 12;
    const ang = rand() * Math.PI * 2;
    const x2 = Math.floor(x1 + Math.cos(ang) * len);
    const y2 = Math.floor(y1 + Math.sin(ang) * len);
    const op = (0.10 + rand() * 0.14).toFixed(2);
    strokes.push(`<line x1='${x1}' y1='${y1}' x2='${x2}' y2='${y2}' stroke='%237B5E3C' stroke-width='0.7' opacity='${op}'/>`);
  }
  const foxing: string[] = [];
  for (let i = 0; i < 40; i++) {
    const x = Math.floor(rand() * 1920);
    const y = Math.floor(rand() * 1080);
    const r = (rand() * 3 + 1.5).toFixed(2);
    const op = (0.08 + rand() * 0.10).toFixed(2);
    foxing.push(`<circle cx='${x}' cy='${y}' r='${r}' fill='%23C28D2D' opacity='${op}'/>`);
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080' preserveAspectRatio='xMidYMid slice'>
    <defs>
      <linearGradient id='p' x1='0' x2='0' y1='0' y2='1'>
        <stop offset='0%' stop-color='%23FBF0DC'/>
        <stop offset='100%' stop-color='%23EEDEBF'/>
      </linearGradient>
    </defs>
    <rect width='1920' height='1080' fill='url(%23p)'/>
    <g>${foxing.join('')}</g>
    <g>${strokes.join('')}</g>
    <g>${fibers.join('')}</g>
  </svg>`;
  const encoded = svg.replace(/\n/g, '').replace(/\s{2,}/g, ' ').replace(/"/g, "'");
  return `url("data:image/svg+xml;utf8,${encoded}") center/cover, #FBF0DC`;
})();

registerTheme({
  id: 'storybook',
  name: '📖 Storybook',
  description: 'Open picture book: parchment pages, illuminated gold drop-caps, hand-drawn illustrations, pop-up polaroids, ribbon bookmarks, and library banners. A reading-rich elementary lobby welcome.',
  background: STORYBOOK_BG,
  bgColor: '#FBF0DC',
  widgets: {
    LOGO:            StorybookLogo,
    TEXT:            StorybookText,
    RICH_TEXT:       StorybookText,
    CLOCK:           StorybookClock,
    WEATHER:         StorybookWeather,
    COUNTDOWN:       StorybookCountdown,
    ANNOUNCEMENT:    StorybookAnnouncement,
    CALENDAR:        StorybookCalendar,
    STAFF_SPOTLIGHT: StorybookStaffSpotlight,
    IMAGE_CAROUSEL:  StorybookImageCarousel,
    TICKER:          StorybookTicker,
  },
});
