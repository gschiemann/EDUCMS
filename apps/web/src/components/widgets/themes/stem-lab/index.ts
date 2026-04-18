/**
 * STEM Lab theme — middle school science lobby.
 * Modern science lab: glowing circuit traces, periodic-table tiles,
 * beakers, rocket countdown, oscilloscope ticker, holographic HUD cards.
 * Dark navy background + subtle graph-paper grid + faint circuit trace overlay.
 */
import { registerTheme } from '../registry';
import {
  StemLabLogo,
  StemLabText,
  StemLabClock,
  StemLabWeather,
  StemLabCountdown,
  StemLabAnnouncement,
  StemLabCalendar,
  StemLabStaffSpotlight,
  StemLabImageCarousel,
  StemLabTicker,
} from '../stem-lab';

// Graph-paper grid + faint diagonal circuit trace as SVG background.
// Encoded as a data-URI inline so no network request is needed.
const STEM_LAB_BG = (() => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080' preserveAspectRatio='xMidYMid slice'>
    <rect width='1920' height='1080' fill='%230A192F'/>
    <!-- Graph-paper minor grid (40px) -->
    <g stroke='%23112240' stroke-width='0.8' opacity='0.9'>
      ${Array.from({length: 49}).map((_,i) => `<line x1='${i*40}' y1='0' x2='${i*40}' y2='1080'/>`).join('')}
      ${Array.from({length: 28}).map((_,i) => `<line x1='0' y1='${i*40}' x2='1920' y2='${i*40}'/>`).join('')}
    </g>
    <!-- Graph-paper major grid (200px) -->
    <g stroke='%23233554' stroke-width='1.5' opacity='0.7'>
      ${Array.from({length: 10}).map((_,i) => `<line x1='${i*200}' y1='0' x2='${i*200}' y2='1080'/>`).join('')}
      ${Array.from({length: 6}).map((_,i)  => `<line x1='0' y1='${i*200}' x2='1920' y2='${i*200}'/>`).join('')}
    </g>
    <!-- Faint circuit traces -->
    <g stroke='%2364FFDA' stroke-width='1.2' opacity='0.07' fill='none'>
      <path d='M0 200 H600 V400 H1200 V200 H1920'/>
      <path d='M0 700 H400 V500 H900 V700 H1920'/>
      <path d='M200 0 V300 H500 V600 H200 V1080'/>
      <path d='M1600 0 V250 H1300 V550 H1600 V1080'/>
      <path d='M800 0 V180 H1100 V900 H800 V1080'/>
    </g>
    <!-- Solder pad dots at circuit junctions -->
    <g fill='%2364FFDA' opacity='0.12'>
      <circle cx='600' cy='200' r='6'/><circle cx='600' cy='400' r='6'/>
      <circle cx='1200' cy='200' r='6'/><circle cx='1200' cy='400' r='6'/>
      <circle cx='400' cy='700' r='6'/><circle cx='400' cy='500' r='6'/>
      <circle cx='900' cy='700' r='6'/><circle cx='900' cy='500' r='6'/>
      <circle cx='200' cy='300' r='6'/><circle cx='500' cy='300' r='6'/>
      <circle cx='500' cy='600' r='6'/><circle cx='200' cy='600' r='6'/>
      <circle cx='1300' cy='250' r='6'/><circle cx='1600' cy='250' r='6'/>
      <circle cx='1300' cy='550' r='6'/><circle cx='1600' cy='550' r='6'/>
      <circle cx='800' cy='180' r='6'/><circle cx='1100' cy='180' r='6'/>
      <circle cx='800' cy='900' r='6'/><circle cx='1100' cy='900' r='6'/>
    </g>
    <!-- Subtle neon corner glow -->
    <radialGradient id='slglow1' cx='0%25' cy='0%25' r='40%25'>
      <stop offset='0%25' stop-color='%2364FFDA' stop-opacity='0.05'/>
      <stop offset='100%25' stop-color='%2364FFDA' stop-opacity='0'/>
    </radialGradient>
    <radialGradient id='slglow2' cx='100%25' cy='100%25' r='40%25'>
      <stop offset='0%25' stop-color='%23A78BFA' stop-opacity='0.05'/>
      <stop offset='100%25' stop-color='%23A78BFA' stop-opacity='0'/>
    </radialGradient>
    <rect width='1920' height='1080' fill='url(%23slglow1)'/>
    <rect width='1920' height='1080' fill='url(%23slglow2)'/>
  </svg>`;
  const encoded = svg.replace(/\n/g, '').replace(/\s{2,}/g, ' ').replace(/"/g, "'");
  return `url("data:image/svg+xml;utf8,${encoded}") center/cover`;
})();

registerTheme({
  id: 'stem-lab',
  name: '🔬 STEM Lab',
  description: 'Middle school science lobby: glowing circuit traces, periodic-table tiles, rocket countdown, oscilloscope ticker, holographic HUD ID cards. Dark navy + neon accents.',
  background: STEM_LAB_BG,
  bgColor: '#0A192F',
  widgets: {
    LOGO:            StemLabLogo,
    TEXT:            StemLabText,
    RICH_TEXT:       StemLabText,
    CLOCK:           StemLabClock,
    WEATHER:         StemLabWeather,
    COUNTDOWN:       StemLabCountdown,
    ANNOUNCEMENT:    StemLabAnnouncement,
    CALENDAR:        StemLabCalendar,
    STAFF_SPOTLIGHT: StemLabStaffSpotlight,
    IMAGE_CAROUSEL:  StemLabImageCarousel,
    TICKER:          StemLabTicker,
  },
});
