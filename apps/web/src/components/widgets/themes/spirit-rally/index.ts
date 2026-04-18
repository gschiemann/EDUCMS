/**
 * Spirit Rally theme — middle-school pep-rally lobby aesthetic.
 * Stadium bleachers background, HYPE energy, megaphones, foam-finger
 * pointers, spotlight beams, confetti bursts, bold sports typography.
 * Palette: navy + gold + red. Fonts: Bungee display, Fredoka body, Caveat script.
 */
import { registerTheme } from '../registry';
import {
  SpiritRallyLogo,
  SpiritRallyText,
  SpiritRallyClock,
  SpiritRallyWeather,
  SpiritRallyCountdown,
  SpiritRallyAnnouncement,
  SpiritRallyCalendar,
  SpiritRallyStaffSpotlight,
  SpiritRallyImageCarousel,
  SpiritRallyTicker,
} from '../spirit-rally';

const SPIRIT_RALLY_BG = (() => {
  // Stadium bleacher pattern: horizontal rows in navy/dark-navy,
  // two gold spotlight cones sweeping down from upper corners,
  // confetti dots and star accents scattered throughout.
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080' preserveAspectRatio='xMidYMid slice'>
    <defs>
      <linearGradient id='srbg' x1='0%25' y1='0%25' x2='0%25' y2='100%25'>
        <stop offset='0%25' stop-color='%230B1A2A'/>
        <stop offset='40%25' stop-color='%231A365D'/>
        <stop offset='100%25' stop-color='%230d2040'/>
      </linearGradient>
      <pattern id='bleachers' width='1920' height='54' patternUnits='userSpaceOnUse'>
        <rect width='1920' height='54' fill='none'/>
        <rect y='0' width='1920' height='26' fill='%231A365D' opacity='0.9'/>
        <rect y='26' width='1920' height='2' fill='%23D69E2E' opacity='0.3'/>
        <rect y='28' width='1920' height='26' fill='%23142a4e' opacity='0.9'/>
      </pattern>
    </defs>
    <!-- Bleacher rows fill -->
    <rect width='1920' height='1080' fill='url(%23srbg)'/>
    <rect width='1920' height='1080' fill='url(%23bleachers)' opacity='0.85'/>
    <!-- Spotlight beam left -->
    <polygon points='240,0 480,0 820,1080 0,1080' fill='rgba(246,224,94,0.07)'/>
    <polygon points='280,0 420,0 660,1080 140,1080' fill='rgba(246,224,94,0.05)'/>
    <!-- Spotlight beam right -->
    <polygon points='1440,0 1680,0 1920,1080 1100,1080' fill='rgba(246,224,94,0.07)'/>
    <polygon points='1500,0 1640,0 1780,1080 1260,1080' fill='rgba(246,224,94,0.05)'/>
    <!-- Spotlight glow halos at top -->
    <ellipse cx='340' cy='30' rx='120' ry='40' fill='rgba(246,224,94,0.18)'/>
    <ellipse cx='1580' cy='30' rx='120' ry='40' fill='rgba(246,224,94,0.18)'/>
    <!-- Confetti burst dots -->
    <g opacity='0.65'>
      <circle cx='180' cy='200' r='8' fill='%23F6E05E'/>
      <circle cx='320' cy='140' r='6' fill='%23C53030'/>
      <circle cx='480' cy='280' r='7' fill='%23FFFFFF'/>
      <circle cx='1440' cy='160' r='8' fill='%23F6E05E'/>
      <circle cx='1600' cy='240' r='6' fill='%23C53030'/>
      <circle cx='1720' cy='120' r='7' fill='%23FFFFFF'/>
      <circle cx='900' cy='80' r='9' fill='%23F6E05E'/>
      <circle cx='1020' cy='180' r='5' fill='%23D69E2E'/>
      <circle cx='200' cy='840' r='7' fill='%23C53030'/>
      <circle cx='1680' cy='900' r='8' fill='%23F6E05E'/>
      <circle cx='960' cy='980' r='6' fill='%23FFFFFF'/>
    </g>
    <!-- Confetti rectangles (tumbling) -->
    <g opacity='0.55'>
      <rect x='140' y='320' width='14' height='28' fill='%23F6E05E' transform='rotate(30 147 334)'/>
      <rect x='1760' y='360' width='14' height='28' fill='%23C53030' transform='rotate(-25 1767 374)'/>
      <rect x='600' y='120' width='12' height='24' fill='%23FFFFFF' transform='rotate(15 606 132)'/>
      <rect x='1320' y='100' width='12' height='24' fill='%23F6E05E' transform='rotate(-40 1326 112)'/>
      <rect x='80' y='620' width='14' height='28' fill='%23D69E2E' transform='rotate(20 87 634)'/>
      <rect x='1840' y='700' width='14' height='28' fill='%23FFFFFF' transform='rotate(-15 1847 714)'/>
    </g>
    <!-- Star accents in upper corners -->
    <text x='60' y='90' font-size='48' fill='%23F6E05E' opacity='0.35' font-family='sans-serif'>★</text>
    <text x='1820' y='90' font-size='48' fill='%23F6E05E' opacity='0.35' font-family='sans-serif' text-anchor='end'>★</text>
    <text x='960' y='70' font-size='36' fill='%23D69E2E' opacity='0.25' font-family='sans-serif' text-anchor='middle'>★</text>
    <!-- Bottom field horizon subtle glow -->
    <rect x='0' y='960' width='1920' height='120' fill='rgba(26,54,93,0.4)'/>
    <line x1='0' y1='962' x2='1920' y2='962' stroke='%23D69E2E' stroke-width='2' opacity='0.25'/>
  </svg>`;
  const encoded = svg.replace(/\n/g, '').replace(/\s{2,}/g, ' ').replace(/"/g, "'");
  return `url("data:image/svg+xml;utf8,${encoded}") center/cover, linear-gradient(180deg, #0B1A2A 0%, #1A365D 100%)`;
})();

registerTheme({
  id: 'spirit-rally',
  name: '📣 Spirit Rally',
  description: 'Middle-school pep-rally lobby: stadium bleachers, spotlight beams, foam fingers, megaphone banners, scoreboard clock, jumbotron carousel, and amber LED ticker.',
  background: SPIRIT_RALLY_BG,
  bgColor: '#1A365D',
  widgets: {
    LOGO:            SpiritRallyLogo,
    TEXT:            SpiritRallyText,
    RICH_TEXT:       SpiritRallyText,
    CLOCK:           SpiritRallyClock,
    WEATHER:         SpiritRallyWeather,
    COUNTDOWN:       SpiritRallyCountdown,
    ANNOUNCEMENT:    SpiritRallyAnnouncement,
    CALENDAR:        SpiritRallyCalendar,
    STAFF_SPOTLIGHT: SpiritRallyStaffSpotlight,
    IMAGE_CAROUSEL:  SpiritRallyImageCarousel,
    TICKER:          SpiritRallyTicker,
  },
});
