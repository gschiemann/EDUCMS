/**
 * Diner Chalkboard theme — illustrated cafeteria chalkboard scene.
 * Widgets render AS scene elements: chalk menu items on the board,
 * retro chrome clock, "daily special" tent card, neon ticker sign.
 */
import { registerTheme } from '../registry';
import {
  DinerChalkboardText, DinerChalkboardClock, DinerChalkboardLunchMenu,
  DinerChalkboardAnnouncement, DinerChalkboardCountdown, DinerChalkboardLogo,
  DinerChalkboardTicker, DinerChalkboardWeather, DinerChalkboardImageCarousel,
  DinerChalkboardCalendar, DinerChalkboardStaff,
} from '../diner-chalkboard';

const DINER_CHALKBOARD_BG = (() => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080' preserveAspectRatio='xMidYMid slice'>
    <!-- Main chalkboard wall -->
    <rect width='1920' height='1080' fill='%232C3E2D'/>
    <!-- Subtle texture gradient -->
    <rect width='1920' height='1080' fill='url(%23cbtex)' opacity='0.15'/>
    <defs>
      <radialGradient id='cbtex' cx='40%25' cy='35%25' r='70%25'>
        <stop offset='0%25' stop-color='%23ffffff' stop-opacity='0.08'/>
        <stop offset='100%25' stop-color='%23000000' stop-opacity='0.1'/>
      </radialGradient>
    </defs>
    <!-- Wood frame top -->
    <rect x='0' y='0' width='1920' height='24' fill='%23A67C3D'/>
    <rect x='0' y='24' width='1920' height='4' fill='%235C4A12'/>
    <!-- Wood frame bottom counter -->
    <rect x='0' y='920' width='1920' height='160' fill='%23D4A76A'/>
    <rect x='0' y='920' width='1920' height='6' fill='%23A67C3D'/>
    <rect x='0' y='926' width='1920' height='3' fill='%235C4A12' opacity='0.3'/>
    <!-- Counter edge highlight -->
    <rect x='0' y='1076' width='1920' height='4' fill='%238B6914'/>
    <!-- Chalk dust areas -->
    <ellipse cx='200' cy='900' rx='80' ry='4' fill='%23ffffff' opacity='0.06'/>
    <ellipse cx='900' cy='910' rx='120' ry='5' fill='%23ffffff' opacity='0.05'/>
    <ellipse cx='1600' cy='895' rx='70' ry='3' fill='%23ffffff' opacity='0.06'/>
    <!-- Decorative chalk drawings - fork and knife -->
    <g transform='translate(80,120)' opacity='0.12' stroke='%23F0EDE5' stroke-width='2' fill='none'>
      <line x1='0' y1='0' x2='0' y2='80'/>
      <line x1='-8' y1='0' x2='8' y2='0'/>
      <line x1='-6' y1='5' x2='6' y2='5'/>
    </g>
    <g transform='translate(1840,140)' opacity='0.12' stroke='%23F0EDE5' stroke-width='2' fill='none'>
      <ellipse cx='0' cy='0' rx='8' ry='20'/>
      <line x1='0' y1='20' x2='0' y2='80'/>
    </g>
    <!-- Chalk doodles - stars -->
    <g fill='%23F0EDE5' opacity='0.08'>
      <text x='160' y='860' font-size='18' font-family='sans-serif'>★</text>
      <text x='460' y='880' font-size='14' font-family='sans-serif'>★</text>
      <text x='1200' y='850' font-size='16' font-family='sans-serif'>★</text>
      <text x='1700' y='870' font-size='18' font-family='sans-serif'>★</text>
    </g>
    <!-- Salt and pepper on counter -->
    <g transform='translate(1680,940)'>
      <rect x='0' y='20' width='22' height='40' rx='4' fill='%23E8E8E8' stroke='%23C0C0C0' stroke-width='1'/>
      <circle cx='11' cy='16' r='6' fill='%23E8E8E8' stroke='%23C0C0C0' stroke-width='1'/>
      <circle cx='8' cy='14' r='1' fill='%23666'/>
      <circle cx='14' cy='14' r='1' fill='%23666'/>
      <circle cx='11' cy='17' r='1' fill='%23666'/>
    </g>
    <g transform='translate(1720,942)'>
      <rect x='0' y='20' width='22' height='38' rx='4' fill='%232D2D2D' stroke='%23444' stroke-width='1'/>
      <circle cx='11' cy='16' r='6' fill='%232D2D2D' stroke='%23444' stroke-width='1'/>
      <circle cx='8' cy='14' r='1' fill='%23888'/>
      <circle cx='14' cy='14' r='1' fill='%23888'/>
      <circle cx='11' cy='17' r='1' fill='%23888'/>
    </g>
    <!-- Napkin holder on counter -->
    <g transform='translate(100,945)'>
      <rect x='0' y='10' width='60' height='50' rx='3' fill='%23C0C0C0' stroke='%23A0A0A0' stroke-width='1'/>
      <rect x='5' y='0' width='50' height='55' rx='2' fill='%23FFF8E7'/>
      <rect x='8' y='3' width='44' height='48' rx='1' fill='%23F5E6C8'/>
    </g>
    <!-- Tray stack on counter right -->
    <g transform='translate(1500,960)'>
      <rect x='0' y='30' width='100' height='4' rx='1' fill='%23A67C3D'/>
      <rect x='2' y='26' width='96' height='4' rx='1' fill='%23B88A4A'/>
      <rect x='4' y='22' width='92' height='4' rx='1' fill='%23C49A3C'/>
    </g>
  </svg>`;
  const encoded = svg.replace(/\n/g, '').replace(/\s{2,}/g, ' ').replace(/"/g, "'");
  return `url("data:image/svg+xml;utf8,${encoded}") center/cover, #2C3E2D`;
})();

registerTheme({
  id: 'diner-chalkboard',
  name: '🍽️ Diner Chalkboard',
  description: 'Retro cafeteria chalkboard: chalk menu items, chrome diner clock, daily specials tent card, neon ticker. Widgets BECOME scene elements.',
  background: DINER_CHALKBOARD_BG,
  bgColor: '#2C3E2D',
  widgets: {
    CLOCK:           DinerChalkboardClock,
    TEXT:            DinerChalkboardText,
    RICH_TEXT:       DinerChalkboardText,
    LUNCH_MENU:     DinerChalkboardLunchMenu,
    ANNOUNCEMENT:    DinerChalkboardAnnouncement,
    CALENDAR:        DinerChalkboardCalendar,
    STAFF_SPOTLIGHT: DinerChalkboardStaff,
    COUNTDOWN:       DinerChalkboardCountdown,
    LOGO:            DinerChalkboardLogo,
    TICKER:          DinerChalkboardTicker,
    WEATHER:         DinerChalkboardWeather,
    IMAGE_CAROUSEL:  DinerChalkboardImageCarousel,
  },
});
