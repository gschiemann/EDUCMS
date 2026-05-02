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

/* ─── ALL ───────────────────────────────────────────────────────────── */
export const ALL_V2_WIDGETS: RegisteredWidget[] = [
  ...CLOCK_WIDGETS, ...HEADLINE_WIDGETS, ...ANNOUNCEMENT_WIDGETS, ...CALENDAR_WIDGETS,
  ...STAFF_WIDGETS, ...COUNTDOWN_WIDGETS, ...LOGO_WIDGETS, ...TICKER_WIDGETS,
  ...WEATHER_WIDGETS, ...PHOTO_WIDGETS, ...RICHTEXT_WIDGETS, ...IMAGE_WIDGETS,
  ...LUNCH_WIDGETS, ...BELL_WIDGETS,
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
