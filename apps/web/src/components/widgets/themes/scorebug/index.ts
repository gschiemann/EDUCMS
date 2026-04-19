/**
 * Scorebug theme — middle-school athletics dashboard.
 * ESPN / live-sports-app energy: dark glass UI, neon live stats,
 * matchup hero, league standings, athlete of the week, chyrons.
 *
 * The background is a deep near-black to navy gradient with a thin
 * diagonal accent-line pattern tucked into one corner — just enough
 * visual interest to feel "on-air" without distracting from the
 * heavy glass widgets sitting on top.
 */
import { registerTheme } from '../registry';
import {
  ScorebugLogo,
  ScorebugText,
  ScorebugClock,
  ScorebugWeather,
  ScorebugCountdown,
  ScorebugAnnouncement,
  ScorebugCalendar,
  ScorebugStaffSpotlight,
  ScorebugImageCarousel,
  ScorebugTicker,
} from '../scorebug';

const SCOREBUG_BG = (() => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080' preserveAspectRatio='xMidYMid slice'>
    <defs>
      <radialGradient id='sbbg' cx='50%25' cy='40%25' r='85%25'>
        <stop offset='0%25' stop-color='%2311182A'/>
        <stop offset='55%25' stop-color='%230B111C'/>
        <stop offset='100%25' stop-color='%23050810'/>
      </radialGradient>
      <linearGradient id='sbaccent' x1='0' y1='0' x2='1' y2='1'>
        <stop offset='0%25' stop-color='%231E90FF' stop-opacity='0.35'/>
        <stop offset='100%25' stop-color='%23EF4444' stop-opacity='0.1'/>
      </linearGradient>
    </defs>
    <rect width='1920' height='1080' fill='url(%23sbbg)'/>
    <!-- Diagonal accent lines bottom-right corner -->
    <g opacity='0.55'>
      <line x1='1520' y1='1080' x2='1920' y2='680' stroke='%231E90FF' stroke-width='3' stroke-opacity='0.4'/>
      <line x1='1580' y1='1080' x2='1920' y2='740' stroke='%231E90FF' stroke-width='2' stroke-opacity='0.3'/>
      <line x1='1640' y1='1080' x2='1920' y2='800' stroke='%23EF4444' stroke-width='2' stroke-opacity='0.4'/>
      <line x1='1700' y1='1080' x2='1920' y2='860' stroke='%23EF4444' stroke-width='1.5' stroke-opacity='0.3'/>
      <line x1='1760' y1='1080' x2='1920' y2='920' stroke='%23A3E635' stroke-width='1.5' stroke-opacity='0.25'/>
    </g>
    <!-- Top-left mirrored diag lines for balance -->
    <g opacity='0.4'>
      <line x1='0' y1='60' x2='320' y2='-260' stroke='%231E90FF' stroke-width='2' stroke-opacity='0.3'/>
      <line x1='0' y1='120' x2='320' y2='-200' stroke='%231E90FF' stroke-width='2' stroke-opacity='0.25'/>
      <line x1='0' y1='180' x2='320' y2='-140' stroke='%23EF4444' stroke-width='1.5' stroke-opacity='0.25'/>
    </g>
    <!-- Faint grid specks to suggest a data surface -->
    <g fill='%231E90FF' opacity='0.2'>
      <circle cx='240' cy='260' r='2'/>
      <circle cx='520' cy='380' r='2'/>
      <circle cx='1400' cy='320' r='2'/>
      <circle cx='1700' cy='520' r='2'/>
      <circle cx='320' cy='820' r='2'/>
      <circle cx='880' cy='920' r='2'/>
      <circle cx='1200' cy='780' r='2'/>
    </g>
    <!-- Subtle horizontal scanline at the top -->
    <rect x='0' y='0' width='1920' height='2' fill='%23EF4444' opacity='0.35'/>
    <rect x='0' y='0' width='1920' height='1080' fill='url(%23sbaccent)'/>
  </svg>`;
  const encoded = svg.replace(/\n/g, '').replace(/\s{2,}/g, ' ').replace(/"/g, "'");
  return `url("data:image/svg+xml;utf8,${encoded}") center/cover, linear-gradient(180deg, #0B111C 0%, #05080F 100%)`;
})();

registerTheme({
  id: 'scorebug',
  name: '📊 Scorebug Dashboard',
  description: 'ESPN-style sports-app dashboard. Dark glass UI, neon live stats, matchup hero banner, league standings, athlete of the week. Middle school athletics energy.',
  background: SCOREBUG_BG,
  bgColor: '#0B111C',
  widgets: {
    LOGO:            ScorebugLogo,
    TEXT:            ScorebugText,
    RICH_TEXT:       ScorebugText,
    CLOCK:           ScorebugClock,
    WEATHER:         ScorebugWeather,
    COUNTDOWN:       ScorebugCountdown,
    ANNOUNCEMENT:    ScorebugAnnouncement,
    CALENDAR:        ScorebugCalendar,
    STAFF_SPOTLIGHT: ScorebugStaffSpotlight,
    IMAGE_CAROUSEL:  ScorebugImageCarousel,
    TICKER:          ScorebugTicker,
  },
});
