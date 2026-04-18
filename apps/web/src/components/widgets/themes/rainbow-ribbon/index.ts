/**
 * Rainbow Ribbon theme — candy-pop party scene.
 * Every widget renders as a real shape: ribbon banners, speech bubbles,
 * cloud cutouts, starbursts, pennant flags. No rectangles pretending to be
 * shapes. Sky-to-peach gradient background with confetti dots.
 */
import { registerTheme } from '../registry';
import {
  RainbowRibbonLogo,
  RainbowRibbonText,
  RainbowRibbonClock,
  RainbowRibbonWeather,
  RainbowRibbonCountdown,
  RainbowRibbonAnnouncement,
  RainbowRibbonCalendar,
  RainbowRibbonStaffSpotlight,
  RainbowRibbonImageCarousel,
  RainbowRibbonTicker,
} from '../rainbow-ribbon';

const RAINBOW_RIBBON_BG = (() => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080' preserveAspectRatio='xMidYMid slice'>
    <defs>
      <radialGradient id='rrbg' cx='50%25' cy='40%25' r='75%25'>
        <stop offset='0%25' stop-color='%23FFE9F3'/>
        <stop offset='30%25' stop-color='%23FFD6E9'/>
        <stop offset='70%25' stop-color='%23C9E7FF'/>
        <stop offset='100%25' stop-color='%23A8D8FF'/>
      </radialGradient>
    </defs>
    <rect width='1920' height='1080' fill='url(%23rrbg)'/>
    <g opacity='0.7'>
      <rect x='150' y='150' width='14' height='28' fill='%23FF5D8F' transform='rotate(25 157 164)'/>
      <rect x='400' y='110' width='14' height='28' fill='%2367B8FF' transform='rotate(-35 407 124)'/>
      <rect x='750' y='90' width='14' height='28' fill='%23FFC857' transform='rotate(15 757 104)'/>
      <rect x='1250' y='130' width='14' height='28' fill='%23A7E8BD' transform='rotate(-20 1257 144)'/>
      <rect x='1600' y='160' width='14' height='28' fill='%23C58CFF' transform='rotate(40 1607 174)'/>
      <rect x='50' y='700' width='14' height='28' fill='%23FF5D8F' transform='rotate(15 57 714)'/>
      <rect x='1850' y='750' width='14' height='28' fill='%2367B8FF' transform='rotate(-25 1857 764)'/>
      <rect x='1100' y='1000' width='14' height='28' fill='%23FFC857' transform='rotate(40 1107 1014)'/>
      <circle cx='250' cy='260' r='8' fill='%23FFC857'/>
      <circle cx='1650' cy='280' r='8' fill='%23FF5D8F'/>
      <circle cx='100' cy='450' r='8' fill='%2367B8FF'/>
      <circle cx='1800' cy='550' r='8' fill='%23A7E8BD'/>
      <circle cx='600' cy='820' r='8' fill='%23C58CFF'/>
      <circle cx='1400' cy='880' r='8' fill='%23FF9F68'/>
    </g>
  </svg>`;
  const encoded = svg.replace(/\n/g, '').replace(/\s{2,}/g, ' ').replace(/"/g, "'");
  return `url("data:image/svg+xml;utf8,${encoded}") center/cover, linear-gradient(180deg, #BFE8FF 0%, #FFD6E9 60%, #FFCBA4 100%)`;
})();

registerTheme({
  id: 'rainbow-ribbon',
  name: '🎀 Rainbow Ribbon',
  description: 'Candy-pop party scene: folded ribbon banners, speech bubbles, cloud cutouts, starbursts, and pennant flags. Every widget is a real shape.',
  background: RAINBOW_RIBBON_BG,
  bgColor: '#BFE8FF',
  widgets: {
    LOGO:            RainbowRibbonLogo,
    TEXT:            RainbowRibbonText,
    RICH_TEXT:       RainbowRibbonText,
    CLOCK:           RainbowRibbonClock,
    WEATHER:         RainbowRibbonWeather,
    COUNTDOWN:       RainbowRibbonCountdown,
    ANNOUNCEMENT:    RainbowRibbonAnnouncement,
    CALENDAR:        RainbowRibbonCalendar,
    STAFF_SPOTLIGHT: RainbowRibbonStaffSpotlight,
    IMAGE_CAROUSEL:  RainbowRibbonImageCarousel,
    TICKER:          RainbowRibbonTicker,
  },
});
