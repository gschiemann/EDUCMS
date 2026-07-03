/**
 * Boot-time registration of all bundled widget variants.
 *
 * Import once from a top-level layout/page so all variants are in the registry
 * before the picker renders. New variants drop into this file as one
 * `registerVariant({...})` call each.
 */
import { registerVariant } from './variants';
import {
  VideoBasicTile,
  VideoCarouselTile,
  WebpageTile,
  ImageBasicTile,
  ImageCarouselBasicTile,
  ExternalHtmlTile,
} from './variant-tiles/basic-content-tiles';
import {
  BackToSchoolClock, BackToSchoolText, BackToSchoolAnnouncement,
  BackToSchoolCalendar, BackToSchoolStaff, BackToSchoolCountdown,
  BackToSchoolLogo, BackToSchoolTicker, BackToSchoolWeather,
  BackToSchoolImageCarousel,
} from './themes/back-to-school';

// ════════════════════════════════════════════════════════════════════════
// Basic content widgets — registered FIRST so they appear at the top
// of the Widget Library, not buried under 500+ themed variants.
// 2026-05-09 — operator: "i don't see an image or image carousel
// option". Pre-fix these were appended to the BOTTOM of the file
// which meant a user filtering "ALL" had to scroll past every clock/
// text/holiday variant before hitting Image. Moving them up to the
// top of registration order pushes them to slot #1 in the picker.
// ════════════════════════════════════════════════════════════════════════
// 2026-05-10 — operator: "show the images in the widget once we add
// them". The previous registration had these variants render the
// thumbnail tile component as the CANVAS widget too, which froze the
// canvas at the placeholder forever no matter what URLs/photos the
// operator picked. Adding previewOnly:true on each variant makes the
// canvas fall through to the standard WidgetRenderer dispatch
// (ImageCarouselWidget / VideoCarouselWidget / etc.) which actually
// reads config.urls + config.assetUrl and renders real <img> / <video>
// elements. The tile components stay as the picker thumbnails — that's
// what they were always meant for.
registerVariant({
  id: 'image-basic',
  widgetType: 'IMAGE',
  name: 'Image',
  description: 'Single photo. Pick a file in Properties after dropping.',
  category: 'MODERN',
  render: ImageBasicTile,
  previewOnly: true,
});
registerVariant({
  id: 'image-carousel-basic',
  widgetType: 'IMAGE_CAROUSEL',
  name: 'Image Carousel',
  description: 'Multiple images with timing + transitions. Pick images in Properties.',
  category: 'MODERN',
  render: ImageCarouselBasicTile,
  previewOnly: true,
});
registerVariant({
  id: 'video-basic',
  widgetType: 'VIDEO',
  name: 'Video',
  description: 'Single video playback. Pick a video file in Properties after dropping.',
  category: 'MODERN',
  render: VideoBasicTile,
  previewOnly: true,
});
registerVariant({
  id: 'video-carousel-basic',
  widgetType: 'VIDEO_CAROUSEL',
  name: 'Video Carousel',
  description: 'Multiple videos auto-playing one after another. Pick videos in Properties.',
  category: 'MODERN',
  render: VideoCarouselTile,
  previewOnly: true,
});
registerVariant({
  id: 'webpage-basic',
  widgetType: 'WEBPAGE',
  name: 'Web Page',
  description: 'Embed any URL. Set the URL + auto-refresh in Properties.',
  category: 'MODERN',
  render: WebpageTile,
  previewOnly: true,
});
// 2026-05-16 — one tile for all 78 industry-signage / HS templates.
// Same pattern as Image / Video / Web Page: a single picker tile;
// the operator chooses WHICH of the 78 templates — and rebrands its
// colors + fonts — in the Properties panel after dropping. (78
// separate tiles would drown the picker; the EXTERNAL_HTML widget
// just takes a different cfg.url per template.)
registerVariant({
  id: 'external-html-basic',
  widgetType: 'EXTERNAL_HTML',
  name: 'Signage Template',
  description: 'Drop a ready-made industry template (QSR, retail, healthcare, hospitality, HS…). Pick which one + recolor it in Properties.',
  category: 'MODERN',
  render: ExternalHtmlTile,
  previewOnly: true,
});

// ════════════════════════════════════════════════════════════════════════
// Wave B / editor-crush B2+B3+B5 (2026-07-02) — the ELEMENTS wave.
// Canva's Elements tray is shapes + icons + decorations; before this block
// VenueOS had NO static shapes, NO icon library, and the 8 finished
// Decoration animations were dead-registered (listed only in constants.ts
// WIDGET_GROUPS, which no rendered surface imports — the exact CLAUDE.md
// rule-#9 WidgetPalette class). Registered EARLY (right after the basic
// content tiles) so elements sit near the top of the "All widgets" stream.
// All previewOnly: the tile render doubles as a live preview, the canvas
// dispatches through WidgetRenderer's SHAPE/ICON/DECORATION cases.
// ════════════════════════════════════════════════════════════════════════
import { ShapeWidget, SHAPE_KINDS } from './ShapeWidget';
import { IconWidget } from './IconWidget';
import { DecorationWidget, DECORATION_VARIANTS } from './DecorationWidget';

// B2 — static shapes (rect/pill/circle/triangle/star/line/arrow). ONE
// canonical SHAPE type; the primitive is config.shape, which ShapeWidget
// dispatches on (config.variant — the registry id handlePick writes — is
// ignored by the renderer, so no id/variant collision is possible here).
for (const s of SHAPE_KINDS) {
  registerVariant({
    id: `shape-${s.key}`,
    widgetType: 'SHAPE',
    name: s.label,
    description: s.hint,
    category: 'MODERN',
    render: ShapeWidget as ComponentType<ThemeWidgetProps>,
    previewOnly: true,
    defaultConfig: { shape: s.key },
  });
}

// B5 — lucide icon element. ONE tile; the operator picks any of ~1,500
// icons via the searchable picker in Properties (IconPickerField).
registerVariant({
  id: 'icon-element',
  widgetType: 'ICON',
  name: 'Icon',
  description: 'Crisp SVG icon in your brand color — search 1,500+ (star, trophy, pizza…) in Properties.',
  category: 'MODERN',
  render: IconWidget as ComponentType<ThemeWidgetProps>,
  previewOnly: true,
  defaultConfig: { icon: 'star' },
});

// B3 — resurrect the 8 finished Decoration animations (APPROVED
// 2026-04-27, complete widget + Properties editor, dead palette entry).
// Ids are `decoration-<key>`; DecorationWidget normalizes the prefixed
// registry id back to its bare variant key (same pattern TouchPointWidget
// established for `touch-*` ids), so handlePick writing variant:
// 'decoration-confetti' still renders the confetti animation.
for (const d of DECORATION_VARIANTS) {
  registerVariant({
    id: `decoration-${d.key}`,
    widgetType: 'DECORATION',
    name: d.label,
    description: d.hint,
    category: 'MODERN',
    render: DecorationWidget as unknown as ComponentType<ThemeWidgetProps>,
    previewOnly: true,
    defaultConfig: { ...d.defaults },
  });
}

// 2026-05-25 monetize-audit — the one ad-network we can integrate
// without partnership sign-off. Drops a rotating sponsor banner that
// reads from the operator's own asset library. Sponsor disclosure
// label baked in for FTC native-advertising compliance.
import { HouseAdsBannerTile, MusicPlayerTile } from './variant-tiles/monetize-music-tiles';
registerVariant({
  id: 'house-ad-banner-basic',
  widgetType: 'HOUSE_AD_BANNER',
  name: 'House Ads',
  description: 'Rotate your own sponsor creatives. No third-party network. Pick slots + interval in Properties.',
  category: 'MODERN',
  render: HouseAdsBannerTile,
  previewOnly: true,
  defaultConfig: {
    intervalMs: 8000,
    showSponsorLabel: true,
    placement: 'banner',
    slots: [],
  },
});

// 2026-05-25 music-overhaul — venue background music with multi-
// provider support: SomaFM (free, public), NPR local-station finder
// (free, by lat/lng), NTS Radio (free, public), Apple Music for
// Business / Spotify for Business (placeholders pending OAuth), and
// generic Icecast/Shoutcast/HLS audio URL for tenant-supplied streams.
registerVariant({
  id: 'music-player-basic',
  widgetType: 'MUSIC_PLAYER',
  name: 'Music Player',
  description: 'Venue background music. SomaFM · NPR · NTS · custom stream. Schedule windows, emergency-silenced.',
  category: 'MODERN',
  render: MusicPlayerTile,
  previewOnly: true,
  defaultConfig: {
    source: 'somafm',
    somafmStationId: 'groovesalad',
    defaultVolume: 70,
    autoResume: true,
    pauseDuringEmergency: true,
  },
});
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

