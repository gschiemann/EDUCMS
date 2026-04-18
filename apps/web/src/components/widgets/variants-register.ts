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

// ═══════════════════════════════════════════════════════════════════════
// ELEMENTARY SHAPE-BASED THEMES — Rainbow Ribbon / Field Day / Bulletin Board
// Every widget in these themes is a real SVG shape (ribbon, stopwatch,
// polaroid, pushpin). Registered here so teachers can pick any of them
// a la carte from the widget picker, not just when instantiating the
// full preset.
// ═══════════════════════════════════════════════════════════════════════
import {
  RainbowRibbonLogo, RainbowRibbonText, RainbowRibbonClock, RainbowRibbonWeather,
  RainbowRibbonCountdown, RainbowRibbonAnnouncement, RainbowRibbonCalendar,
  RainbowRibbonStaffSpotlight, RainbowRibbonImageCarousel, RainbowRibbonTicker,
} from './themes/rainbow-ribbon';
import {
  FieldDayLogo, FieldDayText, FieldDayClock, FieldDayWeather,
  FieldDayCountdown, FieldDayAnnouncement, FieldDayCalendar,
  FieldDayStaffSpotlight, FieldDayImageCarousel, FieldDayTicker,
} from './themes/field-day';
import {
  BulletinBoardLogo, BulletinBoardText, BulletinBoardClock, BulletinBoardWeather,
  BulletinBoardCountdown, BulletinBoardAnnouncement, BulletinBoardCalendar,
  BulletinBoardStaffSpotlight, BulletinBoardImageCarousel, BulletinBoardTicker,
} from './themes/bulletin-board';
import {
  StorybookLogo, StorybookText, StorybookClock, StorybookWeather,
  StorybookCountdown, StorybookAnnouncement, StorybookCalendar,
  StorybookStaffSpotlight, StorybookImageCarousel, StorybookTicker,
} from './themes/storybook';

// ─── RAINBOW RIBBON (Elementary, candy-pop party) ──────────────────────
registerVariant({ id: 'clock-rainbow-ribbon',         widgetType: 'CLOCK',           name: 'Rainbow Speech Bubble', description: 'Speech-bubble clock with rainbow strip',     category: 'ELEMENTARY', render: RainbowRibbonClock,          defaultConfig: { theme: 'rainbow-ribbon', format: '12h' } });
registerVariant({ id: 'text-rainbow-ribbon',          widgetType: 'TEXT',            name: 'Pink Ribbon Banner',     description: 'Folded ribbon banner with swallow tails',    category: 'ELEMENTARY', render: RainbowRibbonText,           defaultConfig: { theme: 'rainbow-ribbon' } });
registerVariant({ id: 'weather-rainbow-ribbon',       widgetType: 'WEATHER',         name: 'Cloud Cutout',           description: 'Dynamic cloud + sun/rain/snow per condition', category: 'ELEMENTARY', render: RainbowRibbonWeather,        defaultConfig: { theme: 'rainbow-ribbon', location: 'Springfield', units: 'imperial' } });
registerVariant({ id: 'announcement-rainbow-ribbon',  widgetType: 'ANNOUNCEMENT',    name: 'Speech Bubble',          description: 'White speech bubble with tail',              category: 'ELEMENTARY', render: RainbowRibbonAnnouncement,   defaultConfig: { theme: 'rainbow-ribbon' } });
registerVariant({ id: 'calendar-rainbow-ribbon',      widgetType: 'CALENDAR',        name: 'Candy Pills',            description: 'Rounded pastel pills with bullet dots',      category: 'ELEMENTARY', render: RainbowRibbonCalendar,       defaultConfig: { theme: 'rainbow-ribbon' } });
registerVariant({ id: 'staff-rainbow-ribbon',         widgetType: 'STAFF_SPOTLIGHT', name: 'Washi Polaroid',         description: 'Polaroid with spotlight washi tape',         category: 'ELEMENTARY', render: RainbowRibbonStaffSpotlight, defaultConfig: { theme: 'rainbow-ribbon' } });
registerVariant({ id: 'countdown-rainbow-ribbon',     widgetType: 'COUNTDOWN',       name: 'Yellow Starburst',       description: '12-point starburst with day counter',        category: 'ELEMENTARY', render: RainbowRibbonCountdown,      defaultConfig: { theme: 'rainbow-ribbon', label: 'Event in' } });
registerVariant({ id: 'logo-rainbow-ribbon',          widgetType: 'LOGO',            name: 'Pleated Rosette',        description: 'Ribbon rosette with smiley sun mascot',      category: 'ELEMENTARY', render: RainbowRibbonLogo,           defaultConfig: { theme: 'rainbow-ribbon' } });
registerVariant({ id: 'ticker-rainbow-ribbon',        widgetType: 'TICKER',          name: 'Pennant Bunting',        description: 'Colorful pennant-flag bunting ticker',       category: 'ELEMENTARY', render: RainbowRibbonTicker,         defaultConfig: { theme: 'rainbow-ribbon' } });
registerVariant({ id: 'image-rainbow-ribbon',         widgetType: 'IMAGE_CAROUSEL',  name: 'Washi Frame',            description: 'Photo hero with washi-tape corners',         category: 'ELEMENTARY', render: RainbowRibbonImageCarousel,  defaultConfig: { theme: 'rainbow-ribbon' } });

