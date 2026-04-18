const fs = require('fs');

let c = fs.readFileSync('apps/web/src/components/widgets/WidgetRenderer.tsx', 'utf8');
const linesToRemoveCompact = [
  // 10 themes TS errors
  91, 228, 229, 230, 231, 232, 337, 338, 339, 341, 342, 343, 446, 447, 448, 449, 450, 451, 531, 580, 581, 622, 623, 624, 625, 668, 669, 670, 671, 672,
  // 3 themes TS errors (guessing lines) - actually I'll just remove compact={compact} from all GymPE/PrincipalsOffice/OfficeDashboard components since they don't use it!
];

// Instead of line numbers, I'll just safely replace it
const componentsToRemoveCompactFrom = [
  'BackToSchoolText', 'BusLoopText', 'DinerChalkboardText', 'FinalChanceText', 'AthleticsText', 'MSHallText', 'SunshineAcademyText',
  'BackToSchoolTicker', 'BusLoopTicker', 'DinerChalkboardTicker', 'FinalChanceTicker', 'AthleticsTicker', 'LibraryQuietTicker', 'MSHallTicker', 'MusicArtsTicker', 'StemScienceTicker', 'SunshineAcademyTicker',
  'BackToSchoolLogo', 'DinerChalkboardLogo', 'FinalChanceLogo', 'AthleticsLogo', 'MSHallLogo', 'LibraryQuietImage',
  'BackToSchoolImageCarousel', 'DinerChalkboardImageCarousel', 'FinalChanceImageCarousel', 'MSHallImageCarousel', 'StemScienceImageCarousel', 'SunshineAcademyImageCarousel',
  // GymPE
  'GymPEText', 'GymPETicker', 'GymPEAnnouncement', 'GymPECalendar', 'GymPEWeather',
  // PrincipalsOffice
  'PrincipalsOfficeLogo', 'PrincipalsOfficeText', 'PrincipalsOfficeClock', 'PrincipalsOfficeAnnouncement', 'PrincipalsOfficeTicker',
  // OfficeDashboard
  'OfficeDashboardLogo', 'OfficeDashboardText', 'OfficeDashboardClock', 'OfficeDashboardAnnouncement', 'OfficeDashboardStaff', 'OfficeDashboardCalendar', 'OfficeDashboardTicker'
];

componentsToRemoveCompactFrom.forEach(comp => {
  const regex = new RegExp(\`<(\${comp})\\s(.*?)compact=\\{compact\\}(.*?)\\/>\`, 'g');
  c = c.replace(regex, '<$1 $2$3/>');
});

fs.writeFileSync('apps/web/src/components/widgets/WidgetRenderer.tsx', c);
console.log('Fixed types');
