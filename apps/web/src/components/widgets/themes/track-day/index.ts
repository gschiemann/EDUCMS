/**
 * Track Day theme — top-down running-track lobby scene.
 * Background is a bird's-eye aerial of an elementary-school track:
 *  - Oval rust-red 6-lane track
 *  - Green infield inside the oval
 *  - Bleachers on top-right
 *  - Finish line on the right edge
 * Widgets are stadium props placed ON this field — not a grid.
 */
import { registerTheme } from '../registry';
import {
  TrackDayLogo,
  TrackDayText,
  TrackDayClock,
  TrackDayWeather,
  TrackDayCountdown,
  TrackDayAnnouncement,
  TrackDayCalendar,
  TrackDayStaffSpotlight,
  TrackDayImageCarousel,
  TrackDayTicker,
} from '../track-day';

const TRACK_DAY_BG = (() => {
  // Top-down stadium illustration at 1920x1080 reference.
  //  Oval track: outer ellipse rx=880, ry=450; inner ellipse (infield edge)
  //    rx=660, ry=270. Six lanes between them with white dashed lane-lines.
  //  Finish line: checkered segment on right side at x≈1720.
  //  Bleachers: gray tiered slab in top-right corner outside the track.
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080' preserveAspectRatio='xMidYMid slice'>
    <defs>
      <radialGradient id='grass' cx='50%25' cy='55%25' r='55%25'>
        <stop offset='0%25' stop-color='%2363C27F'/>
        <stop offset='80%25' stop-color='%234FB06B'/>
        <stop offset='100%25' stop-color='%233E9555'/>
      </radialGradient>
      <linearGradient id='track' x1='0%25' y1='0%25' x2='0%25' y2='100%25'>
        <stop offset='0%25' stop-color='%23C46460'/>
        <stop offset='100%25' stop-color='%23A44845'/>
      </linearGradient>
      <pattern id='grassTex' width='40' height='40' patternUnits='userSpaceOnUse'>
        <rect width='40' height='40' fill='url(%23grass)'/>
        <circle cx='8' cy='12' r='1.2' fill='%233E9555' opacity='0.6'/>
        <circle cx='26' cy='30' r='1' fill='%232E7A47' opacity='0.5'/>
        <circle cx='34' cy='8' r='0.9' fill='%232E7A47' opacity='0.4'/>
      </pattern>
    </defs>
    <!-- Solid grass backdrop -->
    <rect width='1920' height='1080' fill='url(%23grassTex)'/>
    <!-- Bleachers top-right, tiered gray slabs -->
    <g>
      <rect x='1180' y='30'  width='680' height='36' fill='%236B7280' stroke='%231F2937' stroke-width='3'/>
      <rect x='1160' y='66'  width='720' height='36' fill='%239CA3AF' stroke='%231F2937' stroke-width='3'/>
      <rect x='1140' y='102' width='760' height='36' fill='%23C0C7D1' stroke='%231F2937' stroke-width='3'/>
      <!-- Bleacher vertical supports -->
      <line x1='1240' y1='30'  x2='1240' y2='138' stroke='%231F2937' stroke-width='2' opacity='0.5'/>
      <line x1='1400' y1='30'  x2='1400' y2='138' stroke='%231F2937' stroke-width='2' opacity='0.5'/>
      <line x1='1560' y1='30'  x2='1560' y2='138' stroke='%231F2937' stroke-width='2' opacity='0.5'/>
      <line x1='1720' y1='30'  x2='1720' y2='138' stroke='%231F2937' stroke-width='2' opacity='0.5'/>
      <line x1='1840' y1='30'  x2='1840' y2='138' stroke='%231F2937' stroke-width='2' opacity='0.5'/>
    </g>
    <!-- Track oval — rust red, centered around (960, 560). -->
    <ellipse cx='960' cy='560' rx='880' ry='450' fill='url(%23track)' stroke='%231F2937' stroke-width='5'/>
    <!-- 5 lane-lines inside the track ring (dashed white) -->
    <ellipse cx='960' cy='560' rx='842' ry='416' fill='none' stroke='%23ffffff' stroke-width='3' stroke-dasharray='14 10' opacity='0.85'/>
    <ellipse cx='960' cy='560' rx='800' ry='380' fill='none' stroke='%23ffffff' stroke-width='3' stroke-dasharray='14 10' opacity='0.85'/>
    <ellipse cx='960' cy='560' rx='758' ry='344' fill='none' stroke='%23ffffff' stroke-width='3' stroke-dasharray='14 10' opacity='0.85'/>
    <ellipse cx='960' cy='560' rx='716' ry='310' fill='none' stroke='%23ffffff' stroke-width='3' stroke-dasharray='14 10' opacity='0.85'/>
    <ellipse cx='960' cy='560' rx='676' ry='276' fill='none' stroke='%23ffffff' stroke-width='3' stroke-dasharray='14 10' opacity='0.85'/>
    <!-- Infield grass — inside the innermost lane -->
    <ellipse cx='960' cy='560' rx='640' ry='244' fill='url(%23grassTex)' stroke='%23ffffff' stroke-width='4'/>
    <!-- Finish line — checkered strip on the right side of track -->
    <g>
      <rect x='1600' y='510' width='14' height='100' fill='%23FFFFFF' stroke='%231F2937' stroke-width='2'/>
      <g fill='%231F2937'>
        <rect x='1600' y='510' width='7' height='10'/>
        <rect x='1607' y='520' width='7' height='10'/>
        <rect x='1600' y='530' width='7' height='10'/>
        <rect x='1607' y='540' width='7' height='10'/>
        <rect x='1600' y='550' width='7' height='10'/>
        <rect x='1607' y='560' width='7' height='10'/>
        <rect x='1600' y='570' width='7' height='10'/>
        <rect x='1607' y='580' width='7' height='10'/>
        <rect x='1600' y='590' width='7' height='10'/>
        <rect x='1607' y='600' width='7' height='10'/>
      </g>
    </g>
    <!-- Starting blocks — left side of track -->
    <g>
      <rect x='290' y='545' width='30' height='12' fill='%23FFC857' stroke='%231F2937' stroke-width='2'/>
      <rect x='290' y='565' width='30' height='12' fill='%23FFC857' stroke='%231F2937' stroke-width='2'/>
    </g>
    <!-- Grass outer corners — faint field markings -->
    <g opacity='0.35' stroke='%23ffffff' stroke-width='2' fill='none'>
      <circle cx='340' cy='900' r='20'/>
      <circle cx='1580' cy='900' r='20'/>
      <circle cx='340' cy='220' r='20'/>
    </g>
  </svg>`;
  const encoded = svg.replace(/\n/g, '').replace(/\s{2,}/g, ' ').replace(/"/g, "'");
  return `url("data:image/svg+xml;utf8,${encoded}") center/cover`;
})();

registerTheme({
  id: 'track-day',
  name: '🏃 Track Day',
  description: 'Top-down running-track stadium: oval rust track, 6 lanes, infield grass, bleachers + finish line. Widgets are stadium props (whistle, stopwatch, clipboard, polaroid).',
  background: TRACK_DAY_BG,
  bgColor: '#4FB06B',
  widgets: {
    LOGO:            TrackDayLogo,
    TEXT:            TrackDayText,
    RICH_TEXT:       TrackDayText,
    CLOCK:           TrackDayClock,
    WEATHER:         TrackDayWeather,
    COUNTDOWN:       TrackDayCountdown,
    ANNOUNCEMENT:    TrackDayAnnouncement,
    CALENDAR:        TrackDayCalendar,
    STAFF_SPOTLIGHT: TrackDayStaffSpotlight,
    IMAGE_CAROUSEL:  TrackDayImageCarousel,
    TICKER:          TrackDayTicker,
  },
});