// ─── FIELD DAY (Elementary, sports/varsity sticker-pack) ───────────────
registerVariant({ id: 'clock-field-day',              widgetType: 'CLOCK',           name: 'Stopwatch',              description: 'Coach\'s stopwatch with side lugs',          category: 'ELEMENTARY', render: FieldDayClock,               defaultConfig: { theme: 'field-day', format: '12h' } });
registerVariant({ id: 'text-field-day',               widgetType: 'TEXT',            name: 'Varsity Pennant',        description: 'Thick-stroke varsity banner patch',          category: 'ELEMENTARY', render: FieldDayText,                defaultConfig: { theme: 'field-day' } });
registerVariant({ id: 'weather-field-day',            widgetType: 'WEATHER',         name: 'Shield Badge',           description: 'Navy shield weather badge',                  category: 'ELEMENTARY', render: FieldDayWeather,             defaultConfig: { theme: 'field-day', location: 'Springfield', units: 'imperial' } });
registerVariant({ id: 'announcement-field-day',       widgetType: 'ANNOUNCEMENT',    name: 'Trophy Scroll',          description: 'Trophy cup + ribbon scroll announcement',    category: 'ELEMENTARY', render: FieldDayAnnouncement,        defaultConfig: { theme: 'field-day' } });
registerVariant({ id: 'calendar-field-day',           widgetType: 'CALENDAR',        name: 'Jersey Cards',           description: 'Stacked jersey-silhouette event cards',      category: 'ELEMENTARY', render: FieldDayCalendar,            defaultConfig: { theme: 'field-day' } });
registerVariant({ id: 'staff-field-day',              widgetType: 'STAFF_SPOTLIGHT', name: 'MVP Gold Card',          description: 'Gold MVP card with rotated sticker',         category: 'ELEMENTARY', render: FieldDayStaffSpotlight,      defaultConfig: { theme: 'field-day' } });
registerVariant({ id: 'countdown-field-day',          widgetType: 'COUNTDOWN',       name: 'Gold Medal',             description: 'Gold medal with ribbon tails',               category: 'ELEMENTARY', render: FieldDayCountdown,           defaultConfig: { theme: 'field-day', label: 'Event in' } });
registerVariant({ id: 'logo-field-day',               widgetType: 'LOGO',            name: 'Mascot Patch',           description: 'Round mascot shield with sunburst rays',     category: 'ELEMENTARY', render: FieldDayLogo,                defaultConfig: { theme: 'field-day' } });
registerVariant({ id: 'ticker-field-day',             widgetType: 'TICKER',          name: 'Scoreboard LED',         description: 'Amber dot-matrix scoreboard strip',          category: 'ELEMENTARY', render: FieldDayTicker,              defaultConfig: { theme: 'field-day' } });
registerVariant({ id: 'image-field-day',              widgetType: 'IMAGE_CAROUSEL',  name: 'Scoreboard Frame',       description: 'LED-dot scoreboard photo frame',             category: 'ELEMENTARY', render: FieldDayImageCarousel,       defaultConfig: { theme: 'field-day' } });

// ─── BULLETIN BOARD (Elementary, paper crafts + pushpins) ──────────────
registerVariant({ id: 'clock-bulletin-board',         widgetType: 'CLOCK',           name: 'Paper Clock',            description: 'Round paper clock pinned to cork',           category: 'ELEMENTARY', render: BulletinBoardClock,          defaultConfig: { theme: 'bulletin-board', format: '12h' } });
registerVariant({ id: 'text-bulletin-board',          widgetType: 'TEXT',            name: 'Letter Banner',          description: 'Construction-paper letters on jute string',  category: 'ELEMENTARY', render: BulletinBoardText,           defaultConfig: { theme: 'bulletin-board' } });
registerVariant({ id: 'weather-bulletin-board',       widgetType: 'WEATHER',         name: 'Index Card',             description: 'Weather written on a pinned index card',     category: 'ELEMENTARY', render: BulletinBoardWeather,        defaultConfig: { theme: 'bulletin-board', location: 'Springfield', units: 'imperial' } });
registerVariant({ id: 'announcement-bulletin-board',  widgetType: 'ANNOUNCEMENT',    name: 'Pinned Index Card',      description: 'Lined index card with two pushpins',         category: 'ELEMENTARY', render: BulletinBoardAnnouncement,   defaultConfig: { theme: 'bulletin-board' } });
registerVariant({ id: 'calendar-bulletin-board',      widgetType: 'CALENDAR',        name: 'Sticky Note Stack',      description: 'Rotated pastel sticky notes with tape',      category: 'ELEMENTARY', render: BulletinBoardCalendar,       defaultConfig: { theme: 'bulletin-board' } });
registerVariant({ id: 'staff-bulletin-board',         widgetType: 'STAFF_SPOTLIGHT', name: 'Taped Polaroid',         description: 'Classic polaroid with corner tape',          category: 'ELEMENTARY', render: BulletinBoardStaffSpotlight, defaultConfig: { theme: 'bulletin-board' } });
registerVariant({ id: 'countdown-bulletin-board',     widgetType: 'COUNTDOWN',       name: 'Torn Paper Banner',      description: 'Torn-edge paper countdown with ribbons',     category: 'ELEMENTARY', render: BulletinBoardCountdown,      defaultConfig: { theme: 'bulletin-board', label: 'Event in' } });
registerVariant({ id: 'logo-bulletin-board',          widgetType: 'LOGO',            name: 'Paper Crest',            description: 'Paper school crest with red pushpin',        category: 'ELEMENTARY', render: BulletinBoardLogo,           defaultConfig: { theme: 'bulletin-board' } });
registerVariant({ id: 'ticker-bulletin-board',        widgetType: 'TICKER',          name: 'Paper Strip Banner',     description: 'Scalloped paper strip taped to the board',   category: 'ELEMENTARY', render: BulletinBoardTicker,         defaultConfig: { theme: 'bulletin-board' } });
registerVariant({ id: 'image-bulletin-board',         widgetType: 'IMAGE_CAROUSEL',  name: 'Pinned Photo',           description: 'Photo pinned with four colored pushpins',    category: 'ELEMENTARY', render: BulletinBoardImageCarousel,  defaultConfig: { theme: 'bulletin-board' } });

