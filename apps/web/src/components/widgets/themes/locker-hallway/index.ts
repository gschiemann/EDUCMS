/**
 * Locker Hallway theme — middle school lobby metal locker aesthetic.
 *
 * Background: a full-width row of charcoal-blue brushed-steel lockers with
 * vent slots, combination-dial circles, and bar handles. Widgets render as
 * locker-world scene elements — magnetic letter tiles, polaroid frames held
 * by magnets, notebook-paper sheets taped to doors, pennant flags, and a
 * combination-lock clock face.
 */
import { registerTheme } from '../registry';
import {
  LockerHallwayLogo,
  LockerHallwayText,
  LockerHallwayClock,
  LockerHallwayWeather,
  LockerHallwayCountdown,
  LockerHallwayAnnouncement,
  LockerHallwayCalendar,
  LockerHallwayStaffSpotlight,
  LockerHallwayImageCarousel,
  LockerHallwayTicker,
} from '../locker-hallway';

// ─── Background SVG ──────────────────────────────────────────────────────────
// A horizontal row of brushed-steel charcoal-blue lockers filling the full
// screen: vertical dividers, vent slots at the top of each door, a bar
// handle in the middle, and a combination-lock dial near the base. A narrow
// linoleum floor strip runs across the bottom.
const LOCKER_HALLWAY_BG = (() => {
  // Locker parameters
  const W    = 1920;
  const H    = 1080;
  const LW   = 120;          // locker width
  const LH_  = 900;          // locker door height
  const TOP  = 40;           // top of locker row from top of canvas
  const COUNT = Math.ceil(W / LW) + 1;

  // Build locker elements as a string for each door
  const buildLocker = (idx: number) => {
    const x = idx * LW;
    // Alternate slight shade variation for depth
    const shade = idx % 2 === 0 ? '%234A5568' : '%232D3748';
    const highlight = idx % 3 === 0 ? '0.18' : '0.10';
    const cx = x + LW / 2;
    const dialY = TOP + LH_ - 80;
    const handleY = TOP + LH_ / 2;
    return `
      <rect x='${x}' y='${TOP}' width='${LW}' height='${LH_}' fill='${shade}' stroke='%232D3748' stroke-width='3'/>
      <rect x='${x+3}' y='${TOP+4}' width='10' height='${LH_-8}' rx='3' fill='%23D7DCE1' opacity='${highlight}'/>
      <rect x='${x+10}' y='${TOP+16}' width='${LW-20}' height='5' rx='2' fill='%231A202C' opacity='0.55'/>
      <rect x='${x+10}' y='${TOP+26}' width='${LW-20}' height='5' rx='2' fill='%231A202C' opacity='0.4'/>
      <rect x='${x+10}' y='${TOP+36}' width='${LW-20}' height='5' rx='2' fill='%231A202C' opacity='0.28'/>
      <rect x='${cx-22}' y='${handleY-6}' width='44' height='12' rx='6' fill='%23B8BEC7' stroke='%236B727C' stroke-width='2'/>
      <circle cx='${cx}' cy='${dialY}' r='18' fill='%23B8BEC7' stroke='%231A202C' stroke-width='3'/>
      <circle cx='${cx}' cy='${dialY}' r='8'  fill='%236B727C'/>
      <line x1='${cx}' y1='${dialY-18}' x2='${cx}' y2='${dialY-10}' stroke='%231A202C' stroke-width='2'/>
    `;
  };

  const lockers = Array.from({ length: COUNT }, (_, i) => buildLocker(i)).join('');

  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${W} ${H}' preserveAspectRatio='xMidYMid slice'>
    <defs>
      <linearGradient id='lhWallGrad' x1='0' y1='0' x2='0' y2='1'>
        <stop offset='0%25' stop-color='%234A5568'/>
        <stop offset='55%25' stop-color='%232D3748'/>
        <stop offset='100%25' stop-color='%231A202C'/>
      </linearGradient>
      <linearGradient id='lhFloorGrad' x1='0' y1='0' x2='0' y2='1'>
        <stop offset='0%25' stop-color='%23B8BEC7'/>
        <stop offset='100%25' stop-color='%236B727C'/>
      </linearGradient>
    </defs>
    <!-- Wall background -->
    <rect width='${W}' height='${H}' fill='url(%23lhWallGrad)'/>
    <!-- Ceiling strip -->
    <rect x='0' y='0' width='${W}' height='${TOP}' fill='%231A202C'/>
    <rect x='0' y='${TOP-4}' width='${W}' height='8' fill='%23D7DCE1' opacity='0.3'/>
    <!-- Locker row -->
    ${lockers}
    <!-- Top locker frame bar -->
    <rect x='0' y='${TOP}' width='${W}' height='12' fill='%231A202C' opacity='0.6'/>
    <!-- Bottom locker frame bar + floor transition -->
    <rect x='0' y='${TOP+LH_}' width='${W}' height='14' fill='%231A202C' opacity='0.7'/>
    <!-- Linoleum floor -->
    <rect x='0' y='${TOP+LH_+14}' width='${W}' height='${H-(TOP+LH_+14)}' fill='url(%23lhFloorGrad)'/>
    <!-- Floor tile seams -->
    ${Array.from({ length: Math.ceil(W / 200) }, (_, i) =>
      `<line x1='${i*200}' y1='${TOP+LH_+14}' x2='${i*200}' y2='${H}' stroke='%236B727C' stroke-width='2' opacity='0.35'/>`
    ).join('')}
    <line x1='0' y1='${TOP+LH_+60}' x2='${W}' y2='${TOP+LH_+60}' stroke='%236B727C' stroke-width='2' opacity='0.3'/>
    <!-- Ambient ceiling light glow -->
    <ellipse cx='${W/2}' cy='0' rx='${W*0.5}' ry='120' fill='%23D7DCE1' opacity='0.06'/>
  </svg>`;

  const encoded = svg.replace(/\n/g, '').replace(/\s{2,}/g, ' ').replace(/"/g, "'");
  return `url("data:image/svg+xml;utf8,${encoded}") center/cover, linear-gradient(180deg, #2D3748 0%, #1A202C 100%)`;
})();

registerTheme({
  id: 'locker-hallway',
  name: '🔒 Locker Hallway',
  description: 'Middle school lobby: brushed-steel lockers, magnetic letter tiles, combination-lock clock, notebook-paper announcements, and polaroid staff spotlights.',
  background: LOCKER_HALLWAY_BG,
  bgColor: '#6B727C',
  widgets: {
    LOGO:            LockerHallwayLogo,
    TEXT:            LockerHallwayText,
    RICH_TEXT:       LockerHallwayText,
    CLOCK:           LockerHallwayClock,
    WEATHER:         LockerHallwayWeather,
    COUNTDOWN:       LockerHallwayCountdown,
    ANNOUNCEMENT:    LockerHallwayAnnouncement,
    CALENDAR:        LockerHallwayCalendar,
    STAFF_SPOTLIGHT: LockerHallwayStaffSpotlight,
    IMAGE_CAROUSEL:  LockerHallwayImageCarousel,
    TICKER:          LockerHallwayTicker,
  },
});
