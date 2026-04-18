/**
 * Boot-time registration of all bundled widget variants.
 *
 * Import once from a top-level layout/page so all variants are in the registry
 * before the picker renders. New variants drop into this file as one
 * `registerVariant({...})` call each.
 */
import { registerVariant } from './variants';
import {
  BackToSchoolClock, BackToSchoolText, BackToSchoolAnnouncement,
  BackToSchoolCalendar, BackToSchoolStaff, BackToSchoolCountdown,
  BackToSchoolLogo, BackToSchoolTicker, BackToSchoolWeather,
  BackToSchoolImageCarousel,
} from './themes/back-to-school';
import {
  ClockGradientDigital, ClockDarkPill, ClockMinimalAnalog, ClockStackedCard,
  TextBigBold, TextGradient, TextHighlight, TextOutlined,
  AnnouncementModernCard, AnnouncementSpotlight, AnnouncementGlass,
  TickerLed, TickerPastel, TickerAlert,
  StaffModernCard, StaffHero,
  CountdownBigNumber, CountdownBlocks,
  CalendarModernList,
  WeatherHero, WeatherGlass,
  LogoCircle, LogoWordmark,
  GalleryModern,
} from './themes/modern-2026';

// ─── CLOCK variants ──────────────────────────────────────
registerVariant({
  id: 'clock-analog-wood',
  widgetType: 'CLOCK',
  name: 'Wood Wall Clock',
  description: 'Classroom analog clock with rotating hands',
  category: 'CLASSROOM',
  render: BackToSchoolClock,
});

// ─── TEXT / HEADLINE variants ────────────────────────────
registerVariant({
  id: 'text-chalkboard',
  widgetType: 'TEXT',
  name: 'Chalkboard',
  description: 'White chalk handwriting on a green chalkboard',
  category: 'CLASSROOM',
  render: BackToSchoolText,
  defaultConfig: { alignment: 'center' },
});

// ─── ANNOUNCEMENT variants ───────────────────────────────
registerVariant({
  id: 'announcement-sticky-note',
  widgetType: 'ANNOUNCEMENT',
  name: 'Sticky Note',
  description: 'Yellow sticky note pinned with washi tape',
  category: 'CLASSROOM',
  render: BackToSchoolAnnouncement,
});

// ─── CALENDAR variants ───────────────────────────────────
registerVariant({
  id: 'calendar-notebook',
  widgetType: 'CALENDAR',
  name: 'Notebook Page',
  description: 'Lined notebook with red margin and hole punches',
  category: 'CLASSROOM',
  render: BackToSchoolCalendar,
});

// ─── STAFF SPOTLIGHT variants ────────────────────────────
registerVariant({
  id: 'staff-polaroid',
  widgetType: 'STAFF_SPOTLIGHT',
  name: 'Polaroid',
  description: 'Polaroid photo pinned with washi tape',
  category: 'CLASSROOM',
  render: BackToSchoolStaff,
});

// ─── COUNTDOWN variants ──────────────────────────────────
registerVariant({
  id: 'countdown-chalk',
  widgetType: 'COUNTDOWN',
  name: 'Chalk Countdown',
  description: 'Days remaining written in chalk',
  category: 'CLASSROOM',
  render: BackToSchoolCountdown,
});

// ─── LOGO variants ───────────────────────────────────────
registerVariant({
  id: 'logo-crest-sticker',
  widgetType: 'LOGO',
  name: 'Crest Sticker',
  description: 'Round school crest sticker with initials',
  category: 'CLASSROOM',
  render: BackToSchoolLogo,
});

// ─── TICKER variants ─────────────────────────────────────
registerVariant({
  id: 'ticker-pennant-banner',
  widgetType: 'TICKER',
  name: 'Pennant Banner',
  description: 'Triangular paper banner garland with handwriting',
  category: 'CLASSROOM',
  render: BackToSchoolTicker,
});

// ─── WEATHER variants ────────────────────────────────────
registerVariant({
  id: 'weather-wood-sign',
  widgetType: 'WEATHER',
  name: 'Wood Wall Sign',
  description: 'Small wood-framed sign hanging on the wall',
  category: 'CLASSROOM',
  render: BackToSchoolWeather,
});

// ─── IMAGE_CAROUSEL variants ─────────────────────────────
registerVariant({
  id: 'gallery-pinned-photo',
  widgetType: 'IMAGE_CAROUSEL',
  name: 'Pinned Photos',
  description: 'Photo grid pinned to the wall with washi tape',
  category: 'CLASSROOM',
  render: BackToSchoolImageCarousel,
});