// ─── STORYBOOK (Elementary, picture-book / library aesthetic) ──────────
registerVariant({ id: 'clock-storybook',              widgetType: 'CLOCK',           name: 'Pocket Watch',           description: 'Gold pocket-watch clock with chain + live hands', category: 'ELEMENTARY', render: StorybookClock,              defaultConfig: { theme: 'storybook', format: '12h' } });
registerVariant({ id: 'text-storybook',               widgetType: 'TEXT',            name: 'Illuminated Title',      description: 'Gold drop-cap page title with swash underline',  category: 'ELEMENTARY', render: StorybookText,               defaultConfig: { theme: 'storybook' } });
registerVariant({ id: 'weather-storybook',            widgetType: 'WEATHER',         name: 'Parchment Weather',      description: 'Ink + watercolor weather sketch on parchment',   category: 'ELEMENTARY', render: StorybookWeather,            defaultConfig: { theme: 'storybook', location: 'Springfield', units: 'imperial' } });
registerVariant({ id: 'announcement-storybook',       widgetType: 'ANNOUNCEMENT',    name: 'Open Book Page',         description: 'Ruled book-page spread with fleur-de-lis',       category: 'ELEMENTARY', render: StorybookAnnouncement,       defaultConfig: { theme: 'storybook' } });
registerVariant({ id: 'calendar-storybook',           widgetType: 'CALENDAR',        name: 'Chapter List',           description: 'Library-style chapter heading list',             category: 'ELEMENTARY', render: StorybookCalendar,           defaultConfig: { theme: 'storybook' } });
registerVariant({ id: 'staff-storybook',              widgetType: 'STAFF_SPOTLIGHT', name: 'Pop-up Book Card',       description: 'Polaroid rising from a book page',               category: 'ELEMENTARY', render: StorybookStaffSpotlight,     defaultConfig: { theme: 'storybook' } });
registerVariant({ id: 'countdown-storybook',          widgetType: 'COUNTDOWN',       name: 'Bookmark Ribbon',        description: 'Red library-ribbon bookmark with tails',         category: 'ELEMENTARY', render: StorybookCountdown,          defaultConfig: { theme: 'storybook', label: 'Event in' } });
registerVariant({ id: 'logo-storybook',               widgetType: 'LOGO',            name: 'Illuminated Crest',      description: 'Scalloped gold medallion with books + quill',    category: 'ELEMENTARY', render: StorybookLogo,               defaultConfig: { theme: 'storybook' } });
registerVariant({ id: 'ticker-storybook',             widgetType: 'TICKER',          name: 'Parchment Banner',       description: 'Swallow-tail parchment banner with rope tassels',category: 'ELEMENTARY', render: StorybookTicker,             defaultConfig: { theme: 'storybook' } });
registerVariant({ id: 'image-storybook',              widgetType: 'IMAGE_CAROUSEL',  name: 'Ornate Frame',           description: 'Illustrated plate with gold oval frame',         category: 'ELEMENTARY', render: StorybookImageCarousel,      defaultConfig: { theme: 'storybook' } });

// ─── SCRAPBOOK (Elementary, teacher's personal scrapbook) ──────────────
import {
  ScrapbookLogo, ScrapbookText, ScrapbookClock, ScrapbookWeather,
  ScrapbookCountdown, ScrapbookAnnouncement, ScrapbookCalendar,
  ScrapbookStaffSpotlight, ScrapbookImageCarousel, ScrapbookTicker,
} from './themes/scrapbook';
registerVariant({ id: 'clock-scrapbook',              widgetType: 'CLOCK',           name: 'Scrapbook Polaroid',     description: 'Polaroid-framed wall clock with live analog hands',  category: 'ELEMENTARY', render: ScrapbookClock,              defaultConfig: { theme: 'scrapbook', format: '12h' } });
registerVariant({ id: 'text-scrapbook',               widgetType: 'TEXT',            name: 'Washi Tape Header',      description: 'Headline on a torn paper strip with washi tape',     category: 'ELEMENTARY', render: ScrapbookText,               defaultConfig: { theme: 'scrapbook' } });
registerVariant({ id: 'weather-scrapbook',            widgetType: 'WEATHER',         name: 'Parchment Card',         description: 'Parchment card with 6 condition doodle illustrations',category: 'ELEMENTARY', render: ScrapbookWeather,            defaultConfig: { theme: 'scrapbook', location: 'Springfield', units: 'imperial' } });
registerVariant({ id: 'announcement-scrapbook',       widgetType: 'ANNOUNCEMENT',    name: 'Notebook Page',          description: 'Ruled notebook page with spiral binding + tape',     category: 'ELEMENTARY', render: ScrapbookAnnouncement,       defaultConfig: { theme: 'scrapbook' } });
registerVariant({ id: 'calendar-scrapbook',           widgetType: 'CALENDAR',        name: 'Index Card Stack',       description: 'Three overlapping index cards at slight rotations',  category: 'ELEMENTARY', render: ScrapbookCalendar,           defaultConfig: { theme: 'scrapbook' } });
registerVariant({ id: 'staff-scrapbook',              widgetType: 'STAFF_SPOTLIGHT', name: 'Classic Polaroid',       description: 'Polaroid photo + handwritten caption below',         category: 'ELEMENTARY', render: ScrapbookStaffSpotlight,     defaultConfig: { theme: 'scrapbook' } });
registerVariant({ id: 'countdown-scrapbook',          widgetType: 'COUNTDOWN',       name: 'Ticket Stub',            description: 'Ticket stub with big day count + torn edge',         category: 'ELEMENTARY', render: ScrapbookCountdown,          defaultConfig: { theme: 'scrapbook', label: 'Days Until' } });
registerVariant({ id: 'logo-scrapbook',               widgetType: 'LOGO',            name: 'Paper Crest',            description: 'Round paper crest with star stickers + polaroid tape',category: 'ELEMENTARY', render: ScrapbookLogo,               defaultConfig: { theme: 'scrapbook' } });
registerVariant({ id: 'ticker-scrapbook',             widgetType: 'TICKER',          name: 'Paper Strip',            description: 'Yellow paper strip with a paperclip at each end',    category: 'ELEMENTARY', render: ScrapbookTicker,             defaultConfig: { theme: 'scrapbook' } });
registerVariant({ id: 'image-scrapbook',              widgetType: 'IMAGE_CAROUSEL',  name: 'Scrapbook Polaroid',     description: 'Polaroid frame with four corner washi tapes',        category: 'ELEMENTARY', render: ScrapbookImageCarousel,      defaultConfig: { theme: 'scrapbook' } });

registerVariant({ id: 'bell-gym',                widgetType: 'BELL_SCHEDULE', name: 'Gym',      description: 'Pep-style bell schedule',           category: 'ATHLETICS', render: GymPEBellSchedule });