// ─── Athletics set (3 themes) ───
import { TrackDayLogo, TrackDayText, TrackDayClock, TrackDayWeather, TrackDayCountdown, TrackDayAnnouncement, TrackDayCalendar, TrackDayStaffSpotlight, TrackDayImageCarousel, TrackDayTicker } from './themes/track-day';
registerVariant({ id: 'clock-track-day', widgetType: 'CLOCK', name: 'Track Day', description: 'Track Day themed Clock', category: 'ELEMENTARY', render: TrackDayClock, defaultConfig: { theme: 'track-day' } });
registerVariant({ id: 'text-track-day', widgetType: 'TEXT', name: 'Track Day', description: 'Track Day themed Text', category: 'ELEMENTARY', render: TrackDayText, defaultConfig: { theme: 'track-day' } });
registerVariant({ id: 'weather-track-day', widgetType: 'WEATHER', name: 'Track Day', description: 'Track Day themed Weather', category: 'ELEMENTARY', render: TrackDayWeather, defaultConfig: { theme: 'track-day' } });
registerVariant({ id: 'announcement-track-day', widgetType: 'ANNOUNCEMENT', name: 'Track Day', description: 'Track Day themed Announcement', category: 'ELEMENTARY', render: TrackDayAnnouncement, defaultConfig: { theme: 'track-day' } });
registerVariant({ id: 'calendar-track-day', widgetType: 'CALENDAR', name: 'Track Day', description: 'Track Day themed Calendar', category: 'ELEMENTARY', render: TrackDayCalendar, defaultConfig: { theme: 'track-day' } });
registerVariant({ id: 'staff_spotlight-track-day', widgetType: 'STAFF_SPOTLIGHT', name: 'Track Day', description: 'Track Day themed StaffSpotlight', category: 'ELEMENTARY', render: TrackDayStaffSpotlight, defaultConfig: { theme: 'track-day' } });
registerVariant({ id: 'countdown-track-day', widgetType: 'COUNTDOWN', name: 'Track Day', description: 'Track Day themed Countdown', category: 'ELEMENTARY', render: TrackDayCountdown, defaultConfig: { theme: 'track-day' } });
registerVariant({ id: 'logo-track-day', widgetType: 'LOGO', name: 'Track Day', description: 'Track Day themed Logo', category: 'ELEMENTARY', render: TrackDayLogo, defaultConfig: { theme: 'track-day' } });
registerVariant({ id: 'ticker-track-day', widgetType: 'TICKER', name: 'Track Day', description: 'Track Day themed Ticker', category: 'ELEMENTARY', render: TrackDayTicker, defaultConfig: { theme: 'track-day' } });
registerVariant({ id: 'image_carousel-track-day', widgetType: 'IMAGE_CAROUSEL', name: 'Track Day', description: 'Track Day themed ImageCarousel', category: 'ELEMENTARY', render: TrackDayImageCarousel, defaultConfig: { theme: 'track-day' } });

import { ScorebugLogo, ScorebugText, ScorebugClock, ScorebugWeather, ScorebugCountdown, ScorebugAnnouncement, ScorebugCalendar, ScorebugStaffSpotlight, ScorebugImageCarousel, ScorebugTicker } from './themes/scorebug';
registerVariant({ id: 'clock-scorebug', widgetType: 'CLOCK', name: 'Scorebug', description: 'Scorebug themed Clock', category: 'MIDDLE', render: ScorebugClock, defaultConfig: { theme: 'scorebug' } });
registerVariant({ id: 'text-scorebug', widgetType: 'TEXT', name: 'Scorebug', description: 'Scorebug themed Text', category: 'MIDDLE', render: ScorebugText, defaultConfig: { theme: 'scorebug' } });
registerVariant({ id: 'weather-scorebug', widgetType: 'WEATHER', name: 'Scorebug', description: 'Scorebug themed Weather', category: 'MIDDLE', render: ScorebugWeather, defaultConfig: { theme: 'scorebug' } });
registerVariant({ id: 'announcement-scorebug', widgetType: 'ANNOUNCEMENT', name: 'Scorebug', description: 'Scorebug themed Announcement', category: 'MIDDLE', render: ScorebugAnnouncement, defaultConfig: { theme: 'scorebug' } });
registerVariant({ id: 'calendar-scorebug', widgetType: 'CALENDAR', name: 'Scorebug', description: 'Scorebug themed Calendar', category: 'MIDDLE', render: ScorebugCalendar, defaultConfig: { theme: 'scorebug' } });
registerVariant({ id: 'staff_spotlight-scorebug', widgetType: 'STAFF_SPOTLIGHT', name: 'Scorebug', description: 'Scorebug themed StaffSpotlight', category: 'MIDDLE', render: ScorebugStaffSpotlight, defaultConfig: { theme: 'scorebug' } });
registerVariant({ id: 'countdown-scorebug', widgetType: 'COUNTDOWN', name: 'Scorebug', description: 'Scorebug themed Countdown', category: 'MIDDLE', render: ScorebugCountdown, defaultConfig: { theme: 'scorebug' } });
registerVariant({ id: 'logo-scorebug', widgetType: 'LOGO', name: 'Scorebug', description: 'Scorebug themed Logo', category: 'MIDDLE', render: ScorebugLogo, defaultConfig: { theme: 'scorebug' } });
registerVariant({ id: 'ticker-scorebug', widgetType: 'TICKER', name: 'Scorebug', description: 'Scorebug themed Ticker', category: 'MIDDLE', render: ScorebugTicker, defaultConfig: { theme: 'scorebug' } });
registerVariant({ id: 'image_carousel-scorebug', widgetType: 'IMAGE_CAROUSEL', name: 'Scorebug', description: 'Scorebug themed ImageCarousel', category: 'MIDDLE', render: ScorebugImageCarousel, defaultConfig: { theme: 'scorebug' } });

import { JumbotronProLogo, JumbotronProText, JumbotronProClock, JumbotronProWeather, JumbotronProCountdown, JumbotronProAnnouncement, JumbotronProCalendar, JumbotronProStaffSpotlight, JumbotronProImageCarousel, JumbotronProTicker } from './themes/jumbotron-pro';
registerVariant({ id: 'clock-jumbotron-pro', widgetType: 'CLOCK', name: 'Jumbotron Pro', description: 'Jumbotron Pro themed Clock', category: 'HIGH', render: JumbotronProClock, defaultConfig: { theme: 'jumbotron-pro' } });
registerVariant({ id: 'text-jumbotron-pro', widgetType: 'TEXT', name: 'Jumbotron Pro', description: 'Jumbotron Pro themed Text', category: 'HIGH', render: JumbotronProText, defaultConfig: { theme: 'jumbotron-pro' } });
registerVariant({ id: 'weather-jumbotron-pro', widgetType: 'WEATHER', name: 'Jumbotron Pro', description: 'Jumbotron Pro themed Weather', category: 'HIGH', render: JumbotronProWeather, defaultConfig: { theme: 'jumbotron-pro' } });
registerVariant({ id: 'announcement-jumbotron-pro', widgetType: 'ANNOUNCEMENT', name: 'Jumbotron Pro', description: 'Jumbotron Pro themed Announcement', category: 'HIGH', render: JumbotronProAnnouncement, defaultConfig: { theme: 'jumbotron-pro' } });
registerVariant({ id: 'calendar-jumbotron-pro', widgetType: 'CALENDAR', name: 'Jumbotron Pro', description: 'Jumbotron Pro themed Calendar', category: 'HIGH', render: JumbotronProCalendar, defaultConfig: { theme: 'jumbotron-pro' } });
registerVariant({ id: 'staff_spotlight-jumbotron-pro', widgetType: 'STAFF_SPOTLIGHT', name: 'Jumbotron Pro', description: 'Jumbotron Pro themed StaffSpotlight', category: 'HIGH', render: JumbotronProStaffSpotlight, defaultConfig: { theme: 'jumbotron-pro' } });
registerVariant({ id: 'countdown-jumbotron-pro', widgetType: 'COUNTDOWN', name: 'Jumbotron Pro', description: 'Jumbotron Pro themed Countdown', category: 'HIGH', render: JumbotronProCountdown, defaultConfig: { theme: 'jumbotron-pro' } });
registerVariant({ id: 'logo-jumbotron-pro', widgetType: 'LOGO', name: 'Jumbotron Pro', description: 'Jumbotron Pro themed Logo', category: 'HIGH', render: JumbotronProLogo, defaultConfig: { theme: 'jumbotron-pro' } });
registerVariant({ id: 'ticker-jumbotron-pro', widgetType: 'TICKER', name: 'Jumbotron Pro', description: 'Jumbotron Pro themed Ticker', category: 'HIGH', render: JumbotronProTicker, defaultConfig: { theme: 'jumbotron-pro' } });
registerVariant({ id: 'image_carousel-jumbotron-pro', widgetType: 'IMAGE_CAROUSEL', name: 'Jumbotron Pro', description: 'Jumbotron Pro themed ImageCarousel', category: 'HIGH', render: JumbotronProImageCarousel, defaultConfig: { theme: 'jumbotron-pro' } });

// ─── v2 widget pack (2026-05-02) ─────────────────────────────────────
// 14 categories × 5 audience-tagged styles (Neon / Paper / Crayon /
// Glass / Ops). Each v2 widget registers as a variant of an EXISTING
// canonical widget type (CLOCK, ANNOUNCEMENT, …) — NOT under its own
// type string. That keeps the picker's type-filter row at ~12 chips
// (one per canonical type) instead of mushrooming to 70+. The
// renderer dispatches via cfg.variant (existing variant lookup at
// the top of WidgetPreview), so the canonical case statement never
// needs a v2 branch.
//
// `level` from the v2 registry maps onto the picker's existing level
// filter via `CATEGORY_TO_LEVELS` (apps/web/src/components/template-
// builder/VariantPicker.tsx). Mapping:
//   high       → HIGH        (level filter: High)
//   middle     → MIDDLE      (level filter: Middle)
//   elementary → ELEMENTARY  (level filter: Elementary)
//   universal  → MODERN      (visible across every level chip)
//   admin      → OFFICE      (visible across every level chip — no admin chip exists)
import { ALL_V2_WIDGETS } from './v2/registry';
import type { ThemeWidgetProps, WidgetType } from './themes/registry';
import type { ComponentType } from 'react';

const V2_LEVEL_TO_CATEGORY: Record<string, string> = {
  high: 'HIGH',
  middle: 'MIDDLE',
  elementary: 'ELEMENTARY',
  universal: 'MODERN',
  admin: 'OFFICE',
};