// ════════════════════════════════════════════════════════════════════════
// MODERN 2026 — fresh, premium variants for every widget type
// ════════════════════════════════════════════════════════════════════════

// CLOCKS
registerVariant({ id: 'clock-gradient-digital', widgetType: 'CLOCK', name: 'Gradient Digital', description: 'Big bold time on white with indigo→pink gradient', category: 'MODERN', render: ClockGradientDigital });
registerVariant({ id: 'clock-dark-pill',        widgetType: 'CLOCK', name: 'Dark Pill',         description: 'Minimal dark pill with crisp digital readout', category: 'MODERN', render: ClockDarkPill });
registerVariant({ id: 'clock-minimal-analog',   widgetType: 'CLOCK', name: 'Minimal Analog',    description: 'Clean thin-line analog face on white',         category: 'MINIMAL', render: ClockMinimalAnalog });
registerVariant({ id: 'clock-stacked-card',     widgetType: 'CLOCK', name: 'Stacked Card',      description: 'Day, date, and time stacked on a violet card', category: 'MODERN', render: ClockStackedCard });

// HEADLINES / TEXT
registerVariant({ id: 'text-big-bold',  widgetType: 'TEXT', name: 'Big & Bold',  description: 'Massive Fredoka headline on white',   category: 'MODERN',   render: TextBigBold });
registerVariant({ id: 'text-gradient',  widgetType: 'TEXT', name: 'Gradient',    description: 'Vibrant rainbow gradient text',         category: 'MODERN',   render: TextGradient });
registerVariant({ id: 'text-highlight', widgetType: 'TEXT', name: 'Highlight',   description: 'Marker-style highlight under the words', category: 'PLAYFUL',  render: TextHighlight });
registerVariant({ id: 'text-outlined',  widgetType: 'TEXT', name: 'Outlined',    description: 'Bold outlined text with stacked drop shadow', category: 'PLAYFUL', render: TextOutlined });
registerVariant({ id: 'text-big-bold-rich',  widgetType: 'RICH_TEXT', name: 'Big & Bold',  description: 'Massive Fredoka headline on white',   category: 'MODERN',   render: TextBigBold });
registerVariant({ id: 'text-gradient-rich',  widgetType: 'RICH_TEXT', name: 'Gradient',    description: 'Vibrant rainbow gradient text',         category: 'MODERN',   render: TextGradient });

// ANNOUNCEMENTS
registerVariant({ id: 'announcement-modern-card', widgetType: 'ANNOUNCEMENT', name: 'Modern Card', description: 'Clean white card with vertical accent bar',           category: 'MODERN', render: AnnouncementModernCard });
registerVariant({ id: 'announcement-spotlight',   widgetType: 'ANNOUNCEMENT', name: 'Spotlight',    description: 'Bold full-color card with white text',               category: 'MODERN', render: AnnouncementSpotlight });
registerVariant({ id: 'announcement-glass',       widgetType: 'ANNOUNCEMENT', name: 'Glass',        description: 'Frosted glass card — subtle and premium',            category: 'MODERN', render: AnnouncementGlass });

// TICKERS
registerVariant({ id: 'ticker-led',     widgetType: 'TICKER', name: 'LED Marquee',   description: 'Dark with gold→coral gradient text — newsroom feel', category: 'MODERN', render: TickerLed });
registerVariant({ id: 'ticker-pastel',  widgetType: 'TICKER', name: 'Pastel',         description: 'Soft pastel scrolling banner',                       category: 'MODERN', render: TickerPastel });
registerVariant({ id: 'ticker-alert',   widgetType: 'TICKER', name: 'Alert',          description: 'Bold diagonal-stripe alert ticker for urgent updates', category: 'BOLD', render: TickerAlert });

// STAFF SPOTLIGHT
registerVariant({ id: 'staff-modern-card', widgetType: 'STAFF_SPOTLIGHT', name: 'Profile Card', description: 'Avatar circle + name + bio — clean and modern',  category: 'MODERN', render: StaffModernCard });
registerVariant({ id: 'staff-hero',        widgetType: 'STAFF_SPOTLIGHT', name: 'Hero Banner',  description: 'Large photo banner with name overlaid at bottom', category: 'MODERN', render: StaffHero });