// ─── LOCKER HALLWAY (Middle school lobby, brushed-steel locker aesthetic) ──
import {
  LockerHallwayLogo, LockerHallwayText, LockerHallwayClock, LockerHallwayWeather,
  LockerHallwayCountdown, LockerHallwayAnnouncement, LockerHallwayCalendar,
  LockerHallwayStaffSpotlight, LockerHallwayImageCarousel, LockerHallwayTicker,
} from './themes/locker-hallway';
// Side-effect import triggers registerTheme() for the background + theme picker
import './themes/locker-hallway/index';
registerVariant({ id: 'clock-locker-hallway',         widgetType: 'CLOCK',           name: 'Combination Lock',       description: 'Combination-dial clock with live analog hands',       category: 'HALLWAY',    render: LockerHallwayClock,          defaultConfig: { theme: 'locker-hallway', format: '12h' } });
registerVariant({ id: 'text-locker-hallway',          widgetType: 'TEXT',            name: 'Magnetic Tiles',         description: 'Magnetic letter tiles on a brushed-steel locker strip',category: 'HALLWAY',    render: LockerHallwayText,           defaultConfig: { theme: 'locker-hallway' } });
registerVariant({ id: 'weather-locker-hallway',       widgetType: 'WEATHER',         name: 'Locker Door Forecast',   description: 'Forecast taped inside a locker door with magnet icons', category: 'HALLWAY',   render: LockerHallwayWeather,        defaultConfig: { theme: 'locker-hallway', location: 'Springfield', units: 'imperial' } });
registerVariant({ id: 'announcement-locker-hallway',  widgetType: 'ANNOUNCEMENT',    name: 'Notebook Flyer',         description: 'Notebook paper taped to locker with corner magnets',  category: 'HALLWAY',    render: LockerHallwayAnnouncement,   defaultConfig: { theme: 'locker-hallway' } });
registerVariant({ id: 'calendar-locker-hallway',      widgetType: 'CALENDAR',        name: 'Hall Pass Cards',        description: 'Hall-pass–style cards with colored header bars',      category: 'HALLWAY',    render: LockerHallwayCalendar,       defaultConfig: { theme: 'locker-hallway' } });
registerVariant({ id: 'staff-locker-hallway',         widgetType: 'STAFF_SPOTLIGHT', name: 'Magnet Polaroid',        description: 'Polaroid held to locker door by 4 colored magnets',  category: 'HALLWAY',    render: LockerHallwayStaffSpotlight, defaultConfig: { theme: 'locker-hallway' } });
registerVariant({ id: 'countdown-locker-hallway',     widgetType: 'COUNTDOWN',       name: 'Gym Pennant',            description: 'Gym-class pennant stuck to locker with red magnets',  category: 'HALLWAY',    render: LockerHallwayCountdown,      defaultConfig: { theme: 'locker-hallway', label: 'Days Left' } });
registerVariant({ id: 'logo-locker-hallway',          widgetType: 'LOGO',            name: 'Magnetic Badge',         description: 'Circular magnetic school badge on a locker door',     category: 'HALLWAY',    render: LockerHallwayLogo,           defaultConfig: { theme: 'locker-hallway' } });
registerVariant({ id: 'ticker-locker-hallway',        widgetType: 'TICKER',          name: 'Magnetic Strip',         description: 'Bold condensed-caps text on a long magnetic strip',   category: 'HALLWAY',    render: LockerHallwayTicker,         defaultConfig: { theme: 'locker-hallway' } });
registerVariant({ id: 'image-locker-hallway',         widgetType: 'IMAGE_CAROUSEL',  name: 'Locker Magnets Frame',   description: 'Photo held to the locker plate by 4 colored magnets', category: 'HALLWAY',    render: LockerHallwayImageCarousel,  defaultConfig: { theme: 'locker-hallway' } });

// ─── NEWS STUDIO PRO (High school premium broadcast aesthetic) ─────────────
import {
  NewsStudioProLogo, NewsStudioProText, NewsStudioProClock, NewsStudioProWeather,
  NewsStudioProCountdown, NewsStudioProAnnouncement, NewsStudioProCalendar,
  NewsStudioProStaffSpotlight, NewsStudioProImageCarousel, NewsStudioProTicker,
} from './themes/news-studio-pro';
// Side-effect import triggers registerTheme() for the background + theme picker
import './themes/news-studio-pro/index';
registerVariant({ id: 'clock-news-studio-pro',         widgetType: 'CLOCK',           name: 'Broadcast Clock',        description: 'Dark glass panel with blue glow, ON AIR dot + live analog hands',    category: 'BROADCAST', render: NewsStudioProClock,          defaultConfig: { theme: 'news-studio-pro', format: '12h' } });
registerVariant({ id: 'text-news-studio-pro',          widgetType: 'TEXT',            name: 'Glass Headline Card',    description: 'Glass-panel headline with blue left accent strip + italic serif sub', category: 'BROADCAST', render: NewsStudioProText,           defaultConfig: { theme: 'news-studio-pro' } });
registerVariant({ id: 'weather-news-studio-pro',       widgetType: 'WEATHER',         name: 'Weather Center',         description: '"WEATHER CENTER" glass panel with condition icon + 5-day strip',     category: 'BROADCAST', render: NewsStudioProWeather,        defaultConfig: { theme: 'news-studio-pro', location: 'Springfield', units: 'imperial' } });
registerVariant({ id: 'announcement-news-studio-pro',  widgetType: 'ANNOUNCEMENT',    name: 'Lower-Third Chyron',     description: 'Hot-red category block + dark glass body — broadcast lower-third',   category: 'BROADCAST', render: NewsStudioProAnnouncement,   defaultConfig: { theme: 'news-studio-pro' } });
registerVariant({ id: 'calendar-news-studio-pro',      widgetType: 'CALENDAR',        name: 'Up Next Segments',       description: '"UP NEXT" event tiles in glass panels with premium typography',      category: 'BROADCAST', render: NewsStudioProCalendar,       defaultConfig: { theme: 'news-studio-pro' } });
registerVariant({ id: 'staff-news-studio-pro',         widgetType: 'STAFF_SPOTLIGHT', name: 'Anchor Intro Card',      description: 'Portrait frame + glass nameplate with gold accent — anchor intro',   category: 'BROADCAST', render: NewsStudioProStaffSpotlight, defaultConfig: { theme: 'news-studio-pro' } });
registerVariant({ id: 'countdown-news-studio-pro',     widgetType: 'COUNTDOWN',       name: 'T-Minus Banner',         description: 'Breaking-news "T-MINUS" glass banner with blue glow + live counter', category: 'BROADCAST', render: NewsStudioProCountdown,      defaultConfig: { theme: 'news-studio-pro', label: 'Until Game Day' } });
registerVariant({ id: 'logo-news-studio-pro',          widgetType: 'LOGO',            name: 'Station ID Bug',         description: 'Sharp rectangular station-ID bug with school initials + blue underline', category: 'BROADCAST', render: NewsStudioProLogo,       defaultConfig: { theme: 'news-studio-pro' } });
registerVariant({ id: 'ticker-news-studio-pro',        widgetType: 'TICKER',          name: 'Live Ticker',            description: 'Hot-red LIVE block + glass body + italic serif scroll',              category: 'BROADCAST', render: NewsStudioProTicker,         defaultConfig: { theme: 'news-studio-pro' } });
registerVariant({ id: 'image-news-studio-pro',         widgetType: 'IMAGE_CAROUSEL',  name: 'Broadcast Frame',        description: 'Widescreen 16:9 bezel with blue glow + corner network bug',          category: 'BROADCAST', render: NewsStudioProImageCarousel,  defaultConfig: { theme: 'news-studio-pro' } });