// v2 category → canonical widget type. The variant gets registered
// under the canonical type so it shows up in the picker chip the
// operator already knows ("CLOCK", "WEATHER", …). Photos and Images
// both map onto IMAGE; Headlines maps onto TEXT (large headline-as-
// text). Anything not in this map is skipped with a console warning.
const V2_CATEGORY_TO_CANONICAL: Record<string, WidgetType> = {
  'Clocks':         'CLOCK',
  'Headlines':      'TEXT',
  'Announcements':  'ANNOUNCEMENT',
  'Calendars':      'CALENDAR',
  'Staff':          'STAFF_SPOTLIGHT',
  'Countdowns':     'COUNTDOWN',
  'Logos':          'LOGO',
  'Tickers':        'TICKER',
  'Weather':        'WEATHER',
  'Photos':         'IMAGE',
  'Rich Text':      'RICH_TEXT',
  'Images':         'IMAGE',
  'Lunch Menus':    'LUNCH_MENU',
  'Bell Schedules': 'BELL_SCHEDULE',
  // VenueOS Sports — celebration ribbons (EDU CMS-10/12 batches). Every
  // sport category registers under the one CELEBRATION canonical type
  // so the picker shows a single "Celebration" chip.
  'Celebrations · Baseball':   'CELEBRATION',
  'Celebrations · Football':   'CELEBRATION',
  'Celebrations · Basketball': 'CELEBRATION',
  'Celebrations · Hockey':     'CELEBRATION',
  'Celebrations · Soccer':     'CELEBRATION',
  // VenueOS multi-industry widget packs (EDU CMS-11/12).
  'Healthcare':   'HEALTHCARE',
  'Corporate':    'CORPORATE',
  'Hospitality':  'HOSPITALITY',
  'Worship':      'WORSHIP',
  'Charts':       'CHART',
  // Retail storefront pack (2026-05-19) — RETAIL-vertical scoped.
  'Retail':       'RETAIL',
  // VenueOS Sports — the live scoreboard widget (HS / College / Pro).
  'Scoreboards':  'SCOREBOARD',
  // VenueOS Sports Venue — jumbotron / ribbon / concourse surfaces.
  'Sports Venue':              'SCOREBOARD',
  // VenueOS Sports — celebration ribbons for the remaining sports.
  'Celebrations · More Sports': 'CELEBRATION',
  // VenueOS universal packs — backgrounds, live data feeds, touch
  // engagement, and transit boards. All variant-rendered.
  'Backgrounds':   'BACKGROUND',
  'Live Data':     'LIVE_DATA',
  'Touch & Engage': 'TOUCH_POINT',
  'Transit':       'LIVE_DATA',
};

for (const w of ALL_V2_WIDGETS) {
  const canonicalType = V2_CATEGORY_TO_CANONICAL[w.category];
  if (!canonicalType) {
    // eslint-disable-next-line no-console
    console.warn(`[v2] no canonical type mapped for category "${w.category}" — skipping ${w.type}`);
    continue;
  }
  registerVariant({
    // Stable, kebab-cased id derived from the v2 type. Persisted in
    // `cfg.variant`; handlePick uses this to detect same-vs-different
    // variants for the swap/append path.
    id: w.type.toLowerCase().replace(/_/g, '-'),
    // Canonical widget type so the picker's type filter shows ONE
    // chip per category (CLOCK, WEATHER, …) and so the renderer's
    // existing case statement still applies when no variant is set.
    widgetType: canonicalType,
    name: w.label,
    description: w.desc,
    category: V2_LEVEL_TO_CATEGORY[w.level] ?? 'MODERN',
    // ThemeWidgetProps.config is `any`; v2 widgets accept a typed
    // `config?: <Cfg>` and ignore extra `compact` / `onConfigChange`
    // props. The cast is safe at runtime; React doesn't enforce
    // prop-shape at the boundary.
    render: w.Component as ComponentType<ThemeWidgetProps>,
    // Seed defaults so a freshly-dropped zone renders immediately.
    defaultConfig: w.defaults || {},
    // Business-line scope — VariantPicker hides a vertical-scoped widget
    // from every other vertical's palette (a healthcare widget never
    // shows in a gym, a celebration never lands in a restaurant).
    vertical: w.vertical,
    // Multi-vertical scope — cross-over widgets (Lunch Menu, Staff
    // Spotlight, Transit) that belong to several lines but not all.
    // Takes precedence over `vertical` in the picker filter.
    verticals: w.verticals,
  });
}

// (basic content variants registered at top of file — see header block)

// ════════════════════════════════════════════════════════════════════════
// Phase D2.9-D2.11 (2026-05-12) — TOUCH_POINT variants
//
// 25 visual variants of the canonical interactive zone. Each registers
// `widgetType: 'TOUCH_POINT'` so the picker groups them under one
// "Touch" chip; the visual is selected via `defaultConfig.variant`,
// which the runtime TouchPointWidget (WidgetRenderer) dispatches on.
//
// previewOnly: true — the canvas falls through to the standard
// WidgetRenderer.case('TOUCH_POINT') path which already knows how to
// render every variant. The variant's `render` is only used as the
// picker thumbnail. TouchPointWidget IS the thumbnail too because
// the visual is identical at every size (em-based sizing).
//
// Operator (2026-05-12): "where are the touch widgets? I expected
// a pill just like all the other widgets called touch." Registering
// here makes them appear in the V2 Widget Library's "Touch" chip
// + the "All widgets" stream.
// ════════════════════════════════════════════════════════════════════════
import { TouchPointWidget as TouchTile } from './WidgetRenderer';

const TOUCH_VARIANTS: Array<{ id: string; name: string; description: string; extraConfig?: Record<string, any> }> = [
  // Generic hotspots + shapes
  { id: 'hotspot',     name: 'Transparent Hotspot', description: 'Invisible tap area — drop on top of any content to make it tappable' },
  { id: 'tap-prompt',  name: 'Tap Here Button',     description: '"Tap to continue" pill — best for kiosk start screens', extraConfig: { label: 'Tap to continue' } },
  { id: 'circle',      name: 'Circle Button',       description: 'Filled circle hotspot — "press here" indicator' },
  { id: 'square',      name: 'Square Button',       description: 'Rounded-square button — labeled via Properties', extraConfig: { label: 'Tap' } },
  // Directional arrows
  { id: 'arrow-right', name: 'Right Arrow',         description: 'Right-pointing arrow — pair with "Next" gestures' },
  { id: 'arrow-left',  name: 'Left Arrow',          description: 'Left-pointing arrow — back / previous navigation' },
  { id: 'arrow-up',    name: 'Up Arrow',            description: 'Up arrow — scroll / page-up patterns' },
  { id: 'arrow-down',  name: 'Down Arrow',          description: 'Down arrow — scroll / page-down patterns' },
  // Kiosk nav vocabulary
  { id: 'home',        name: 'Home Button',         description: 'House-icon disc — "Return to start screen"' },
  { id: 'back',        name: 'Back Chip',           description: 'Labeled "← Back" pill — bigger touch target', extraConfig: { label: 'Back' } },
  { id: 'next',        name: 'Next Chip',           description: 'Labeled "Next →" pill — primary advance', extraConfig: { label: 'Next' } },
  { id: 'close',       name: 'Close Button',        description: 'X-icon dismiss button — high-contrast on any bg' },
  { id: 'menu',        name: 'Menu Button',         description: 'Hamburger icon — open a sub-menu via goto-scene' },
  { id: 'help',        name: 'Help Button',         description: 'Amber "?" — opens help overlay or request-help action' },
  { id: 'play',        name: 'Play Button',         description: 'Big play triangle — pair with play-video Tap Action' },
  // Communication actions
  { id: 'qr',          name: 'QR Code',             description: 'Visible QR placeholder — set qrText to encode a URL', extraConfig: { qrText: 'https://example.com' } },
  { id: 'info',        name: 'Info Button',         description: 'Blue circled "i" — tap for show-overlay with details' },
  { id: 'phone',       name: 'Phone Button',        description: 'Phone receiver — pair with open-url tel:+1...' },
  { id: 'email',       name: 'Email Button',        description: 'Envelope — pair with open-url mailto:... or webhook' },
  { id: 'share',       name: 'Share Button',        description: 'Share icon — opens a sharing options overlay' },
  // Engagement actions
  { id: 'heart',       name: 'Favorite (Heart)',    description: 'Pink heart — pair with webhook to log a favorite' },
  { id: 'star',        name: 'Star Rating',         description: 'Amber star — pair with webhook to log a rating' },
  // Utility
  { id: 'search',      name: 'Search Button',       description: 'Magnifying glass — pair with show-overlay for a search panel' },
  { id: 'volume',      name: 'Volume Toggle',       description: 'Speaker icon — pair with sound-toggle Tap Action' },
  { id: 'print',       name: 'Print Button',        description: 'Printer icon — pair with webhook for a print job' },
];

for (const tv of TOUCH_VARIANTS) {
  registerVariant({
    id: `touch-${tv.id}`,
    widgetType: 'TOUCH_POINT',
    name: tv.name,
    description: tv.description,
    category: 'MODERN',
    render: TouchTile as ComponentType<ThemeWidgetProps>,
    // Operator (2026-05-13): "the square should stay transparent and
    // we should just be able to update the two layers of the circle
    // shown in the image." Defaulting bgColor='transparent' makes the
    // touch widget render as JUST THE ICON — no disc behind it — so
    // the zone rectangle stays transparent. Operator opts INTO a
    // background by picking a color in Properties (which adds an
    // inscribed circular disc behind the icon).
    defaultConfig: {
      variant: tv.id,
      bgColor: 'transparent',
      ...(tv.extraConfig || {}),
    },
    previewOnly: true,
  });
}