// COUNTDOWN
registerVariant({ id: 'countdown-big-number', widgetType: 'COUNTDOWN', name: 'Big Number', description: 'Single massive day count on white', category: 'MODERN', render: CountdownBigNumber });
registerVariant({ id: 'countdown-blocks',     widgetType: 'COUNTDOWN', name: 'D / H / M Blocks', description: 'Days, hours, minutes in three indigo blocks', category: 'MODERN', render: CountdownBlocks });

// CALENDAR
registerVariant({ id: 'calendar-modern-list', widgetType: 'CALENDAR', name: 'Modern List', description: 'Clean event list with date pills', category: 'MODERN', render: CalendarModernList });

// WEATHER
registerVariant({ id: 'weather-hero',  widgetType: 'WEATHER', name: 'Hero Weather', description: 'Big icon + temperature on a blue gradient', category: 'MODERN', render: WeatherHero });
registerVariant({ id: 'weather-glass', widgetType: 'WEATHER', name: 'Glass',        description: 'Frosted glass with gradient temperature',   category: 'MODERN', render: WeatherGlass });

// LOGO
registerVariant({ id: 'logo-circle',   widgetType: 'LOGO', name: 'Initials Circle', description: 'Modern indigo→pink gradient circle with initials', category: 'MODERN', render: LogoCircle });
registerVariant({ id: 'logo-wordmark', widgetType: 'LOGO', name: 'Wordmark',         description: 'School name as a multi-line wordmark',              category: 'MINIMAL', render: LogoWordmark });

// IMAGE CAROUSEL
registerVariant({ id: 'gallery-modern', widgetType: 'IMAGE_CAROUSEL', name: 'Modern Gallery', description: 'Clean framed gallery placeholder', category: 'MODERN', render: GalleryModern });

// ════════════════════════════════════════════════════════════════════════
// EXISTING THEME WIDGETS — surface every themed component as a picker tile
// so users can swap visual styles without going through the theme dropdown.
// ════════════════════════════════════════════════════════════════════════
import {
  GymPEText, GymPEWeather, GymPEBellSchedule, GymPEAnnouncement, GymPETicker
} from './themes/gym-pe';
import {
  PrincipalsOfficeLogo, PrincipalsOfficeText, PrincipalsOfficeClock,
  PrincipalsOfficeAnnouncement, PrincipalsOfficeRichText, PrincipalsOfficeTicker
} from './themes/principals-office';
import {
  OfficeDashboardLogo, OfficeDashboardText, OfficeDashboardClock,
  OfficeDashboardAnnouncement, OfficeDashboardStaff, OfficeDashboardCalendar, OfficeDashboardTicker
} from './themes/office-dashboard';
import {
  BusLoopText, BusLoopClock, BusLoopTicker, BusLoopWeather, BusLoopAnnouncement, BusLoopCalendar
} from './themes/bus-loop';
import {
  DinerChalkboardText, DinerChalkboardClock, DinerChalkboardLunchMenu,
  DinerChalkboardAnnouncement, DinerChalkboardCountdown, DinerChalkboardTicker,
  DinerChalkboardCalendar, DinerChalkboardStaff, DinerChalkboardLogo,
  DinerChalkboardWeather, DinerChalkboardImageCarousel
} from './themes/diner-chalkboard';
import {
  FinalChanceClock, FinalChanceWeather, FinalChanceText, FinalChanceLogo,
  FinalChanceAnnouncement, FinalChanceCalendar, FinalChanceCountdown,
  FinalChanceStaff, FinalChanceImageCarousel, FinalChanceTicker
} from './themes/final-chance';
import {
  AthleticsLogo, AthleticsCountdown, AthleticsAnnouncement, AthleticsText, AthleticsTicker
} from './themes/high-school-athletics';
import {
  LibraryQuietText, LibraryQuietClock, LibraryQuietImage,
  LibraryQuietRichText, LibraryQuietLunch, LibraryQuietTicker
} from './themes/library-quiet';
import {
  MSHallClock, MSHallBellSchedule, MSHallTicker, MSHallAnnouncement,
  MSHallImageCarousel, MSHallWeather, MSHallText, MSHallCountdown, MSHallStaff, MSHallLogo
} from './themes/middle-school-hall';
import {
  MusicArtsText, MusicArtsCountdown, MusicArtsRichText, MusicArtsSpotlight, MusicArtsTicker
} from './themes/music-arts';
import {
  StemScienceText, StemScienceCountdown, StemScienceRichText, StemScienceImageCarousel, StemScienceTicker
} from './themes/stem-science';
import {
  SunshineAcademyClock, SunshineAcademyWeather, SunshineAcademyCountdown,
  SunshineAcademyText, SunshineAcademyAnnouncement, SunshineAcademyTicker,
  SunshineAcademyCalendar, SunshineAcademyStaffSpotlight, SunshineAcademyImageCarousel
} from './themes/sunshine-academy';
import {
  LobbyWelcomeLogo, LobbyWelcomeText, LobbyWelcomeClock, LobbyWelcomeWeather,
  LobbyWelcomeAnnouncement, LobbyWelcomeCalendar, LobbyWelcomeTicker
} from './themes/lobby-welcome';

