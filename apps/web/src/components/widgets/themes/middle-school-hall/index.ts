/**
 * Middle School Hallway theme — illustrated locker and corkboard scene.
 */
import { registerTheme } from '../registry';
import {
  MSHallClock, MSHallBellSchedule, MSHallTicker, MSHallAnnouncement,
  MSHallImageCarousel, MSHallWeather, MSHallText, MSHallCountdown,
  MSHallStaff, MSHallLogo
} from '../middle-school-hall';

const MS_HALL_BG = (() => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080' preserveAspectRatio='xMidYMid slice'>
    <!-- Base wall color (cream/beige) -->
    <rect width='1920' height='1080' fill='%23F4F1EA'/>
    
    <!-- Brick texture pattern (faint) -->
    <defs>
      <pattern id='bricks' width='80' height='40' patternUnits='userSpaceOnUse'>
        <rect width='80' height='40' fill='none' />
        <path d='M0,19 L80,19 M40,19 L40,40 M0,0 L0,19 M80,0 L80,19 M0,39 L80,39 M0,40 L0,40' stroke='%23E0D8C8' stroke-width='1.5' />
      </pattern>
      <linearGradient id='floorGradient' x1='0' y1='0' x2='0' y2='1'>
        <stop offset='0%25' stop-color='%23BDC3C7'/>
        <stop offset='100%25' stop-color='%2395A5A6'/>
      </linearGradient>
      <linearGradient id='corkGradient' x1='0' y1='0' x2='1' y2='1'>
        <stop offset='0%25' stop-color='%23D4A76A'/>
        <stop offset='100%25' stop-color='%23B88645'/>
      </linearGradient>
      <linearGradient id='lockerBlue' x1='0' y1='0' x2='1' y2='0'>
        <stop offset='0%25' stop-color='%232874A6'/>
        <stop offset='10%25' stop-color='%233498DB'/>
        <stop offset='90%25' stop-color='%232E86C1'/>
        <stop offset='100%25' stop-color='%2321618C'/>
      </linearGradient>
    </defs>
    
    <rect width='1920' height='1080' fill='url(%23bricks)' opacity='0.7'/>

    <!-- Corkboard (Right Side) -->
    <rect x='1000' y='200' width='800' height='600' rx='8' fill='url(%23corkGradient)' stroke='%238B5A2B' stroke-width='16'/>
    <!-- Corkboard inner shadow -->
    <rect x='1008' y='208' width='784' height='584' rx='4' fill='none' stroke='%235C3A21' stroke-width='4' opacity='0.3'/>
    
    <!-- Floor -->
    <rect x='0' y='950' width='1920' height='130' fill='url(%23floorGradient)'/>
    <!-- Baseboard -->
    <rect x='0' y='930' width='1920' height='20' fill='%237F8C8D'/>
    <!-- Floor tile lines -->
    <path d='M0,970 L1920,970 M0,1010 L1920,1010 M0,1050 L1920,1050 M300,950 L200,1080 M600,950 L500,1080 M900,950 L800,1080 M1200,950 L1100,1080 M1500,950 L1400,1080 M1800,950 L1700,1080' stroke='%237F8C8D' stroke-width='2' opacity='0.5'/>
    
    <!-- Lockers (Left Side and Bottom edge) -->
    <!-- We'll draw a block of lockers on the left, and maybe a low bank of lockers along the bottom center -->
    <g transform='translate(50, 450)'>
      <!-- Locker block 1 -->
      <rect x='0' y='0' width='800' height='480' fill='%231F618D'/>
      <!-- Individual lockers (width=100) -->
      <g stroke='%23154360' stroke-width='3'>
        <rect x='0' y='0' width='100' height='480' fill='url(%23lockerBlue)'/>
        <rect x='100' y='0' width='100' height='480' fill='url(%23lockerBlue)'/>
        <rect x='200' y='0' width='100' height='480' fill='url(%23lockerBlue)'/>
        <rect x='300' y='0' width='100' height='480' fill='url(%23lockerBlue)'/>
        <rect x='400' y='0' width='100' height='480' fill='url(%23lockerBlue)'/>
        <rect x='500' y='0' width='100' height='480' fill='url(%23lockerBlue)'/>
        <rect x='600' y='0' width='100' height='480' fill='url(%23lockerBlue)'/>
        <rect x='700' y='0' width='100' height='480' fill='url(%23lockerBlue)'/>
      </g>
      
      <!-- Locker details (vents and handles) -->
      <g fill='%231B4F72'>
        <!-- Locker 1 -->
        <rect x='20' y='20' width='60' height='6'/><rect x='20' y='32' width='60' height='6'/><rect x='20' y='44' width='60' height='6'/>
        <rect x='80' y='200' width='10' height='40' rx='2' fill='%23BDC3C7'/> <!-- Handle -->
        <!-- Locker 2 -->
        <rect x='120' y='20' width='60' height='6'/><rect x='120' y='32' width='60' height='6'/><rect x='120' y='44' width='60' height='6'/>
        <rect x='180' y='200' width='10' height='40' rx='2' fill='%23BDC3C7'/>
        <!-- Locker 3 -->
        <rect x='220' y='20' width='60' height='6'/><rect x='220' y='32' width='60' height='6'/><rect x='220' y='44' width='60' height='6'/>
        <rect x='280' y='200' width='10' height='40' rx='2' fill='%23BDC3C7'/>
        <!-- Locker 4 -->
        <rect x='320' y='20' width='60' height='6'/><rect x='320' y='32' width='60' height='6'/><rect x='320' y='44' width='60' height='6'/>
        <rect x='380' y='200' width='10' height='40' rx='2' fill='%23BDC3C7'/>
        <!-- Locker 5 -->
        <rect x='420' y='20' width='60' height='6'/><rect x='420' y='32' width='60' height='6'/><rect x='420' y='44' width='60' height='6'/>
        <rect x='480' y='200' width='10' height='40' rx='2' fill='%23BDC3C7'/>
        <!-- Locker 6 -->
        <rect x='520' y='20' width='60' height='6'/><rect x='520' y='32' width='60' height='6'/><rect x='520' y='44' width='60' height='6'/>
        <rect x='580' y='200' width='10' height='40' rx='2' fill='%23BDC3C7'/>
        <!-- Locker 7 -->
        <rect x='620' y='20' width='60' height='6'/><rect x='620' y='32' width='60' height='6'/><rect x='620' y='44' width='60' height='6'/>
        <rect x='680' y='200' width='10' height='40' rx='2' fill='%23BDC3C7'/>
        <!-- Locker 8 -->
        <rect x='720' y='20' width='60' height='6'/><rect x='720' y='32' width='60' height='6'/><rect x='720' y='44' width='60' height='6'/>
        <rect x='780' y='200' width='10' height='40' rx='2' fill='%23BDC3C7'/>
      </g>
    </g>

    <!-- Ceiling / Lighting shadow -->
    <rect x='0' y='0' width='1920' height='80' fill='url(%23floorGradient)' opacity='0.3'/>
    <path d='M0,80 L1920,80' stroke='%23BDC3C7' stroke-width='4'/>
    <!-- Hanging rods for the digital clock -->
    <rect x='300' y='80' width='8' height='100' fill='%237F8C8D'/>
    <rect x='600' y='80' width='8' height='100' fill='%237F8C8D'/>
  </svg>`;
  const encoded = svg.replace(/\n/g, '').replace(/\s{2,}/g, ' ').replace(/"/g, "'");
  return `url("data:image/svg+xml;utf8,${encoded}") center/cover, #F4F1EA`;
})();

registerTheme({
  id: 'middle-school-hall',
  name: '🏫 Hallway Lockers',
  description: 'Middle school hallway scene with metal lockers and a large corkboard. Widgets render as pinned papers, hanging digital clocks, taped flyers, and LED scrolling signs.',
  background: MS_HALL_BG,
  bgColor: '#F4F1EA',
  widgets: {
    CLOCK:           MSHallClock,
    BELL_SCHEDULE:   MSHallBellSchedule,
    TICKER:          MSHallTicker,
    ANNOUNCEMENT:    MSHallAnnouncement,
    IMAGE_CAROUSEL:  MSHallImageCarousel,
    WEATHER:         MSHallWeather,
    TEXT:            MSHallText,
    RICH_TEXT:       MSHallText,
    COUNTDOWN:       MSHallCountdown,
    STAFF_SPOTLIGHT: MSHallStaff,
    LOGO:            MSHallLogo,
  },
});