// ─── AUTO-GENERATED: 8 shape-based themes (middle + high school) ───
import { SpiritRallyLogo, SpiritRallyText, SpiritRallyClock, SpiritRallyWeather, SpiritRallyCountdown, SpiritRallyAnnouncement, SpiritRallyCalendar, SpiritRallyStaffSpotlight, SpiritRallyImageCarousel, SpiritRallyTicker } from './themes/spirit-rally';
registerVariant({ id: 'clock-spirit-rally', widgetType: 'CLOCK', name: 'Spirit Rally', description: 'Spirit Rally themed Clock', category: 'MIDDLE', render: SpiritRallyClock, defaultConfig: { theme: 'spirit-rally' } });
registerVariant({ id: 'text-spirit-rally', widgetType: 'TEXT', name: 'Spirit Rally', description: 'Spirit Rally themed Text', category: 'MIDDLE', render: SpiritRallyText, defaultConfig: { theme: 'spirit-rally' } });
registerVariant({ id: 'weather-spirit-rally', widgetType: 'WEATHER', name: 'Spirit Rally', description: 'Spirit Rally themed Weather', category: 'MIDDLE', render: SpiritRallyWeather, defaultConfig: { theme: 'spirit-rally' } });
registerVariant({ id: 'announcement-spirit-rally', widgetType: 'ANNOUNCEMENT', name: 'Spirit Rally', description: 'Spirit Rally themed Announcement', category: 'MIDDLE', render: SpiritRallyAnnouncement, defaultConfig: { theme: 'spirit-rally' } });
registerVariant({ id: 'calendar-spirit-rally', widgetType: 'CALENDAR', name: 'Spirit Rally', description: 'Spirit Rally themed Calendar', category: 'MIDDLE', render: SpiritRallyCalendar, defaultConfig: { theme: 'spirit-rally' } });
registerVariant({ id: 'staff_spotlight-spirit-rally', widgetType: 'STAFF_SPOTLIGHT', name: 'Spirit Rally', description: 'Spirit Rally themed StaffSpotlight', category: 'MIDDLE', render: SpiritRallyStaffSpotlight, defaultConfig: { theme: 'spirit-rally' } });
registerVariant({ id: 'countdown-spirit-rally', widgetType: 'COUNTDOWN', name: 'Spirit Rally', description: 'Spirit Rally themed Countdown', category: 'MIDDLE', render: SpiritRallyCountdown, defaultConfig: { theme: 'spirit-rally' } });
registerVariant({ id: 'logo-spirit-rally', widgetType: 'LOGO', name: 'Spirit Rally', description: 'Spirit Rally themed Logo', category: 'MIDDLE', render: SpiritRallyLogo, defaultConfig: { theme: 'spirit-rally' } });
registerVariant({ id: 'ticker-spirit-rally', widgetType: 'TICKER', name: 'Spirit Rally', description: 'Spirit Rally themed Ticker', category: 'MIDDLE', render: SpiritRallyTicker, defaultConfig: { theme: 'spirit-rally' } });
registerVariant({ id: 'image_carousel-spirit-rally', widgetType: 'IMAGE_CAROUSEL', name: 'Spirit Rally', description: 'Spirit Rally themed ImageCarousel', category: 'MIDDLE', render: SpiritRallyImageCarousel, defaultConfig: { theme: 'spirit-rally' } });

import { StemLabLogo, StemLabText, StemLabClock, StemLabWeather, StemLabCountdown, StemLabAnnouncement, StemLabCalendar, StemLabStaffSpotlight, StemLabImageCarousel, StemLabTicker } from './themes/stem-lab';
registerVariant({ id: 'clock-stem-lab', widgetType: 'CLOCK', name: 'STEM Lab', description: 'STEM Lab themed Clock', category: 'MIDDLE', render: StemLabClock, defaultConfig: { theme: 'stem-lab' } });
registerVariant({ id: 'text-stem-lab', widgetType: 'TEXT', name: 'STEM Lab', description: 'STEM Lab themed Text', category: 'MIDDLE', render: StemLabText, defaultConfig: { theme: 'stem-lab' } });
registerVariant({ id: 'weather-stem-lab', widgetType: 'WEATHER', name: 'STEM Lab', description: 'STEM Lab themed Weather', category: 'MIDDLE', render: StemLabWeather, defaultConfig: { theme: 'stem-lab' } });
registerVariant({ id: 'announcement-stem-lab', widgetType: 'ANNOUNCEMENT', name: 'STEM Lab', description: 'STEM Lab themed Announcement', category: 'MIDDLE', render: StemLabAnnouncement, defaultConfig: { theme: 'stem-lab' } });
registerVariant({ id: 'calendar-stem-lab', widgetType: 'CALENDAR', name: 'STEM Lab', description: 'STEM Lab themed Calendar', category: 'MIDDLE', render: StemLabCalendar, defaultConfig: { theme: 'stem-lab' } });
registerVariant({ id: 'staff_spotlight-stem-lab', widgetType: 'STAFF_SPOTLIGHT', name: 'STEM Lab', description: 'STEM Lab themed StaffSpotlight', category: 'MIDDLE', render: StemLabStaffSpotlight, defaultConfig: { theme: 'stem-lab' } });
registerVariant({ id: 'countdown-stem-lab', widgetType: 'COUNTDOWN', name: 'STEM Lab', description: 'STEM Lab themed Countdown', category: 'MIDDLE', render: StemLabCountdown, defaultConfig: { theme: 'stem-lab' } });
registerVariant({ id: 'logo-stem-lab', widgetType: 'LOGO', name: 'STEM Lab', description: 'STEM Lab themed Logo', category: 'MIDDLE', render: StemLabLogo, defaultConfig: { theme: 'stem-lab' } });
registerVariant({ id: 'ticker-stem-lab', widgetType: 'TICKER', name: 'STEM Lab', description: 'STEM Lab themed Ticker', category: 'MIDDLE', render: StemLabTicker, defaultConfig: { theme: 'stem-lab' } });
registerVariant({ id: 'image_carousel-stem-lab', widgetType: 'IMAGE_CAROUSEL', name: 'STEM Lab', description: 'STEM Lab themed ImageCarousel', category: 'MIDDLE', render: StemLabImageCarousel, defaultConfig: { theme: 'stem-lab' } });

