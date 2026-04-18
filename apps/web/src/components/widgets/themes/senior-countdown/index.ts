/**
 * Senior Countdown theme — high school senior-class lobby.
 *
 * Graduation-themed, aspirational: diploma scrolls, mortarboard caps,
 * gold tassels, parchment textures, classic school colors with gold
 * foil accents. Background: subtle parchment field with faint laurel
 * wreath watermarks in each corner.
 */
import { registerTheme } from '../registry';
import {
  SeniorCountdownLogo,
  SeniorCountdownText,
  SeniorCountdownClock,
  SeniorCountdownWeather,
  SeniorCountdownCountdown,
  SeniorCountdownAnnouncement,
  SeniorCountdownCalendar,
  SeniorCountdownStaffSpotlight,
  SeniorCountdownImageCarousel,
  SeniorCountdownTicker,
} from '../senior-countdown';

// Parchment background with faint laurel wreath watermarks at each corner
const SENIOR_COUNTDOWN_BG = (() => {
  // Laurel sprig helper — repeated in each corner at different rotations
  const laurelPath = (ox: number, oy: number, rotate: number) =>
    `<g transform="translate(${ox} ${oy}) rotate(${rotate} 0 0)" opacity="0.06" stroke="%23C9A227" stroke-width="6" fill="none">
      <path d="M0 0 Q-30 -40 -60 -20"/>
      <ellipse cx="-22" cy="-28" rx="18" ry="10" transform="rotate(-40 -22 -28)"/>
      <path d="M0 0 Q30 -40 60 -20"/>
      <ellipse cx="22" cy="-28" rx="18" ry="10" transform="rotate(40 22 -28)"/>
      <path d="M0 0 Q-50 -70 -100 -40"/>
      <ellipse cx="-44" cy="-54" rx="18" ry="10" transform="rotate(-50 -44 -54)"/>
      <path d="M0 0 Q50 -70 100 -40"/>
      <ellipse cx="44" cy="-54" rx="18" ry="10" transform="rotate(50 44 -54)"/>
      <path d="M0 0 Q-70 -95 -130 -65"/>
      <ellipse cx="-62" cy="-76" rx="18" ry="10" transform="rotate(-55 -62 -76)"/>
      <path d="M0 0 Q70 -95 130 -65"/>
      <ellipse cx="62" cy="-76" rx="18" ry="10" transform="rotate(55 62 -76)"/>
      <line x1="-14" y1="0" x2="14" y2="0" stroke-width="4"/>
    </g>`;

  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080' preserveAspectRatio='xMidYMid slice'>
    <defs>
      <linearGradient id='scdbg' x1='0' y1='0' x2='1' y2='1'>
        <stop offset='0%25' stop-color='%23F5EFE1'/>
        <stop offset='50%25' stop-color='%23F0E8D5'/>
        <stop offset='100%25' stop-color='%23E8DCC4'/>
      </linearGradient>
    </defs>
    <rect width='1920' height='1080' fill='url(%23scdbg)'/>
    ${laurelPath(180, 180, 0)}
    ${laurelPath(1740, 180, 90)}
    ${laurelPath(180, 900, -90)}
    ${laurelPath(1740, 900, 180)}
    <line x1='0' y1='28' x2='1920' y2='28' stroke='%23C9A227' stroke-width='3' opacity='0.25'/>
    <line x1='0' y1='1052' x2='1920' y2='1052' stroke='%23C9A227' stroke-width='3' opacity='0.25'/>
    <line x1='28' y1='0' x2='28' y2='1080' stroke='%23C9A227' stroke-width='3' opacity='0.25'/>
    <line x1='1892' y1='0' x2='1892' y2='1080' stroke='%23C9A227' stroke-width='3' opacity='0.25'/>
  </svg>`;

  const encoded = svg.replace(/\n/g, '').replace(/\s{2,}/g, ' ').replace(/"/g, "'");
  return `url("data:image/svg+xml;utf8,${encoded}") center/cover, linear-gradient(135deg, #F5EFE1 0%, #E8DCC4 100%)`;
})();

registerTheme({
  id: 'senior-countdown',
  name: '🎓 Senior Countdown',
  description: 'Graduation-themed lobby theme: diploma scrolls, mortarboard caps, gold tassels, parchment textures, and aspirational "CLASS OF 2027" banners in navy and gold.',
  background: SENIOR_COUNTDOWN_BG,
  bgColor: '#F5EFE1',
  widgets: {
    LOGO:            SeniorCountdownLogo,
    TEXT:            SeniorCountdownText,
    RICH_TEXT:       SeniorCountdownText,
    CLOCK:           SeniorCountdownClock,
    WEATHER:         SeniorCountdownWeather,
    COUNTDOWN:       SeniorCountdownCountdown,
    ANNOUNCEMENT:    SeniorCountdownAnnouncement,
    CALENDAR:        SeniorCountdownCalendar,
    STAFF_SPOTLIGHT: SeniorCountdownStaffSpotlight,
    IMAGE_CAROUSEL:  SeniorCountdownImageCarousel,
    TICKER:          SeniorCountdownTicker,
  },
});
