/**
 * Jumbotron Pro theme — Friday-night-lights stadium jumbotron scene.
 *
 * Background: stadium at night. Dark navy gradient at the top fading to
 * a field-green hint at the bottom; tiny floodlight flares in every
 * corner; a subtle crowd-dot texture across the middle. Every widget
 * renders as an LED-chrome panel on this video wall.
 */
import { registerTheme } from '../registry';
import {
  JumbotronProLogo,
  JumbotronProText,
  JumbotronProClock,
  JumbotronProWeather,
  JumbotronProCountdown,
  JumbotronProAnnouncement,
  JumbotronProCalendar,
  JumbotronProStaffSpotlight,
  JumbotronProImageCarousel,
  JumbotronProTicker,
} from '../jumbotron-pro';

const JUMBOTRON_PRO_BG = (() => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080' preserveAspectRatio='xMidYMid slice'>
    <defs>
      <linearGradient id='jpNight' x1='0' y1='0' x2='0' y2='1'>
        <stop offset='0%25' stop-color='%23050A14'/>
        <stop offset='55%25' stop-color='%230B1020'/>
        <stop offset='82%25' stop-color='%23102318'/>
        <stop offset='100%25' stop-color='%23143A1E'/>
      </linearGradient>
      <radialGradient id='jpFlareTL' cx='0%25' cy='0%25' r='40%25'>
        <stop offset='0%25' stop-color='%23FFE9A8' stop-opacity='0.45'/>
        <stop offset='40%25' stop-color='%23FFB020' stop-opacity='0.12'/>
        <stop offset='100%25' stop-color='%23FFB020' stop-opacity='0'/>
      </radialGradient>
      <radialGradient id='jpFlareTR' cx='100%25' cy='0%25' r='40%25'>
        <stop offset='0%25' stop-color='%23FFE9A8' stop-opacity='0.45'/>
        <stop offset='40%25' stop-color='%23FFB020' stop-opacity='0.12'/>
        <stop offset='100%25' stop-color='%23FFB020' stop-opacity='0'/>
      </radialGradient>
      <radialGradient id='jpFlareBL' cx='0%25' cy='100%25' r='36%25'>
        <stop offset='0%25' stop-color='%23FFE9A8' stop-opacity='0.3'/>
        <stop offset='60%25' stop-color='%23FFB020' stop-opacity='0'/>
      </radialGradient>
      <radialGradient id='jpFlareBR' cx='100%25' cy='100%25' r='36%25'>
        <stop offset='0%25' stop-color='%23FFE9A8' stop-opacity='0.3'/>
        <stop offset='60%25' stop-color='%23FFB020' stop-opacity='0'/>
      </radialGradient>
      <pattern id='jpCrowd' x='0' y='0' width='24' height='24' patternUnits='userSpaceOnUse'>
        <circle cx='6' cy='6' r='0.9' fill='%23FFB020' fill-opacity='0.08'/>
        <circle cx='18' cy='14' r='0.7' fill='%23D1D5DB' fill-opacity='0.06'/>
        <circle cx='10' cy='20' r='0.6' fill='%23FFB020' fill-opacity='0.06'/>
      </pattern>
    </defs>
    <rect width='1920' height='1080' fill='url(%23jpNight)'/>
    <rect width='1920' height='1080' fill='url(%23jpCrowd)'/>
    <rect width='1920' height='1080' fill='url(%23jpFlareTL)'/>
    <rect width='1920' height='1080' fill='url(%23jpFlareTR)'/>
    <rect width='1920' height='1080' fill='url(%23jpFlareBL)'/>
    <rect width='1920' height='1080' fill='url(%23jpFlareBR)'/>
    <g opacity='0.35'>
      <line x1='0' y1='880' x2='1920' y2='880' stroke='%23143A1E' stroke-width='2'/>
      <line x1='0' y1='940' x2='1920' y2='940' stroke='%230F2A18' stroke-width='1'/>
      <line x1='0' y1='1000' x2='1920' y2='1000' stroke='%230F2A18' stroke-width='1'/>
    </g>
    <g fill='%23FFB020' opacity='0.9'>
      <circle cx='80' cy='60' r='3'/>
      <circle cx='1840' cy='60' r='3'/>
      <circle cx='80' cy='1020' r='2'/>
      <circle cx='1840' cy='1020' r='2'/>
    </g>
  </svg>`;
  const encoded = svg.replace(/\n/g, '').replace(/\s{2,}/g, ' ').replace(/"/g, "'");
  return `url("data:image/svg+xml;utf8,${encoded}") center/cover, linear-gradient(180deg, #050A14 0%, #0B1020 55%, #143A1E 100%)`;
})();

registerTheme({
  id: 'jumbotron-pro',
  name: '🏟️ Jumbotron Pro',
  description: 'Stadium jumbotron scene: LED scoreboard center, chrome-and-amber panels, dot-matrix ticker, player-stats + standings rails. Friday-night-lights for high school lobbies.',
  background: JUMBOTRON_PRO_BG,
  bgColor: '#050A14',
  widgets: {
    LOGO:            JumbotronProLogo,
    TEXT:            JumbotronProText,
    RICH_TEXT:       JumbotronProText,
    CLOCK:           JumbotronProClock,
    WEATHER:         JumbotronProWeather,
    COUNTDOWN:       JumbotronProCountdown,
    ANNOUNCEMENT:    JumbotronProAnnouncement,
    CALENDAR:        JumbotronProCalendar,
    STAFF_SPOTLIGHT: JumbotronProStaffSpotlight,
    IMAGE_CAROUSEL:  JumbotronProImageCarousel,
    TICKER:          JumbotronProTicker,
  },
});