// ─── CLOCK ─────────────────────────────────────────────────────────────
registerVariant({ id: 'clock-diner-chrome',     widgetType: 'CLOCK', name: 'Diner Chrome',      description: 'Retro 50s diner chrome wall clock', category: 'CAFETERIA',  render: DinerChalkboardClock });
registerVariant({ id: 'clock-hallway-led',      widgetType: 'CLOCK', name: 'Hallway LED',       description: 'Hanging digital LED clock in a metal frame', category: 'HALLWAY', render: MSHallClock });
registerVariant({ id: 'clock-bus-station',      widgetType: 'CLOCK', name: 'Bus Station',       description: 'Big station-style clock with seconds', category: 'SAFETY',  render: BusLoopClock });
registerVariant({ id: 'clock-sunshine',         widgetType: 'CLOCK', name: 'Sunshine',          description: 'Cheerful elementary clock with sun rays', category: 'ELEMENTARY', render: SunshineAcademyClock });
registerVariant({ id: 'clock-glass-card',       widgetType: 'CLOCK', name: 'Glass Card',        description: 'Premium dark glassmorphic clock', category: 'DARK',     render: FinalChanceClock });
registerVariant({ id: 'clock-library-quiet',    widgetType: 'CLOCK', name: 'Library Quiet',     description: 'Refined wood-trim clock for the library', category: 'LIBRARY', render: LibraryQuietClock });
registerVariant({ id: 'clock-principals-brass', widgetType: 'CLOCK', name: 'Brass Office',      description: 'Polished brass desk clock for the principal\'s office', category: 'OFFICE', render: PrincipalsOfficeClock });
registerVariant({ id: 'clock-dashboard',        widgetType: 'CLOCK', name: 'Dashboard',         description: 'Operations-dashboard time block', category: 'OFFICE',     render: OfficeDashboardClock });
registerVariant({ id: 'clock-lobby',            widgetType: 'CLOCK', name: 'Lobby',             description: 'Modern glassmorphic clock for the lobby', category: 'LOBBY', render: LobbyWelcomeClock });

// ─── HEADLINES ─────────────────────────────────────────────────────────
registerVariant({ id: 'text-diner-chalk',     widgetType: 'TEXT', name: 'Diner Chalk',      description: 'White chalk handwriting on a green chalkboard', category: 'CAFETERIA',  render: DinerChalkboardText });
registerVariant({ id: 'text-hallway-flyer',   widgetType: 'TEXT', name: 'Hallway Flyer',    description: 'Taped paper flyer on the locker wall',          category: 'HALLWAY',    render: MSHallText });
registerVariant({ id: 'text-bus-station',     widgetType: 'TEXT', name: 'Bus Station Sign', description: 'Bold yellow station sign type',                 category: 'SAFETY',     render: BusLoopText });
registerVariant({ id: 'text-sunshine',        widgetType: 'TEXT', name: 'Sunshine',         description: 'Warm yellow elementary headline',               category: 'ELEMENTARY', render: SunshineAcademyText });
registerVariant({ id: 'text-final-chance',    widgetType: 'TEXT', name: 'Glow Headline',    description: 'Big glow text on dark glass',                   category: 'DARK',       render: FinalChanceText });
registerVariant({ id: 'text-library',         widgetType: 'TEXT', name: 'Library',          description: 'Serif refined library headline',                category: 'LIBRARY',    render: LibraryQuietText });
registerVariant({ id: 'text-athletics',       widgetType: 'TEXT', name: 'Stadium',          description: 'Athletic team-poster headline',                 category: 'ATHLETICS',  render: AthleticsText });
registerVariant({ id: 'text-principals',      widgetType: 'TEXT', name: 'Principal\'s',     description: 'Elegant office letterhead style',               category: 'OFFICE',     render: PrincipalsOfficeText });
registerVariant({ id: 'text-dashboard',       widgetType: 'TEXT', name: 'Dashboard',        description: 'Tight dashboard headline block',                category: 'OFFICE',     render: OfficeDashboardText });
registerVariant({ id: 'text-gym-pe',          widgetType: 'TEXT', name: 'Gym Banner',       description: 'Pep-rally banner type',                         category: 'ATHLETICS',  render: GymPEText });
registerVariant({ id: 'text-music-arts',      widgetType: 'TEXT', name: 'Music & Arts',     description: 'Creative arts-classroom headline',              category: 'ARTS',       render: MusicArtsText });
registerVariant({ id: 'text-stem',            widgetType: 'TEXT', name: 'STEM',             description: 'Tech / STEM headline with grid backdrop',       category: 'STEM',       render: StemScienceText });
registerVariant({ id: 'text-lobby',           widgetType: 'TEXT', name: 'Lobby',            description: 'Sleek glassmorphic welcome text',               category: 'LOBBY',      render: LobbyWelcomeText });

