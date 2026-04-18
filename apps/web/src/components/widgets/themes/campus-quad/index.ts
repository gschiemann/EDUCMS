/**
 * Campus Quad theme — high school modern-minimal welcome.
 *
 * Visual identity: brutalist-editorial, typography-forward, clean lines.
 * Warm off-white ground + a single bold accent-red + editorial Fraunces serif.
 * Background: warm off-white field (#F7F5F0) with a thin accent-red horizontal
 * rule near the top edge and a subtle column-grid watermark in CSS.
 */
import { registerTheme } from '../registry';
import {
  CampusQuadLogo,
  CampusQuadText,
  CampusQuadClock,
  CampusQuadWeather,
  CampusQuadCountdown,
  CampusQuadAnnouncement,
  CampusQuadCalendar,
  CampusQuadStaffSpotlight,
  CampusQuadImageCarousel,
  CampusQuadTicker,
} from '../campus-quad';

// Background: warm off-white with a thin accent-red horizontal rule at ~4%
// from the top and a faint column-grid watermark built entirely from SVG
// so it renders identically at any resolution without loading an image file.
const CAMPUS_QUAD_BG = (() => {
  // SVG encodes:
  //   1. Warm off-white fill (#F7F5F0)
  //   2. Thin accent-red rule at y=43 (≈4% of 1080)
  //   3. Faint vertical column lines — 12-column grid at 8.33% intervals
  //      at very low opacity (0.06) so it reads as texture, not a cage
  const cols = Array.from({ length: 11 }, (_, i) => {
    const x = Math.round(((i + 1) / 12) * 1920);
    return `<line x1='${x}' y1='0' x2='${x}' y2='1080' stroke='%23121212' stroke-width='1' opacity='0.06'/>`;
  }).join('');

  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080' preserveAspectRatio='xMidYMid slice'>
    <rect width='1920' height='1080' fill='%23F7F5F0'/>
    ${cols}
    <line x1='0' y1='43' x2='1920' y2='43' stroke='%23B8322C' stroke-width='3'/>
  </svg>`;

  const encoded = svg.replace(/\n/g, '').replace(/\s{2,}/g, ' ').replace(/"/g, "'");
  return `url("data:image/svg+xml;utf8,${encoded}") center/cover, #F7F5F0`;
})();

registerTheme({
  id:          'campus-quad',
  name:        'Campus Quad',
  description: 'High school modern-minimal editorial. Brutalist-clean typography, bold accent-red, generous white-space — built for the campus welcome board.',
  background:  CAMPUS_QUAD_BG,
  bgColor:     '#F7F5F0',
  widgets: {
    LOGO:            CampusQuadLogo,
    TEXT:            CampusQuadText,
    RICH_TEXT:       CampusQuadText,
    CLOCK:           CampusQuadClock,
    WEATHER:         CampusQuadWeather,
    COUNTDOWN:       CampusQuadCountdown,
    ANNOUNCEMENT:    CampusQuadAnnouncement,
    CALENDAR:        CampusQuadCalendar,
    STAFF_SPOTLIGHT: CampusQuadStaffSpotlight,
    IMAGE_CAROUSEL:  CampusQuadImageCarousel,
    TICKER:          CampusQuadTicker,
  },
});