// ════════════════════════════════════════════════════════════════════
// Sprint 13 — sport-bound widget primitives. Each binds to live Game
// state (home/away score, clock, segment, sport-specific stats) when
// the operator drops it into a Scoreboard / Ribbon / Scorebug template
// and the resulting template renders on /board /ribbon /scorebug. In
// the builder canvas (no GameStateProvider) they render placeholder
// values so the operator can lay out the board against realistic
// dummy numbers.
// ════════════════════════════════════════════════════════════════════
import {
  ScoreHomeWidget,
  ScoreAwayWidget,
  GameClockWidget,
  GameSegmentWidget,
  GameStatWidget,
} from './sports/SportWidgets';
// 2026-05-19 — the REAL board, one drop. Operator wanted the actual
// pushed scoreboard available as a template, not the generic 7-zone
// primitive layout. This is a faithful BoardScene reproduction that
// reads live game state from the GameStateProvider.
import { MainScoreboardWidget } from './sports/MainScoreboardWidget';
// 2026-07-01 — swim/dive sport split flagship widgets (see file header
// of SwimDiveWidgets.tsx for the full swimming-vs-diving rationale).
import { SwimLaneGridWidget, DiveLeaderboardWidget } from './sports/SwimDiveWidgets';
// 2026-07-01 DEPTH PASS — swim/dive widgets #3-6 (relay exchange, splits
// panel, record line, dive judges panel). See SwimDiveWidgets.tsx header.
import {
  SwimRelayExchangeWidget,
  SwimSplitsPanelWidget,
  SwimRecordLineWidget,
  DiveJudgesPanelWidget,
} from './sports/SwimDiveWidgets';
// S6 #288 (2026-07-03) — "Stadium Lane" flagship swim-meet broadcast
// board. Greg picked all 3 stadium designs 2026-07-03; only v1
// "Broadcast" is built (StadiumMeetBoardWidget.tsx header has the full
// rationale + live-data mapping). A NEW widget/file — NOT a SwimDiveWidgets
// reskin — so it doesn't collide with the concurrent no-fake-data sweep
// on that file.
import { StadiumMeetBoardWidget } from './sports/StadiumMeetBoardWidget';
// 2026-05-26 — CTS-fed ribbon scoreboard. Live game state flows from
// the CtsBridge (Beelink mini PC reading the CTS console via Web
// Serial) → API → signed WS → window CustomEvent → this widget.
// Designed for a 480×208 px ribbon panel; transform:scale lets it
// resize for any LED canvas the operator drops it on. See
// packages/scoreboard-cts/README.md for the protocol details.
import { CtsScoreboard } from './sports/CtsScoreboard';

registerVariant({
  id: 'scoreboard-main',
  widgetType: 'SCOREBOARD',
  name: 'Main Scoreboard (live)',
  description: 'The real game board — team color panels, logos, big scores, live amber clock, period, possession. Drop it, bind a game, done. Resize for any LED.',
  category: 'SPORTS',
  render: MainScoreboardWidget as any,
  vertical: 'SPORTS',
  defaultConfig: {},
});

registerVariant({
  id: 'scoreboard-cts-ribbon',
  widgetType: 'SCOREBOARD',
  name: 'Water Polo Ribbon (CTS)',
  description: 'Live ribbon scoreboard fed by a Colorado Time Systems (CTS) System 6 / Gen 6 console. Plug the USB-RS232 dongle in, open the player with ?cts=1, click Connect once — every clock tick / goal / exclusion shows up here.',
  category: 'SPORTS',
  render: CtsScoreboard as any,
  vertical: 'SPORTS',
  defaultConfig: {
    homeAbbrev: 'H',
    awayAbbrev: 'A',
    bgColor: '#0f172a',
    accentColor: '#f59e0b',
  },
});

// ────────────────────────────────────────────────────────────────────
// 2026-05-26 — Composable CTS ribbon widget set. Sibling of the all-
// in-one CtsScoreboard above. Each tile is a single zone an operator
// drops onto a custom-canvas ribbon to compose their own layout
// (clock here, score there, sponsor middle, announcements right).
// Every widget shares one window-CustomEvent subscriber, so they all
// stay in sync across the ribbon with zero per-widget round trips.
// All gated to the SPORTS vertical so non-sports tenants never see
// them in the palette.
// ────────────────────────────────────────────────────────────────────
import {
  CtsClockWidget,
  CtsScoreCombinedWidget,
  CtsScoreHomeWidget,
  CtsScoreAwayWidget,
  CtsPeriodWidget,
  CtsExclusionWidget,
  CtsShotClockWidget,
  CtsHornFlashWidget,
  CtsSponsorRotatorWidget,
  CtsAnnouncementWidget,
  CtsCelebrationWidget,
  CtsCelebrationOrchestratorWidget,
} from './sports/CtsRibbonWidgets';

registerVariant({
  id: 'scoreboard-cts-clock',
  widgetType: 'SCOREBOARD',
  name: 'Clock (CTS)',
  description: 'Live CTS game clock. Big tabular figures, amber by default, flashes red on horn.',
  category: 'SPORTS',
  render: CtsClockWidget as any,
  vertical: 'SPORTS',
  defaultConfig: { bgColor: '#0f172a', accentColor: '#f59e0b' },
});

registerVariant({
  id: 'scoreboard-cts-score',
  widgetType: 'SCOREBOARD',
  name: 'Score H-A (CTS)',
  description: 'Live combined score: home abbrev, score, dash, away score, away abbrev. Reads off the CTS feed.',
  category: 'SPORTS',
  render: CtsScoreCombinedWidget as any,
  vertical: 'SPORTS',
  defaultConfig: {
    homeAbbrev: 'H',
    awayAbbrev: 'A',
    homeColor: '#93c5fd',
    awayColor: '#fca5a5',
    bgColor: '#0f172a',
  },
});

registerVariant({
  id: 'scoreboard-cts-score-home',
  widgetType: 'SCOREBOARD',
  name: 'Home Score (CTS)',
  description: 'Home team’s live CTS score, by itself. Pair with the Away tile for a two-zone ribbon.',
  category: 'SPORTS',
  render: CtsScoreHomeWidget as any,
  vertical: 'SPORTS',
  defaultConfig: { homeAbbrev: 'HOME', homeColor: '#93c5fd', bgColor: '#0f172a' },
});

registerVariant({
  id: 'scoreboard-cts-score-away',
  widgetType: 'SCOREBOARD',
  name: 'Away Score (CTS)',
  description: 'Away team’s live CTS score, by itself. Pair with the Home tile for a two-zone ribbon.',
  category: 'SPORTS',
  render: CtsScoreAwayWidget as any,
  vertical: 'SPORTS',
  defaultConfig: { awayAbbrev: 'AWAY', awayColor: '#fca5a5', bgColor: '#0f172a' },
});

registerVariant({
  id: 'scoreboard-cts-period',
  widgetType: 'SCOREBOARD',
  name: 'Period / Quarter (CTS)',
  description: 'Q1–Q4 / OT readout from the CTS console.',
  category: 'SPORTS',
  render: CtsPeriodWidget as any,
  vertical: 'SPORTS',
  defaultConfig: { bgColor: '#0f172a', accentColor: '#cbd5e1' },
});

registerVariant({
  id: 'scoreboard-cts-exclusion',
  widgetType: 'SCOREBOARD',
  name: 'Active Exclusion (CTS)',
  description: 'Live water-polo penalty: side, jersey, seconds remaining. Idles "NO PENALTY" between exclusions.',
  category: 'SPORTS',
  render: CtsExclusionWidget as any,
  vertical: 'SPORTS',
  defaultConfig: {
    team: 'auto',
    homeAbbrev: 'H',
    awayAbbrev: 'A',
    homeColor: '#facc15',
    awayColor: '#fb923c',
    bgColor: '#1a0b1c',
  },
});

registerVariant({
  id: 'scoreboard-cts-shot-clock',
  widgetType: 'SCOREBOARD',
  name: 'Shot Clock (CTS)',
  description: '30-second possession clock. Flashes red at ≤5s; shows "—" when parked.',
  category: 'SPORTS',
  render: CtsShotClockWidget as any,
  vertical: 'SPORTS',
  defaultConfig: { team: 'either', bgColor: '#0f172a', accentColor: '#facc15' },
});

registerVariant({
  id: 'scoreboard-cts-horn-flash',
  widgetType: 'SCOREBOARD',
  name: 'Horn Flash (CTS)',
  description: 'Whole-tile red flash whenever the CTS horn fires. Great as a 1080×80 visual cue for refs/crowd.',
  category: 'SPORTS',
  render: CtsHornFlashWidget as any,
  vertical: 'SPORTS',
  defaultConfig: { bgColor: '#1e1b1b' },
});

registerVariant({
  id: 'scoreboard-cts-sponsor',
  widgetType: 'SCOREBOARD',
  name: 'Sponsor Rotator (CTS)',
  description: 'Pre-built sponsor reel. Add image or text slots in the Properties panel; they rotate on the ribbon during the game. Falls back to sample sponsors in the builder.',
  category: 'SPORTS',
  render: CtsSponsorRotatorWidget as any,
  vertical: 'SPORTS',
  defaultConfig: {
    zoneLabel: 'OUR SPONSORS',
    defaultDurationMs: 6000,
    bgColor: '#1e293b',
    slots: [],
  },
});

registerVariant({
  id: 'scoreboard-cts-announcement',
  widgetType: 'SCOREBOARD',
  name: 'Player Announcements (CTS)',
  description: 'Operator-curated announcement queue. Lineups, next match, player of the week, anything you want to roll on the ribbon during the game. Falls back to sample copy in the builder.',
  category: 'SPORTS',
  render: CtsAnnouncementWidget as any,
  vertical: 'SPORTS',
  defaultConfig: {
    zoneLabel: 'ANNOUNCEMENTS',
    defaultDurationMs: 5000,
    bgColor: '#0c1322',
    accentColor: '#fbbf24',
    entries: [],
  },
});

