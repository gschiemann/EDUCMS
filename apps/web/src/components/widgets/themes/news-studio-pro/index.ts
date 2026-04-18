/**
 * News Studio Pro theme — high school premium TV news studio aesthetic.
 *
 * Background: studio-black gradient with faint blue uplight at the bottom
 * + premium dot-grid pattern for broadcast depth.
 *
 * Palette: studioBlack #0B0F17 · accent #1E90FF · hotRed #EF2929 · gold #FFC94D
 * Fonts: Inter (display, 900) · Fraunces (serif italic) · JetBrains Mono (clock/countdown)
 */
import { registerTheme } from '../registry';
import {
  NewsStudioProLogo,
  NewsStudioProText,
  NewsStudioProClock,
  NewsStudioProWeather,
  NewsStudioProCountdown,
  NewsStudioProAnnouncement,
  NewsStudioProCalendar,
  NewsStudioProStaffSpotlight,
  NewsStudioProImageCarousel,
  NewsStudioProTicker,
} from '../news-studio-pro';

// Studio-black base with faint network-blue uplight and dot-grid overlay.
// The dot-grid uses a tiny SVG data URI so it renders at every resolution
// without aliasing — same technique as the Diner Chalkboard theme.
const NSP_BG = (() => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='48' height='48'>
    <circle cx='24' cy='24' r='1.2' fill='%231E90FF' opacity='0.10'/>
  </svg>`;
  const encoded = svg.replace(/\n/g, '').replace(/\s{2,}/g, ' ').replace(/"/g, "'");
  const dotGrid = `url("data:image/svg+xml;utf8,${encoded}")`;
  return [
    dotGrid,
    `radial-gradient(ellipse 120% 60% at 50% 110%, #0044AA18 0%, transparent 70%)`,
    `linear-gradient(180deg, #05080E 0%, #0B0F17 60%, #05080E 100%)`,
  ].join(', ');
})();

registerTheme({
  id:          'news-studio-pro',
  name:        '📺 News Studio Pro',
  description: 'Premium broadcast aesthetic: glass lower-thirds, blue glow panels, LIVE indicators, and bold network typography for high school news.',
  background:  NSP_BG,
  bgColor:     '#0B0F17',
  widgets: {
    LOGO:            NewsStudioProLogo,
    TEXT:            NewsStudioProText,
    RICH_TEXT:       NewsStudioProText,
    CLOCK:           NewsStudioProClock,
    WEATHER:         NewsStudioProWeather,
    COUNTDOWN:       NewsStudioProCountdown,
    ANNOUNCEMENT:    NewsStudioProAnnouncement,
    CALENDAR:        NewsStudioProCalendar,
    STAFF_SPOTLIGHT: NewsStudioProStaffSpotlight,
    IMAGE_CAROUSEL:  NewsStudioProImageCarousel,
    TICKER:          NewsStudioProTicker,
  },
});
