/**
 * Scrapbook theme — elementary school lobby.
 * "Teacher's personal scrapbook": pastel-striped bg, polaroids at angles,
 * washi tape strips, handwritten labels, paper clips, spiral-notebook edges,
 * doodle frames, and sticker accents.
 */
import { registerTheme } from '../registry';
import {
  ScrapbookLogo,
  ScrapbookText,
  ScrapbookClock,
  ScrapbookWeather,
  ScrapbookCountdown,
  ScrapbookAnnouncement,
  ScrapbookCalendar,
  ScrapbookStaffSpotlight,
  ScrapbookImageCarousel,
  ScrapbookTicker,
} from '../scrapbook';

/**
 * Pastel-striped background — diagonal soft stripes in the SC palette,
 * evoking craft paper on a bulletin board. Backed by the paper solid so
 * any decode failure stays warm and readable.
 */
const SCRAPBOOK_BG = (() => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080' preserveAspectRatio='xMidYMid slice'>
    <rect width='1920' height='1080' fill='%23FFF8E7'/>
    <!-- Diagonal pastel stripes -->
    <g opacity='0.38'>
      <rect x='-200' y='-100' width='180' height='2800' fill='%23FBE8DA' transform='rotate(-18 -110 1300)'/>
      <rect x='120'  y='-100' width='90'  height='2800' fill='%23E0F5E1' transform='rotate(-18 210 1300)'/>
      <rect x='320'  y='-100' width='180' height='2800' fill='%23FF9FB044' transform='rotate(-18 410 1300)'/>
      <rect x='620'  y='-100' width='70'  height='2800' fill='%23FFD66E44' transform='rotate(-18 655 1300)'/>
      <rect x='800'  y='-100' width='180' height='2800' fill='%23FBE8DA' transform='rotate(-18 890 1300)'/>
      <rect x='1080' y='-100' width='90'  height='2800' fill='%23E0F5E1' transform='rotate(-18 1125 1300)'/>
      <rect x='1260' y='-100' width='180' height='2800' fill='%23C39BFF33' transform='rotate(-18 1350 1300)'/>
      <rect x='1540' y='-100' width='70'  height='2800' fill='%2380BCFF33' transform='rotate(-18 1575 1300)'/>
      <rect x='1700' y='-100' width='180' height='2800' fill='%23FBE8DA' transform='rotate(-18 1790 1300)'/>
    </g>
    <!-- Scattered star stickers -->
    <g font-size='28' font-family='serif' text-anchor='middle' dominant-baseline='middle' opacity='0.25'>
      <text x='120'  y='180'  fill='%23FF9FB0'>★</text>
      <text x='460'  y='90'   fill='%23FFD66E'>★</text>
      <text x='900'  y='55'   fill='%23C39BFF'>★</text>
      <text x='1380' y='100'  fill='%2380BCFF'>★</text>
      <text x='1760' y='160'  fill='%23FF9FB0'>★</text>
      <text x='80'   y='620'  fill='%23E8536B'>★</text>
      <text x='1840' y='700'  fill='%23FFD66E'>★</text>
      <text x='980'  y='1020' fill='%23C39BFF'>★</text>
      <text x='330'  y='950'  fill='%2380BCFF'>★</text>
      <text x='1600' y='940'  fill='%23FF9FB0'>★</text>
    </g>
    <!-- Small doodle dots -->
    <g opacity='0.2'>
      <circle cx='220'  cy='310' r='6' fill='%23FFD66E'/>
      <circle cx='1680' cy='340' r='6' fill='%23FF9FB0'/>
      <circle cx='580'  cy='780' r='6' fill='%2380BCFF'/>
      <circle cx='1400' cy='820' r='6' fill='%23C39BFF'/>
      <circle cx='760'  cy='200' r='4' fill='%23E8536B'/>
      <circle cx='1140' cy='880' r='4' fill='%23E8536B'/>
    </g>
  </svg>`;
  const encoded = svg.replace(/\n/g, '').replace(/\s{2,}/g, ' ').replace(/"/g, "'");
  return `url("data:image/svg+xml;utf8,${encoded}") center/cover, #FFF8E7`;
})();

registerTheme({
  id: 'scrapbook',
  name: '📒 Scrapbook',
  description: "Teacher's personal scrapbook: pastel-striped bg, polaroids at angles, washi tape, handwritten labels, paper clips, notebook edges, and doodle sticker frames.",
  background: SCRAPBOOK_BG,
  bgColor: '#FFF8E7',
  widgets: {
    LOGO:            ScrapbookLogo,
    TEXT:            ScrapbookText,
    RICH_TEXT:       ScrapbookText,
    CLOCK:           ScrapbookClock,
    WEATHER:         ScrapbookWeather,
    COUNTDOWN:       ScrapbookCountdown,
    ANNOUNCEMENT:    ScrapbookAnnouncement,
    CALENDAR:        ScrapbookCalendar,
    STAFF_SPOTLIGHT: ScrapbookStaffSpotlight,
    IMAGE_CAROUSEL:  ScrapbookImageCarousel,
    TICKER:          ScrapbookTicker,
  },
});