registerVariant({
  id: 'scoreboard-cts-celebration',
  widgetType: 'SCOREBOARD',
  name: 'Auto-Celebration (CTS, simple)',
  description: 'Idles "GO TEAM"; pulses a big team-color "GOAL!" scene the moment the CTS score increases or the horn fires. Detection is delta-based so duplicate snapshots never re-trigger. Lightweight text-only — for the full cinematic celebration library, use the Celebration Orchestrator tile below.',
  category: 'SPORTS',
  render: CtsCelebrationWidget as any,
  vertical: 'SPORTS',
  defaultConfig: {
    text: 'GOAL!',
    idleText: 'GO TEAM',
    activeMs: 6000,
    hornAlsoTriggers: true,
    homeColor: '#3b82f6',
    awayColor: '#ef4444',
    bgColor: '#0a0a14',
  },
});

registerVariant({
  id: 'scoreboard-cts-celebration-orchestrator',
  widgetType: 'SCOREBOARD',
  name: 'Celebration Orchestrator (CTS)',
  description: 'Full-coverage overlay that fires a CINEMATIC celebration from the existing celebration library (soccer GOOOOAL, hockey red-lamp, lacrosse stick-up, football TD, etc.) the moment the CTS feed shows a home/away goal, period change, or horn. Picks from operator-configured cue decks; round-robins so the same scene doesn’t repeat twice in a row. Drop this on the ribbon as a full-bleed, high-z-index zone — it stays invisible until something fires.',
  category: 'SPORTS',
  render: CtsCelebrationOrchestratorWidget as any,
  vertical: 'SPORTS',
  defaultConfig: {
    durationMs: 6000,
    homeTeamName: 'HOME',
    awayTeamName: 'AWAY',
    homeColor: '#3b82f6',
    awayColor: '#ef4444',
    cues: {
      homeGoal: ['CEL_SOCCER_GOAL', 'CEL_HOCKEY_GOAL', 'CEL_LX_GOAL', 'CEL_SC_GOAL_NEON'],
      awayGoal: ['CEL_HOCKEY_GOAL', 'CEL_SOCCER_GOAL', 'CEL_HK_GOAL_RETRO', 'CEL_LX_GOAL'],
      periodEnd: ['CEL_FOOTBALL_TOUCHDOWN', 'CEL_BASKETBALL_BUZZER'],
      horn: ['CEL_FOOTBALL_TOUCHDOWN', 'CEL_BASKETBALL_BUZZER'],
    },
  },
});

registerVariant({
  id: 'score-home',
  widgetType: 'SCORE_HOME',
  name: 'Home Score',
  description: 'Live home-team score. Big digits; auto-binds to the game.',
  category: 'SPORTS',
  render: ScoreHomeWidget,
  defaultConfig: {
    color: '#ffffff',
    fontWeight: 900,
    align: 'center',
    placeholder: '24',
  },
});

registerVariant({
  id: 'score-away',
  widgetType: 'SCORE_AWAY',
  name: 'Away Score',
  description: 'Live away-team score. Big digits; auto-binds to the game.',
  category: 'SPORTS',
  render: ScoreAwayWidget,
  defaultConfig: {
    color: '#ffffff',
    fontWeight: 900,
    align: 'center',
    placeholder: '21',
  },
});

registerVariant({
  id: 'game-clock',
  widgetType: 'GAME_CLOCK',
  name: 'Game Clock',
  description: 'Live MM:SS game clock. Counts down/up from the sport definition.',
  category: 'SPORTS',
  render: GameClockWidget,
  defaultConfig: {
    color: '#ffffff',
    fontWeight: 800,
    align: 'center',
    placeholder: '07:42',
  },
});

registerVariant({
  id: 'game-segment',
  widgetType: 'GAME_SEGMENT',
  name: 'Period / Quarter',
  description: 'Sport-aware label — "Q3", "Inning 5", "Set 2", etc.',
  category: 'SPORTS',
  render: GameSegmentWidget,
  defaultConfig: {
    color: '#ffffff',
    fontWeight: 700,
    align: 'center',
    placeholder: 'Q3',
  },
});

registerVariant({
  id: 'game-stat',
  widgetType: 'GAME_STAT',
  name: 'Game Stat',
  description: 'Pick a sport stat in Properties — down/distance, balls/strikes, sets, etc.',
  category: 'SPORTS',
  render: GameStatWidget,
  defaultConfig: {
    color: '#ffffff',
    fontWeight: 700,
    align: 'center',
    statKey: 'down',
    label: 'Down',
    placeholder: '2',
  },
});

// 2026-07-01 — swim/dive sport split flagship widgets (operator: "lanes
// and shit that we need to show where each swimmer is" + "[diving is]
// totally different, SEPARATE it"). Each is its own top-level widgetType
// (not a SCOREBOARD variant) so it gets its own palette tile, matching
// the GAME_CLOCK / GAME_SEGMENT pattern above. `vertical: 'SPORTS'` scopes
// them to the Sports Venue palette (verticalForWidgetType's regex only
// covers SCOREBOARD|SCORE_|GAME_ prefixes, so these need the explicit tag).
registerVariant({
  id: 'swim-lane-grid',
  widgetType: 'SWIM_LANE_GRID',
  name: 'Swim Lane Grid',
  description: 'Live heat board — one row per lane: lane #, swimmer/team, time, place. Toggle lane order vs. results order. Bind a meet; resize for any LED.',
  category: 'SPORTS',
  render: SwimLaneGridWidget as any,
  vertical: 'SPORTS',
  defaultConfig: { orderMode: 'lane', laneCount: 8 },
});

registerVariant({
  id: 'dive-leaderboard',
  widgetType: 'DIVE_LEADERBOARD',
  name: 'Dive Leaderboard',
  description: 'Judged running-total leaderboard for diving — place, diver/team, total score. No lanes/clock/splits (diving is judged, not timed). Bind a meet; resize for any LED.',
  category: 'SPORTS',
  render: DiveLeaderboardWidget as any,
  vertical: 'SPORTS',
  defaultConfig: {},
});

// 2026-07-01 DEPTH PASS (docs/research/2026-06-30-swim-dive-scoreboards/
// 00-REPORT.md parts A3/A4/A8/B4/B5) — four more swim/dive widgets, same
// SPORTS-vertical / top-level-widgetType pattern as the two above.
registerVariant({
  id: 'swim-relay-exchange',
  widgetType: 'SWIM_RELAY_EXCHANGE',
  name: 'Swim Relay Exchange',
  description: 'One relay lane\'s 4 legs — leg name, split, cumulative time, and exchange/takeoff time. A negative exchange auto-flags DQ. Bind a meet; resize for any LED.',
  category: 'SPORTS',
  render: SwimRelayExchangeWidget as any,
  vertical: 'SPORTS',
  defaultConfig: { laneNumber: 3 },
});

registerVariant({
  id: 'swim-splits-panel',
  widgetType: 'SWIM_SPLITS_PANEL',
  name: 'Swim Splits Panel',
  description: 'Per-length split table for one focused lane — length #, split, cumulative time, optional pace-vs-record delta. Bind a meet; resize for any LED.',
  category: 'SPORTS',
  render: SwimSplitsPanelWidget as any,
  vertical: 'SPORTS',
  defaultConfig: { showPaceDelta: true },
});

registerVariant({
  id: 'swim-record-line',
  widgetType: 'SWIM_RECORD_LINE',
  name: 'Swim Record Line',
  description: 'Record/pace reference bar — record type (WR/AR/NR/pool/meet), time + holder, live on/off-pace delta, and a RECORD flash when broken. Drop it above a lane grid or splits panel.',
  category: 'SPORTS',
  render: SwimRecordLineWidget as any,
  vertical: 'SPORTS',
  defaultConfig: {},
});

registerVariant({
  id: 'dive-judges-panel',
  widgetType: 'DIVE_JUDGES_PANEL',
  name: 'Dive Judges Panel',
  description: 'Row of judge scores (3/5/7) for the current dive — dropped high/low greyed out, dive code + Degree of Difficulty, computed dive score. Bind a meet; resize for any LED.',
  category: 'SPORTS',
  render: DiveJudgesPanelWidget as any,
  vertical: 'SPORTS',
  defaultConfig: {},
});

// S6 #288 (2026-07-03) — Stadium Lane flagship broadcast board. Own
// palette tile (matches the SWIM_LANE_GRID / DIVE_LEADERBOARD pattern
// above) so an operator can drop it directly onto a custom canvas, in
// addition to the "🏊 Broadcast Meet Board" full SCOREBOARD preset
// (apps/api/src/templates/sports-presets.ts).
registerVariant({
  id: 'stadium-meet-board-broadcast',
  widgetType: 'STADIUM_MEET_BOARD',
  name: 'Stadium Lane — Broadcast',
  description: 'Flagship stadium broadcast board — angled header, gold leader glow, team-color lane washes, pool-record + sponsor footer. Bind a meet; resize for any LED.',
  category: 'SPORTS',
  render: StadiumMeetBoardWidget as any,
  vertical: 'SPORTS',
  defaultConfig: { boardStyle: 'broadcast', laneCount: 8 },
});