// ─── ANNOUNCEMENTS ─────────────────────────────────────────────────────
registerVariant({ id: 'announcement-diner-special', widgetType: 'ANNOUNCEMENT', name: 'Diner Special',    description: 'Daily Special chalkboard tent card', category: 'CAFETERIA',  render: DinerChalkboardAnnouncement });
registerVariant({ id: 'announcement-hallway-flyer', widgetType: 'ANNOUNCEMENT', name: 'Hallway Flyer',    description: 'Taped paper announcement on lockers', category: 'HALLWAY',   render: MSHallAnnouncement });
registerVariant({ id: 'announcement-safety',        widgetType: 'ANNOUNCEMENT', name: 'Safety Alert',     description: 'High-contrast safety alert card',     category: 'SAFETY',    render: BusLoopAnnouncement });
registerVariant({ id: 'announcement-sunshine',      widgetType: 'ANNOUNCEMENT', name: 'Sunshine',         description: 'Warm yellow elementary announcement', category: 'ELEMENTARY', render: SunshineAcademyAnnouncement });
registerVariant({ id: 'announcement-final-chance',  widgetType: 'ANNOUNCEMENT', name: 'Glass Glow',       description: 'Premium dark glassmorphic announcement', category: 'DARK',   render: FinalChanceAnnouncement });
registerVariant({ id: 'announcement-athletics',     widgetType: 'ANNOUNCEMENT', name: 'Stadium',          description: 'Bold athletic announcement banner',   category: 'ATHLETICS', render: AthleticsAnnouncement });
registerVariant({ id: 'announcement-principals',    widgetType: 'ANNOUNCEMENT', name: 'Principal\'s',     description: 'Office letterhead-style memo card',   category: 'OFFICE',    render: PrincipalsOfficeAnnouncement });
registerVariant({ id: 'announcement-dashboard',     widgetType: 'ANNOUNCEMENT', name: 'Dashboard',        description: 'Compact dashboard alert',             category: 'OFFICE',    render: OfficeDashboardAnnouncement });
registerVariant({ id: 'announcement-gym',           widgetType: 'ANNOUNCEMENT', name: 'Gym Banner',       description: 'Pep-rally announcement banner',       category: 'ATHLETICS', render: GymPEAnnouncement });
registerVariant({ id: 'announcement-lobby',         widgetType: 'ANNOUNCEMENT', name: 'Lobby',            description: 'Modern glassmorphic announcement',    category: 'LOBBY',     render: LobbyWelcomeAnnouncement });

