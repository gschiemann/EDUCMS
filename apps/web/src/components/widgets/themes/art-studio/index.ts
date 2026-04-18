/**
 * Art Studio theme — middle school art-room lobby.
 * Artist's loft / studio vibe: paint splatters, brush strokes,
 * watercolor washes, palette + brushes, canvas easels.
 *
 * Background: warm canvas texture with subtle paint-splatter SVG
 * in a few corners. bgColor: '#FBF7F0'.
 */
import { registerTheme } from '../registry';
import {
  ArtStudioLogo,
  ArtStudioText,
  ArtStudioClock,
  ArtStudioWeather,
  ArtStudioCountdown,
  ArtStudioAnnouncement,
  ArtStudioCalendar,
  ArtStudioStaffSpotlight,
  ArtStudioImageCarousel,
  ArtStudioTicker,
} from '../art-studio';

const ART_STUDIO_BG = (() => {
  // Inline SVG: warm canvas linen texture + paint-splatter blobs in corners.
  // All colours are URL-encoded to survive the data-URI embedding.
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080' preserveAspectRatio='xMidYMid slice'>
    <defs>
      <filter id='rough' x='-5%25' y='-5%25' width='110%25' height='110%25'>
        <feTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/>
        <feColorMatrix type='saturate' values='0'/>
        <feBlend in='SourceGraphic' mode='multiply' result='blend'/>
      </filter>
    </defs>
    <!-- Canvas base -->
    <rect width='1920' height='1080' fill='%23FBF7F0'/>
    <!-- Subtle linen weave overlay -->
    <rect width='1920' height='1080' fill='url(%23rough)' opacity='0.04'/>
    <!-- TOP-LEFT paint splatters -->
    <g opacity='0.22'>
      <circle cx='80'  cy='60'  r='38' fill='%23D84040'/>
      <circle cx='140' cy='40'  r='22' fill='%23F5C542'/>
      <circle cx='50'  cy='120' r='18' fill='%233570D6'/>
      <circle cx='200' cy='80'  r='14' fill='%239457C0'/>
      <circle cx='30'  cy='30'  r='10' fill='%233AA856'/>
      <!-- Splatter drops -->
      <ellipse cx='180' cy='55'  rx='6' ry='14' fill='%23D84040' transform='rotate(30 180 55)'/>
      <ellipse cx='120' cy='105' rx='5' ry='12' fill='%23F5C542' transform='rotate(-20 120 105)'/>
      <ellipse cx='240' cy='40'  rx='4' ry='10' fill='%233570D6' transform='rotate(50 240 40)'/>
    </g>
    <!-- TOP-RIGHT paint splatters -->
    <g opacity='0.18'>
      <circle cx='1840' cy='70'  r='32' fill='%23F5C542'/>
      <circle cx='1780' cy='45'  r='20' fill='%233570D6'/>
      <circle cx='1870' cy='130' r='16' fill='%23D84040'/>
      <circle cx='1700' cy='80'  r='12' fill='%233AA856'/>
      <ellipse cx='1760' cy='120' rx='5' ry='13' fill='%239457C0' transform='rotate(-35 1760 120)'/>
      <ellipse cx='1880' cy='50'  rx='4' ry='10' fill='%23F5C542' transform='rotate(20 1880 50)'/>
    </g>
    <!-- BOTTOM-LEFT paint splatters -->
    <g opacity='0.15'>
      <circle cx='90'  cy='1020' r='28' fill='%233570D6'/>
      <circle cx='170' cy='1050' r='18' fill='%23D84040'/>
      <circle cx='50'  cy='960'  r='14' fill='%23F5C542'/>
      <ellipse cx='200' cy='1000' rx='5' ry='11' fill='%233AA856' transform='rotate(15 200 1000)'/>
    </g>
    <!-- BOTTOM-RIGHT paint splatters -->
    <g opacity='0.16'>
      <circle cx='1850' cy='1010' r='26' fill='%239457C0'/>
      <circle cx='1780' cy='1050' r='18' fill='%23F5C542'/>
      <circle cx='1900' cy='960'  r='14' fill='%23D84040'/>
      <ellipse cx='1740' cy='1020' rx='5' ry='12' fill='%233570D6' transform='rotate(-25 1740 1020)'/>
    </g>
    <!-- Faint brush-stroke lines across mid-section for texture -->
    <g opacity='0.05' stroke='%232A2624' strokeWidth='3' strokeLinecap='round'>
      <path d='M0,540 Q480,520 960,538 T1920,540'/>
      <path d='M0,560 Q480,574 960,558 T1920,560'/>
    </g>
  </svg>`;
  const encoded = svg.replace(/\n/g, '').replace(/\s{2,}/g, ' ').replace(/"/g, "'");
  return `url("data:image/svg+xml;utf8,${encoded}") center/cover, #FBF7F0`;
})();

registerTheme({
  id: 'art-studio',
  name: '🎨 Art Studio',
  description: 'Middle school art-room lobby: paint splatters, watercolor washes, kraft-paper scrolls, easels, and handwriting fonts throughout.',
  background: ART_STUDIO_BG,
  bgColor: '#FBF7F0',
  widgets: {
    LOGO:            ArtStudioLogo,
    TEXT:            ArtStudioText,
    RICH_TEXT:       ArtStudioText,
    CLOCK:           ArtStudioClock,
    WEATHER:         ArtStudioWeather,
    COUNTDOWN:       ArtStudioCountdown,
    ANNOUNCEMENT:    ArtStudioAnnouncement,
    CALENDAR:        ArtStudioCalendar,
    STAFF_SPOTLIGHT: ArtStudioStaffSpotlight,
    IMAGE_CAROUSEL:  ArtStudioImageCarousel,
    TICKER:          ArtStudioTicker,
  },
});