import { MorningNewsLogo, MorningNewsText, MorningNewsClock, MorningNewsWeather, MorningNewsCountdown, MorningNewsAnnouncement, MorningNewsCalendar, MorningNewsStaffSpotlight, MorningNewsImageCarousel, MorningNewsTicker } from './themes/morning-news';
registerVariant({ id: 'clock-morning-news', widgetType: 'CLOCK', name: 'Morning News', description: 'Morning News themed Clock', category: 'MIDDLE', render: MorningNewsClock, defaultConfig: { theme: 'morning-news' } });
registerVariant({ id: 'text-morning-news', widgetType: 'TEXT', name: 'Morning News', description: 'Morning News themed Text', category: 'MIDDLE', render: MorningNewsText, defaultConfig: { theme: 'morning-news' } });
registerVariant({ id: 'weather-morning-news', widgetType: 'WEATHER', name: 'Morning News', description: 'Morning News themed Weather', category: 'MIDDLE', render: MorningNewsWeather, defaultConfig: { theme: 'morning-news' } });
registerVariant({ id: 'announcement-morning-news', widgetType: 'ANNOUNCEMENT', name: 'Morning News', description: 'Morning News themed Announcement', category: 'MIDDLE', render: MorningNewsAnnouncement, defaultConfig: { theme: 'morning-news' } });
registerVariant({ id: 'calendar-morning-news', widgetType: 'CALENDAR', name: 'Morning News', description: 'Morning News themed Calendar', category: 'MIDDLE', render: MorningNewsCalendar, defaultConfig: { theme: 'morning-news' } });
registerVariant({ id: 'staff_spotlight-morning-news', widgetType: 'STAFF_SPOTLIGHT', name: 'Morning News', description: 'Morning News themed StaffSpotlight', category: 'MIDDLE', render: MorningNewsStaffSpotlight, defaultConfig: { theme: 'morning-news' } });
registerVariant({ id: 'countdown-morning-news', widgetType: 'COUNTDOWN', name: 'Morning News', description: 'Morning News themed Countdown', category: 'MIDDLE', render: MorningNewsCountdown, defaultConfig: { theme: 'morning-news' } });
registerVariant({ id: 'logo-morning-news', widgetType: 'LOGO', name: 'Morning News', description: 'Morning News themed Logo', category: 'MIDDLE', render: MorningNewsLogo, defaultConfig: { theme: 'morning-news' } });
registerVariant({ id: 'ticker-morning-news', widgetType: 'TICKER', name: 'Morning News', description: 'Morning News themed Ticker', category: 'MIDDLE', render: MorningNewsTicker, defaultConfig: { theme: 'morning-news' } });
registerVariant({ id: 'image_carousel-morning-news', widgetType: 'IMAGE_CAROUSEL', name: 'Morning News', description: 'Morning News themed ImageCarousel', category: 'MIDDLE', render: MorningNewsImageCarousel, defaultConfig: { theme: 'morning-news' } });

import { ArtStudioLogo, ArtStudioText, ArtStudioClock, ArtStudioWeather, ArtStudioCountdown, ArtStudioAnnouncement, ArtStudioCalendar, ArtStudioStaffSpotlight, ArtStudioImageCarousel, ArtStudioTicker } from './themes/art-studio';
registerVariant({ id: 'clock-art-studio', widgetType: 'CLOCK', name: 'Art Studio', description: 'Art Studio themed Clock', category: 'MIDDLE', render: ArtStudioClock, defaultConfig: { theme: 'art-studio' } });
registerVariant({ id: 'text-art-studio', widgetType: 'TEXT', name: 'Art Studio', description: 'Art Studio themed Text', category: 'MIDDLE', render: ArtStudioText, defaultConfig: { theme: 'art-studio' } });
registerVariant({ id: 'weather-art-studio', widgetType: 'WEATHER', name: 'Art Studio', description: 'Art Studio themed Weather', category: 'MIDDLE', render: ArtStudioWeather, defaultConfig: { theme: 'art-studio' } });
registerVariant({ id: 'announcement-art-studio', widgetType: 'ANNOUNCEMENT', name: 'Art Studio', description: 'Art Studio themed Announcement', category: 'MIDDLE', render: ArtStudioAnnouncement, defaultConfig: { theme: 'art-studio' } });
registerVariant({ id: 'calendar-art-studio', widgetType: 'CALENDAR', name: 'Art Studio', description: 'Art Studio themed Calendar', category: 'MIDDLE', render: ArtStudioCalendar, defaultConfig: { theme: 'art-studio' } });
registerVariant({ id: 'staff_spotlight-art-studio', widgetType: 'STAFF_SPOTLIGHT', name: 'Art Studio', description: 'Art Studio themed StaffSpotlight', category: 'MIDDLE', render: ArtStudioStaffSpotlight, defaultConfig: { theme: 'art-studio' } });
registerVariant({ id: 'countdown-art-studio', widgetType: 'COUNTDOWN', name: 'Art Studio', description: 'Art Studio themed Countdown', category: 'MIDDLE', render: ArtStudioCountdown, defaultConfig: { theme: 'art-studio' } });
registerVariant({ id: 'logo-art-studio', widgetType: 'LOGO', name: 'Art Studio', description: 'Art Studio themed Logo', category: 'MIDDLE', render: ArtStudioLogo, defaultConfig: { theme: 'art-studio' } });
registerVariant({ id: 'ticker-art-studio', widgetType: 'TICKER', name: 'Art Studio', description: 'Art Studio themed Ticker', category: 'MIDDLE', render: ArtStudioTicker, defaultConfig: { theme: 'art-studio' } });
registerVariant({ id: 'image_carousel-art-studio', widgetType: 'IMAGE_CAROUSEL', name: 'Art Studio', description: 'Art Studio themed ImageCarousel', category: 'MIDDLE', render: ArtStudioImageCarousel, defaultConfig: { theme: 'art-studio' } });

