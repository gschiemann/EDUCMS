/**
 * Morning News theme — middle school morning broadcast aesthetic.
 *
 * TV morning-show set vibe: LIVE badge, lower-third graphics, news ticker,
 * anchor-desk card, breaking-news color bars.
 *
 * Background: dark navy gradient (anchor blue → deeper navy) with a
 * subtle dot-grid overlay and a faint warm newsroom-monitor glow
 * centered at top-left, evoking a studio bank of monitors.
 */
import { registerTheme } from '../registry';
import {
  MorningNewsLogo,
  MorningNewsText,
  MorningNewsClock,
  MorningNewsWeather,
  MorningNewsCountdown,
  MorningNewsAnnouncement,
  MorningNewsCalendar,
  MorningNewsStaffSpotlight,
  MorningNewsImageCarousel,
  MorningNewsTicker,
} from '../morning-news';

const MORNING_NEWS_BG = (() => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080' preserveAspectRatio='xMidYMid slice'>
    <defs>
      <radialGradient id='mnGlow' cx='18%25' cy='22%25' r='55%25'>
        <stop offset='0%25' stop-color='%231E3A5F' stop-opacity='0.55'/>
        <stop offset='100%25' stop-color='%230F172A' stop-opacity='0'/>
      </radialGradient>
      <pattern id='mnDots' x='0' y='0' width='40' height='40' patternUnits='userSpaceOnUse'>
        <circle cx='20' cy='20' r='1.2' fill='%23334155' opacity='0.6'/>
      </pattern>
    </defs>
    <rect width='1920' height='1080' fill='%230F172A'/>
    <rect width='1920' height='1080' fill='url(%23mnDots)'/>
    <rect width='1920' height='1080' fill='url(%23mnGlow)'/>
    <rect x='0' y='1054' width='1920' height='6' fill='%23EAB308' opacity='0.7'/>
    <rect x='0' y='1060' width='1920' height='20' fill='%23DC2626' opacity='0.85'/>
  </svg>`;
  const encoded = svg.replace(/\n/g, '').replace(/\s{2,}/g, ' ').replace(/"/g, "'");
  return `url("data:image/svg+xml;utf8,${encoded}") center/cover, linear-gradient(160deg, #0F172A 0%, #020617 100%)`;
})();

registerTheme({
  id:          'morning-news',
  name:        '📺 Morning News',
  description: 'Middle-school morning broadcast aesthetic: LIVE badge, lower-third graphics, breaking-news color bars, anchor-desk cards, and a classic cable-news ticker.',
  background:  MORNING_NEWS_BG,
  bgColor:     '#0F172A',
  widgets: {
    LOGO:            MorningNewsLogo,
    TEXT:            MorningNewsText,
    RICH_TEXT:       MorningNewsText,
    CLOCK:           MorningNewsClock,
    WEATHER:         MorningNewsWeather,
    COUNTDOWN:       MorningNewsCountdown,
    ANNOUNCEMENT:    MorningNewsAnnouncement,
    CALENDAR:        MorningNewsCalendar,
    STAFF_SPOTLIGHT: MorningNewsStaffSpotlight,
    IMAGE_CAROUSEL:  MorningNewsImageCarousel,
    TICKER:          MorningNewsTicker,
  },
});