// ─── TICKERS ───────────────────────────────────────────────────────────
registerVariant({ id: 'ticker-diner-neon',       widgetType: 'TICKER', name: 'Diner Neon',     description: 'Neon-style scrolling diner sign',  category: 'CAFETERIA',   render: DinerChalkboardTicker });
registerVariant({ id: 'ticker-hallway-led',      widgetType: 'TICKER', name: 'Hallway LED',    description: 'School hallway LED scroll',         category: 'HALLWAY',     render: MSHallTicker });
registerVariant({ id: 'ticker-bus-station',      widgetType: 'TICKER', name: 'Bus Station',    description: 'Station-board scrolling ticker',    category: 'SAFETY',      render: BusLoopTicker });
registerVariant({ id: 'ticker-sunshine',         widgetType: 'TICKER', name: 'Sunshine',       description: 'Warm cheerful scroll',              category: 'ELEMENTARY',  render: SunshineAcademyTicker });
registerVariant({ id: 'ticker-final-chance',     widgetType: 'TICKER', name: 'Glow Ticker',    description: 'Dark glow ticker',                  category: 'DARK',        render: FinalChanceTicker });
registerVariant({ id: 'ticker-library',          widgetType: 'TICKER', name: 'Library',        description: 'Refined library scroll',            category: 'LIBRARY',     render: LibraryQuietTicker });
registerVariant({ id: 'ticker-athletics',        widgetType: 'TICKER', name: 'Stadium',        description: 'Stadium-style ticker',              category: 'ATHLETICS',   render: AthleticsTicker });
registerVariant({ id: 'ticker-principals',       widgetType: 'TICKER', name: 'Principal\'s',   description: 'Calm office ticker',                category: 'OFFICE',      render: PrincipalsOfficeTicker });
registerVariant({ id: 'ticker-dashboard',        widgetType: 'TICKER', name: 'Dashboard',      description: 'Operations dashboard scroll',       category: 'OFFICE',      render: OfficeDashboardTicker });
registerVariant({ id: 'ticker-gym',              widgetType: 'TICKER', name: 'Gym Banner',     description: 'Pep-rally ticker banner',           category: 'ATHLETICS',   render: GymPETicker });
registerVariant({ id: 'ticker-music-arts',       widgetType: 'TICKER', name: 'Music & Arts',   description: 'Creative arts ticker',              category: 'ARTS',        render: MusicArtsTicker });
registerVariant({ id: 'ticker-stem',             widgetType: 'TICKER', name: 'STEM',           description: 'Tech-grid ticker',                  category: 'STEM',        render: StemScienceTicker });
registerVariant({ id: 'ticker-lobby',            widgetType: 'TICKER', name: 'Lobby',          description: 'Sleek frosted glass scroll',        category: 'LOBBY',       render: LobbyWelcomeTicker });

// ─── CALENDAR ──────────────────────────────────────────────────────────
registerVariant({ id: 'calendar-diner-board',    widgetType: 'CALENDAR', name: 'Diner Board',  description: 'Chalk schedule on a mini board',    category: 'CAFETERIA', render: DinerChalkboardCalendar });
registerVariant({ id: 'calendar-bus-station',    widgetType: 'CALENDAR', name: 'Bus Station',  description: 'Station-style departures schedule', category: 'SAFETY',    render: BusLoopCalendar });
registerVariant({ id: 'calendar-sunshine',       widgetType: 'CALENDAR', name: 'Sunshine',     description: 'Warm cheerful calendar list',       category: 'ELEMENTARY',render: SunshineAcademyCalendar });
registerVariant({ id: 'calendar-final-chance',   widgetType: 'CALENDAR', name: 'Glow',         description: 'Dark glassmorphic event list',      category: 'DARK',      render: FinalChanceCalendar });
registerVariant({ id: 'calendar-dashboard',      widgetType: 'CALENDAR', name: 'Dashboard',    description: 'Operations dashboard agenda',       category: 'OFFICE',    render: OfficeDashboardCalendar });
registerVariant({ id: 'calendar-lobby',          widgetType: 'CALENDAR', name: 'Lobby',        description: 'Modern glassmorphic event list',    category: 'LOBBY',     render: LobbyWelcomeCalendar });

// ─── STAFF SPOTLIGHT ───────────────────────────────────────────────────
registerVariant({ id: 'staff-diner-frame',       widgetType: 'STAFF_SPOTLIGHT', name: 'Diner Frame',     description: 'Employee of the Month framed photo', category: 'CAFETERIA',  render: DinerChalkboardStaff });
registerVariant({ id: 'staff-hallway-pinned',    widgetType: 'STAFF_SPOTLIGHT', name: 'Hallway Pinned',  description: 'Pinned-photo on the hallway corkboard', category: 'HALLWAY',  render: MSHallStaff });
registerVariant({ id: 'staff-sunshine',          widgetType: 'STAFF_SPOTLIGHT', name: 'Sunshine',        description: 'Cheerful elementary staff card',     category: 'ELEMENTARY', render: SunshineAcademyStaffSpotlight });
registerVariant({ id: 'staff-final-chance',      widgetType: 'STAFF_SPOTLIGHT', name: 'Glow',            description: 'Dark glassmorphic staff card',       category: 'DARK',       render: FinalChanceStaff });
registerVariant({ id: 'staff-dashboard',         widgetType: 'STAFF_SPOTLIGHT', name: 'Dashboard',       description: 'Compact staff spotlight tile',       category: 'OFFICE',     render: OfficeDashboardStaff });
registerVariant({ id: 'staff-music-arts',        widgetType: 'STAFF_SPOTLIGHT', name: 'Music & Arts',    description: 'Spotlight in arts-room aesthetic',   category: 'ARTS',       render: MusicArtsSpotlight });

