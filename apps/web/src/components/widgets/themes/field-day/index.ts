/**
 * Field Day theme — sports-stadium sticker pack.
 * Widgets BECOME shapes: stopwatch clock, shield weather, medal
 * countdown, trophy announcement, jersey calendar, scoreboard ticker.
 */
import { registerTheme } from '../registry';
import {
  FieldDayLogo, FieldDayText, FieldDayClock, FieldDayWeather,
  FieldDayCountdown, FieldDayAnnouncement, FieldDayCalendar,
  FieldDayStaffSpotlight, FieldDayImageCarousel, FieldDayTicker,
} from '../field-day';

const FIELD_DAY_BG = (() => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080' preserveAspectRatio='xMidYMid slice'>
    <defs>
      <radialGradient id='fdspot' cx='50%25' cy='20%25' r='70%25'>
        <stop offset='0%25' stop-color='%23355089' stop-opacity='1'/>
        <stop offset='60%25' stop-color='%231E2A4A' stop-opacity='1'/>
        <stop offset='100%25' stop-color='%230B1121' stop-opacity='1'/>
      </radialGradient>
      <pattern id='fdhex' width='60' height='52' patternUnits='userSpaceOnUse' patternTransform='scale(1.2)'>
        <path d='M30 0 L60 15 L60 37 L30 52 L0 37 L0 15 Z' fill='none' stroke='%23FFD23F' stroke-width='1' opacity='0.08'/>
      </pattern>
    </defs>
    <rect width='1920' height='1080' fill='url(%23fdspot)'/>
    <rect width='1920' height='1080' fill='url(%23fdhex)'/>
    <!-- stadium spotlight beams -->
    <g opacity='0.12'>
      <polygon points='200,0 360,0 520,1080 0,1080' fill='%23FFD23F'/>
      <polygon points='1720,0 1560,0 1400,1080 1920,1080' fill='%23FFD23F'/>
    </g>
    <!-- field horizon line -->
    <line x1='0' y1='860' x2='1920' y2='860' stroke='%234CB963' stroke-width='2' opacity='0.3'/>
    <rect x='0' y='860' width='1920' height='220' fill='%234CB963' opacity='0.08'/>
    <!-- confetti dots -->
    <g fill='%23FFD23F' opacity='0.5'>
      <circle cx='160' cy='180' r='6'/>
      <circle cx='1760' cy='240' r='7'/>
      <circle cx='1840' cy='820' r='5'/>
      <circle cx='120' cy='900' r='6'/>
    </g>
    <g fill='%23E63946' opacity='0.5'>
      <rect x='320' y='520' width='12' height='6' transform='rotate(25 326 523)'/>
      <rect x='1580' y='620' width='12' height='6' transform='rotate(-15 1586 623)'/>
    </g>
    <g fill='%23FFFFFF' opacity='0.5'>
      <circle cx='480' cy='220' r='4'/>
      <circle cx='1340' cy='340' r='4'/>
    </g>
  </svg>`;
  const encoded = svg.replace(/\n/g, '').replace(/\s{2,}/g, ' ').replace(/"/g, "'");
  return `url("data:image/svg+xml;utf8,${encoded}") center/cover, #1E2A4A`;
})();

registerTheme({
  id: 'field-day',
  name: '🏆 Field Day',
  description: 'Sports-stadium sticker pack: stopwatch clock, shield weather badge, medal countdown, trophy announcements, jersey event cards, scoreboard LED ticker. Widgets BECOME real shapes.',
  background: FIELD_DAY_BG,
  bgColor: '#1E2A4A',
  widgets: {
    LOGO:            FieldDayLogo,
    TEXT:            FieldDayText,
    RICH_TEXT:       FieldDayText,
    CLOCK:           FieldDayClock,
    WEATHER:         FieldDayWeather,
    COUNTDOWN:       FieldDayCountdown,
    ANNOUNCEMENT:    FieldDayAnnouncement,
    CALENDAR:        FieldDayCalendar,
    STAFF_SPOTLIGHT: FieldDayStaffSpotlight,
    IMAGE_CAROUSEL:  FieldDayImageCarousel,
    TICKER:          FieldDayTicker,
  },
});
