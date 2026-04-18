/**
 * Achievement Hall theme — high-school Hall of Fame trophy-case lobby.
 * Dark walnut wood-grain walls, velvet backing mid-strip, brass engraved
 * plaques, gold oval portrait frames, ornate picture frames, and a
 * spotlight glow across every widget. Every widget evokes a physical
 * trophy case or museum display case exhibit.
 */
import { registerTheme } from '../registry';
import {
  AchievementHallLogo,
  AchievementHallText,
  AchievementHallClock,
  AchievementHallWeather,
  AchievementHallCountdown,
  AchievementHallAnnouncement,
  AchievementHallCalendar,
  AchievementHallStaffSpotlight,
  AchievementHallImageCarousel,
  AchievementHallTicker,
} from '../achievement-hall';

// Dark walnut wood-grain + velvet mid-strip + spotlight from top.
// Encoded as a data-URI SVG fallback so no network request is needed.
const AH_BG = (() => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080' preserveAspectRatio='xMidYMid slice'>
    <defs>
      <linearGradient id='woodGrain' x1='0%25' y1='0%25' x2='0%25' y2='100%25'>
        <stop offset='0%25'   stop-color='%2326180C'/>
        <stop offset='18%25'  stop-color='%233D2817'/>
        <stop offset='36%25'  stop-color='%2358392A'/>
        <stop offset='52%25'  stop-color='%233D2817'/>
        <stop offset='68%25'  stop-color='%2326180C'/>
        <stop offset='84%25'  stop-color='%233D2817'/>
        <stop offset='100%25' stop-color='%2326180C'/>
      </linearGradient>
      <radialGradient id='spotlight' cx='50%25' cy='0%25' r='70%25'>
        <stop offset='0%25'   stop-color='rgba(255,240,180,0.18)'/>
        <stop offset='100%25' stop-color='rgba(255,240,180,0)'/>
      </radialGradient>
    </defs>
    <rect width='1920' height='1080' fill='url(%23woodGrain)'/>
    <g opacity='0.07' stroke='%23B08D57' stroke-width='1' fill='none'>
      <line x1='0' y1='54'  x2='1920' y2='54'/>
      <line x1='0' y1='108' x2='1920' y2='108'/>
      <line x1='0' y1='162' x2='1920' y2='162'/>
      <line x1='0' y1='216' x2='1920' y2='216'/>
      <line x1='0' y1='270' x2='1920' y2='270'/>
      <line x1='0' y1='324' x2='1920' y2='324'/>
      <line x1='0' y1='378' x2='1920' y2='378'/>
      <line x1='0' y1='432' x2='1920' y2='432'/>
      <line x1='0' y1='486' x2='1920' y2='486'/>
      <line x1='0' y1='540' x2='1920' y2='540'/>
      <line x1='0' y1='594' x2='1920' y2='594'/>
      <line x1='0' y1='648' x2='1920' y2='648'/>
      <line x1='0' y1='702' x2='1920' y2='702'/>
      <line x1='0' y1='756' x2='1920' y2='756'/>
      <line x1='0' y1='810' x2='1920' y2='810'/>
      <line x1='0' y1='864' x2='1920' y2='864'/>
      <line x1='0' y1='918' x2='1920' y2='918'/>
      <line x1='0' y1='972' x2='1920' y2='972'/>
      <line x1='0' y1='1026' x2='1920' y2='1026'/>
    </g>
    <rect y='360' width='1920' height='360' fill='%232C1A1A' opacity='0.55'/>
    <line x1='0' y1='360'  x2='1920' y2='360'  stroke='%23B08D57' stroke-width='3' opacity='0.5'/>
    <line x1='0' y1='720'  x2='1920' y2='720'  stroke='%23B08D57' stroke-width='3' opacity='0.5'/>
    <rect width='1920' height='1080' fill='url(%23spotlight)'/>
  </svg>`;
  const encoded = svg.replace(/\n/g, '').replace(/\s{2,}/g, ' ').replace(/"/g, "'");
  return `url("data:image/svg+xml;utf8,${encoded}") center/cover, linear-gradient(180deg, #26180C 0%, #3D2817 50%, #26180C 100%)`;
})();

registerTheme({
  id: 'achievement-hall',
  name: '🏆 Achievement Hall',
  description: 'Hall of Fame trophy-case lobby: dark walnut wood grain, gold oval portrait frames, brass engraved plaques, velvet backing, and spotlight glows on every award.',
  background: AH_BG,
  bgColor: '#3D2817',
  widgets: {
    LOGO:            AchievementHallLogo,
    TEXT:            AchievementHallText,
    RICH_TEXT:       AchievementHallText,
    CLOCK:           AchievementHallClock,
    WEATHER:         AchievementHallWeather,
    COUNTDOWN:       AchievementHallCountdown,
    ANNOUNCEMENT:    AchievementHallAnnouncement,
    CALENDAR:        AchievementHallCalendar,
    STAFF_SPOTLIGHT: AchievementHallStaffSpotlight,
    IMAGE_CAROUSEL:  AchievementHallImageCarousel,
    TICKER:          AchievementHallTicker,
  },
});