import { VarsityAthleticLogo, VarsityAthleticText, VarsityAthleticClock, VarsityAthleticWeather, VarsityAthleticCountdown, VarsityAthleticAnnouncement, VarsityAthleticCalendar, VarsityAthleticStaffSpotlight, VarsityAthleticImageCarousel, VarsityAthleticTicker } from './themes/varsity-athletic';
registerVariant({ id: 'clock-varsity-athletic', widgetType: 'CLOCK', name: 'Varsity Athletic', description: 'Varsity Athletic themed Clock', category: 'HIGH', render: VarsityAthleticClock, defaultConfig: { theme: 'varsity-athletic' } });
registerVariant({ id: 'text-varsity-athletic', widgetType: 'TEXT', name: 'Varsity Athletic', description: 'Varsity Athletic themed Text', category: 'HIGH', render: VarsityAthleticText, defaultConfig: { theme: 'varsity-athletic' } });
registerVariant({ id: 'weather-varsity-athletic', widgetType: 'WEATHER', name: 'Varsity Athletic', description: 'Varsity Athletic themed Weather', category: 'HIGH', render: VarsityAthleticWeather, defaultConfig: { theme: 'varsity-athletic' } });
registerVariant({ id: 'announcement-varsity-athletic', widgetType: 'ANNOUNCEMENT', name: 'Varsity Athletic', description: 'Varsity Athletic themed Announcement', category: 'HIGH', render: VarsityAthleticAnnouncement, defaultConfig: { theme: 'varsity-athletic' } });
registerVariant({ id: 'calendar-varsity-athletic', widgetType: 'CALENDAR', name: 'Varsity Athletic', description: 'Varsity Athletic themed Calendar', category: 'HIGH', render: VarsityAthleticCalendar, defaultConfig: { theme: 'varsity-athletic' } });
registerVariant({ id: 'staff_spotlight-varsity-athletic', widgetType: 'STAFF_SPOTLIGHT', name: 'Varsity Athletic', description: 'Varsity Athletic themed StaffSpotlight', category: 'HIGH', render: VarsityAthleticStaffSpotlight, defaultConfig: { theme: 'varsity-athletic' } });
registerVariant({ id: 'countdown-varsity-athletic', widgetType: 'COUNTDOWN', name: 'Varsity Athletic', description: 'Varsity Athletic themed Countdown', category: 'HIGH', render: VarsityAthleticCountdown, defaultConfig: { theme: 'varsity-athletic' } });
registerVariant({ id: 'logo-varsity-athletic', widgetType: 'LOGO', name: 'Varsity Athletic', description: 'Varsity Athletic themed Logo', category: 'HIGH', render: VarsityAthleticLogo, defaultConfig: { theme: 'varsity-athletic' } });
registerVariant({ id: 'ticker-varsity-athletic', widgetType: 'TICKER', name: 'Varsity Athletic', description: 'Varsity Athletic themed Ticker', category: 'HIGH', render: VarsityAthleticTicker, defaultConfig: { theme: 'varsity-athletic' } });
registerVariant({ id: 'image_carousel-varsity-athletic', widgetType: 'IMAGE_CAROUSEL', name: 'Varsity Athletic', description: 'Varsity Athletic themed ImageCarousel', category: 'HIGH', render: VarsityAthleticImageCarousel, defaultConfig: { theme: 'varsity-athletic' } });

import { SeniorCountdownLogo, SeniorCountdownText, SeniorCountdownClock, SeniorCountdownWeather, SeniorCountdownCountdown, SeniorCountdownAnnouncement, SeniorCountdownCalendar, SeniorCountdownStaffSpotlight, SeniorCountdownImageCarousel, SeniorCountdownTicker } from './themes/senior-countdown';
registerVariant({ id: 'clock-senior-countdown', widgetType: 'CLOCK', name: 'Senior Countdown', description: 'Senior Countdown themed Clock', category: 'HIGH', render: SeniorCountdownClock, defaultConfig: { theme: 'senior-countdown' } });
registerVariant({ id: 'text-senior-countdown', widgetType: 'TEXT', name: 'Senior Countdown', description: 'Senior Countdown themed Text', category: 'HIGH', render: SeniorCountdownText, defaultConfig: { theme: 'senior-countdown' } });
registerVariant({ id: 'weather-senior-countdown', widgetType: 'WEATHER', name: 'Senior Countdown', description: 'Senior Countdown themed Weather', category: 'HIGH', render: SeniorCountdownWeather, defaultConfig: { theme: 'senior-countdown' } });
registerVariant({ id: 'announcement-senior-countdown', widgetType: 'ANNOUNCEMENT', name: 'Senior Countdown', description: 'Senior Countdown themed Announcement', category: 'HIGH', render: SeniorCountdownAnnouncement, defaultConfig: { theme: 'senior-countdown' } });
registerVariant({ id: 'calendar-senior-countdown', widgetType: 'CALENDAR', name: 'Senior Countdown', description: 'Senior Countdown themed Calendar', category: 'HIGH', render: SeniorCountdownCalendar, defaultConfig: { theme: 'senior-countdown' } });
registerVariant({ id: 'staff_spotlight-senior-countdown', widgetType: 'STAFF_SPOTLIGHT', name: 'Senior Countdown', description: 'Senior Countdown themed StaffSpotlight', category: 'HIGH', render: SeniorCountdownStaffSpotlight, defaultConfig: { theme: 'senior-countdown' } });
registerVariant({ id: 'countdown-senior-countdown', widgetType: 'COUNTDOWN', name: 'Senior Countdown', description: 'Senior Countdown themed Countdown', category: 'HIGH', render: SeniorCountdownCountdown, defaultConfig: { theme: 'senior-countdown' } });
registerVariant({ id: 'logo-senior-countdown', widgetType: 'LOGO', name: 'Senior Countdown', description: 'Senior Countdown themed Logo', category: 'HIGH', render: SeniorCountdownLogo, defaultConfig: { theme: 'senior-countdown' } });
registerVariant({ id: 'ticker-senior-countdown', widgetType: 'TICKER', name: 'Senior Countdown', description: 'Senior Countdown themed Ticker', category: 'HIGH', render: SeniorCountdownTicker, defaultConfig: { theme: 'senior-countdown' } });
registerVariant({ id: 'image_carousel-senior-countdown', widgetType: 'IMAGE_CAROUSEL', name: 'Senior Countdown', description: 'Senior Countdown themed ImageCarousel', category: 'HIGH', render: SeniorCountdownImageCarousel, defaultConfig: { theme: 'senior-countdown' } });