// ─── COUNTDOWN ─────────────────────────────────────────────────────────
registerVariant({ id: 'countdown-diner-chalk',   widgetType: 'COUNTDOWN', name: 'Diner Chalk',  description: 'Chalk countdown on a mini slate',     category: 'CAFETERIA',  render: DinerChalkboardCountdown });
registerVariant({ id: 'countdown-hallway',       widgetType: 'COUNTDOWN', name: 'Hallway',       description: 'Posted countdown flyer on lockers',  category: 'HALLWAY',    render: MSHallCountdown });
registerVariant({ id: 'countdown-sunshine',      widgetType: 'COUNTDOWN', name: 'Sunshine',      description: 'Warm elementary countdown',          category: 'ELEMENTARY', render: SunshineAcademyCountdown });
registerVariant({ id: 'countdown-final-chance',  widgetType: 'COUNTDOWN', name: 'Glow',          description: 'Dark glassmorphic countdown',        category: 'DARK',       render: FinalChanceCountdown });
registerVariant({ id: 'countdown-athletics',     widgetType: 'COUNTDOWN', name: 'Stadium',       description: 'Game-day countdown banner',          category: 'ATHLETICS',  render: AthleticsCountdown });
registerVariant({ id: 'countdown-music-arts',    widgetType: 'COUNTDOWN', name: 'Music & Arts',  description: 'Showtime countdown',                 category: 'ARTS',       render: MusicArtsCountdown });
registerVariant({ id: 'countdown-stem',          widgetType: 'COUNTDOWN', name: 'STEM',          description: 'Lab-style countdown timer',          category: 'STEM',       render: StemScienceCountdown });

// ─── WEATHER ───────────────────────────────────────────────────────────
registerVariant({ id: 'weather-diner-sign',      widgetType: 'WEATHER', name: 'Diner Sign',     description: 'Small chalkboard weather sign',     category: 'CAFETERIA',  render: DinerChalkboardWeather });
registerVariant({ id: 'weather-hallway-phone',   widgetType: 'WEATHER', name: 'Phone Screen',   description: 'Weather as a stuck-up phone screen', category: 'HALLWAY',   render: MSHallWeather });
registerVariant({ id: 'weather-bus-board',       widgetType: 'WEATHER', name: 'Bus Board',      description: 'Travel-board weather panel',         category: 'SAFETY',     render: BusLoopWeather });
registerVariant({ id: 'weather-sunshine',        widgetType: 'WEATHER', name: 'Sunshine',       description: 'Warm cheerful weather card',         category: 'ELEMENTARY', render: SunshineAcademyWeather });
registerVariant({ id: 'weather-final-chance',    widgetType: 'WEATHER', name: 'Glow',           description: 'Dark glassmorphic weather panel',    category: 'DARK',       render: FinalChanceWeather });
registerVariant({ id: 'weather-gym',             widgetType: 'WEATHER', name: 'Gym Outdoor',    description: 'Conditions for outdoor PE',          category: 'ATHLETICS',  render: GymPEWeather });
registerVariant({ id: 'weather-lobby',           widgetType: 'WEATHER', name: 'Lobby',          description: 'Sleek frosted glass weather panel',  category: 'LOBBY',      render: LobbyWelcomeWeather });