// ════════════════════════════════════════════════════════════════════
// 2026-05-19 — Composable scoreboard ELEMENT widgets. Operator: "make
// sure everything in these scoreboards are added as widgets and can be
// added or removed." Each is an individual element (team name, logo,
// timeouts, possession, play/shot clock, down&distance, base diamond,
// penalty box, sets, riding time, leaderboard, …) the operator drops,
// positions, sizes, brands, and removes independently. All register
// under the SCOREBOARD canonical type (variant-dispatched) so they
// share the picker's Scoreboard chip; SPORTS-scoped + SPORTS category.
// ════════════════════════════════════════════════════════════════════
import {
  TeamNameWidget, TeamAbbrWidget, TeamLogoWidget, TeamRecordWidget,
  GameStatusWidget, TimeoutsWidget, PossessionArrowWidget, PossessionBallWidget,
  PlayClockWidget, ShotClockWidget, AddedTimeWidget, BonusLampWidget,
  SponsorSlotWidget, TeamFoulsWidget,
} from './sports/SportElementWidgets';
import {
  DownDistanceWidget, BallOnWidget, FlagIndicatorWidget,
  CountWidget, BaseDiamondWidget, InningHalfWidget, PitchCountWidget, PitchSpeedWidget,
  PenaltyBoxWidget, PowerPlayBadgeWidget, SetScoresWidget, ServeIndicatorWidget,
  RidingTimeWidget, WeightClassWidget, TeamScoreRunningWidget, LeaderboardWidget,
  CardCountWidget, StatPairWidget,
} from './sports/SportElementWidgets.sports';

const SPORT_ELEMENT_VARIANTS: Array<{
  id: string; name: string; description: string;
  render: ComponentType<ThemeWidgetProps>; defaultConfig?: Record<string, any>;
}> = [
  // Universal
  { id: 'sb-team-name-home', name: 'Team Name · Home', description: 'Home team name. Pick home/away in Properties.', render: TeamNameWidget as any, defaultConfig: { team: 'home', fontSize: 54, fontWeight: 800, color: '#ffffff' } },
  { id: 'sb-team-name-away', name: 'Team Name · Away', description: 'Away team name.', render: TeamNameWidget as any, defaultConfig: { team: 'away', fontSize: 54, fontWeight: 800, color: '#ffffff' } },
  { id: 'sb-team-abbr-home', name: 'Team Abbr · Home', description: '3-letter home abbreviation.', render: TeamAbbrWidget as any, defaultConfig: { team: 'home', fontSize: 64, fontWeight: 900 } },
  { id: 'sb-team-abbr-away', name: 'Team Abbr · Away', description: '3-letter away abbreviation.', render: TeamAbbrWidget as any, defaultConfig: { team: 'away', fontSize: 64, fontWeight: 900 } },
  { id: 'sb-team-logo-home', name: 'Team Logo · Home', description: 'Home team logo (or color initial disc).', render: TeamLogoWidget as any, defaultConfig: { team: 'home' } },
  { id: 'sb-team-logo-away', name: 'Team Logo · Away', description: 'Away team logo.', render: TeamLogoWidget as any, defaultConfig: { team: 'away' } },
  { id: 'sb-team-record-home', name: 'Team Record · Home', description: 'Home W-L record (set in Properties).', render: TeamRecordWidget as any, defaultConfig: { team: 'home', fontSize: 32, placeholder: '10-1' } },
  { id: 'sb-team-record-away', name: 'Team Record · Away', description: 'Away W-L record.', render: TeamRecordWidget as any, defaultConfig: { team: 'away', fontSize: 32, placeholder: '8-3' } },
  { id: 'sb-status', name: 'Game Status', description: 'LIVE / FINAL / HALFTIME pill — pulses when live.', render: GameStatusWidget as any, defaultConfig: { fontSize: 30 } },
  { id: 'sb-timeouts-home', name: 'Timeouts · Home', description: 'Home timeouts-remaining pips.', render: TimeoutsWidget as any, defaultConfig: { team: 'home', fontSize: 40 } },
  { id: 'sb-timeouts-away', name: 'Timeouts · Away', description: 'Away timeouts-remaining pips.', render: TimeoutsWidget as any, defaultConfig: { team: 'away', fontSize: 40 } },
  { id: 'sb-possession-arrow', name: 'Possession Arrow', description: 'Alternating-possession arrow (basketball/football).', render: PossessionArrowWidget as any, defaultConfig: { fontSize: 48 } },
  { id: 'sb-possession-ball-home', name: 'Possession · Home', description: 'Who-has-the-ball marker, home side (football).', render: PossessionBallWidget as any, defaultConfig: { team: 'home', fontSize: 40 } },
  { id: 'sb-possession-ball-away', name: 'Possession · Away', description: 'Who-has-the-ball marker, away side.', render: PossessionBallWidget as any, defaultConfig: { team: 'away', fontSize: 40 } },
  { id: 'sb-play-clock', name: 'Play Clock', description: 'Football 40/25s play clock (separate from game clock).', render: PlayClockWidget as any, defaultConfig: { fontSize: 88, color: '#e2e8f0' } },
  { id: 'sb-shot-clock', name: 'Shot Clock', description: 'Basketball/lacrosse/water-polo shot clock.', render: ShotClockWidget as any, defaultConfig: { fontSize: 88, color: '#e2e8f0' } },
  { id: 'sb-added-time', name: 'Added Time', description: 'Soccer stoppage/added time (+N).', render: AddedTimeWidget as any, defaultConfig: { fontSize: 40 } },
  { id: 'sb-bonus-home', name: 'Bonus Lamp · Home', description: 'Basketball BONUS / DOUBLE-BONUS lamp, home.', render: BonusLampWidget as any, defaultConfig: { team: 'home', fontSize: 24 } },
  { id: 'sb-bonus-away', name: 'Bonus Lamp · Away', description: 'Basketball BONUS / DOUBLE-BONUS lamp, away.', render: BonusLampWidget as any, defaultConfig: { team: 'away', fontSize: 24 } },
  { id: 'sb-sponsor', name: 'Sponsor Slot', description: 'Sponsor logo / text slot.', render: SponsorSlotWidget as any, defaultConfig: { fontSize: 22 } },
  { id: 'sb-fouls-home', name: 'Team Fouls · Home', description: 'Home team fouls (basketball).', render: TeamFoulsWidget as any, defaultConfig: { team: 'home', fontSize: 56 } },
  { id: 'sb-fouls-away', name: 'Team Fouls · Away', description: 'Away team fouls (basketball).', render: TeamFoulsWidget as any, defaultConfig: { team: 'away', fontSize: 56 } },
  // Football
  { id: 'sb-down-distance', name: 'Down & Distance', description: 'Football down + yards to go ("2ND & 7").', render: DownDistanceWidget as any, defaultConfig: { fontSize: 60, color: '#fbbf24' } },
  { id: 'sb-ball-on', name: 'Ball On', description: 'Football ball-on / yard line.', render: BallOnWidget as any, defaultConfig: { fontSize: 32 } },
  { id: 'sb-flag', name: 'Flag Indicator', description: 'Football penalty-flag indicator.', render: FlagIndicatorWidget as any, defaultConfig: { fontSize: 28 } },
  // Baseball / softball
  { id: 'sb-count', name: 'Count (B-S-O)', description: 'Balls-strikes count + out dots.', render: CountWidget as any, defaultConfig: { fontSize: 64 } },
  { id: 'sb-bases', name: 'Base Diamond', description: 'Lit base-runner diamond (1st/2nd/3rd).', render: BaseDiamondWidget as any, defaultConfig: {} },
  { id: 'sb-inning-half', name: 'Inning + Half', description: 'Inning number with top/bottom arrow.', render: InningHalfWidget as any, defaultConfig: { fontSize: 48 } },
  { id: 'sb-pitch-count-home', name: 'Pitch Count · Home', description: 'Home pitcher pitch count.', render: PitchCountWidget as any, defaultConfig: { team: 'home', fontSize: 48 } },
  { id: 'sb-pitch-count-away', name: 'Pitch Count · Away', description: 'Away pitcher pitch count.', render: PitchCountWidget as any, defaultConfig: { team: 'away', fontSize: 48 } },
  { id: 'sb-pitch-speed', name: 'Pitch Speed', description: 'Radar-gun pitch speed (MPH).', render: PitchSpeedWidget as any, defaultConfig: { fontSize: 64 } },
  // Hockey / lacrosse / water polo
  { id: 'sb-penalty-home', name: 'Penalty Box · Home', description: 'Home stacked penalty timers + player #.', render: PenaltyBoxWidget as any, defaultConfig: { team: 'home', fontSize: 40 } },
  { id: 'sb-penalty-away', name: 'Penalty Box · Away', description: 'Away stacked penalty timers + player #.', render: PenaltyBoxWidget as any, defaultConfig: { team: 'away', fontSize: 40 } },
  { id: 'sb-power-play', name: 'Power Play / PK', description: 'Power-play / penalty-kill man-advantage badge.', render: PowerPlayBadgeWidget as any, defaultConfig: { fontSize: 22 } },
  // Volleyball / tennis
  { id: 'sb-set-scores', name: 'Set Scores', description: 'Per-set scores (volleyball/tennis).', render: SetScoresWidget as any, defaultConfig: { fontSize: 44 } },
  { id: 'sb-serve', name: 'Serve Indicator', description: 'Which team is serving.', render: ServeIndicatorWidget as any, defaultConfig: { team: 'home', fontSize: 40 } },
  // Wrestling
  { id: 'sb-riding-time', name: 'Riding Time', description: 'Wrestling riding-time clock (≥1:00 = point).', render: RidingTimeWidget as any, defaultConfig: { fontSize: 56 } },
  { id: 'sb-weight-class', name: 'Weight Class', description: 'Wrestling weight class.', render: WeightClassWidget as any, defaultConfig: { fontSize: 36 } },
  { id: 'sb-team-score-home', name: 'Dual Score · Home', description: 'Running dual-meet team score, home (wrestling/track).', render: TeamScoreRunningWidget as any, defaultConfig: { team: 'home', fontSize: 64 } },
  { id: 'sb-team-score-away', name: 'Dual Score · Away', description: 'Running dual-meet team score, away.', render: TeamScoreRunningWidget as any, defaultConfig: { team: 'away', fontSize: 64 } },
  // Soccer
  { id: 'sb-cards-home', name: 'Cards · Home', description: 'Yellow + red card counts, home (soccer).', render: CardCountWidget as any, defaultConfig: { team: 'home', fontSize: 40 } },
  { id: 'sb-cards-away', name: 'Cards · Away', description: 'Yellow + red card counts, away (soccer).', render: CardCountWidget as any, defaultConfig: { team: 'away', fontSize: 40 } },
  { id: 'sb-stat-pair', name: 'Stat (labelled)', description: 'Generic labelled stat — bind shots / corners / possession% / etc. in Properties.', render: StatPairWidget as any, defaultConfig: { statKey: 'shots', label: 'SHOTS', fontSize: 48 } },
  // Track / swim
  { id: 'sb-leaderboard', name: 'Leaderboard', description: 'Place / lane / name / time rows (track, swim).', render: LeaderboardWidget as any, defaultConfig: { fontSize: 28 } },
];

