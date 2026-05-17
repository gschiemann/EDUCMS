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

/** Stamp a business-line vertical onto a batch of widgets. Applied at
 *  the ALL_V2_WIDGETS assembly point so the per-pack arrays stay clean
 *  and a widget appears only in its own vertical's builder palette. */
const withVertical = (vertical: string, widgets: RegisteredWidget[]): RegisteredWidget[] =>
  widgets.map((w) => ({ ...w, vertical }));

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

export const CHART_WIDGETS: RegisteredWidget[] = [
  W('CHART_BAR',         CAT_CHARTS, 'Bar Chart',      'Categorical bars with auto-labeled values', 'universal', BarChart3,  withMeasuredHeight(BarChartWidget),     { label: 'Weekly signups', title: 'New users · last 7 days' }),
  W('CHART_DONUT_GAUGE', CAT_CHARTS, 'Donut Gauge',    'Big circular gauge with a goal target',     'universal', PieChart,   withMeasuredHeight(DonutGaugeWidget),   { label: 'NPS · Last 30d', title: 'Customer satisfaction', value: 78, goal: 100 }),
  W('CHART_LINE',        CAT_CHARTS, 'Line Chart',     'Multi-series line chart with grid',         'universal', LineChart,  withMeasuredHeight(LineChartWidget),    { label: '6-week trend', title: 'Revenue vs forecast' }),
  W('CHART_PROGRESS',    CAT_CHARTS, 'Progress List',  'Stacked progress bars',                     'universal', ListChecks, withMeasuredHeight(ProgressListWidget), { label: 'Project status', title: 'Where we are this week' }),
  W('CHART_COUNTUP',     CAT_CHARTS, 'Count-Up Stats', 'Four big-number stat cards',                'universal', Calculator, withMeasuredHeight(CountUpStatsWidget),  { label: 'By the numbers', title: 'A year in numbers' }),
];

/* ─── ALL ───────────────────────────────────────────────────────────── */
export const ALL_V2_WIDGETS: RegisteredWidget[] = [
  ...CLOCK_WIDGETS, ...HEADLINE_WIDGETS, ...ANNOUNCEMENT_WIDGETS, ...CALENDAR_WIDGETS,
  ...STAFF_WIDGETS, ...COUNTDOWN_WIDGETS, ...LOGO_WIDGETS, ...TICKER_WIDGETS,
  ...WEATHER_WIDGETS, ...PHOTO_WIDGETS, ...RICHTEXT_WIDGETS, ...IMAGE_WIDGETS,
  ...LUNCH_WIDGETS, ...BELL_WIDGETS,
  // VenueOS Sports — celebration ribbons, scoped to the SPORTS vertical
  // so they never appear in a school / restaurant / clinic palette.
  ...withVertical('SPORTS', [
    ...CEL_BASEBALL_WIDGETS, ...CEL_FOOTBALL_WIDGETS, ...CEL_BASKETBALL_WIDGETS,
    ...CEL_HOCKEY_WIDGETS, ...CEL_SOCCER_WIDGETS,
  ]),
  // Industry packs — each scoped to its own business line.
  ...withVertical('HEALTHCARE', HEALTHCARE_WIDGETS),
  ...withVertical('CORPORATE', CORPORATE_WIDGETS),
  ...withVertical('HOSPITALITY', HOSPITALITY_WIDGETS),
  ...withVertical('WORSHIP', WORSHIP_WIDGETS),
  // Charts are universal — a KPI bar chart fits every vertical, so no
  // vertical tag (shows in every palette).
  ...CHART_WIDGETS,
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