// ─── LOGO ──────────────────────────────────────────────────────────────
registerVariant({ id: 'logo-diner-badge',        widgetType: 'LOGO', name: 'Diner Badge',     description: 'Round retro diner badge',            category: 'CAFETERIA', render: DinerChalkboardLogo });
registerVariant({ id: 'logo-hallway-medal',      widgetType: 'LOGO', name: 'Hallway Medal',   description: 'Pinned medal-style school crest',    category: 'HALLWAY',   render: MSHallLogo });
registerVariant({ id: 'logo-final-chance',       widgetType: 'LOGO', name: 'Glow',            description: 'Dark glow gradient school crest',    category: 'DARK',      render: FinalChanceLogo });
registerVariant({ id: 'logo-athletics',          widgetType: 'LOGO', name: 'Stadium',         description: 'Athletic team logo treatment',       category: 'ATHLETICS', render: AthleticsLogo });
registerVariant({ id: 'logo-principals',         widgetType: 'LOGO', name: 'Principal\'s',    description: 'Embossed seal-style school logo',    category: 'OFFICE',    render: PrincipalsOfficeLogo });
registerVariant({ id: 'logo-dashboard',          widgetType: 'LOGO', name: 'Dashboard',       description: 'Compact dashboard logo tile',        category: 'OFFICE',    render: OfficeDashboardLogo });
registerVariant({ id: 'logo-lobby',              widgetType: 'LOGO', name: 'Lobby',           description: 'Sleek glassmorphic circular logo',   category: 'LOBBY',     render: LobbyWelcomeLogo });

// ─── IMAGE CAROUSEL ────────────────────────────────────────────────────
registerVariant({ id: 'gallery-diner',           widgetType: 'IMAGE_CAROUSEL', name: 'Diner Strip',  description: 'Pinned polaroid food photos on cork strip', category: 'CAFETERIA', render: DinerChalkboardImageCarousel });
registerVariant({ id: 'gallery-hallway',         widgetType: 'IMAGE_CAROUSEL', name: 'Hallway Pin',  description: 'Polaroids pinned to hallway corkboard',     category: 'HALLWAY',   render: MSHallImageCarousel });
registerVariant({ id: 'gallery-sunshine',        widgetType: 'IMAGE_CAROUSEL', name: 'Sunshine',     description: 'Cheerful elementary photo frame',           category: 'ELEMENTARY', render: SunshineAcademyImageCarousel });
registerVariant({ id: 'gallery-final-chance',    widgetType: 'IMAGE_CAROUSEL', name: 'Glow',         description: 'Dark glassmorphic photo frame',             category: 'DARK',      render: FinalChanceImageCarousel });
registerVariant({ id: 'gallery-stem',            widgetType: 'IMAGE_CAROUSEL', name: 'STEM',         description: 'Lab-style image grid',                      category: 'STEM',      render: StemScienceImageCarousel });
registerVariant({ id: 'gallery-library-image',   widgetType: 'IMAGE',          name: 'Library Frame', description: 'Refined wood-frame image',                  category: 'LIBRARY',   render: LibraryQuietImage });

// ─── RICH TEXT ─────────────────────────────────────────────────────────
registerVariant({ id: 'richtext-principals',     widgetType: 'RICH_TEXT', name: 'Principal\'s', description: 'Office letterhead rich text',     category: 'OFFICE',  render: PrincipalsOfficeRichText });
registerVariant({ id: 'richtext-library',        widgetType: 'RICH_TEXT', name: 'Library',      description: 'Refined library rich text',       category: 'LIBRARY', render: LibraryQuietRichText });
registerVariant({ id: 'richtext-music-arts',     widgetType: 'RICH_TEXT', name: 'Music & Arts', description: 'Creative arts rich text',         category: 'ARTS',    render: MusicArtsRichText });
registerVariant({ id: 'richtext-stem',           widgetType: 'RICH_TEXT', name: 'STEM',         description: 'Tech / STEM rich text',           category: 'STEM',    render: StemScienceRichText });

// ─── LUNCH MENU ────────────────────────────────────────────────────────
registerVariant({ id: 'lunch-diner-board',       widgetType: 'LUNCH_MENU', name: 'Diner Board', description: 'Chalk-written menu items',          category: 'CAFETERIA', render: DinerChalkboardLunchMenu });
registerVariant({ id: 'lunch-library',           widgetType: 'LUNCH_MENU', name: 'Library',     description: 'Refined library lunch listing',     category: 'LIBRARY',   render: LibraryQuietLunch });

// ─── BELL SCHEDULE ─────────────────────────────────────────────────────
registerVariant({ id: 'bell-hallway',            widgetType: 'BELL_SCHEDULE', name: 'Hallway',  description: 'Pinned bell schedule on corkboard', category: 'HALLWAY',   render: MSHallBellSchedule });
registerVariant({ id: 'bell-gym',                widgetType: 'BELL_SCHEDULE', name: 'Gym',      description: 'Pep-style bell schedule',           category: 'ATHLETICS', render: GymPEBellSchedule });