for (const v of SPORT_ELEMENT_VARIANTS) {
  registerVariant({
    id: v.id,
    widgetType: 'SCOREBOARD',
    name: v.name,
    description: v.description,
    category: 'SPORTS',
    vertical: 'SPORTS',
    render: v.render,
    defaultConfig: { align: 'center', ...(v.defaultConfig || {}) },
  });
}

// 2026-05-19 — live RIBBON-board + SCOREBUG composite widgets (the
// surfaces the operator said were missing entirely). One-drop, live-
// bound, resize for any ribbon chain / OBS overlay.
import { RibbonScoreboardWidget, ScorebugWidget } from './sports/RibbonScorebugWidgets';

registerVariant({
  id: 'ribbon-main',
  widgetType: 'SCOREBOARD',
  name: 'Ribbon Board (live)',
  description: 'Perimeter ribbon: live score-follow anchor + rotating sponsor/message reel. Resize for any panel chain (1920×192 → 11520×192).',
  category: 'SPORTS',
  vertical: 'SPORTS',
  render: RibbonScoreboardWidget as any,
  defaultConfig: {},
});
registerVariant({
  id: 'scorebug-main',
  widgetType: 'SCOREBOARD',
  name: 'Scorebug (broadcast)',
  description: 'Compact transparent broadcast overlay — team blocks + clock + period + per-sport situational line. Drop into OBS as a browser source.',
  category: 'SPORTS',
  vertical: 'SPORTS',
  render: ScorebugWidget as any,
  defaultConfig: {},
});

// ════════════════════════════════════════════════════════════════════════
// 2026-05-28 — MULTI-VERTICAL PALETTE TILES (P1-2 fix).
//
// Before this block: of 341 registerVariant() calls, 324 were K-12 and
// only 17 SPORTS — so a QSR / RESTAURANT / BAR / RETAIL / FASHION / GYM
// operator opening the builder palette (VariantPicker) saw ONLY the
// universal subset. The restaurant / bar / retail / fitness widget
// COMPONENTS already existed and rendered (WidgetRenderer.tsx switch
// cases) and were already editable (PropertiesPanel.tsx switch cases),
// but they were never registered as palette VARIANTS — so the operator
// could only start from a preset, never drag a fresh Menu Board / Tap
// List / Price Callout onto a canvas. (See VariantPicker
// variantVisibleForVertical().)
//
// Every tile below was selected by the strict intersection of (a) a
// dedicated WidgetRenderer case that returns a real component (NOT the
// "Pick a style" placeholder) AND (b) a PropertiesPanel editor case —
// so each one renders on the canvas AND is editable after dropping.
//
// Cross-vertical tagging:
//   • RESTAURANT_* → verticals:['QSR','RESTAURANT'] — quick-service AND
//     full-service both get the food-service widget set (audit fix #3:
//     the QSR/RESTAURANT split was starving full-service tenants).
//   • RETAIL_*     → verticals:['RETAIL','FASHION'] — FASHION ⊂ RETAIL,
//     so a boutique gets the storefront widget set too (audit fix #9).
//   • BAR_*        → vertical:'BAR'.
//   • FITNESS_*    → vertical:'GYM'.
//
// NOT covered here (deliberately): CORPORATE / HEALTHCARE / HOSPITALITY /
// WORSHIP have NO dedicated renderable+editable widget components — their
// canonical widget types render the "Pick a style" placeholder in
// WidgetRenderer (no registered variants). Registering tiles for them
// would surface non-rendering / non-editable tiles, which violates the
// "must render + must be editable" rule. They need real widget
// components built first (tracked as separate work).
//
// `render` is set to the actual widget component (same pattern as the
// SPORTS tiles above) so the picker thumbnail shows the real widget with
// its built-in demo/fallback content; `defaultConfig: {}` lets each
// widget fall back to its own sample data until the operator edits it in
// the Properties panel. `as any` on widgetType + render matches the
// SPORTS registrations — these vertical widget types live as strings in
// the WidgetRenderer / PropertiesPanel switches, not in the WidgetType
// union.
// ════════════════════════════════════════════════════════════════════════

// ── RESTAURANT / QSR (verticals: QSR + RESTAURANT) ──
import { MenuBoardWidget } from './restaurant/MenuBoardWidget';
import { ComboCarouselWidget } from './restaurant/ComboCarouselWidget';
import { WaitTimeWidget } from './restaurant/WaitTimeWidget';
import { LoyaltyTickerWidget } from './restaurant/LoyaltyTickerWidget';
import { SpecialsCalloutWidget } from './restaurant/SpecialsCalloutWidget';
import { AllergyLegendWidget } from './restaurant/AllergyLegendWidget';

const FOOD_SERVICE_VERTICALS = ['QSR', 'RESTAURANT'];

registerVariant({
  id: 'restaurant-menu-board',
  widgetType: 'RESTAURANT_MENU_BOARD' as any,
  name: 'Menu Board',
  description: 'Multi-column counter-service menu. Add items, prices, and category columns in Properties. Pulls from POS when connected.',
  category: 'MODERN',
  render: MenuBoardWidget as any,
  verticals: FOOD_SERVICE_VERTICALS,
  defaultConfig: {},
});
registerVariant({
  id: 'restaurant-combo-carousel',
  widgetType: 'RESTAURANT_COMBO_CAROUSEL' as any,
  name: 'Combo Carousel',
  description: 'Auto-rotating combo / value-meal carousel. Add combos + photos in Properties.',
  category: 'MODERN',
  render: ComboCarouselWidget as any,
  verticals: FOOD_SERVICE_VERTICALS,
  defaultConfig: {},
});
registerVariant({
  id: 'restaurant-wait-time',
  widgetType: 'RESTAURANT_WAIT_TIME' as any,
  name: 'Wait Time',
  description: 'Counter-service / dine-in queue display. Set current wait + label in Properties.',
  category: 'MODERN',
  render: WaitTimeWidget as any,
  verticals: FOOD_SERVICE_VERTICALS,
  defaultConfig: {},
});
registerVariant({
  id: 'restaurant-loyalty-ticker',
  widgetType: 'RESTAURANT_LOYALTY_TICKER' as any,
  name: 'Loyalty Ticker',
  description: 'Rotating loyalty / rewards messaging strip. Edit the messages in Properties.',
  category: 'MODERN',
  render: LoyaltyTickerWidget as any,
  verticals: FOOD_SERVICE_VERTICALS,
  defaultConfig: {},
});
registerVariant({
  id: 'restaurant-specials-callout',
  widgetType: 'RESTAURANT_SPECIALS_CALLOUT' as any,
  name: 'Specials Callout',
  description: '"TODAY ONLY" big-type promo card. Set the headline, price, and accent color in Properties.',
  category: 'MODERN',
  render: SpecialsCalloutWidget as any,
  verticals: FOOD_SERVICE_VERTICALS,
  defaultConfig: {},
});
registerVariant({
  id: 'restaurant-allergy-legend',
  widgetType: 'RESTAURANT_ALLERGY_LEGEND' as any,
  name: 'Allergy Legend',
  description: 'Small icon legend explaining the dietary chips on your menu (GF, V, nut-free…). Toggle which icons show in Properties.',
  category: 'MINIMAL',
  render: AllergyLegendWidget as any,
  verticals: FOOD_SERVICE_VERTICALS,
  defaultConfig: {},
});

// ── BAR / nightlife (vertical: BAR) ──
import { TapListWidget } from './bar/TapListWidget';
import { CocktailMenuWidget } from './bar/CocktailMenuWidget';
import { HappyHourCountdownWidget } from './bar/HappyHourCountdownWidget';
import { GameDayScheduleWidget } from './bar/GameDayScheduleWidget';
import { EventTonightWidget } from './bar/EventTonightWidget';
import { TriviaScoreboardWidget } from './bar/TriviaScoreboardWidget';

