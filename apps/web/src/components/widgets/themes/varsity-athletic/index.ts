/**
 * Varsity Athletic theme — high school athletic-lobby jumbotron aesthetic.
 * Stadium night background: dark navy gradient with subtle spotlight beams,
 * faint crowd-dot texture, and a field-line accent at the bottom.
 * Palette: stadium navy, scarlet, gold, chrome-metallic.
 */
import { registerTheme } from '../registry';
import {
  VarsityAthleticLogo,
  VarsityAthleticText,
  VarsityAthleticClock,
  VarsityAthleticWeather,
  VarsityAthleticCountdown,
  VarsityAthleticAnnouncement,
  VarsityAthleticCalendar,
  VarsityAthleticStaffSpotlight,
  VarsityAthleticImageCarousel,
  VarsityAthleticTicker,
} from '../varsity-athletic';

// Stadium night background: deep navy gradient + SVG spotlight beams +
// crowd-dot texture + field-line stripe at the base.
const VA_BG = (() => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080' preserveAspectRatio='xMidYMid slice'>
    <defs>
      <radialGradient id='sky' cx='50%25' cy='20%25' r='80%25'>
        <stop offset='0%25' stop-color='%23162848'/>
        <stop offset='50%25' stop-color='%230F1F3A'/>
        <stop offset='100%25' stop-color='%230A1428'/>
      </radialGradient>
      <radialGradient id='spot1' cx='30%25' cy='0%25' r='55%25'>
        <stop offset='0%25' stop-color='%23FFFFFF' stop-opacity='0.07'/>
        <stop offset='100%25' stop-color='%23FFFFFF' stop-opacity='0'/>
      </radialGradient>
      <radialGradient id='spot2' cx='70%25' cy='0%25' r='50%25'>
        <stop offset='0%25' stop-color='%23FFFFFF' stop-opacity='0.05'/>
        <stop offset='100%25' stop-color='%23FFFFFF' stop-opacity='0'/>
      </radialGradient>
      <radialGradient id='spot3' cx='50%25' cy='0%25' r='45%25'>
        <stop offset='0%25' stop-color='%23D4AF37' stop-opacity='0.04'/>
        <stop offset='100%25' stop-color='%23D4AF37' stop-opacity='0'/>
      </radialGradient>
    </defs>
    <rect width='1920' height='1080' fill='url(%23sky)'/>
    <rect width='1920' height='1080' fill='url(%23spot1)'/>
    <rect width='1920' height='1080' fill='url(%23spot2)'/>
    <rect width='1920' height='1080' fill='url(%23spot3)'/>
    <g opacity='0.18'>
      <polygon points='576,0 480,0 960,700' fill='%23FFFFFF'/>
      <polygon points='1344,0 1440,0 960,700' fill='%23FFFFFF'/>
      <polygon points='320,0 260,0 960,900' fill='%23FFFFFF' opacity='0.5'/>
      <polygon points='1600,0 1660,0 960,900' fill='%23FFFFFF' opacity='0.5'/>
    </g>
    <g opacity='0.06'>
      ${Array.from({ length: 120 }).map((_, i) => {
        const x = (i % 24) * 80 + 20;
        const y = Math.floor(i / 24) * 180 + 60;
        return `<circle cx='${x}' cy='${y}' r='3' fill='%23FFFFFF'/>`;
      }).join('')}
    </g>
    <rect x='0' y='1020' width='1920' height='60' fill='%23C81D1D' opacity='0.35'/>
    <line x1='0' y1='1050' x2='1920' y2='1050' stroke='%23D4AF37' stroke-width='2' opacity='0.5'/>
    <line x1='0' y1='1020' x2='1920' y2='1020' stroke='%23C0C0C0' stroke-width='1' opacity='0.3'/>
  </svg>`;
  const encoded = svg.replace(/\n/g, '').replace(/\s{2,}/g, ' ').replace(/"/g, "'");
  return `url("data:image/svg+xml;utf8,${encoded}") center/cover, linear-gradient(180deg, #0A1428 0%, #0F1F3A 60%, #0A1428 100%)`;
})();

registerTheme({
  id: 'varsity-athletic',
  name: '🏆 Varsity Athletic',
  description: 'Stadium jumbotron aesthetic: scoreboard clocks, chrome-bevel crests, gold-foil ribbons, amber LED tickers. Built for athletic lobbies and high school sports culture.',
  background: VA_BG,
  bgColor: '#0F1F3A',
  widgets: {
    LOGO:            VarsityAthleticLogo,
    TEXT:            VarsityAthleticText,
    RICH_TEXT:       VarsityAthleticText,
    CLOCK:           VarsityAthleticClock,
    WEATHER:         VarsityAthleticWeather,
    COUNTDOWN:       VarsityAthleticCountdown,
    ANNOUNCEMENT:    VarsityAthleticAnnouncement,
    CALENDAR:        VarsityAthleticCalendar,
    STAFF_SPOTLIGHT: VarsityAthleticStaffSpotlight,
    IMAGE_CAROUSEL:  VarsityAthleticImageCarousel,
    TICKER:          VarsityAthleticTicker,
  },
});
