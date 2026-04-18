/**
 * Back to School theme — illustrated classroom scene.
 * Widgets render AS scene elements (chalk on chalkboard, analog wall clock,
 * sticky note on bulletin board, polaroid pinned with washi tape, etc.).
 */
import { registerTheme } from '../registry';
import {
  BackToSchoolText, BackToSchoolClock, BackToSchoolAnnouncement,
  BackToSchoolCalendar, BackToSchoolStaff, BackToSchoolCountdown,
  BackToSchoolLogo, BackToSchoolTicker, BackToSchoolWeather,
  BackToSchoolImageCarousel,
} from '../back-to-school';

// Inline-encoded illustrated classroom SVG (kept in sync with system-presets.ts)
const BACK_TO_SCHOOL_BG = (() => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080' preserveAspectRatio='xMidYMid slice'><rect width='1920' height='870' fill='%23FFF4D2'/><rect y='870' width='1920' height='210' fill='%23D89A6B'/></svg>`;
  const encoded = svg.replace(/\n/g, '').replace(/\s{2,}/g, ' ').replace(/"/g, "'");
  return `url("data:image/svg+xml;utf8,${encoded}") center/cover, #FFF4D2`;
})();

registerTheme({
  id: 'back-to-school',
  name: '🍎 Back to School',
  description: 'Hand-drawn classroom: chalkboard, wall clock, bulletin board, alphabet poster, bookshelf, desk. Widgets BECOME scene elements.',
  background: BACK_TO_SCHOOL_BG,
  bgColor: '#FFF4D2',
  widgets: {
    CLOCK:           BackToSchoolClock,
    TEXT:            BackToSchoolText,
    RICH_TEXT:       BackToSchoolText,
    ANNOUNCEMENT:    BackToSchoolAnnouncement,
    CALENDAR:        BackToSchoolCalendar,
    STAFF_SPOTLIGHT: BackToSchoolStaff,
    COUNTDOWN:       BackToSchoolCountdown,
    LOGO:            BackToSchoolLogo,
    TICKER:          BackToSchoolTicker,
    WEATHER:         BackToSchoolWeather,
    IMAGE_CAROUSEL:  BackToSchoolImageCarousel,
  },
});
