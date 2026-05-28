"use client";
/**
 * v2 widget pack — central registry.
 * ────────────────────────────────────
 * Every v2 widget is registered here with:
 *   - widget type string (e.g. 'CLOCK_NEON')        — what gets stored on a zone's `type`
 *   - category                                       — palette grouping
 *   - label / description                            — palette UI
 *   - level                                          — elementary / middle / high / universal / admin
 *   - Component                                      — the React component
 *   - defaults                                       — seed config when dragged onto canvas
 *
 * The downstream integrations:
 *   - apps/web/src/components/template-builder/constants.ts → WIDGET_GROUPS picks up these labels
 *   - apps/web/src/components/widgets/WidgetRenderer.tsx    → switch dispatches to the Component
 *
 * Both files import from this single source so the catalog stays in sync.
 */

import type { ComponentType } from 'react';
import {
  Clock, Megaphone, Newspaper, CalendarDays, Users, Timer, Shield,
  ArrowRight, Cloud, Camera, FileText, Image as ImageIcon,
  UtensilsCrossed, Bell,
  // Celebration widgets (EDU CMS-10/12). `RefreshCw` — the shipped
  // registry imported `Refresh`, which does not exist in lucide-react.
  Zap, TrendingUp, Crown, Star, Repeat2, CircleEqual, Flag, Trophy,
  Hand, Goal, Hammer, AlertOctagon, RefreshCw, Target,
  MousePointerClick, Award, Music, Sparkles, Crosshair,
  // Industry widget packs (EDU CMS-11/12) — healthcare, corporate,
  // hospitality, worship, charts.
  Hash, UserCog, BookOpen, CalendarClock, ShieldCheck, CalendarRange,
  UserCheck, DoorOpen, PartyPopper, BarChart3, PieChart, LineChart,
  ListChecks, Calculator, BedDouble, Calendar, MapPin, Clock4, Key,
  Cross, HandCoins, HeartHandshake,
  // Live scoreboard widget.
  Tv,
  // VenueOS Sports Venue + universal packs (EDU CMS-6/7 batches) —
  // sports-venue surfaces, backgrounds, live-data feeds, touch
  // engagement, and transit boards.
  ScrollText, GitCompareArrows, ListOrdered, Volume2, Gift,
  Navigation, Image as ImageIcon2, Layers, Sparkle, CircleDot,
  Grid3x3, Spline, Waves, Building2, Wind, Globe, DollarSign,
  TrafficCone, UserPlus, Languages, Accessibility, SmilePlus,
  Lightbulb, Disc3, Search, Map as MapIcon, HeartPulse, PlaneTakeoff,
  Plane, TrainFront, SquareParking, Activity, Coins,
  // Retail pack (EDU CMS — 2026-05-19).
  Percent, Tag, ShoppingBag, QrCode, Store,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import * as Clocks       from './ClockWidgets';
import * as Headlines    from './HeadlineWidgets';
import * as Announce     from './AnnouncementWidgets';
import * as Calendars    from './CalendarWidgets';
import * as Staff        from './StaffWidgets';
import * as Countdowns   from './CountdownWidgets';
import * as Logos        from './LogoWidgets';
import * as Tickers      from './TickerWidgets';
import * as Weather      from './WeatherWidgets';
import * as Photos       from './PhotoWidgets';
import * as RichText     from './RichTextWidgets';
import * as Images       from './ImageWidgets';
import * as Lunch        from './LunchMenuWidgets';
import * as BellSched    from './BellScheduleWidgets';

// Celebration widgets — EDU CMS-10 batch. These size their content off
// a pixel `height` prop; the variant render path doesn't pass zone
// dimensions, so each Component is wrapped in `withMeasuredHeight`
// (below) which measures the real rendered height and feeds it in.
import {
  CelBaseballStrikeoutWidget, CelBaseballHomeRunWidget, CelBaseballGrandSlamWidget,
  CelBaseballNoHitterWidget, CelBaseballStolenBaseWidget, CelBaseballDoublePlayWidget,
  CelBaseballTriplePlayWidget, CelBaseballWalkOffWidget,
} from './CelebrationsBaseballWidgets';
import {
  CelFootballTouchdownWidget, CelFootballPickSixWidget, CelFootballFieldGoalWidget,
  CelFootballSackWidget, CelFootballFirstDownWidget, CelFootballInterceptionWidget,
  CelFootballSafetyWidget, CelFootballFumbleRecoveryWidget,
} from './CelebrationsFootballWidgets';
import {
  CelBasketballThreeWidget, CelBasketballDunkWidget, CelBasketballBuzzerWidget,
  CelBasketballBlockWidget, CelBasketballStealWidget, CelBasketballAlleyOopWidget,
  CelBasketballAndOneWidget, CelBasketballTripleDoubleWidget,
} from './CelebrationsBasketballWidgets';
import { withMeasuredHeight } from './_shared/measured';

// EDU CMS-12 batch — hockey + soccer celebrations and four industry
// packs (healthcare, corporate, hospitality, worship) + universal charts.
import {
  CelHockeyGoalWidget, CelHockeyHatTrickWidget, CelHockeyPowerPlayWidget,
  CelHockeyShortyWidget, CelHockeyBigSaveWidget, CelHockeyEmptyNetWidget,
} from './CelebrationsHockeyWidgets';
import {
  CelSoccerGoalWidget, CelSoccerHatTrickWidget, CelSoccerGolazoWidget,
  CelSoccerRedCardWidget, CelSoccerPenaltySaveWidget, CelSoccerFreeKickWidget,
} from './CelebrationsSoccerWidgets';
import {
  NowServingWidget, WaitTimesBoardWidget, ProviderSpotlightWidget,
  VisitorHoursWidget, CodeBannerWidget, PatientEducationWidget,
  InsuranceAcceptedWidget,
} from './HealthcareWidgets';
import {
  RoomScheduleWidget, VisitorWelcomeWidget, KpiTileWidget,
  SalesLeaderboardWidget, DoorSignWidget, OkrTrackerWidget,
  TeamAnniversariesWidget,
} from './CorporateWidgets';
import {
  HotelWelcomeWidget, DailyEventsBoardWidget, AmenityHoursWidget,
  CheckInOutTimesWidget, LocalAttractionsWidget,
} from './HospitalityWidgets';
import {
  ServiceTimesWidget, SermonTitleCardWidget, HymnBoardWidget,
  GivingThermometerWidget, ScriptureVerseWidget, PrayerRequestQrWidget,
} from './WorshipWidgets';
import {
  BarChartWidget, DonutGaugeWidget, LineChartWidget,
  ProgressListWidget, CountUpStatsWidget,
} from './ChartsWidgets';
// Retail pack (clean / minimal, approved 2026-05-19) — RETAIL-scoped.
import {
  SaleSealWidget, PriceTagWidget, ProductSpotlightWidget,
  FlashCountdownWidget, StoreHoursWidget, LoyaltyQrWidget,
  NewArrivalsWidget, PromoStripWidget,
} from './RetailWidgets';

// Live scoreboard — one widget, every sport. Polls /sports/board/:id
// and renders driven by the game's SportDefinition. Three tiers.
import { SportsScoreboardWidget } from './SportsScoreboardWidgets';

// VenueOS Sports Venue (EDU CMS-6) — jumbotron / ribbon / concourse
// surfaces. SPORTS-vertical scoped.
import {
  StadiumScoreboardWidget, RibbonTickerWidget, RibbonSponsorWidget,
  RibbonFanShoutoutWidget, PlayerCardWidget, StartingLineupWidget,
  StatComparisonWidget, OutOfTownScoresWidget, KissCamWidget,
  NoiseMeterWidget, InGamePromoWidget, SponsorTakeoverWidget,
  HomeScheduleWidget, StandingsBoardWidget, ConcessionWaitsWidget,
  GateWayfindingWidget, GoalCelebrationWidget,
} from './SportsVenueWidgets';
// VenueOS celebration ribbons — remaining sports + retro/neon variants.
import {
  BbHomeRunRetroWidget, BbHomeRunNeonWidget, BbStrikeoutNeonWidget,
  FbTouchdownNeonWidget, FbTouchdownRetroWidget, BkThreeNeonWidget,
  BkThreeRetroWidget, HkGoalNeonWidget, HkGoalRetroWidget,
  ScGoalRetroWidget, ScGoalNeonWidget, TnAceWidget, TnAceNeonWidget,
  TnBreakPointWidget, TnMatchPointWidget, TnWinnerWidget, LxGoalWidget,
  LxBehindTheBackWidget, LxBigSaveWidget, LxFaceoffWidget, WrPinWidget,
  WrTakedownWidget, WrNearFallWidget, WrTechFallWidget, GfAceWidget,
  GfEagleWidget, GfBirdieWidget, BxKnockoutWidget, BxTkoWidget,
  BxKnockdownWidget, BxEndOfRoundWidget, TrWorldRecordWidget,
  TrFinishWidget, TrPersonalBestWidget, SwRecordWidget, SwFinishWidget,
  SwSplitWidget,
  // T1-5: status-transition cinematics — halftime break, final result,
  // and horn/period-end burst.
  CelHalftimeWidget, CelFinalWidget, CelHornWidget,
} from './CelebrationsOtherSportsWidgets';
// VenueOS universal — drop-in template backgrounds.
import {
  BgIndigoMidnight, BgAurora, BgGoldenHour, BgForestDeep, BgPeachCream,
  BgOceanBlue, BgMeshViolet, BgMeshOcean, BgMeshDesert, BgDiamondTile,
  BgDotsGrid, BgTopoLines, BgAnimatedFlow, BgPhotoLobbyWarm,
  BgPhotoCampus, BgPhotoHospital, BgPhotoRetail,
} from './BackgroundsWidgets';
// VenueOS universal — live data feeds (markets, news, weather, transit).
// `SportsScoreboardWidget` here is the data-feed scoreboard, distinct
// from the engine-driven one above — aliased to avoid the name clash.
import {
  SportsScoreboardWidget as LiveSportsScoreboardWidget,
  StockTickerWidget, CryptoTickerWidget, NewsHeadlinesWidget,
  AirQualityWidget, WorldClocksWidget, FxRatesWidget, TrafficCamWidget,
} from './LiveDataWidgets';
// VenueOS universal — touch & engagement surfaces.
import {
  PhotoBoothWidget, SignInPadWidget, LanguagePickerWidget,
  AccessibilityTrayWidget, NpsSmileyWidget, TriviaGameWidget,
  SpinToWinWidget, DirectorySearchWidget, WayfindingFloorMapWidget,
  DonationThermometerWidget,
} from './TouchEngageWidgets';
// VenueOS universal — transit / airport boards.
import {
  DeparturesBoardWidget, FlightStatusHeroWidget, TransitDeparturesWidget,
  ParkingAvailabilityWidget,
} from './TransitWidgets';

import type { WidgetMeta, SchoolLevel } from './_shared/types';

export interface RegisteredWidget extends WidgetMeta {
  Component: ComponentType<any>;
  icon: LucideIcon;
}

const W = (
  type: string, category: string, label: string, desc: string,
  level: SchoolLevel, icon: LucideIcon, Component: ComponentType<any>,
  defaults: Record<string, unknown> = {}
): RegisteredWidget => ({ type, category, label, desc, level, icon, Component, defaults });

/** Stamp a SINGLE business-line vertical onto a batch of widgets.
 *  Applied at the ALL_V2_WIDGETS assembly point so the per-pack arrays
 *  stay clean and a widget appears only in its own vertical's palette. */
const withVertical = (vertical: string, widgets: RegisteredWidget[]): RegisteredWidget[] =>
  widgets.map((w) => ({ ...w, vertical }));

/** Stamp MULTIPLE business-line verticals onto a batch — for cross-over
 *  widgets that belong to several lines but not all. e.g. a Lunch Menu
 *  fits K-12, QSR, Restaurant, Hospitality, Bar, and a Corporate
 *  cafeteria — but not Healthcare or Sports. The widget then appears in
 *  EACH listed vertical's palette and nowhere else. Takes precedence
 *  over `vertical` in the picker filter. */
const withVerticals = (verticals: string[], widgets: RegisteredWidget[]): RegisteredWidget[] =>
  widgets.map((w) => ({ ...w, verticals }));

// 2026-05-02 integration note — the original drop's registry imported
// component names that didn't match the exports in the widget files
// (e.g. `ClockNeonWidget` vs the actual `ClockNeonPulseWidget`). Each
// row below has been audited against the file header in the corresponding
// *Widgets.tsx so the level + label match the design intent and the
// import resolves. Levels: high/middle/elementary/universal/admin per
// the file headers.

/* ─── CLOCKS ─────────────────────────────────────────────────────────── */
export const CLOCK_WIDGETS: RegisteredWidget[] = [
  W('CLOCK_NEON',     'Clocks', 'Neon Pulse Clock',     'Glowing arcade-marquee digits with pulse',     'high',       Clock, Clocks.ClockNeonPulseWidget,    { showSeconds: true }),
  W('CLOCK_PAPER',    'Clocks', 'Locker Flip Clock',    'Middle-school split-flap board',                'middle',     Clock, Clocks.ClockLockerFlipWidget),
  W('CLOCK_CRAYON',   'Clocks', 'Recess Block Clock',   'Chunky color-block digits, recess-bright',     'elementary', Clock, Clocks.ClockRecessBlocksWidget),
  W('CLOCK_GLASS',    'Clocks', 'Glass Minimal Clock',  'Frosted glass + thin sans, modern',             'universal',  Clock, Clocks.ClockGlassMinimalWidget),
  W('CLOCK_OPS',      'Clocks', 'Ops Terminal Clock',   'Phosphor terminal with system stats',           'admin',      Clock, Clocks.ClockOpsTerminalWidget),
];

/* ─── HEADLINES ──────────────────────────────────────────────────────── */
export const HEADLINE_WIDGETS: RegisteredWidget[] = [
  W('HEADLINE_NEON',     'Headlines', 'Neon Marquee Headline','Big glow letters + eyebrow chip',          'high',       Newspaper, Headlines.HeadlineNeonMarqueeWidget),
  W('HEADLINE_PAPER',    'Headlines', 'Paper Press',          'Newspaper masthead with drop-cap',         'middle',     Newspaper, Headlines.HeadlinePaperPressWidget),
  W('HEADLINE_CRAYON',   'Headlines', 'Crayon Banner',        'Wavy crayon banner headline',              'elementary', Newspaper, Headlines.HeadlineCrayonBannerWidget),
  W('HEADLINE_GLASS',    'Headlines', 'Slab Editorial',       'Big-type minimal editorial',                'universal',  Newspaper, Headlines.HeadlineSlabHeroWidget),
  W('HEADLINE_OPS',      'Headlines', 'Briefing Memo',        'Console-style memo headline',               'admin',      Newspaper, Headlines.HeadlineBriefMemoWidget),
];

/* ─── ANNOUNCEMENTS ──────────────────────────────────────────────────── */
export const ANNOUNCEMENT_WIDGETS: RegisteredWidget[] = [
  W('ANN_NEON',     'Announcements', 'Neon Alert',          'High-energy glowing alert',                  'high',       Megaphone, Announce.AnnouncementNeonAlertWidget),
  W('ANN_PAPER',    'Announcements', 'Bulletin Pin',        'Cork-board pinned bulletin notice',          'middle',     Megaphone, Announce.AnnouncementBulletinPinWidget),
  W('ANN_CRAYON',   'Announcements', 'Rainbow Bubble',      'Cheerful kid-friendly speech bubble',        'elementary', Megaphone, Announce.AnnouncementRainbowBubbleWidget),
  W('ANN_GLASS',    'Announcements', 'Glass Toast',         'Frosted glass toast card w/ accent',         'universal',  Megaphone, Announce.AnnouncementGlassToastWidget),
  W('ANN_OPS',      'Announcements', 'Ops Dispatch',        'Pager-style dispatch alert',                 'admin',      Megaphone, Announce.AnnouncementOpsDispatchWidget),
];

/* ─── CALENDARS ──────────────────────────────────────────────────────── */
export const CALENDAR_WIDGETS: RegisteredWidget[] = [
  W('CAL_NEON',     'Calendars', 'Neon Grid',         'Marquee schedule with TODAY chip',         'high',       CalendarDays, Calendars.CalendarNeonGridWidget),
  W('CAL_PAPER',    'Calendars', 'Paper Agenda',      'Hand-stamped planner with bullet items',   'middle',     CalendarDays, Calendars.CalendarPaperAgendaWidget),
  W('CAL_CRAYON',   'Calendars', 'Crayon Days',       'Big colorful day cards',                    'elementary', CalendarDays, Calendars.CalendarCrayonDaysWidget),
  W('CAL_GLASS',    'Calendars', 'Glass Timeline',    'Modern minimalist timeline',                'universal',  CalendarDays, Calendars.CalendarGlassTimelineWidget),
  W('CAL_OPS',      'Calendars', 'Ops Queue',         'Job-queue style listing',                   'admin',      CalendarDays, Calendars.CalendarOpsQueueWidget),
];

/* ─── STAFF SPOTLIGHT ────────────────────────────────────────────────── */
export const STAFF_WIDGETS: RegisteredWidget[] = [
  W('STAFF_NEON',     'Staff', 'Neon Trading Card',   'Holographic card w/ portrait',             'high',       Users, Staff.StaffNeonCardWidget),
  W('STAFF_PAPER',    'Staff', 'Yearbook Portrait',   'Yearbook-style portrait + bio',            'middle',     Users, Staff.StaffYearbookPortraitWidget),
  W('STAFF_CRAYON',   'Staff', 'Crayon Hero',         'Big cute "Meet your teacher!"',            'elementary', Users, Staff.StaffCrayonHeroWidget),
  W('STAFF_GLASS',    'Staff', 'Glass Profile Card',  'Premium product-page profile',              'universal',  Users, Staff.StaffGlassProfileWidget),
  W('STAFF_OPS',      'Staff', 'Ops Personnel Badge', 'Sysadmin user-record badge',                'admin',      Users, Staff.StaffOpsBadgeWidget),
];

/* ─── COUNTDOWNS ─────────────────────────────────────────────────────── */
export const COUNTDOWN_WIDGETS: RegisteredWidget[] = [
  W('CD_NEON',     'Countdowns', 'Neon Digits',         'Vegas-marquee countdown digits',         'high',       Timer, Countdowns.CountdownNeonDigitsWidget),
  W('CD_PAPER',    'Countdowns', 'Paper Flip',          'Daily desk-calendar flip',               'middle',     Timer, Countdowns.CountdownPaperFlipWidget),
  W('CD_CRAYON',   'Countdowns', 'Crayon Blocks',       '"X sleeps until!" crayon blocks',        'elementary', Timer, Countdowns.CountdownCrayonBlocksWidget),
  W('CD_GLASS',    'Countdowns', 'Glass Progress Ring', 'Conic-gradient progress ring',           'universal',  Timer, Countdowns.CountdownGlassRingWidget),
  W('CD_OPS',      'Countdowns', 'Ops Mission Timer',   'Mission-control countdown',              'admin',      Timer, Countdowns.CountdownOpsTimerWidget),
];

/* ─── LOGOS ──────────────────────────────────────────────────────────── */
export const LOGO_WIDGETS: RegisteredWidget[] = [
  W('LOGO_NEON',     'Logos', 'Neon Emblem',     'Glowing crest in a neon ring',                  'high',       Shield, Logos.LogoNeonEmblemWidget),
  W('LOGO_PAPER',    'Logos', 'Varsity Patch',   'Felt varsity patch crest',                       'middle',     Shield, Logos.LogoVarsityPatchWidget),
  W('LOGO_CRAYON',   'Logos', 'Crayon Sun',      'Sunshine spokes around mascot',                  'elementary', Shield, Logos.LogoCrayonSunWidget),
  W('LOGO_GLASS',    'Logos', 'Glass Mark',      'Modern minimal logo card',                       'universal',  Shield, Logos.LogoGlassMarkWidget),
  W('LOGO_OPS',      'Logos', 'Ops Stamp',       'Identifier-style brand block',                   'admin',      Shield, Logos.LogoOpsStampWidget),
];

/* ─── TICKERS ────────────────────────────────────────────────────────── */
export const TICKER_WIDGETS: RegisteredWidget[] = [
  W('TICKER_NEON',     'Tickers', 'Neon LED Ticker',     'Glowing scrolling LED',                  'high',       ArrowRight, Tickers.TickerNeonLedWidget),
  W('TICKER_PAPER',    'Tickers', 'Paper Press Ticker',  'Italic broadsheet scroller',             'middle',     ArrowRight, Tickers.TickerPaperPressWidget),
  W('TICKER_CRAYON',   'Tickers', 'Crayon Train',        'Cute train pulling chips',                'elementary', ArrowRight, Tickers.TickerCrayonTrainWidget),
  W('TICKER_GLASS',    'Tickers', 'Glass Flow',          'Frosted ticker bar',                      'universal',  ArrowRight, Tickers.TickerGlassFlowWidget),
  W('TICKER_OPS',      'Tickers', 'Ops Feed',            'Console event feed',                      'admin',      ArrowRight, Tickers.TickerOpsFeedWidget),
];

/* ─── WEATHER ────────────────────────────────────────────────────────── */
export const WEATHER_WIDGETS: RegisteredWidget[] = [
  W('WX_NEON',     'Weather', 'Neon Forecast',       'Arcade-marquee weather panel',               'high',       Cloud, Weather.WeatherNeonForecastWidget),
  W('WX_PAPER',    'Weather', 'Paper Bulletin',      'Newspaper-style forecast',                   'middle',     Cloud, Weather.WeatherPaperBulletinWidget),
  W('WX_CRAYON',   'Weather', 'Crayon Sun',          'Big cute weather face',                      'elementary', Cloud, Weather.WeatherCrayonSunWidget),
  W('WX_GLASS',    'Weather', 'Glass Card',          'iOS-style glass weather card',               'universal',  Cloud, Weather.WeatherGlassCardWidget),
  W('WX_OPS',      'Weather', 'Ops Telemetry',       'Sysop weather feed',                          'admin',      Cloud, Weather.WeatherOpsTelemetryWidget),
];

/* ─── PHOTOS ─────────────────────────────────────────────────────────── */
export const PHOTO_WIDGETS: RegisteredWidget[] = [
  W('PHOTO_NEON',     'Photos', 'Neon Glitch',         'CRT glitch photo frame',                  'high',       Camera, Photos.PhotoNeonGlitchWidget),
  W('PHOTO_PAPER',    'Photos', 'Polaroid Pin Wall',   'Three pinned polaroids',                  'middle',     Camera, Photos.PhotoPolaroidPinWidget),
  W('PHOTO_CRAYON',   'Photos', 'Crayon Scrapbook',    'Bright 4-up scrapbook grid',              'elementary', Camera, Photos.PhotoCrayonScrapbookWidget),
  W('PHOTO_GLASS',    'Photos', 'Glass Mosaic',        'Hero + thumbs glass mosaic',              'universal',  Camera, Photos.PhotoGlassMosaicWidget),
  W('PHOTO_OPS',      'Photos', 'Ops Contact Sheet',   'Greyscale contact sheet',                  'admin',      Camera, Photos.PhotoOpsContactSheetWidget),
];

/* ─── RICH TEXT ──────────────────────────────────────────────────────── */
export const RICHTEXT_WIDGETS: RegisteredWidget[] = [
  W('RT_NEON',     'Rich Text', 'Neon Terminal',  'Phosphor markdown reader',                    'high',       FileText, RichText.RichTextNeonTerminalWidget),
  W('RT_PAPER',    'Rich Text', 'Paper Letter',   'Letterpress newsletter',                       'middle',     FileText, RichText.RichTextPaperLetterWidget),
  W('RT_CRAYON',   'Rich Text', 'Crayon Notebook','Notebook page with ruled lines',               'elementary', FileText, RichText.RichTextCrayonNotebookWidget),
  W('RT_GLASS',    'Rich Text', 'Glass Doc',      'Modern minimal document',                      'universal',  FileText, RichText.RichTextGlassDocWidget),
  W('RT_OPS',      'Rich Text', 'Ops README',     'Markdown README in code editor',                'admin',      FileText, RichText.RichTextOpsReadmeWidget),
];

/* ─── IMAGES ─────────────────────────────────────────────────────────── */
export const IMAGE_WIDGETS: RegisteredWidget[] = [
  W('IMG_NEON',     'Images', 'Neon Banner',        'Neon-trimmed image w/ caption',             'high',       ImageIcon, Images.ImageNeonBannerWidget),
  W('IMG_PAPER',    'Images', 'Paper Framed',       'Matted print frame',                         'middle',     ImageIcon, Images.ImagePaperFramedWidget),
  W('IMG_CRAYON',   'Images', 'Crayon Sticker',     'Sticker-frame image',                        'elementary', ImageIcon, Images.ImageCrayonStickerWidget),
  W('IMG_GLASS',    'Images', 'Glass Hero',         'Hero image w/ frosted caption',              'universal',  ImageIcon, Images.ImageGlassHeroWidget),
  W('IMG_OPS',      'Images', 'Ops Asset',          'Asset-explorer image',                        'admin',      ImageIcon, Images.ImageOpsAssetWidget),
];

/* ─── LUNCH MENUS ────────────────────────────────────────────────────── */
export const LUNCH_WIDGETS: RegisteredWidget[] = [
  W('LUNCH_NEON',     'Lunch Menus', 'Neon Drive-In',  'Vintage diner today-special sign',        'high',       UtensilsCrossed, Lunch.LunchNeonDriveInWidget),
  W('LUNCH_PAPER',    'Lunch Menus', 'Chalk Cafe',     'Chalkboard cafe weekly menu',             'middle',     UtensilsCrossed, Lunch.LunchPaperChalkWidget),
  W('LUNCH_CRAYON',   'Lunch Menus', 'Crayon Tray',    'Big bright today-tray',                    'elementary', UtensilsCrossed, Lunch.LunchCrayonTrayWidget),
  W('LUNCH_GLASS',    'Lunch Menus', 'Glass Bistro',   'Prix-fixe bistro card',                    'universal',  UtensilsCrossed, Lunch.LunchGlassBistroWidget),
  W('LUNCH_OPS',      'Lunch Menus', 'Ops Inventory',  'Cafeteria week inventory',                 'admin',      UtensilsCrossed, Lunch.LunchOpsInventoryWidget),
];

/* ─── BELL SCHEDULES ─────────────────────────────────────────────────── */
export const BELL_WIDGETS: RegisteredWidget[] = [
  W('BELL_NEON',     'Bell Schedules', 'Neon Pit Board',   'Race-pit current-period board',       'high',       Bell, BellSched.BellNeonPitWidget),
  W('BELL_PAPER',    'Bell Schedules', 'Paper Programme',  'Playbill-style daily schedule',        'middle',     Bell, BellSched.BellPaperProgramWidget),
  W('BELL_CRAYON',   'Bell Schedules', 'Crayon Day-Plan',  'Cute pill-shaped period list',         'elementary', Bell, BellSched.BellCrayonDayplanWidget),
  W('BELL_GLASS',    'Bell Schedules', 'Glass Timetable',  'Modern app-style timetable',           'universal',  Bell, BellSched.BellGlassTimetableWidget),
  W('BELL_OPS',      'Bell Schedules', 'Ops Dispatch',     'Network dispatch board',               'admin',      Bell, BellSched.BellOpsDispatchWidget),
];

/* ─── CELEBRATIONS — EDU CMS-10 batch ─────────────────────────────────
 * Full-screen sports celebration ribbons — fire on a scoring event.
 * Each Component is wrapped in withMeasuredHeight: the widget sizes its
 * type off a pixel `height`, which the variant render path does not
 * pass, so the wrapper measures the real rendered height and feeds it
 * in. (variants-register.ts maps these three categories → CELEBRATION.) */
const CAT_CEL_BASEBALL   = 'Celebrations · Baseball';
const CAT_CEL_FOOTBALL   = 'Celebrations · Football';
const CAT_CEL_BASKETBALL = 'Celebrations · Basketball';

export const CEL_BASEBALL_WIDGETS: RegisteredWidget[] = [
  W('CEL_BASEBALL_STRIKEOUT',  CAT_CEL_BASEBALL, 'Strikeout',     'Flashing Ks with a rotating baseball',            'universal', Zap,         withMeasuredHeight(CelBaseballStrikeoutWidget),  { pitcher: 'BURNES', kCount: 11, team: 'starting rotation' }),
  W('CEL_BASEBALL_HOMERUN',    CAT_CEL_BASEBALL, 'Home Run',      'Arcing ball trail + player, distance, exit velo', 'universal', TrendingUp,  withMeasuredHeight(CelBaseballHomeRunWidget),    { player: 'TUCKER', distance: '418 FT', exitVelo: '108 MPH EXIT VELOCITY' }),
  W('CEL_BASEBALL_GRANDSLAM',  CAT_CEL_BASEBALL, 'Grand Slam',    'Four-base diamond + GRAND SLAM',                  'universal', Crown,       withMeasuredHeight(CelBaseballGrandSlamWidget),  { player: 'DEVERS', score: '7-2' }),
  W('CEL_BASEBALL_NOHITTER',   CAT_CEL_BASEBALL, 'No-Hitter',     'Mid-game no-hitter alert',                        'universal', Star,        withMeasuredHeight(CelBaseballNoHitterWidget),   { pitcher: 'KERSHAW', inning: 9 }),
  W('CEL_BASEBALL_STOLENBASE', CAT_CEL_BASEBALL, 'Stolen Base',   'Speed arrows + safe call + season SB count',      'universal', Zap,         withMeasuredHeight(CelBaseballStolenBaseWidget), { runner: 'WITT JR.', base: '2ND', seasonSb: 14 }),
  W('CEL_BASEBALL_DOUBLEPLAY', CAT_CEL_BASEBALL, 'Double Play',   'Two-stage ball flight with the player chain',     'universal', Repeat2,     withMeasuredHeight(CelBaseballDoublePlayWidget), { combo: '6-4-3', players: ['LINDOR', 'ALBIES', 'OLSON'] }),
  W('CEL_BASEBALL_TRIPLEPLAY', CAT_CEL_BASEBALL, 'Triple Play',   'Three lit bases + TRIPLE PLAY punch',             'universal', CircleEqual, withMeasuredHeight(CelBaseballTriplePlayWidget), { caption: '1st in 6 yrs' }),
  W('CEL_BASEBALL_WALKOFF',    CAT_CEL_BASEBALL, 'Walk-Off Win',  'Game-over team-color flood + walk-off hero',      'universal', Flag,        withMeasuredHeight(CelBaseballWalkOffWidget),    { teamName: 'BULLS', hero: 'JUDGE', finalScore: '5-4', innings: 11 }),
];

export const CEL_FOOTBALL_WIDGETS: RegisteredWidget[] = [
  W('CEL_FOOTBALL_TOUCHDOWN', CAT_CEL_FOOTBALL, 'Touchdown',       'Massive TOUCHDOWN with stadium-light shake', 'universal', Trophy,       withMeasuredHeight(CelFootballTouchdownWidget),      { player: 'BARKLEY', distance: '67 YD', score: '21-14' }),
  W('CEL_FOOTBALL_PICKSIX',   CAT_CEL_FOOTBALL, 'Pick Six',        'Defensive TD — interception to the house',   'universal', Hand,         withMeasuredHeight(CelFootballPickSixWidget),        { player: 'RAMSEY', distance: '42 YD RETURN' }),
  W('CEL_FOOTBALL_FIELDGOAL', CAT_CEL_FOOTBALL, 'Field Goal',      'Twin uprights, arcing ball, +3 callout',     'universal', Goal,         withMeasuredHeight(CelFootballFieldGoalWidget),      { kicker: 'BUTKER', distance: '52 YD' }),
  W('CEL_FOOTBALL_SACK',      CAT_CEL_FOOTBALL, 'Sack',            'QB takedown — impact lines + season sacks',  'universal', Hammer,       withMeasuredHeight(CelFootballSackWidget),           { player: 'PARSONS', sacks: 9.5 }),
  W('CEL_FOOTBALL_FIRSTDOWN', CAT_CEL_FOOTBALL, 'First Down',      'Yard-line marker sweep — drive sustained',   'universal', ArrowRight,   withMeasuredHeight(CelFootballFirstDownWidget),      { distance: '14 YD' }),
  W('CEL_FOOTBALL_INT',       CAT_CEL_FOOTBALL, 'Interception',    'Defender pulls it down — possession change', 'universal', Hand,         withMeasuredHeight(CelFootballInterceptionWidget),   { player: 'PEPPERS', count: 5 }),
  W('CEL_FOOTBALL_SAFETY',    CAT_CEL_FOOTBALL, 'Safety',          '+2 in the end zone — flashing red flood',    'universal', AlertOctagon, withMeasuredHeight(CelFootballSafetyWidget),         {}),
  W('CEL_FOOTBALL_FUMBLE',    CAT_CEL_FOOTBALL, 'Fumble Recovery', 'Ball scramble — possession change',          'universal', RefreshCw,    withMeasuredHeight(CelFootballFumbleRecoveryWidget), { player: 'BOSA' }),
];

export const CEL_BASKETBALL_WIDGETS: RegisteredWidget[] = [
  W('CEL_BASKETBALL_THREE',        CAT_CEL_BASKETBALL, '3-Pointer',     'Arcing trail + spinning ball + tonight count', 'universal', Target,            withMeasuredHeight(CelBasketballThreeWidget),        { player: 'CURRY', threesTonight: 7 }),
  W('CEL_BASKETBALL_DUNK',         CAT_CEL_BASKETBALL, 'Slam Dunk',     'Net-shred animation + player in lights',       'universal', Zap,               withMeasuredHeight(CelBasketballDunkWidget),         { player: 'GIANNIS', kind: 'POSTER' }),
  W('CEL_BASKETBALL_BUZZER',       CAT_CEL_BASKETBALL, 'Buzzer Beater', 'Clock-to-zero with a team-color flood',        'universal', Timer,             withMeasuredHeight(CelBasketballBuzzerWidget),       { player: 'BOOKER', clock: '0.4', kind: 'GAME WINNER' }),
  W('CEL_BASKETBALL_BLOCK',        CAT_CEL_BASKETBALL, 'Block',         'Rejection wall + block count',                 'universal', Hand,              withMeasuredHeight(CelBasketballBlockWidget),        { player: 'EMBIID', blocksTonight: 3 }),
  W('CEL_BASKETBALL_STEAL',        CAT_CEL_BASKETBALL, 'Steal',         'Ball-snatch with speed lines + name',          'universal', Zap,               withMeasuredHeight(CelBasketballStealWidget),        { player: 'GILGEOUS', stealsTonight: 4 }),
  W('CEL_BASKETBALL_ALLEYOOP',     CAT_CEL_BASKETBALL, 'Alley-Oop',     'Passer to dunker with an arcing trail',        'universal', MousePointerClick, withMeasuredHeight(CelBasketballAlleyOopWidget),     { passer: 'DONCIC', dunker: 'IRVING' }),
  W('CEL_BASKETBALL_ANDONE',       CAT_CEL_BASKETBALL, 'And-One',       'Bucket + foul — free throw incoming',          'universal', MousePointerClick, withMeasuredHeight(CelBasketballAndOneWidget),       { player: 'TATUM' }),
  W('CEL_BASKETBALL_TRIPLEDOUBLE', CAT_CEL_BASKETBALL, 'Triple-Double', 'Stat-line achievement — 10/10/10 locked',      'universal', Award,             withMeasuredHeight(CelBasketballTripleDoubleWidget), { player: 'JOKIC', line: '24 PTS · 12 REB · 13 AST', careerCount: 18 }),
];

/* ─── CELEBRATIONS — Hockey + Soccer (EDU CMS-12 batch) ─────────────── */
const CAT_CEL_HOCKEY  = 'Celebrations · Hockey';
const CAT_CEL_SOCCER  = 'Celebrations · Soccer';

export const CEL_HOCKEY_WIDGETS: RegisteredWidget[] = [
  W('CEL_HOCKEY_GOAL',        CAT_CEL_HOCKEY, 'Goal',            'Red-lamp pulse + GOAL banner + assists', 'universal', Goal,        withMeasuredHeight(CelHockeyGoalWidget),      { scorer: 'MCDAVID', assists: ['DRAISAITL', 'NUGENT-HOPKINS'], score: '3-1' }),
  W('CEL_HOCKEY_HATTRICK',    CAT_CEL_HOCKEY, 'Hat Trick',       '3 goals — flying-hats sparkle',          'universal', PartyPopper, withMeasuredHeight(CelHockeyHatTrickWidget),  { player: 'OVECHKIN' }),
  W('CEL_HOCKEY_POWERPLAY',   CAT_CEL_HOCKEY, 'Power Play Goal', '5-on-4 cashed in — strength badge',      'universal', Zap,         withMeasuredHeight(CelHockeyPowerPlayWidget), { scorer: 'MATTHEWS', strength: '5-on-4', score: '2-1' }),
  W('CEL_HOCKEY_SHORTHANDED', CAT_CEL_HOCKEY, 'Shorthanded',     'Down a man and still scored',            'universal', Shield,      withMeasuredHeight(CelHockeyShortyWidget),    { scorer: 'POINT', strength: '4-on-5' }),
  W('CEL_HOCKEY_BIGSAVE',     CAT_CEL_HOCKEY, 'Big Save',        'Goaltender denial + save count',         'universal', Shield,      withMeasuredHeight(CelHockeyBigSaveWidget),   { goalie: 'SHESTERKIN', saves: 28 }),
  W('CEL_HOCKEY_EMPTYNET',    CAT_CEL_HOCKEY, 'Empty Net Goal',  'Game-sealing goal into the empty net',   'universal', Flag,        withMeasuredHeight(CelHockeyEmptyNetWidget),  { scorer: 'BARKOV', finalScore: '4-2' }),
];

export const CEL_SOCCER_WIDGETS: RegisteredWidget[] = [
  W('CEL_SOCCER_GOAL',     CAT_CEL_SOCCER, 'GOOOOAL',        'Classic GOOOOAL with a flag-wave backdrop', 'universal', Goal,         withMeasuredHeight(CelSoccerGoalWidget),        { scorer: 'MESSI', minute: "63'", score: '2-1' }),
  W('CEL_SOCCER_HATTRICK', CAT_CEL_SOCCER, 'Hat Trick',      '3 goals — three goal-minute chips',         'universal', Award,        withMeasuredHeight(CelSoccerHatTrickWidget),    { player: 'HAALAND', goals: ["12'", "38'", "81'"] }),
  W('CEL_SOCCER_GOLAZO',   CAT_CEL_SOCCER, 'Golazo',         'Highlight-reel strike — italic GOLAZO',     'universal', Sparkles,     withMeasuredHeight(CelSoccerGolazoWidget),      { player: 'BELLINGHAM', kind: 'BICYCLE KICK' }),
  W('CEL_SOCCER_REDCARD',  CAT_CEL_SOCCER, 'Red Card',       'Sending-off — flashing red card',           'universal', AlertOctagon, withMeasuredHeight(CelSoccerRedCardWidget),     { player: 'RAMOS', number: '4', reason: '2nd yellow' }),
  W('CEL_SOCCER_PENSAVE',  CAT_CEL_SOCCER, 'Penalty Save',   'Goalkeeper saves a penalty',                'universal', Shield,       withMeasuredHeight(CelSoccerPenaltySaveWidget), { goalie: 'COURTOIS' }),
  W('CEL_SOCCER_FREEKICK', CAT_CEL_SOCCER, 'Free Kick Goal', 'Wall-bending strike + spot diagram',        'universal', Crosshair,    withMeasuredHeight(CelSoccerFreeKickWidget),    { player: 'BECKHAM', distance: '28 YD' }),
];

/* ─── INDUSTRY PACKS (EDU CMS-11/12) ─────────────────────────────────── */
const CAT_HEALTHCARE  = 'Healthcare';
const CAT_CORPORATE   = 'Corporate';
const CAT_HOSPITALITY = 'Hospitality';
const CAT_WORSHIP     = 'Worship';
const CAT_CHARTS      = 'Charts';

export const HEALTHCARE_WIDGETS: RegisteredWidget[] = [
  W('NOW_SERVING',        CAT_HEALTHCARE, 'Now Serving',        'Big-number queue indicator + up-next list',    'universal', Hash,          withMeasuredHeight(NowServingWidget),        { station: 'Reception · Counter 3', current: 'A 47', upcoming: ['A 48', 'A 49', 'A 50', 'A 51'] }),
  W('WAIT_TIMES_BOARD',   CAT_HEALTHCARE, 'Wait Times Board',   'Per-department wait estimates, traffic-light', 'universal', Clock,         withMeasuredHeight(WaitTimesBoardWidget),    {}),
  W('PROVIDER_SPOTLIGHT', CAT_HEALTHCARE, 'Provider Spotlight', 'Doctor / staff hero card with bio',            'universal', UserCog,       withMeasuredHeight(ProviderSpotlightWidget), { name: 'Dr. Aisha Pereira', title: 'Cardiothoracic Surgeon · MD, FACS' }),
  W('PATIENT_EDUCATION',  CAT_HEALTHCARE, 'Patient Education',  'Waiting-room education with QR-to-phone',      'universal', BookOpen,      withMeasuredHeight(PatientEducationWidget),  { title: 'Managing high blood pressure' }),
  W('VISITOR_HOURS',      CAT_HEALTHCARE, 'Visitor Hours',      'Multi-unit visitor hours table',               'universal', CalendarClock, withMeasuredHeight(VisitorHoursWidget),      {}),
  W('CODE_BANNER',        CAT_HEALTHCARE, 'Code Banner',        'Flashing overlay for hospital codes',          'universal', AlertOctagon,  withMeasuredHeight(CodeBannerWidget),        { code: 'CODE BLUE', location: '4-WEST · ROOM 412' }),
  W('INSURANCE_ACCEPTED', CAT_HEALTHCARE, 'Insurance Accepted', 'Tile board of accepted insurance carriers',    'universal', ShieldCheck,   withMeasuredHeight(InsuranceAcceptedWidget), {}),
];

export const CORPORATE_WIDGETS: RegisteredWidget[] = [
  W('ROOM_SCHEDULE',      CAT_CORPORATE, 'Meeting Room Schedule',  'Door-sign room status + up-next list',  'universal', CalendarRange, withMeasuredHeight(RoomScheduleWidget),      { room: 'Pacific · 12-A', status: 'AVAILABLE' }),
  W('VISITOR_WELCOME',    CAT_CORPORATE, 'Visitor Welcome Board',  'Lobby greeter, personalized name',      'universal', UserCheck,     withMeasuredHeight(VisitorWelcomeWidget),    { host: 'Northwind HQ', visitor: 'Alex Morgan', company: 'Acme Robotics' }),
  W('KPI_TILE',           CAT_CORPORATE, 'KPI Tile',               'One-metric tile + sparkline + delta',   'universal', TrendingUp,    withMeasuredHeight(KpiTileWidget),           { label: 'Revenue · MRR', value: '1.42M', prefix: '$', delta: 12, target: '1.5M' }),
  W('SALES_LEADERBOARD',  CAT_CORPORATE, 'Sales Leaderboard',      'Rep ranking with quota %',              'universal', Trophy,        withMeasuredHeight(SalesLeaderboardWidget),  { title: 'Sales · September', goal: '$2.5M', percent: 78 }),
  W('DOOR_SIGN',          CAT_CORPORATE, 'Office Door Sign',       'Portrait office sign — availability',   'universal', DoorOpen,      withMeasuredHeight(DoorSignWidget),          { occupant: 'Dana Stevens', title: 'VP Engineering', status: 'AVAILABLE' }),
  W('OKR_TRACKER',        CAT_CORPORATE, 'OKR Tracker',            'Objective + key-result progress bars',  'universal', Target,        withMeasuredHeight(OkrTrackerWidget),        { quarter: 'Q3' }),
  W('TEAM_ANNIVERSARIES', CAT_CORPORATE, 'Anniversaries & B-days', 'Work anniversaries + birthdays',        'universal', PartyPopper,   withMeasuredHeight(TeamAnniversariesWidget), { company: 'Northwind' }),
];

export const HOSPITALITY_WIDGETS: RegisteredWidget[] = [
  W('HOTEL_WELCOME',      CAT_HOSPITALITY, 'Hotel Guest Welcome', 'Editorial welcome card, personalized', 'universal', BedDouble, withMeasuredHeight(HotelWelcomeWidget),     { hotel: 'THE COPPERLEAF', guest: 'The Park family' }),
  W('DAILY_EVENTS_BOARD', CAT_HOSPITALITY, 'Daily Events Board',  "Today's activity + dining schedule",   'universal', Calendar,  withMeasuredHeight(DailyEventsBoardWidget), { property: 'THE COPPERLEAF' }),
  W('AMENITY_HOURS',      CAT_HOSPITALITY, 'Amenity Hours Board', 'Pool / gym / spa open-closed status',  'universal', Clock4,    withMeasuredHeight(AmenityHoursWidget),     {}),
  W('CHECK_IN_OUT_TIMES', CAT_HOSPITALITY, 'Check-in/out Times',  'Check-in / check-out windows',         'universal', Key,       withMeasuredHeight(CheckInOutTimesWidget),  {}),
  W('LOCAL_ATTRACTIONS',  CAT_HOSPITALITY, 'Local Attractions',   'Curated nearby dining + activities',   'universal', MapPin,    withMeasuredHeight(LocalAttractionsWidget), { property: 'THE COPPERLEAF' }),
];

export const WORSHIP_WIDGETS: RegisteredWidget[] = [
  W('SERVICE_TIMES',      CAT_WORSHIP, 'Service Times',      'Weekly service schedule',                'universal', CalendarDays,   withMeasuredHeight(ServiceTimesWidget),      { label: 'Weekly Gatherings' }),
  W('SERMON_TITLE_CARD',  CAT_WORSHIP, 'Sermon Title Card',  'Editorial sermon hero — series + title', 'universal', Cross,          withMeasuredHeight(SermonTitleCardWidget),   { series: 'The Sermon on the Mount' }),
  W('HYMN_BOARD',         CAT_WORSHIP, 'Hymn Board',         "Today's hymn numbers + titles",          'universal', Music,          withMeasuredHeight(HymnBoardWidget),         {}),
  W('GIVING_THERMOMETER', CAT_WORSHIP, 'Giving Thermometer', 'Campaign progress with QR-to-give',       'universal', HandCoins,      withMeasuredHeight(GivingThermometerWidget), { label: 'Capital Campaign', title: 'Build the new student wing', goal: 250000, raised: 167200 }),
  W('SCRIPTURE_VERSE',    CAT_WORSHIP, 'Scripture Verse',    'Centered editorial verse card',          'universal', BookOpen,       withMeasuredHeight(ScriptureVerseWidget),    { reference: 'John 3:16', translation: 'KJV' }),
  W('PRAYER_REQUEST_QR',  CAT_WORSHIP, 'Prayer Request QR',  'QR to a confidential prayer form',       'universal', HeartHandshake, withMeasuredHeight(PrayerRequestQrWidget),   { qrLabel: 'firstchurch.org/prayer' }),
];

/* ─── RETAIL — storefront pack (clean / minimal, approved 2026-05-19) ─
 * Scoped to the RETAIL vertical at the ALL_V2_WIDGETS assembly point.
 * Ported from scratch/design/retail/retail-pack-v2.html. Each Component
 * sizes off the measured height + percentage layout; Chromium-83 safe. */
const CAT_RETAIL = 'Retail';

export const RETAIL_WIDGETS: RegisteredWidget[] = [
  W('RETAIL_SALE_SEAL',       CAT_RETAIL, 'Sale Seal',           'Charcoal discount disc — big % off, thin ring',          'universal', Percent,     withMeasuredHeight(SaleSealWidget),         { pct: '50%', label: 'OFF' }),
  W('RETAIL_PRICE_TAG',       CAT_RETAIL, 'Price-Drop Tag',      'Hanging swing tag — was/now price, limited label',       'universal', Tag,         withMeasuredHeight(PriceTagWidget),         { was: '$129', now: '$79', label: 'LIMITED' }),
  W('RETAIL_PRODUCT',         CAT_RETAIL, 'Product Spotlight',   'Clean product card — image, brand, name, price',         'universal', ShoppingBag, withMeasuredHeight(ProductSpotlightWidget), { brand: 'Aurio', name: 'Studio Wireless', price: '$149', badge: 'New' }),
  W('RETAIL_FLASH_COUNTDOWN', CAT_RETAIL, 'Flash-Sale Countdown','Live urgency timer — set an end time, it ticks down',     'universal', Timer,       withMeasuredHeight(FlashCountdownWidget),   { kicker: 'Flash sale ends in' }),
  W('RETAIL_STORE_HOURS',     CAT_RETAIL, 'Store Hours',         'Open/closed status + day rows, today highlighted',       'universal', Store,       withMeasuredHeight(StoreHoursWidget),       { state: 'Open · closes 9 PM', open: true }),
  W('RETAIL_LOYALTY_QR',      CAT_RETAIL, 'Loyalty QR',          'Join-rewards card — drop your QR image URL',             'universal', QrCode,      withMeasuredHeight(LoyaltyQrWidget),        { heading: 'Join Rewards', cta: '10% off your first scan →' }),
  W('RETAIL_NEW_ARRIVALS',    CAT_RETAIL, 'New Arrivals',        'Eyebrow + title + scrolling category strip',             'universal', Sparkles,    withMeasuredHeight(NewArrivalsWidget),      { eyebrow: 'Just In', title: 'New Arrivals' }),
  W('RETAIL_PROMO_STRIP',     CAT_RETAIL, 'Promo Strip',         'Clean banner with a single accent rule',                 'universal', Megaphone,   withMeasuredHeight(PromoStripWidget),       { big: 'Buy 1, Get 1 50%', small: 'This weekend only' }),
];

/* ─── SCOREBOARDS — live game scoreboard, three tiers ───────────────── */
const CAT_SCOREBOARD = 'Scoreboards';

export const SCOREBOARD_WIDGETS: RegisteredWidget[] = [
  W('SCOREBOARD_HS',      CAT_SCOREBOARD, 'High School Scoreboard', 'Live game scoreboard — bind a game and it auto-adapts to that sport (clock, periods, stats from the engine). High-school tier.', 'universal', Tv, withMeasuredHeight(SportsScoreboardWidget), { tier: 'hs', gameId: '' }),
  W('SCOREBOARD_COLLEGE', CAT_SCOREBOARD, 'College Scoreboard',     'Live game scoreboard — college tier, broadcast polish. Drives off the same sports engine.',                                     'universal', Tv, withMeasuredHeight(SportsScoreboardWidget), { tier: 'college', gameId: '' }),
  W('SCOREBOARD_PRO',     CAT_SCOREBOARD, 'Pro Scoreboard',         'Live game scoreboard — professional tier, sleek broadcast look. Drives off the same sports engine.',                             'universal', Tv, withMeasuredHeight(SportsScoreboardWidget), { tier: 'pro', gameId: '' }),
];

export const CHART_WIDGETS: RegisteredWidget[] = [
  W('CHART_BAR',         CAT_CHARTS, 'Bar Chart',      'Categorical bars with auto-labeled values', 'universal', BarChart3,  withMeasuredHeight(BarChartWidget),     { label: 'Weekly signups', title: 'New users · last 7 days' }),
  W('CHART_DONUT_GAUGE', CAT_CHARTS, 'Donut Gauge',    'Big circular gauge with a goal target',     'universal', PieChart,   withMeasuredHeight(DonutGaugeWidget),   { label: 'NPS · Last 30d', title: 'Customer satisfaction', value: 78, goal: 100 }),
  W('CHART_LINE',        CAT_CHARTS, 'Line Chart',     'Multi-series line chart with grid',         'universal', LineChart,  withMeasuredHeight(LineChartWidget),    { label: '6-week trend', title: 'Revenue vs forecast' }),
  W('CHART_PROGRESS',    CAT_CHARTS, 'Progress List',  'Stacked progress bars',                     'universal', ListChecks, withMeasuredHeight(ProgressListWidget), { label: 'Project status', title: 'Where we are this week' }),
  W('CHART_COUNTUP',     CAT_CHARTS, 'Count-Up Stats', 'Four big-number stat cards',                'universal', Calculator, withMeasuredHeight(CountUpStatsWidget),  { label: 'By the numbers', title: 'A year in numbers' }),
];

/* ─── SPORTS VENUE — jumbotron / ribbon / concourse (EDU CMS-6) ──────
 * Net-new vertical built for live-event venues. Scoped to the SPORTS
 * vertical at the ALL_V2_WIDGETS assembly point. Each Component sizes
 * off a pixel `height`, so all are wrapped in withMeasuredHeight.
 * (variants-register.ts maps 'Sports Venue' → SCOREBOARD.) */
const CAT_SPORTS_VENUE = 'Sports Venue';

export const SPORTS_VENUE_WIDGETS: RegisteredWidget[] = [
  W('STADIUM_SCOREBOARD',   CAT_SPORTS_VENUE, 'Stadium Scoreboard',  'Full jumbotron scoreboard — twin team panels, clock, fouls, sponsor bars', 'universal', Tv,               withMeasuredHeight(StadiumScoreboardWidget),  { sport: 'BASKETBALL', clock: '4:21', period: 'Q3', homeFouls: 5, awayFouls: 3, homeBonus: false, awayBonus: false, topSponsor: 'PRESENTED BY · MIDWEST AUTO GROUP', bottomSponsor: 'BUDWEISER · OFFICIAL BEER PARTNER' }),
  W('RIBBON_TICKER',        CAT_SPORTS_VENUE, 'Ribbon Ticker',       'LED ribbon-board scoreline with a scrolling segment marquee',              'universal', ScrollText,       withMeasuredHeight(RibbonTickerWidget),       { clock: '4:21', period: 'Q3', scrollSpeed: 40 }),
  W('RIBBON_SPONSOR',       CAT_SPORTS_VENUE, 'Ribbon Sponsor',      'Ribbon-board sponsor lockup — logo, tagline, call-to-action',              'universal', Megaphone,        withMeasuredHeight(RibbonSponsorWidget),      { sponsor: 'BUDWEISER', tagline: 'KING OF BEERS', cta: 'now pouring · sec 110-114', bg: '#dc2626' }),
  W('RIBBON_FAN_SHOUTOUT',  CAT_SPORTS_VENUE, 'Ribbon Fan Shoutout', 'Ribbon-board fan shoutout — birthdays, anniversaries, group welcomes',     'universal', PartyPopper,      withMeasuredHeight(RibbonFanShoutoutWidget),  { kind: 'HAPPY BIRTHDAY', name: 'JAMES, AGE 8', from: 'YOUR BULLS FAMILY' }),
  W('PLAYER_CARD',          CAT_SPORTS_VENUE, 'Player Card',         'Featured-player hero card with team colors and a stat line',               'universal', UserCog,          withMeasuredHeight(PlayerCardWidget),         {}),
  W('STARTING_LINEUP',      CAT_SPORTS_VENUE, 'Starting Lineup',     "Tonight's starting five — portrait cards per player",                      'universal', Users,            withMeasuredHeight(StartingLineupWidget),     {}),
  W('STAT_COMPARISON',      CAT_SPORTS_VENUE, 'Stat Comparison',     'Head-to-head team stat bars — season or game averages',                    'universal', GitCompareArrows, withMeasuredHeight(StatComparisonWidget),     { scope: 'SEASON AVERAGES' }),
  W('OUT_OF_TOWN_SCORES',   CAT_SPORTS_VENUE, 'Out-of-Town Scores',  'Around-the-league scoreboard grid of other games',                         'universal', ListOrdered,      withMeasuredHeight(OutOfTownScoresWidget),    {}),
  W('KISS_CAM',             CAT_SPORTS_VENUE, 'Kiss Cam',            'Heart-cutout fan-cam overlay with a sponsor caption',                      'universal', HeartHandshake,   withMeasuredHeight(KissCamWidget),            { kind: 'KISS CAM', tone: '#ec4899', sponsor: 'BROUGHT TO YOU BY JEWELED VOWS DIAMOND CO.' }),
  W('NOISE_METER',          CAT_SPORTS_VENUE, 'Noise Meter',         'Live crowd decibel meter — "make some noise" prompt',                      'universal', Volume2,          withMeasuredHeight(NoiseMeterWidget),         { prompt: 'Get LOUD!', target: 100, level: 87 }),
  W('IN_GAME_PROMO',        CAT_SPORTS_VENUE, 'In-Game Promo',       'Sponsored in-game promo — t-shirt toss, section callouts',                 'universal', Gift,             withMeasuredHeight(InGamePromoWidget),        { kicker: "BROUGHT TO YOU BY POPEYE'S", title: 'T-SHIRT TOSS', subtitle: 'Look up · catch a shirt · take a selfie · tag @ChicagoBulls', sections: ['SEC 100', 'SEC 200', 'SEC 300', 'SEC 400'], cta: 'NEXT TOSS · 4:00', accent: '#ffd23a' }),
  W('SPONSOR_TAKEOVER',     CAT_SPORTS_VENUE, 'Sponsor Takeover',    'Full-screen official-partner takeover with logo and offer',                'universal', Crown,            withMeasuredHeight(SponsorTakeoverWidget),    { sponsor: 'AMERICAN AIRLINES', tagline: 'Going for great.', body: 'Fly the Bulls and earn double AAdvantage miles all season long.', cta: 'aa.com/bulls', bg: '#0a4a8a' }),
  W('HOME_SCHEDULE',        CAT_SPORTS_VENUE, 'Home Schedule',       'Next five home games — date, opponent, theme night, tickets',              'universal', CalendarDays,     withMeasuredHeight(HomeScheduleWidget),       {}),
  W('STANDINGS_BOARD',      CAT_SPORTS_VENUE, 'Standings Board',     'Conference standings table — W/L, PCT, GB, streak, last 10',               'universal', ListOrdered,      withMeasuredHeight(StandingsBoardWidget),     { scope: 'EASTERN CONFERENCE' }),
  W('CONCESSION_WAITS',     CAT_SPORTS_VENUE, 'Concession Waits',    'Shortest concession lines right now — per-stand wait estimates',           'universal', UtensilsCrossed,  withMeasuredHeight(ConcessionWaitsWidget),    {}),
  W('GATE_WAYFINDING',      CAT_SPORTS_VENUE, 'Gate Wayfinding',     'Portrait concourse wayfinding — section, gate, walk time, QR',             'universal', Navigation,       withMeasuredHeight(GateWayfindingWidget),     { section: '212', gate: 'B', distance: '4 MIN WALK', directions: 'Take the escalator to the upper concourse, walk left past Goose Island.' }),
  W('GOAL_CELEBRATION',     CAT_SPORTS_VENUE, 'Goal Celebration',    'Team-color goal celebration burst with scorer callout',                    'universal', Goal,             withMeasuredHeight(GoalCelebrationWidget),    { label: 'GOAL!' }),
];

/* ─── CELEBRATIONS — More Sports (EDU CMS batch) ─────────────────────
 * Celebration ribbons for the remaining sports plus retro/neon style
 * variants of the big events. Scoped to the SPORTS vertical.
 * (variants-register.ts maps 'Celebrations · More Sports' → CELEBRATION.) */
const CAT_CEL_MORE = 'Celebrations · More Sports';

export const CELEBRATIONS_MORE_WIDGETS: RegisteredWidget[] = [
  W('CEL_BB_HOMERUN_RETRO',   CAT_CEL_MORE, 'Home Run · Retro',     'Baseball home run — split-flap retro scoreboard style',  'universal', TrendingUp,   withMeasuredHeight(BbHomeRunRetroWidget),   { player: 'BENCH', distance: '418 FT' }),
  W('CEL_BB_HOMERUN_NEON',    CAT_CEL_MORE, 'Home Run · Neon',      'Baseball home run — synthwave neon-grid style',          'universal', TrendingUp,   withMeasuredHeight(BbHomeRunNeonWidget),    { player: 'OHTANI', distance: '462 FT' }),
  W('CEL_BB_STRIKEOUT_NEON',  CAT_CEL_MORE, 'Strikeout · Neon',     'Baseball strikeout — blinking neon Ks',                  'universal', Zap,          withMeasuredHeight(BbStrikeoutNeonWidget),  { pitcher: 'SKENES', kCount: 13 }),
  W('CEL_FB_TOUCHDOWN_NEON',  CAT_CEL_MORE, 'Touchdown · Neon',     'Football touchdown — neon spark-rain style',             'universal', Trophy,       withMeasuredHeight(FbTouchdownNeonWidget),  { player: 'MAHOMES', distance: '48 YD' }),
  W('CEL_FB_TOUCHDOWN_RETRO', CAT_CEL_MORE, 'Touchdown · Retro',    'Football touchdown — 1972 NFL Films retro style',        'universal', Trophy,       withMeasuredHeight(FbTouchdownRetroWidget), { player: 'PAYTON', distance: '12 YD' }),
  W('CEL_BK_THREE_NEON',      CAT_CEL_MORE, '3-Pointer · Neon',     'Basketball three — glowing neon-grid style',             'universal', Target,       withMeasuredHeight(BkThreeNeonWidget),      { player: 'CURRY', threeCount: 9 }),
  W('CEL_BK_THREE_RETRO',     CAT_CEL_MORE, '3-Pointer · Retro',    'Basketball three — skewed retro splash style',           'universal', Target,       withMeasuredHeight(BkThreeRetroWidget),     { player: 'BIRD', threeCount: 5 }),
  W('CEL_HK_GOAL_NEON',       CAT_CEL_MORE, 'Hockey Goal · Neon',   'Hockey goal — bass-thump neon style',                    'universal', Goal,         withMeasuredHeight(HkGoalNeonWidget),       { scorer: 'PASTRNAK' }),
  W('CEL_HK_GOAL_RETRO',      CAT_CEL_MORE, 'Hockey Goal · Retro',  'Hockey goal — split-flap retro style',                   'universal', Goal,         withMeasuredHeight(HkGoalRetroWidget),      { scorer: 'HOWE', period: 2 }),
  W('CEL_SC_GOAL_RETRO',      CAT_CEL_MORE, 'Soccer Goal · Retro',  'Soccer GOOOOAL — vintage World Cup broadcast style',     'universal', Goal,         withMeasuredHeight(ScGoalRetroWidget),      { scorer: 'PELÉ', minute: "42'" }),
  W('CEL_SC_GOAL_NEON',       CAT_CEL_MORE, 'Soccer Goal · Neon',   'Soccer GOOOOAL — neon word-echo style',                  'universal', Goal,         withMeasuredHeight(ScGoalNeonWidget),       { scorer: 'MBAPPÉ', minute: "90'+3" }),
  W('CEL_TN_ACE',             CAT_CEL_MORE, 'Tennis Ace',           'Tennis ace — court diagram with serve trail',            'universal', Zap,          withMeasuredHeight(TnAceWidget),            { player: 'ALCARAZ', speed: '141 MPH', aces: 8 }),
  W('CEL_TN_ACE_NEON',        CAT_CEL_MORE, 'Tennis Ace · Neon',    'Tennis ace — neon-grid serve-trail style',               'universal', Zap,          withMeasuredHeight(TnAceNeonWidget),        { player: 'SINNER', speed: '138 MPH' }),
  W('CEL_TN_BREAKPOINT',      CAT_CEL_MORE, 'Break Point Won',      'Tennis break point — serve-broken callout',              'universal', Flag,         withMeasuredHeight(TnBreakPointWidget),     { player: 'SWIATEK', set: 1, score: '4-3' }),
  W('CEL_TN_MATCHPOINT',      CAT_CEL_MORE, 'Match Point',          'Tennis match point — spark-rain finale',                 'universal', Crown,        withMeasuredHeight(TnMatchPointWidget),     { player: 'DJOKOVIC', score: '40-30' }),
  W('CEL_TN_WINNER',          CAT_CEL_MORE, 'Tennis Winner',        'Tennis winner — painted-the-line shot callout',          'universal', Sparkles,     withMeasuredHeight(TnWinnerWidget),         { player: 'GAUFF', shot: 'FOREHAND', winners: 24 }),
  W('CEL_LX_GOAL',            CAT_CEL_MORE, 'Lacrosse Goal',        'Lacrosse goal — sticks-up spark-rain celebration',       'universal', Goal,         withMeasuredHeight(LxGoalWidget),           { scorer: 'RAMBO', number: '1', score: '8-6' }),
  W('CEL_LX_BEHINDTHEBACK',   CAT_CEL_MORE, 'Behind-the-Back Goal', 'Lacrosse highlight-reel behind-the-back goal',           'universal', Sparkles,     withMeasuredHeight(LxBehindTheBackWidget),  { player: 'GAIT', distance: '10 YD' }),
  W('CEL_LX_BIGSAVE',         CAT_CEL_MORE, 'Lacrosse Big Save',    'Lacrosse goalie stonewall — save count',                 'universal', Shield,       withMeasuredHeight(LxBigSaveWidget),        { goalie: 'GAUDET', saves: 11 }),
  W('CEL_LX_FACEOFF',         CAT_CEL_MORE, 'Face-Off Win',         'Lacrosse face-off win — arrow-sweep with win rate',      'universal', GitCompareArrows, withMeasuredHeight(LxFaceoffWidget),     { player: "O'CONNOR", winPct: 78 }),
  W('CEL_WR_PIN',             CAT_CEL_MORE, 'Wrestling Pin',        'Wrestling pin — blinking 1-2-3 count',                   'universal', Award,        withMeasuredHeight(WrPinWidget),            { winner: 'JORDAN BURROUGHS', weight: '74 KG', time: '1:47' }),
  W('CEL_WR_TAKEDOWN',        CAT_CEL_MORE, 'Wrestling Takedown',   'Wrestling takedown — +2 callout',                        'universal', Zap,          withMeasuredHeight(WrTakedownWidget),       { wrestler: 'TAYLOR', score: '7-2' }),
  W('CEL_WR_NEARFALL',        CAT_CEL_MORE, 'Near Fall',            'Wrestling near fall — back-points callout',              'universal', TrendingUp,   withMeasuredHeight(WrNearFallWidget),       { wrestler: 'STEVESON', points: 4, score: '11-2' }),
  W('CEL_WR_TECHFALL',        CAT_CEL_MORE, 'Technical Fall',       'Wrestling technical fall — match-over spark-rain',       'universal', Award,        withMeasuredHeight(WrTechFallWidget),       { winner: 'DAKE', lead: '17-2' }),
  W('CEL_GF_ACE',             CAT_CEL_MORE, 'Hole-in-One',          'Golf hole-in-one — flag-pin trajectory celebration',     'universal', Flag,         withMeasuredHeight(GfAceWidget),            { player: 'WOODS', hole: 7, yards: 165 }),
  W('CEL_GF_EAGLE',           CAT_CEL_MORE, 'Golf Eagle',           'Golf eagle — under-par score callout',                   'universal', TrendingUp,   withMeasuredHeight(GfEagleWidget),          { player: 'SCHEFFLER', score: '-7' }),
  W('CEL_GF_BIRDIE',          CAT_CEL_MORE, 'Golf Birdie',          'Golf birdie — one-under callout with tourney score',     'universal', Goal,         withMeasuredHeight(GfBirdieWidget),         { player: 'MORIKAWA', hole: 5, score: '-3' }),
  W('CEL_BX_KNOCKOUT',        CAT_CEL_MORE, 'Knockout',             'Boxing/MMA knockout — fight-over screen-shake',          'universal', Zap,          withMeasuredHeight(BxKnockoutWidget),       { winner: 'FURY', round: 4, time: '2:31' }),
  W('CEL_BX_TKO',             CAT_CEL_MORE, 'TKO',                  'Boxing/MMA TKO — ref-stops-it callout',                  'universal', AlertOctagon, withMeasuredHeight(BxTkoWidget),            { winner: 'USYK', round: 6 }),
  W('CEL_BX_KNOCKDOWN',       CAT_CEL_MORE, 'Knockdown',            'Boxing/MMA knockdown — bass-thump standing count',       'universal', AlertOctagon, withMeasuredHeight(BxKnockdownWidget),      { winner: 'CANELO', round: 3, count: 7 }),
  W('CEL_BX_ENDOFROUND',      CAT_CEL_MORE, 'End of Round',         'Boxing/MMA end-of-round — punches-landed tally',         'universal', CircleEqual,  withMeasuredHeight(BxEndOfRoundWidget),     { round: 6, p1: 'CANELO', p2: 'BIVOL', p1Punches: 48, p2Punches: 31 }),
  W('CEL_TR_WORLDRECORD',     CAT_CEL_MORE, 'Track World Record',   'Track & field world record — spark-rain finale',        'universal', Crown,        withMeasuredHeight(TrWorldRecordWidget),    { athlete: 'BOLT', event: '100M', time: '9.58s', country: 'JAM' }),
  W('CEL_TR_FINISH',          CAT_CEL_MORE, 'Track Finish',         'Track & field finish — top-3 medal podium',              'universal', ListOrdered,  withMeasuredHeight(TrFinishWidget),         { event: '400M FINAL' }),
  W('CEL_TR_PERSONALBEST',    CAT_CEL_MORE, 'Personal Best',        'Track & field personal best — time-delta callout',       'universal', TrendingUp,   withMeasuredHeight(TrPersonalBestWidget),   { athlete: 'RICHARDSON', event: '100M', time: '10.65', delta: '-0.18' }),
  W('CEL_SW_RECORD',          CAT_CEL_MORE, 'Swimming Record',      'Swimming world record — lane-line spark-rain',           'universal', Crown,        withMeasuredHeight(SwRecordWidget),         { athlete: 'LEDECKY', event: '1500M', time: '15:20.48' }),
  W('CEL_SW_FINISH',          CAT_CEL_MORE, 'Swimming Finish',      'Swimming race finish — top-3 lane podium',               'universal', ListOrdered,  withMeasuredHeight(SwFinishWidget),         { event: '100M FREE' }),
  W('CEL_SW_SPLIT',           CAT_CEL_MORE, 'Swimming Split',       'Swimming split milestone — pace vs world record',        'universal', Activity,     withMeasuredHeight(SwSplitWidget),          { athlete: 'PHELPS', split: '1:55.31', vsWR: '-0.42', lap: 3 }),
  // T1-5: auto-fired status-transition cinematics.
  W('CEL_STATUS_HALFTIME',    CAT_CEL_MORE, 'Halftime Break',       'Status cinematic: team scores + big HALFTIME headline (~4 s)',   'universal', Flag,     withMeasuredHeight(CelHalftimeWidget),      { homeTeam: 'EAGLES', awayTeam: 'HAWKS', homeScore: 14, awayScore: 7 }),
  W('CEL_STATUS_FINAL',       CAT_CEL_MORE, 'Final — Game Over',    'Status cinematic: winner emphasis + score recap (~5 s)',         'universal', Trophy,   withMeasuredHeight(CelFinalWidget),         { homeTeam: 'EAGLES', awayTeam: 'HAWKS', homeScore: 21, awayScore: 17, winner: 'home' }),
  W('CEL_STATUS_HORN',        CAT_CEL_MORE, 'Horn / Period End',    'Status cinematic: urgent 1.5 s horn burst with segment label',  'universal', Bell,     withMeasuredHeight(CelHornWidget),          { segmentLabel: 'Q1' }),
];

/* ─── BACKGROUNDS — drop-in template backgrounds (EDU CMS-7) ─────────
 * Universal: a background fits every vertical. Each Component sizes off
 * a pixel `height`, so all are wrapped in withMeasuredHeight.
 * (variants-register.ts maps 'Backgrounds' → BACKGROUND.) */
const CAT_BACKGROUNDS = 'Backgrounds';

export const BACKGROUNDS_WIDGETS: RegisteredWidget[] = [
  W('BG_INDIGO_MIDNIGHT', CAT_BACKGROUNDS, 'Indigo Midnight',     'Deep indigo-to-violet diagonal gradient',          'universal', Sparkle,    withMeasuredHeight(BgIndigoMidnight),  {}),
  W('BG_AURORA',          CAT_BACKGROUNDS, 'Aurora',              'Teal-to-violet aurora gradient',                   'universal', Sparkle,    withMeasuredHeight(BgAurora),          {}),
  W('BG_GOLDEN_HOUR',     CAT_BACKGROUNDS, 'Golden Hour',         'Warm amber-to-rust sunset gradient',               'universal', Sparkle,    withMeasuredHeight(BgGoldenHour),      {}),
  W('BG_FOREST_DEEP',     CAT_BACKGROUNDS, 'Forest Deep',         'Deep evergreen diagonal gradient',                 'universal', Sparkle,    withMeasuredHeight(BgForestDeep),      {}),
  W('BG_PEACH_CREAM',     CAT_BACKGROUNDS, 'Peach Cream',         'Soft cream-to-peach pastel gradient',              'universal', Sparkle,    withMeasuredHeight(BgPeachCream),      {}),
  W('BG_OCEAN_BLUE',      CAT_BACKGROUNDS, 'Ocean Blue',          'Deep-to-bright ocean blue gradient',               'universal', Sparkle,    withMeasuredHeight(BgOceanBlue),       {}),
  W('BG_MESH_VIOLET',     CAT_BACKGROUNDS, 'Mesh · Violet Plum',  'Multi-blob violet-plum mesh gradient',             'universal', Layers,     withMeasuredHeight(BgMeshViolet),      {}),
  W('BG_MESH_OCEAN',      CAT_BACKGROUNDS, 'Mesh · Ocean Glow',   'Multi-blob ocean-glow mesh gradient',              'universal', Layers,     withMeasuredHeight(BgMeshOcean),       {}),
  W('BG_MESH_DESERT',     CAT_BACKGROUNDS, 'Mesh · Desert Dusk',  'Multi-blob desert-dusk mesh gradient',             'universal', Layers,     withMeasuredHeight(BgMeshDesert),      {}),
  W('BG_DIAMOND_TILE',    CAT_BACKGROUNDS, 'Diamond Tile',        'Repeating diamond-tile geometric pattern',         'universal', Grid3x3,    withMeasuredHeight(BgDiamondTile),     { tone1: '#0a0e2a', tone2: '#7b5cff', tileSize: 60 }),
  W('BG_DOTS_GRID',       CAT_BACKGROUNDS, 'Dots Grid',           'Soft polka-dot grid pattern',                      'universal', CircleDot,  withMeasuredHeight(BgDotsGrid),        { base: '#f7f7f5', dot: '#0b0c0e22', spacing: 32 }),
  W('BG_TOPO_LINES',      CAT_BACKGROUNDS, 'Topographic Lines',   'Layered topographic contour lines',                'universal', Spline,     withMeasuredHeight(BgTopoLines),       { base: '#0d2226', line: '#13a6ad', density: 18 }),
  W('BG_ANIMATED_FLOW',   CAT_BACKGROUNDS, 'Animated Flow',       'Slow-drifting animated blur-blob background',      'universal', Waves,      withMeasuredHeight(BgAnimatedFlow),    { speed: 1 }),
  W('BG_PHOTO_LOBBY_WARM',CAT_BACKGROUNDS, 'Hotel Lobby (Warm)',  'Warm hotel-lobby photo placeholder, tinted',       'universal', ImageIcon2, withMeasuredHeight(BgPhotoLobbyWarm),  {}),
  W('BG_PHOTO_CAMPUS',    CAT_BACKGROUNDS, 'Campus Quad',         'Campus-quad photo placeholder, tinted',            'universal', ImageIcon2, withMeasuredHeight(BgPhotoCampus),     {}),
  W('BG_PHOTO_HOSPITAL',  CAT_BACKGROUNDS, 'Hospital Atrium',     'Hospital-atrium photo placeholder, tinted',        'universal', ImageIcon2, withMeasuredHeight(BgPhotoHospital),   {}),
  W('BG_PHOTO_RETAIL',    CAT_BACKGROUNDS, 'Retail Interior',     'Retail-interior photo placeholder, tinted',        'universal', ImageIcon2, withMeasuredHeight(BgPhotoRetail),     {}),
];

/* ─── LIVE DATA — universal data feeds (EDU CMS-7) ───────────────────
 * Markets, news, weather, transit — rendered from config with sample
 * defaults. Universal. Each Component sizes off a pixel `height`.
 * (variants-register.ts maps 'Live Data' → LIVE_DATA.) */
const CAT_LIVE_DATA = 'Live Data';

export const LIVE_DATA_WIDGETS: RegisteredWidget[] = [
  W('SPORTS_SCOREBOARD', CAT_LIVE_DATA, 'Live Scoreboard',  'Multi-game live scoreboard grid for a league',        'universal', Tv,          withMeasuredHeight(LiveSportsScoreboardWidget), { league: 'NBA', accent: '#ffd23a' }),
  W('STOCK_TICKER',      CAT_LIVE_DATA, 'Stock Ticker',     'Market tiles plus a scrolling stock ticker band',     'universal', TrendingUp,  withMeasuredHeight(StockTickerWidget),         { exchange: 'NYSE / NASDAQ' }),
  W('CRYPTO_TICKER',     CAT_LIVE_DATA, 'Crypto Ticker',    '24-hour cryptocurrency price board',                  'universal', Coins,       withMeasuredHeight(CryptoTickerWidget),        {}),
  W('NEWS_HEADLINES',    CAT_LIVE_DATA, 'News Headlines',   'Breaking-news headline list from an RSS source',      'universal', Newspaper,   withMeasuredHeight(NewsHeadlinesWidget),       { source: 'AP · Reuters · BBC', accent: '#e7142b' }),
  W('AIR_QUALITY',       CAT_LIVE_DATA, 'Air Quality',      'Air-quality index gauge with pollutant breakdown',    'universal', Wind,        withMeasuredHeight(AirQualityWidget),          { location: 'Springfield, IL', aqi: 62, pm25: 14, pm10: 28, o3: 52, no2: 12 }),
  W('WORLD_CLOCKS',      CAT_LIVE_DATA, 'World Clocks',     'Live multi-timezone clock cards',                     'universal', Globe,       withMeasuredHeight(WorldClocksWidget),         { hour12: false }),
  W('FX_RATES',          CAT_LIVE_DATA, 'FX Rates',         'Foreign-exchange rate board against a base currency', 'universal', DollarSign,  withMeasuredHeight(FxRatesWidget),             { base: 'USD' }),
  W('TRAFFIC_CAM',       CAT_LIVE_DATA, 'Traffic Cameras',  'DOT traffic-camera grid with congestion status',     'universal', TrafficCone, withMeasuredHeight(TrafficCamWidget),          { city: 'I-5 Corridor' }),
];

/* ─── TOUCH & ENGAGE — interactive kiosk surfaces (EDU CMS-7) ────────
 * Universal touch widgets — photo booth, sign-in, language, feedback,
 * games, wayfinding, fundraising. Each Component sizes off `height`.
 * (variants-register.ts maps 'Touch & Engage' → TOUCH_POINT.) */
const CAT_TOUCH_ENGAGE = 'Touch & Engage';

export const TOUCH_ENGAGE_WIDGETS: RegisteredWidget[] = [
  W('PHOTO_BOOTH',          CAT_TOUCH_ENGAGE, 'Photo Booth',         'Kiosk photo booth — frame picker and countdown',       'universal', Camera,        withMeasuredHeight(PhotoBoothWidget),          { frames: ['Polaroid', 'Strip', 'Grid 4', 'Single'], countdownSec: 3 }),
  W('SIGN_IN_PAD',          CAT_TOUCH_ENGAGE, 'Visitor Sign-In Pad', 'Visitor sign-in form with a visit-type picker',        'universal', UserPlus,      withMeasuredHeight(SignInPadWidget),           { visitTypes: ['Meeting', 'Interview', 'Delivery', 'Vendor', 'Tour', 'Other'] }),
  W('LANGUAGE_PICKER',      CAT_TOUCH_ENGAGE, 'Language Picker',     'Tap-to-select language grid with native names',       'universal', Languages,     withMeasuredHeight(LanguagePickerWidget),      {}),
  W('ACCESSIBILITY_TRAY',   CAT_TOUCH_ENGAGE, 'Accessibility Tray',  'On-screen accessibility controls — text, contrast',    'universal', Accessibility, withMeasuredHeight(AccessibilityTrayWidget),   {}),
  W('NPS_SMILEY',           CAT_TOUCH_ENGAGE, 'Feedback Smileys',    'One-tap NPS smiley feedback prompt',                   'universal', SmilePlus,     withMeasuredHeight(NpsSmileyWidget),           { question: 'How was your visit?' }),
  W('TRIVIA_GAME',          CAT_TOUCH_ENGAGE, 'Trivia Game',         'Timed multiple-choice trivia question card',           'universal', Lightbulb,     withMeasuredHeight(TriviaGameWidget),          { question: 'Which planet is closest to the Sun?', options: ['Venus', 'Mercury', 'Mars', 'Jupiter'] }),
  W('SPIN_TO_WIN',          CAT_TOUCH_ENGAGE, 'Spin-to-Win Wheel',   'Spin-to-win prize wheel for promotions',               'universal', Disc3,         withMeasuredHeight(SpinToWinWidget),           { intro: "TONIGHT'S GIVEAWAY" }),
  W('DIRECTORY_SEARCH',     CAT_TOUCH_ENGAGE, 'Directory Search',    'Searchable people directory with category chips',      'universal', Search,        withMeasuredHeight(DirectorySearchWidget),     { searchOf: 'doctor' }),
  W('WAYFINDING_FLOOR_MAP', CAT_TOUCH_ENGAGE, 'Wayfinding Floor Map','Interactive floor map with route and floor picker',    'universal', MapIcon,       withMeasuredHeight(WayfindingFloorMapWidget),  { floors: [1, 2, 3, 4, 5], currentFloor: 2 }),
  W('DONATION_THERMOMETER', CAT_TOUCH_ENGAGE, 'Donation Thermometer','Fundraiser progress meter with a donate QR code',      'universal', HeartHandshake, withMeasuredHeight(DonationThermometerWidget), { goal: 50000, raised: 32800, donors: 246, daysLeft: 14, qrLabel: 'donate.school.org' }),
];

/* ─── TRANSIT — airport / transit boards (EDU CMS-7) ─────────────────
 * Universal transit widgets — departures, flight status, transit
 * arrivals, parking. Each Component sizes off a pixel `height`.
 * (variants-register.ts maps 'Transit' → LIVE_DATA.) */
const CAT_TRANSIT = 'Transit';

export const TRANSIT_WIDGETS: RegisteredWidget[] = [
  W('DEPARTURES_BOARD',     CAT_TRANSIT, 'Departures Board',     'Airport split-flap departures board',               'universal', PlaneTakeoff,  withMeasuredHeight(DeparturesBoardWidget),     { airport: 'SFO · TERMINAL 2' }),
  W('FLIGHT_STATUS_HERO',   CAT_TRANSIT, 'Flight Status Hero',   'Single-flight status hero — route, gate, boarding',  'universal', Plane,         withMeasuredHeight(FlightStatusHeroWidget),    { flight: 'UA 504', from: 'SFO', fromCity: 'San Francisco', to: 'JFK', toCity: 'New York', depTime: '14:30', arrTime: '22:52', status: 'ON TIME', gate: 'B07', board: '13:50', terminal: '2', aircraft: 'Boeing 737-900' }),
  W('TRANSIT_DEPARTURES',   CAT_TRANSIT, 'Transit Departures',   'Next-trains board — line, destination, minutes',     'universal', TrainFront,    withMeasuredHeight(TransitDeparturesWidget),   { station: 'EMBARCADERO' }),
  W('PARKING_AVAILABILITY', CAT_TRANSIT, 'Parking Availability', 'Live parking-lot availability with capacity bars',  'universal', SquareParking, withMeasuredHeight(ParkingAvailabilityWidget), { facility: 'SFO TERMINAL 2' }),
];

/* ─── ALL ───────────────────────────────────────────────────────────── */
// 2026-05-19 — per-vertical widget scoping, "universal-by-default"
// model (operator: "widgets should not be shared across business lines
// unless it makes sense — don't give me K-12 widgets in every single
// one"). Genuinely cross-industry widgets stay universal (no tag);
// industry-specific ones are scoped to the verticals where they make
// sense. Canonical verticals: K12 | GYM | RETAIL | CORPORATE | QSR |
// FASHION | BAR | HEALTHCARE | HOSPITALITY | RESTAURANT | SPORTS.
const FOOD_SERVICE_VERTICALS = ['K12', 'QSR', 'RESTAURANT', 'HOSPITALITY', 'BAR', 'CORPORATE'];
const PEOPLE_ORG_VERTICALS = ['K12', 'CORPORATE', 'HEALTHCARE', 'WORSHIP'];
const BIG_BUILDING_VERTICALS = ['CORPORATE', 'HOSPITALITY', 'HEALTHCARE', 'K12'];

export const ALL_V2_WIDGETS: RegisteredWidget[] = [
  // ── Genuinely universal — every vertical has clocks, weather, text,
  //    images, logos, countdowns, tickers, headlines, calendars, rich
  //    text, photos. No vertical tag → shown everywhere. ──
  ...CLOCK_WIDGETS, ...HEADLINE_WIDGETS, ...ANNOUNCEMENT_WIDGETS, ...CALENDAR_WIDGETS,
  ...COUNTDOWN_WIDGETS, ...LOGO_WIDGETS, ...TICKER_WIDGETS,
  ...WEATHER_WIDGETS, ...PHOTO_WIDGETS, ...RICHTEXT_WIDGETS, ...IMAGE_WIDGETS,
  // ── Cross-over widgets — scoped to the verticals where they fit. ──
  // Staff / team / employee spotlight: schools, offices, clinics,
  // congregations all spotlight people. Not a restaurant / retail thing.
  ...withVerticals(PEOPLE_ORG_VERTICALS, STAFF_WIDGETS),
  // Lunch / menu boards: anywhere food is served. Hidden from
  // healthcare / sports / retail / fashion / worship.
  ...withVerticals(FOOD_SERVICE_VERTICALS, LUNCH_WIDGETS),
  // Bell schedule: K-12 ONLY — a corporate lobby has no bell schedule.
  ...withVerticals(['K12'], BELL_WIDGETS),
  // VenueOS Sports — celebration ribbons + venue surfaces, scoped to the
  // SPORTS vertical so they never appear in a school / restaurant /
  // clinic palette.
  ...withVertical('SPORTS', [
    ...CEL_BASEBALL_WIDGETS, ...CEL_FOOTBALL_WIDGETS, ...CEL_BASKETBALL_WIDGETS,
    ...CEL_HOCKEY_WIDGETS, ...CEL_SOCCER_WIDGETS,
    ...SCOREBOARD_WIDGETS,
    ...SPORTS_VENUE_WIDGETS, ...CELEBRATIONS_MORE_WIDGETS,
  ]),
  // Industry packs — each scoped to its own business line.
  ...withVertical('HEALTHCARE', HEALTHCARE_WIDGETS),
  ...withVertical('CORPORATE', CORPORATE_WIDGETS),
  ...withVertical('HOSPITALITY', HOSPITALITY_WIDGETS),
  ...withVertical('WORSHIP', WORSHIP_WIDGETS),
  ...withVertical('RETAIL', RETAIL_WIDGETS),
  // Charts are universal — a KPI bar chart fits every vertical, so no
  // vertical tag (shows in every palette).
  ...CHART_WIDGETS,
  // VenueOS universal packs — backgrounds, live data feeds, touch
  // engagement. No vertical tag — every palette.
  ...BACKGROUNDS_WIDGETS, ...LIVE_DATA_WIDGETS,
  ...TOUCH_ENGAGE_WIDGETS,
  // Transit / departure boards: big multi-wing buildings with shuttles,
  // campuses, hospital transit, hotel airport runs. Not a QSR / retail
  // / bar / sports thing.
  ...withVerticals(BIG_BUILDING_VERTICALS, TRANSIT_WIDGETS),
];

export const V2_BY_TYPE: Record<string, RegisteredWidget> = Object.fromEntries(
  ALL_V2_WIDGETS.map(w => [w.type, w])
);

export const V2_GROUPS: { label: string; types: { type: string; label: string; desc: string; icon: LucideIcon }[] }[] = (() => {
  const byCat = new Map<string, RegisteredWidget[]>();
  for (const w of ALL_V2_WIDGETS) {
    if (!byCat.has(w.category)) byCat.set(w.category, []);
    byCat.get(w.category)!.push(w);
  }
  const out: { label: string; types: { type: string; label: string; desc: string; icon: LucideIcon }[] }[] = [];
  for (const [cat, ws] of byCat) {
    out.push({ label: cat, types: ws.map(w => ({ type: w.type, label: w.label, desc: w.desc, icon: w.icon })) });
  }
  return out;
})();