import { CampusQuadLogo, CampusQuadText, CampusQuadClock, CampusQuadWeather, CampusQuadCountdown, CampusQuadAnnouncement, CampusQuadCalendar, CampusQuadStaffSpotlight, CampusQuadImageCarousel, CampusQuadTicker } from './themes/campus-quad';
registerVariant({ id: 'clock-campus-quad', widgetType: 'CLOCK', name: 'Campus Quad', description: 'Campus Quad themed Clock', category: 'HIGH', render: CampusQuadClock, defaultConfig: { theme: 'campus-quad' } });
registerVariant({ id: 'text-campus-quad', widgetType: 'TEXT', name: 'Campus Quad', description: 'Campus Quad themed Text', category: 'HIGH', render: CampusQuadText, defaultConfig: { theme: 'campus-quad' } });
registerVariant({ id: 'weather-campus-quad', widgetType: 'WEATHER', name: 'Campus Quad', description: 'Campus Quad themed Weather', category: 'HIGH', render: CampusQuadWeather, defaultConfig: { theme: 'campus-quad' } });
registerVariant({ id: 'announcement-campus-quad', widgetType: 'ANNOUNCEMENT', name: 'Campus Quad', description: 'Campus Quad themed Announcement', category: 'HIGH', render: CampusQuadAnnouncement, defaultConfig: { theme: 'campus-quad' } });
registerVariant({ id: 'calendar-campus-quad', widgetType: 'CALENDAR', name: 'Campus Quad', description: 'Campus Quad themed Calendar', category: 'HIGH', render: CampusQuadCalendar, defaultConfig: { theme: 'campus-quad' } });
registerVariant({ id: 'staff_spotlight-campus-quad', widgetType: 'STAFF_SPOTLIGHT', name: 'Campus Quad', description: 'Campus Quad themed StaffSpotlight', category: 'HIGH', render: CampusQuadStaffSpotlight, defaultConfig: { theme: 'campus-quad' } });
registerVariant({ id: 'countdown-campus-quad', widgetType: 'COUNTDOWN', name: 'Campus Quad', description: 'Campus Quad themed Countdown', category: 'HIGH', render: CampusQuadCountdown, defaultConfig: { theme: 'campus-quad' } });
registerVariant({ id: 'logo-campus-quad', widgetType: 'LOGO', name: 'Campus Quad', description: 'Campus Quad themed Logo', category: 'HIGH', render: CampusQuadLogo, defaultConfig: { theme: 'campus-quad' } });
registerVariant({ id: 'ticker-campus-quad', widgetType: 'TICKER', name: 'Campus Quad', description: 'Campus Quad themed Ticker', category: 'HIGH', render: CampusQuadTicker, defaultConfig: { theme: 'campus-quad' } });
registerVariant({ id: 'image_carousel-campus-quad', widgetType: 'IMAGE_CAROUSEL', name: 'Campus Quad', description: 'Campus Quad themed ImageCarousel', category: 'HIGH', render: CampusQuadImageCarousel, defaultConfig: { theme: 'campus-quad' } });

import { AchievementHallLogo, AchievementHallText, AchievementHallClock, AchievementHallWeather, AchievementHallCountdown, AchievementHallAnnouncement, AchievementHallCalendar, AchievementHallStaffSpotlight, AchievementHallImageCarousel, AchievementHallTicker } from './themes/achievement-hall';
registerVariant({ id: 'clock-achievement-hall', widgetType: 'CLOCK', name: 'Achievement Hall', description: 'Achievement Hall themed Clock', category: 'HIGH', render: AchievementHallClock, defaultConfig: { theme: 'achievement-hall' } });
registerVariant({ id: 'text-achievement-hall', widgetType: 'TEXT', name: 'Achievement Hall', description: 'Achievement Hall themed Text', category: 'HIGH', render: AchievementHallText, defaultConfig: { theme: 'achievement-hall' } });
registerVariant({ id: 'weather-achievement-hall', widgetType: 'WEATHER', name: 'Achievement Hall', description: 'Achievement Hall themed Weather', category: 'HIGH', render: AchievementHallWeather, defaultConfig: { theme: 'achievement-hall' } });
registerVariant({ id: 'announcement-achievement-hall', widgetType: 'ANNOUNCEMENT', name: 'Achievement Hall', description: 'Achievement Hall themed Announcement', category: 'HIGH', render: AchievementHallAnnouncement, defaultConfig: { theme: 'achievement-hall' } });
registerVariant({ id: 'calendar-achievement-hall', widgetType: 'CALENDAR', name: 'Achievement Hall', description: 'Achievement Hall themed Calendar', category: 'HIGH', render: AchievementHallCalendar, defaultConfig: { theme: 'achievement-hall' } });
registerVariant({ id: 'staff_spotlight-achievement-hall', widgetType: 'STAFF_SPOTLIGHT', name: 'Achievement Hall', description: 'Achievement Hall themed StaffSpotlight', category: 'HIGH', render: AchievementHallStaffSpotlight, defaultConfig: { theme: 'achievement-hall' } });
registerVariant({ id: 'countdown-achievement-hall', widgetType: 'COUNTDOWN', name: 'Achievement Hall', description: 'Achievement Hall themed Countdown', category: 'HIGH', render: AchievementHallCountdown, defaultConfig: { theme: 'achievement-hall' } });
registerVariant({ id: 'logo-achievement-hall', widgetType: 'LOGO', name: 'Achievement Hall', description: 'Achievement Hall themed Logo', category: 'HIGH', render: AchievementHallLogo, defaultConfig: { theme: 'achievement-hall' } });
registerVariant({ id: 'ticker-achievement-hall', widgetType: 'TICKER', name: 'Achievement Hall', description: 'Achievement Hall themed Ticker', category: 'HIGH', render: AchievementHallTicker, defaultConfig: { theme: 'achievement-hall' } });
registerVariant({ id: 'image_carousel-achievement-hall', widgetType: 'IMAGE_CAROUSEL', name: 'Achievement Hall', description: 'Achievement Hall themed ImageCarousel', category: 'HIGH', render: AchievementHallImageCarousel, defaultConfig: { theme: 'achievement-hall' } });