registerVariant({
  id: 'bar-tap-list',
  widgetType: 'BAR_TAP_LIST' as any,
  name: 'Tap List',
  description: 'Beer-on-tap menu for a taproom display. Add brews, ABV, and prices in Properties.',
  category: 'MODERN',
  render: TapListWidget as any,
  vertical: 'BAR',
  defaultConfig: {},
});
registerVariant({
  id: 'bar-cocktail-menu',
  widgetType: 'BAR_COCKTAIL_MENU' as any,
  name: 'Cocktail Menu',
  description: 'Chalkboard-style cocktail list. Add drinks, ingredients, and prices in Properties.',
  category: 'DARK',
  render: CocktailMenuWidget as any,
  vertical: 'BAR',
  defaultConfig: {},
});
registerVariant({
  id: 'bar-happy-hour-countdown',
  widgetType: 'BAR_HAPPY_HOUR_COUNTDOWN' as any,
  name: 'Happy Hour Countdown',
  description: 'Full-bleed countdown to happy-hour end. Set the end time + deal copy in Properties.',
  category: 'BOLD',
  render: HappyHourCountdownWidget as any,
  vertical: 'BAR',
  defaultConfig: {},
});
registerVariant({
  id: 'bar-game-day-schedule',
  widgetType: 'BAR_GAME_DAY_SCHEDULE' as any,
  name: 'Game Day Schedule',
  description: "Today's sports schedule for a sports bar. Add games, channels, and times in Properties.",
  category: 'BROADCAST',
  render: GameDayScheduleWidget as any,
  vertical: 'BAR',
  defaultConfig: {},
});
registerVariant({
  id: 'bar-event-tonight',
  widgetType: 'BAR_EVENT_TONIGHT' as any,
  name: 'Event Tonight',
  description: "Band / show / DJ poster for a live night. Set the act, time, and cover in Properties.",
  category: 'BOLD',
  render: EventTonightWidget as any,
  vertical: 'BAR',
  defaultConfig: {},
});
registerVariant({
  id: 'bar-trivia-scoreboard',
  widgetType: 'BAR_TRIVIA_SCOREBOARD' as any,
  name: 'Trivia Scoreboard',
  description: 'Live trivia-night leaderboard. Add teams + scores in Properties.',
  category: 'MODERN',
  render: TriviaScoreboardWidget as any,
  vertical: 'BAR',
  defaultConfig: {},
});

// ── RETAIL / FASHION (verticals: RETAIL + FASHION) ──
import { RetailProductGridWidget } from './retail/RetailProductGridWidget';
import { RetailPriceCalloutWidget } from './retail/RetailPriceCalloutWidget';
import { RetailSaleCountdownWidget } from './retail/RetailSaleCountdownWidget';
import { RetailWayfindingMapWidget } from './retail/RetailWayfindingMapWidget';
import { RetailLoyaltyQRWidget } from './retail/RetailLoyaltyQRWidget';
import { RetailLookbookCarouselWidget } from './retail/RetailLookbookCarouselWidget';
import { RetailStorefrontHoursWidget } from './retail/RetailStorefrontHoursWidget';

const RETAIL_VERTICALS = ['RETAIL', 'FASHION'];

registerVariant({
  id: 'retail-product-grid',
  widgetType: 'RETAIL_PRODUCT_GRID' as any,
  name: 'Product Grid',
  description: 'N-column product / lookbook grid. Add products, photos, and prices in Properties.',
  category: 'MODERN',
  render: RetailProductGridWidget as any,
  verticals: RETAIL_VERTICALS,
  defaultConfig: {},
});
registerVariant({
  id: 'retail-price-callout',
  widgetType: 'RETAIL_PRICE_CALLOUT' as any,
  name: 'Price Callout',
  description: 'Single-product hero with a big price callout. Set product, photo, and price in Properties.',
  category: 'BOLD',
  render: RetailPriceCalloutWidget as any,
  verticals: RETAIL_VERTICALS,
  defaultConfig: {},
});
registerVariant({
  id: 'retail-sale-countdown',
  widgetType: 'RETAIL_SALE_COUNTDOWN' as any,
  name: 'Sale Countdown',
  description: 'Big "Sale ends in 2d 14h" countdown. Set the end date + headline in Properties.',
  category: 'BOLD',
  render: RetailSaleCountdownWidget as any,
  verticals: RETAIL_VERTICALS,
  defaultConfig: {},
});
registerVariant({
  id: 'retail-wayfinding-map',
  widgetType: 'RETAIL_WAYFINDING_MAP' as any,
  name: 'Store Map',
  description: 'Simple store map with department callouts. Edit departments + layout in Properties.',
  category: 'MINIMAL',
  render: RetailWayfindingMapWidget as any,
  verticals: RETAIL_VERTICALS,
  defaultConfig: {},
});
registerVariant({
  id: 'retail-loyalty-qr',
  widgetType: 'RETAIL_LOYALTY_QR' as any,
  name: 'Loyalty QR',
  description: '"Scan to join" loyalty signup callout. Set the QR target + copy in Properties.',
  category: 'MINIMAL',
  render: RetailLoyaltyQRWidget as any,
  verticals: RETAIL_VERTICALS,
  defaultConfig: {},
});
registerVariant({
  id: 'retail-lookbook-carousel',
  widgetType: 'RETAIL_LOOKBOOK_CAROUSEL' as any,
  name: 'Lookbook Carousel',
  description: 'Auto-rotating fashion-style hero carousel. Add slides + photos in Properties.',
  category: 'MODERN',
  render: RetailLookbookCarouselWidget as any,
  verticals: RETAIL_VERTICALS,
  defaultConfig: {},
});
registerVariant({
  id: 'retail-storefront-hours',
  widgetType: 'RETAIL_STOREFRONT_HOURS' as any,
  name: 'Store Hours',
  description: 'Store-hours card with a live open/closed indicator. Set weekly hours in Properties.',
  category: 'MINIMAL',
  render: RetailStorefrontHoursWidget as any,
  verticals: RETAIL_VERTICALS,
  defaultConfig: {},
});

// ── GYM / fitness (vertical: GYM) ──
import { FitnessClassScheduleWidget } from './fitness/FitnessClassScheduleWidget';
import { FitnessMusicPlayerWidget } from './fitness/FitnessMusicPlayerWidget';
import { FitnessLiveTVWidget } from './fitness/FitnessLiveTVWidget';
import { FitnessAdBannerWidget } from './fitness/FitnessAdBannerWidget';
import { FitnessTrainingVideoWidget } from './fitness/FitnessTrainingVideoWidget';
import { FitnessWorkoutTimerWidget } from './fitness/FitnessWorkoutTimerWidget';
import { FitnessMotivationalQuoteWidget } from './fitness/FitnessMotivationalQuoteWidget';
import { FitnessAppLibraryWidget } from './fitness/FitnessAppLibraryWidget';
import { FitnessStickLauncherWidget } from './fitness/FitnessStickLauncherWidget';

registerVariant({
  id: 'fitness-class-schedule',
  widgetType: 'FITNESS_CLASS_SCHEDULE' as any,
  name: 'Class Schedule',
  description: "Today's class schedule on a gym wall display. Add classes, times, and instructors in Properties.",
  category: 'MODERN',
  render: FitnessClassScheduleWidget as any,
  vertical: 'GYM',
  defaultConfig: {},
});
registerVariant({
  id: 'fitness-music-player',
  widgetType: 'FITNESS_MUSIC_PLAYER' as any,
  name: 'Now Playing',
  description: '"Now playing" display for a gym zone. Connect a music source or set static track info in Properties.',
  category: 'DARK',
  render: FitnessMusicPlayerWidget as any,
  vertical: 'GYM',
  defaultConfig: {},
});
registerVariant({
  id: 'fitness-live-tv',
  widgetType: 'FITNESS_LIVE_TV' as any,
  name: 'Live TV',
  description: 'Live streaming video in a gym zone. Pick a streaming channel in Properties.',
  category: 'BROADCAST',
  render: FitnessLiveTVWidget as any,
  vertical: 'GYM',
  defaultConfig: {},
});
registerVariant({
  id: 'fitness-ad-banner',
  widgetType: 'FITNESS_AD_BANNER' as any,
  name: 'Ad Banner',
  description: 'Rotating ad-creative display for a gym. Add your own creatives + interval in Properties.',
  category: 'MODERN',
  render: FitnessAdBannerWidget as any,
  vertical: 'GYM',
  defaultConfig: {},
});
registerVariant({
  id: 'fitness-training-video',
  widgetType: 'FITNESS_TRAINING_VIDEO' as any,
  name: 'Training Video',
  description: 'Silent, looping equipment-tutorial video. Pick the video in Properties.',
  category: 'MODERN',
  render: FitnessTrainingVideoWidget as any,
  vertical: 'GYM',
  defaultConfig: {},
});
registerVariant({
  id: 'fitness-workout-timer',
  widgetType: 'FITNESS_WORKOUT_TIMER' as any,
  name: 'Workout Timer',
  description: 'HIIT / Tabata / interval timer for a class floor. Set work/rest intervals + rounds in Properties.',
  category: 'BOLD',
  render: FitnessWorkoutTimerWidget as any,
  vertical: 'GYM',
  defaultConfig: {},
});
registerVariant({
  id: 'fitness-motivational-quote',
  widgetType: 'FITNESS_MOTIVATIONAL_QUOTE' as any,
  name: 'Motivational Quote',
  description: 'Rotating gym-wall motivational quotes. Edit the quote list in Properties.',
  category: 'BOLD',
  render: FitnessMotivationalQuoteWidget as any,
  vertical: 'GYM',
  defaultConfig: {},
});
registerVariant({
  id: 'fitness-app-library',
  widgetType: 'FITNESS_APP_LIBRARY' as any,
  name: 'App Library',
  description: 'Smart-TV-style app-picker grid for gym signage. Choose which app tiles show in Properties.',
  category: 'DARK',
  render: FitnessAppLibraryWidget as any,
  vertical: 'GYM',
  defaultConfig: {},
});
registerVariant({
  id: 'fitness-stick-launcher',
  widgetType: 'FITNESS_STICK_LAUNCHER' as any,
  name: 'Streaming Stick Status',
  description: 'Remote-control / streaming-stick status display for a gym TV. Set the device label + state in Properties.',
  category: 'DARK',
  render: FitnessStickLauncherWidget as any,
  vertical: 'GYM',
  defaultConfig: {},
});
