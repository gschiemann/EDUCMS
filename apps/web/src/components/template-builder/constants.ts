import type { LucideIcon } from 'lucide-react';
import {
  Play, Image as ImageIcon, Globe, Type, Bell, Clock, Cloud, Timer,
  CalendarDays, Megaphone, UtensilsCrossed, Users, Rss, Share2, Shield,
  ArrowRight, Square, FileText, ListVideo,
  Cake,
  // Sprint 11h decorations.
  PartyPopper, Rainbow, Sparkles, Zap, Sun,
  // 2026-05-03 — VenueOS fitness/gym widget icons.
  Tv, Music, MonitorPlay, Dumbbell, Quote, AppWindow, Joystick,
  // 2026-05-02 — VenueOS restaurant/QSR widget icons.
  Pizza, ChefHat, Hourglass, Star, BadgePercent, Leaf,
  // 2026-05-02 — VenueOS bar/nightlife widget icons.
  Beer, Wine, Martini, Trophy, Mic2, Brain,
  // 2026-05-03 — VenueOS retail widget icons.
  ShoppingBag, Tag, MapPin, QrCode, Layers, Store,
  // 2026-05-12 — Touch widget palette (Phase D2.9).
  Hand, Circle, MousePointerClick, ArrowLeft, ArrowUp, ArrowDown,
  ChevronRight as ChevronRightIcon,
  // 2026-05-12 — Touch nav button set (Phase D2.10): home/back/next/
  // close/menu/help/play. Mirrors the standard kiosk nav-bar
  // vocabulary every competing interactive-signage tool ships by
  // default (Intuiface, OptiSigns Engage, BrightSign, PandaSuite).
  Home, X as CloseIcon, Menu as MenuIcon, HelpCircle, Play as PlayIcon,
  // 2026-05-12 — Communication + engagement + utility touch widgets
  // (Phase D2.11). Closes the competitive gap with mature interactive
  // signage tools — QR scan-with-phone, info reveals, share/email/
  // phone, star/heart engagement, search/volume/print utility. All
  // mapped to TOUCH_POINT variants on the canvas.
  Info as InfoIcon, Search, Phone, Mail, Heart, Volume2 as VolumeIcon,
  Printer,
} from 'lucide-react';
// The "School Life" (QUOTE / STATS / SCOREBOARD / MENU_ITEM /
// SCHEDULE_GRID / ATTENDANCE / BIRTHDAYS / HONOR_ROLL) and
// "Touch / Interactive" (TOUCH_BUTTON / TOUCH_MENU / ROOM_FINDER /
// ON_SCREEN_KEYBOARD / WAYFINDING_MAP / QUICK_POLL) groups plus the
// standalone ANIMATED_BACKGROUND widget have been temporarily hidden
// from the Add-Widget picker (2026-04-23 customer-readiness audit).
// Rationale: they had no corresponding editor in PropertiesPanel,
// so picking one left the operator with no way to configure it —
// violates the Integration Lead's "can't pick a widget you can't
// edit" rule. No existing preset references any of them (verified
// via grep), so hiding is a pure no-op for shipped content. Ship
// them back one at a time as their editor ships.

// 2026-05-03 — VenueOS rebrand. Each group gets a `verticals` field
// listing which industries see the group in their palette. Empty /
// missing field means "all verticals" (universal — everyone sees it).
//
// (Historical note: WIDGET_GROUPS was originally the source-of-truth
// for the WidgetPalette picker, which was deleted 2026-05-12. The V2
// builder renders VariantPicker which uses variants-register.ts for
// its tile set, NOT this list. WIDGET_GROUPS is still useful here as
// the label/icon/color registry consumed by widgetLabel(), widgetIcon(),
// getZoneColor(), and the bottom of this file — but adding a new tile
// HERE will NOT make it appear in the operator's palette. Register
// the variant in variants-register.ts instead.)
// Filter previously applied in WidgetPalette via useTenantCopy().vertical so a
// gym admin sees Media + Web & Text + Utility + Decorations + Fitness;
// they DON'T see Education + Animated Scenes + Scrapbook + Storybook
// (those are K12-only). A school admin sees the K12 groups as before
// and DOES NOT see the Fitness group.
//
// Adding new vertical-specific groups: set `verticals: ['QSR']` etc.
// Universal widgets stay in groups with no verticals filter.
export const WIDGET_GROUPS: ReadonlyArray<{
  label: string;
  /** If undefined OR empty, group is universal. Otherwise only shown to listed verticals. */
  // 2026-05-03 — added 'BAR' to match the BAR vertical that landed in
  // packages/api-types/src/verticals.ts. Keep this union in sync with
  // VERTICALS in that file when new verticals ship.
  verticals?: ReadonlyArray<'K12' | 'GYM' | 'RETAIL' | 'CORPORATE' | 'QSR' | 'FASHION' | 'BAR'>;
  types: ReadonlyArray<{ type: string; label: string; desc: string; icon: LucideIcon }>;
}> = [
  // Phase D2.9-D2.11 (2026-05-12) — Touch widgets. Pinned to the TOP
  // of the palette so operators see them first. Operator: "where are
  // the touch widgets? I expected a pill just like all the other
  // widgets called touch." Burying these at the bottom of a long
  // scroll past Education / Animated Scenes / Decorations hid them
  // behind 60+ other tiles.
  //
  // Every tile here canonicalizes to widgetType='TOUCH_POINT' with a
  // `variant` field on defaultConfig — same pattern Decorations use,
  // one widget type and many variants. Dropping any tile auto-
  // enables the template's isTouchEnabled flag so the old "Make this
  // template interactive" toggle is now a tiny status row.
  //
  // Universal — every vertical (school lobby, gym, retail, QSR) uses
  // touch hotspots, so no `verticals` filter.
  {
    label: 'Touch (Tap & Go)',
    types: [
      // ── Generic hotspots + shapes ──
      { type: 'TOUCH_HOTSPOT',      label: 'Transparent Hotspot', desc: 'Invisible tap area — drop on top of any content to make it tappable', icon: Hand },
      { type: 'TOUCH_TAP_PROMPT',   label: 'Tap Here Button',     desc: 'Visible "Tap to continue" button with hand icon — best for kiosk start screens', icon: MousePointerClick },
      { type: 'TOUCH_CIRCLE',       label: 'Circle Button',       desc: 'Filled circle hotspot — clean "press here" indicator', icon: Circle },
      { type: 'TOUCH_SQUARE',       label: 'Square Button',       desc: 'Rounded-square button — drop, label it via Properties, set Tap Action', icon: Square },
      // ── Directional arrows ──
      { type: 'TOUCH_ARROW_RIGHT',  label: 'Right Arrow',         desc: 'Right-pointing arrow — pair with content panes for "Next" gestures', icon: ArrowRight },
      { type: 'TOUCH_ARROW_LEFT',   label: 'Left Arrow',          desc: 'Left-pointing arrow — back / previous navigation', icon: ArrowLeft },
      { type: 'TOUCH_ARROW_UP',     label: 'Up Arrow',            desc: 'Up arrow — scroll / page-up patterns', icon: ArrowUp },
      { type: 'TOUCH_ARROW_DOWN',   label: 'Down Arrow',          desc: 'Down arrow — scroll / page-down patterns', icon: ArrowDown },
      // ── Standard kiosk nav vocabulary ──
      // Every competing interactive-signage tool ships this set by
      // default (Intuiface, OptiSigns Engage, BrightSign, PandaSuite).
      // Visitors recognize them instantly — Home is a house, Close is
      // an X, Menu is a hamburger. Less mental work than custom
      // labels for navigation chrome.
      { type: 'TOUCH_HOME',         label: 'Home Button',         desc: 'House-icon button — "Return to start screen"; pair with goto-template back to your default', icon: Home },
      { type: 'TOUCH_BACK',         label: 'Back Chip',           desc: 'Labeled "← Back" pill — bigger touch target than a plain arrow', icon: ArrowLeft },
      { type: 'TOUCH_NEXT',         label: 'Next Chip',           desc: 'Labeled "Next →" pill — primary advance action with clear text', icon: ArrowRight },
      { type: 'TOUCH_CLOSE',        label: 'Close Button',        desc: 'X-icon dismiss button — pair with reset-idle / goto-scene back to the lobby', icon: CloseIcon },
      { type: 'TOUCH_MENU',         label: 'Menu Button',         desc: 'Hamburger icon — open a sub-menu via goto-scene', icon: MenuIcon },
      { type: 'TOUCH_HELP',         label: 'Help Button',         desc: 'Question-mark button — opens help overlay or request-help action', icon: HelpCircle },
      { type: 'TOUCH_PLAY',         label: 'Play Button',         desc: 'Big play triangle — pair with play-video Tap Action for video CTAs', icon: PlayIcon },
      // ── Communication actions ──
      // Standard kiosk patterns that ship across every competitor.
      // QR is the highest-leverage: visitor scans with phone to
      // transfer the experience off the kiosk. Others compose with
      // open-url (tel: / mailto:), webhook, or show-overlay.
      { type: 'TOUCH_QR',           label: 'QR Code',             desc: 'Visible QR placeholder — pair with config.qrText to encode a URL the visitor scans', icon: QrCode },
      { type: 'TOUCH_INFO',         label: 'Info Button',         desc: 'Circled "i" — tap for show-overlay with details about nearby content', icon: InfoIcon },
      { type: 'TOUCH_PHONE',        label: 'Phone Button',        desc: 'Phone receiver — pair with open-url tel:+1... for "tap to call" actions', icon: Phone },
      { type: 'TOUCH_EMAIL',        label: 'Email Button',        desc: 'Envelope — pair with open-url mailto:... or webhook to send the visitor an email', icon: Mail },
      { type: 'TOUCH_SHARE',        label: 'Share Button',        desc: 'Share icon — pair with show-overlay for a sharing options panel', icon: Share2 },
      // ── Engagement actions ──
      // Common on retail / restaurant kiosks for rating, saving, or
      // expressing interest. Pair with webhook to log the action;
      // pair with show-overlay for a confirmation animation.
      { type: 'TOUCH_HEART',        label: 'Favorite (Heart)',    desc: 'Heart button — pair with webhook to log a favorite / save-for-later', icon: Heart },
      { type: 'TOUCH_STAR',         label: 'Star Rating',         desc: 'Star button — pair with webhook to log a 1-tap rating', icon: Star },
      // ── Utility ──
      { type: 'TOUCH_SEARCH',       label: 'Search Button',       desc: 'Magnifying glass — pair with show-overlay for a search panel or open-url to a search page', icon: Search },
      { type: 'TOUCH_VOLUME',       label: 'Volume Toggle',       desc: 'Speaker icon — pair with sound-toggle Tap Action to mute/unmute video', icon: VolumeIcon },
      { type: 'TOUCH_PRINT',        label: 'Print Button',        desc: 'Printer icon — pair with webhook to dispatch a print job to a connected printer', icon: Printer },
    ],
  },
  {
    label: 'Media',
    types: [
      { type: 'VIDEO', label: 'Video Player', desc: 'Play a single video file', icon: Play },
      // 2026-05-09 — VIDEO_CAROUSEL parity with IMAGE_CAROUSEL.
      // Operator: "i need to add multiple [videos]…do the research and
      // add it like everyone else does." Every signage CMS (Yodeck,
      // Rise Vision, OptiSigns, ScreenCloud) ships a multi-video
      // rotator. Same data shape as IMAGE_CAROUSEL: assetUrls + per-
      // slide intervalMs.
      { type: 'VIDEO_CAROUSEL', label: 'Video Carousel', desc: 'Rotate through multiple videos with per-slide timing', icon: Play },
      // 2026-05-03 — Sprint 8c streaming integrations. Universal across
      // every vertical: gyms show ESPN, bars stream sports, restaurants
      // run NHK World on the bar TV. Backed by StreamProviderConnection
      // rows so the channel pick + ad rotation persist server-side.
      { type: 'STREAMING', label: 'Live Stream', desc: 'HLS / YouTube / Twitch / public broadcasters with ad overlay', icon: Tv },
      { type: 'IMAGE', label: 'Single Image', desc: 'Display a photo or graphic', icon: ImageIcon },
      { type: 'IMAGE_CAROUSEL', label: 'Photo Slideshow', desc: 'Rotate through multiple photos with per-slide timing', icon: ImageIcon },
      { type: 'PLAYLIST', label: 'Content Playlist', desc: 'Play mixed content from a playlist', icon: ListVideo },
    ],
  },
  {
    label: 'Web & Text',
    types: [
      { type: 'WEBPAGE', label: 'URL / Website', desc: 'Drop a webpage anywhere on the canvas — size it however you want', icon: Globe },
      { type: 'TEXT', label: 'Text Block', desc: 'Simple text with custom styling', icon: Type },
      { type: 'RICH_TEXT', label: 'Rich Text', desc: 'Formatted text with headings & links', icon: FileText },
      { type: 'RSS_FEED', label: 'News Feed', desc: 'Headlines from any RSS source', icon: Rss },
      { type: 'SOCIAL_FEED', label: 'Social Media', desc: 'Posts from social accounts', icon: Share2 },
    ],
  },
  {
    label: 'Education',
    verticals: ['K12'],
    types: [
      { type: 'ANNOUNCEMENT', label: 'Announcement', desc: 'Eye-catching important message', icon: Megaphone },
      { type: 'BELL_SCHEDULE', label: 'Bell Schedule', desc: 'Class periods with highlights', icon: Bell },
      { type: 'LUNCH_MENU', label: 'Lunch Menu', desc: "Today's cafeteria menu", icon: UtensilsCrossed },
      { type: 'CALENDAR', label: 'Calendar', desc: 'Upcoming events from a feed', icon: CalendarDays },
      { type: 'COUNTDOWN', label: 'Countdown', desc: 'Count down to a special event', icon: Timer },
      { type: 'STAFF_SPOTLIGHT', label: 'Spotlight', desc: 'Feature a teacher or staff', icon: Users },
    ],
  },
  // 2026-05-03 — VenueOS Fitness group. The 9 widget renderers in
  // apps/web/src/components/widgets/fitness/ are wired into
  // WidgetRenderer.tsx but were never exposed in the editor's palette,
  // so a gym admin had no way to drop them onto a custom template.
  // ANNOUNCEMENT + COUNTDOWN are duplicated here as a convenience —
  // gyms also need general announce/countdown widgets and they
  // weren't visible in the gym palette without the Education group.
  {
    label: 'Gym & fitness',
    verticals: ['GYM'],
    types: [
      // 4K themed scene presets — full-canvas widgets that drop in as a
      // single zone (same shape as the K-12 MS_* / HS_* themed scenes).
      // 14 of 15 mockups from scratch/design/fitness/ shipped — Lobby
      // is the last one and follows the same drop-in pattern.
      { type: 'FITNESS_STADIUM',            label: 'Stadium — broadcast',  desc: '4K Jumbotron cardio scene — TV pane, scorebug, music + promo, stats', icon: Tv },
      { type: 'FITNESS_IRON',               label: 'Iron — weight floor',  desc: 'Brutalist concrete + caution-tape weight-floor section card', icon: Dumbbell },
      { type: 'FITNESS_MARQUEE',            label: 'Marquee — events',     desc: 'Vegas marquee bulb-border events board — neon glow + ticker', icon: Megaphone },
      { type: 'FITNESS_CHANNEL_GUIDE',      label: 'Channel guide',        desc: 'Cable-TV channel guide grid + now-watching preview', icon: Tv },
      { type: 'FITNESS_DISCOTHEQUE',        label: 'Discotheque — disco',  desc: 'Strobe + disco-ball energy — class promo + BPM + lasers', icon: Music },
      { type: 'FITNESS_LOCKER',             label: 'Locker — room board',  desc: 'Locker-room corkboard — shift schedule, polaroids, name tags', icon: AppWindow },
      { type: 'FITNESS_SPLASH',             label: 'Splash — pool deck',   desc: 'Aquatic deck board — lane status, hours, weather, water temp', icon: MonitorPlay },
      { type: 'FITNESS_TELEMETRY',          label: 'Telemetry — data',     desc: 'Data-dashboard bridge — gauges, leaderboard, live readouts', icon: Joystick },
      { type: 'FITNESS_CRAG',               label: 'Crag — climbing',      desc: 'Climbing wall route map — grades, sends, current setter', icon: Quote },
      { type: 'FITNESS_CORNERMAN',          label: 'Cornerman — boxing',   desc: 'Boxing-corner round timer + workout block + entrance music', icon: Dumbbell },
      { type: 'FITNESS_RECESS',             label: 'Recess — playful',     desc: 'Block-letter playground vibe — class block, kid schedule', icon: Music },
      { type: 'FITNESS_REFORMER',           label: 'Reformer — pilates',   desc: 'Boutique pilates studio — class moves, instructor, springs', icon: Quote },
      { type: 'FITNESS_TRAILHEAD',          label: 'Trailhead — outdoor',  desc: 'Hiking-trail board — running club routes + conditions', icon: MonitorPlay },
      { type: 'FITNESS_VAULT',              label: 'Vault — CrossFit WOD', desc: 'CrossFit-box WOD whiteboard — leaderboard + foundation stats', icon: Dumbbell },
      { type: 'FITNESS_LOBBY',              label: 'Lobby — concierge',    desc: 'Premium concierge / spa lobby — recovery booking, member greeting', icon: AppWindow },
      { type: 'FITNESS_CLASS_SCHEDULE',     label: 'Class schedule',      desc: "Today's gym classes — instructor, time, room", icon: CalendarDays },
      { type: 'FITNESS_LIVE_TV',            label: 'Live TV',             desc: 'TV channel pane (ESPN / FastChannel / streaming)', icon: Tv },
      { type: 'FITNESS_MUSIC_PLAYER',       label: 'Music player',        desc: 'Now-playing — track, artist, equalizer', icon: Music },
      { type: 'FITNESS_TRAINING_VIDEO',     label: 'Training video',      desc: 'Equipment tutorial loop — looping how-to clips', icon: MonitorPlay },
      { type: 'FITNESS_WORKOUT_TIMER',      label: 'Workout timer',       desc: 'HIIT / Tabata / interval countdown', icon: Dumbbell },
      { type: 'FITNESS_AD_BANNER',          label: 'Promo banner',        desc: 'Rotating gym promo creative — class signups, deals', icon: Megaphone },
      { type: 'FITNESS_MOTIVATIONAL_QUOTE', label: 'Motivational quote',  desc: 'Rotating quotes — one liners between sets', icon: Quote },
      { type: 'FITNESS_APP_LIBRARY',        label: 'App library',         desc: 'Member-app launcher tiles — Peloton, MyZone, etc.', icon: AppWindow },
      { type: 'FITNESS_STICK_LAUNCHER',     label: 'Stick launcher',      desc: 'Hardware companion launcher — Stick / Roku-style picker', icon: Joystick },
      { type: 'ANNOUNCEMENT',               label: 'Announcement',        desc: 'Eye-catching important message', icon: Megaphone },
      { type: 'COUNTDOWN',                  label: 'Countdown',           desc: 'Count down to a class, event, or tournament', icon: Timer },
    ],
  },
  // 2026-05-02 — VenueOS Restaurant & QSR group. Six widgets purpose-
  // built for counter-service, drive-thru, fast-casual menu walls,
  // promo carousels, loyalty programs, and lobby wait-time displays.
  // Filtered to QSR vertical so a school admin never sees menu boards
  // and a restaurant admin never sees bell schedules. ANNOUNCEMENT +
  // COUNTDOWN are exposed here as conveniences (e.g. countdown to
  // happy hour, announcement for a new menu drop) since QSR tenants
  // don't get the K12 Education group.
  {
    label: 'Restaurant & QSR',
    verticals: ['QSR'],
    types: [
      { type: 'RESTAURANT_MENU_BOARD',       label: 'Menu board',        desc: 'Multi-column menu — items, descriptions, prices, dietary chips', icon: UtensilsCrossed },
      { type: 'RESTAURANT_COMBO_CAROUSEL',   label: 'Combo carousel',    desc: 'Auto-rotating combo deals with "starting at $X" callout', icon: Pizza },
      { type: 'RESTAURANT_WAIT_TIME',        label: 'Wait time',         desc: 'Big wait-time readout, queue position, SMS sign-up hint', icon: Hourglass },
      { type: 'RESTAURANT_LOYALTY_TICKER',   label: 'Loyalty ticker',    desc: 'Rewards messaging strip with optional QR sign-up', icon: Star },
      { type: 'RESTAURANT_SPECIALS_CALLOUT', label: 'Specials callout',  desc: '"Today only" big-type promo card with price callout', icon: BadgePercent },
      { type: 'RESTAURANT_ALLERGY_LEGEND',   label: 'Dietary legend',    desc: 'Compact icon legend — V / GF / DF / nut-free / spicy', icon: Leaf },
      { type: 'IMAGE',                       label: 'Food photo',        desc: 'Hero food / drink photo for the wall', icon: ImageIcon },
      { type: 'IMAGE_CAROUSEL',              label: 'Photo slideshow',   desc: 'Rotate through dish photos', icon: ImageIcon },
      { type: 'VIDEO',                       label: 'Video promo',       desc: 'Looping cooking / promo reel', icon: Play },
      { type: 'TICKER',                      label: 'Ticker',            desc: 'Scrolling promo / hours / menu announcements', icon: ArrowRight },
      { type: 'ANNOUNCEMENT',                label: 'Announcement',      desc: 'Eye-catching message — new menu drop, holiday hours, etc.', icon: Megaphone },
      { type: 'COUNTDOWN',                   label: 'Countdown',         desc: 'Count down to happy hour, opening, or event start', icon: Timer },
      { type: 'RICH_TEXT',                   label: 'Chef note',         desc: 'Kitchen / chef intro / story panel (formatted text)', icon: ChefHat },
    ],
  },
  // 2026-05-03 — VenueOS Retail group. Editorial / lookbook /
  // department-store visual DNA. The 7 widget renderers in
  // apps/web/src/components/widgets/retail/ are wired into
  // WidgetRenderer dispatch — without this group entry retail admins
  // had no way to drop them onto a custom template.
  {
    label: 'Retail & merchandising',
    verticals: ['RETAIL'],
    types: [
      { type: 'RETAIL_PRODUCT_GRID',       label: 'Product grid',       desc: 'N-column product grid — thumbnail, name, price, sale badge', icon: ShoppingBag },
      { type: 'RETAIL_PRICE_CALLOUT',      label: 'Price callout',      desc: 'Single-product big-price hero — "$49 / was $79" with strike-through', icon: Tag },
      { type: 'RETAIL_SALE_COUNTDOWN',     label: 'Sale countdown',     desc: 'Big "Sale ends in 2d 14h" countdown', icon: Timer },
      { type: 'RETAIL_WAYFINDING_MAP',     label: 'Wayfinding map',     desc: 'Store map with department callouts', icon: MapPin },
      { type: 'RETAIL_LOYALTY_QR',         label: 'Loyalty QR',         desc: 'QR-code signup card — "Scan to join rewards"', icon: QrCode },
      { type: 'RETAIL_LOOKBOOK_CAROUSEL',  label: 'Lookbook carousel',  desc: 'Auto-rotating fashion-style hero images with overlay caption', icon: Layers },
      { type: 'RETAIL_STOREFRONT_HOURS',   label: 'Storefront hours',   desc: 'Open hours + holiday-adjusted schedule', icon: Store },
      { type: 'IMAGE',                     label: 'Hero image',         desc: 'Single product / lifestyle photo', icon: ImageIcon },
      { type: 'IMAGE_CAROUSEL',            label: 'Photo slideshow',    desc: 'Rotate through product photos', icon: ImageIcon },
      { type: 'VIDEO',                     label: 'Video promo',        desc: 'Looping product / brand reel', icon: Play },
      { type: 'TICKER',                    label: 'Promo ticker',       desc: 'Scrolling price / promo / event strip', icon: ArrowRight },
      { type: 'ANNOUNCEMENT',              label: 'Announcement',       desc: 'Eye-catching seasonal / sale message', icon: Megaphone },
      { type: 'COUNTDOWN',                 label: 'Countdown',          desc: 'Count down to drop, sale, or event', icon: Timer },
    ],
  },
  // 2026-05-03 — VenueOS Bar / nightlife group. Tap lists, cocktail
  // menus, game day, happy hour, trivia, live events. Same as above —
  // widget renderers exist in apps/web/src/components/widgets/bar/
  // but the palette entry was missing.
  {
    label: 'Bar & nightlife',
    verticals: ['BAR'],
    types: [
      { type: 'BAR_TAP_LIST',              label: 'Tap list',            desc: 'Beer-on-tap board — brewery, style, ABV, price', icon: Beer },
      { type: 'BAR_COCKTAIL_MENU',         label: 'Cocktail menu',       desc: 'Hand-drawn chalkboard signature cocktails', icon: Martini },
      { type: 'BAR_HAPPY_HOUR_COUNTDOWN',  label: 'Happy hour',          desc: 'Big countdown to happy-hour end + featured drink', icon: Wine },
      { type: 'BAR_GAME_DAY_SCHEDULE',     label: 'Game day schedule',   desc: "Today's games — kickoff, channel, league", icon: Trophy },
      { type: 'BAR_EVENT_TONIGHT',         label: 'Live event tonight',  desc: 'Band / show poster — doors time + cover charge', icon: Mic2 },
      { type: 'BAR_TRIVIA_SCOREBOARD',     label: 'Trivia scoreboard',   desc: 'Round count + top 5 leaderboard + question timer', icon: Brain },
      { type: 'IMAGE',                     label: 'Hero image',          desc: 'Bar / event / brand photo', icon: ImageIcon },
      { type: 'IMAGE_CAROUSEL',            label: 'Photo slideshow',     desc: 'Rotate through bar photos', icon: ImageIcon },
      { type: 'VIDEO',                     label: 'Video promo',         desc: 'Looping promo / event reel', icon: Play },
      { type: 'TICKER',                    label: 'Ticker',              desc: 'Scrolling promos / specials / event strip', icon: ArrowRight },
      { type: 'ANNOUNCEMENT',              label: 'Announcement',        desc: 'Eye-catching message — drink special, event, hours change', icon: Megaphone },
      { type: 'COUNTDOWN',                 label: 'Countdown',           desc: 'Count down to happy hour, doors, kickoff, etc.', icon: Timer },
    ],
  },
  {
    label: 'Utility',
    types: [
      { type: 'CLOCK', label: 'Clock', desc: 'Current time display', icon: Clock },
      { type: 'WEATHER', label: 'Weather', desc: 'Local weather & forecast', icon: Cloud },
      { type: 'LOGO', label: 'School Logo', desc: 'Display your logo', icon: Shield },
      { type: 'TICKER', label: 'Scrolling Ticker', desc: 'Scrolling text banner', icon: ArrowRight },
      { type: 'EMPTY', label: 'Placeholder', desc: 'Reserve a zone for later', icon: Square },
    ],
  },
  // Sprint 11h — drag-drop decorations. One DECORATION widget type;
  // a `variant` config picks which animation. Each tile in the
  // palette spawns a zone pre-configured with that variant.
  {
    label: 'Decorations',
    types: [
      { type: 'DECORATION_CONFETTI',       label: 'Confetti',       desc: 'Falling colored particles — celebrations + birthdays',     icon: PartyPopper },
      { type: 'DECORATION_RAINBOW_RIBBON', label: 'Rainbow Ribbon', desc: 'Animated rainbow gradient banner — pride / spirit',       icon: Rainbow },
      { type: 'DECORATION_BALLOONS',       label: 'Balloons',       desc: 'Rising balloon cluster — party / year-end',                icon: Cake },
      { type: 'DECORATION_CLOUDS',         label: 'Clouds',         desc: 'Slow horizontal cloud drift — sky-themed background',      icon: Cloud },
      { type: 'DECORATION_SPARKLES',       label: 'Sparkles',       desc: 'Twinkling gold dust — festive overlay',                    icon: Sparkles },
      { type: 'DECORATION_TICKER',         label: 'Marquee Ticker', desc: 'Big bold scrolling text — attention-grabbing banner',      icon: ArrowRight },
      { type: 'DECORATION_NEON_BUZZ',      label: 'Neon Buzz',      desc: 'Buzzing neon-sign text — character for lobbies',           icon: Zap },
      { type: 'DECORATION_PULSE_GLOW',     label: 'Pulse Glow',     desc: 'Breathing glow halo — sits behind featured content',       icon: Sun },
    ],
  },
  // "School Life" group hidden pending editor — see file header.
  {
    label: 'Animated Scenes',
    // K12-only: every variant under this group is school-themed
    // (Cafeteria, Bell Schedule, MS / HS Pack, Hallway, Bus Board,
    // Morning News, Achievement Showcase, Scrapbook, Storybook).
    // Gym / retail / corporate / qsr / fashion tenants see no
    // school-themed animated scenes.
    verticals: ['K12'],
    types: [
      // ANIMATED_BACKGROUND hidden pending editor — see file header.
      { type: 'ANIMATED_WELCOME', label: 'Animated Welcome · Elementary', desc: 'Full-screen rainbow-ribbon scene — shapes, confetti, live weather', icon: Cake },
      { type: 'ANIMATED_WELCOME_MS', label: 'Animated Welcome · Middle School', desc: 'Stadium / varsity scene — pennants, scoreboard, megaphone, varsity patch', icon: Cake },
      { type: 'ANIMATED_WELCOME_HS', label: 'Animated Welcome · High School', desc: 'Neon sunset scene — grad cap, trophy, yearbook, confetti burst', icon: Cake },
      { type: 'HS_VARSITY',          label: 'HS · Varsity (Athletic)',     desc: '4K scoreboard lobby — jersey chest, game-of-the-week, coach spotlight, pennants, PA ticker', icon: Cake },
      { type: 'HS_BROADCAST',        label: 'HS · Broadcast (News Desk)',  desc: '4K campus news network — ON AIR indicator, lower-thirds, forecast, featured guest, breaking story, crawl', icon: Cake },
      { type: 'HS_YEARBOOK',         label: 'HS · Yearbook (Editorial)',   desc: '4K magazine spread — serif masthead, drop-cap lede, photo feature, portrait quote, folio calendar, wire ticker', icon: Cake },
      { type: 'HS_TERMINAL',         label: 'HS · Terminal (CRT/Phosphor)',desc: '4K CRT lobby — phosphor green, scanlines, whoami teacher card, cron events, syslog ticker, blinking cursor', icon: Cake },
      { type: 'HS_TRANSIT',          label: 'HS · Transit (Departure Board)', desc: '4K airport board — amber split-flap rows, classes as departures, status chips, PA ticker', icon: Cake },
      { type: 'HS_GALLERY',          label: 'HS · Gallery (Museum)',       desc: '4K museum lobby — generous whitespace, italic EB Garamond plaques, Roman-numeral acquisitions, artist-statement quote', icon: Cake },
      { type: 'HS_BLUEPRINT',        label: 'HS · Blueprint (Technical)',  desc: '4K architect blueprint — cyan grid paper, title block header, dimensioned callouts, sheet annotations, revision-log ticker', icon: Cake },
      { type: 'HS_ZINE',             label: 'HS · Zine (Cut & Paste)',     desc: '4K photocopied student zine — rotated panels, taped polaroids, ransom-letter announcements, marker annotations, xeroxwire ticker', icon: Cake },
      // MS Pack — 8 landscape variants (productized 2026-04-25)
      { type: 'MS_ARCADE',           label: 'MS · Arcade (Quest Log)',     desc: '4K retro game-HUD lobby — pixel borders, quest-log agenda, XP bar, leaderboard, BOSS BATTLE ticker', icon: Cake },
      { type: 'MS_ATLAS',            label: 'MS · Atlas (Subway Map)',     desc: '4K travel-poster cartography — compass rose, almanac, four transit-style route cards, scrolling news', icon: Cake },
      { type: 'MS_FIELDNOTES',       label: 'MS · Field Notes (Journal)',  desc: '4K naturalist field journal — kraft paper, washi tape, watercolor specimens, log entries with compass bearings', icon: Cake },
      { type: 'MS_GREENHOUSE',       label: 'MS · Greenhouse (Herbarium)', desc: '4K herbarium plate — pressed specimens, brass instrument gauges, terracotta announcement, almanac countdown', icon: Cake },
      { type: 'MS_HOMEROOM',         label: 'MS · Homeroom (Bulletin)',    desc: '4K classroom bulletin — slate, sticky notes, polaroid, tabbed binder agenda, school-spirit pennant', icon: Cake },
      { type: 'MS_PAPER',            label: 'MS · Paper (Broadsheet)',     desc: '4K vintage broadsheet — masthead, drop-cap lead story, departments band, stop-press bulletin ticker', icon: Cake },
      { type: 'MS_PLAYLIST',         label: 'MS · Playlist (Now Playing)', desc: '4K Spotify-style now-playing — album cover, queue, equalizer, transport controls, club charts', icon: Cake },
      { type: 'MS_STUDIO',           label: 'MS · Studio (On-Air Booth)',  desc: '4K radio booth — ON AIR sign, vinyl turntable, VU meter, mixer, cassette lineup, single combined footer', icon: Cake },
      // MS Pack — 8 portrait variants (2160×3840 for vertical hallway displays)
      { type: 'MS_ARCADE_PORTRAIT',     label: 'MS · Arcade — Portrait',     desc: 'Vertical 4K · single-column quest log + leaderboard + side quests', icon: Cake },
      { type: 'MS_ATLAS_PORTRAIT',      label: 'MS · Atlas — Portrait',      desc: 'Vertical 4K · full-width hero poster + 4 transit cards stacked', icon: Cake },
      { type: 'MS_FIELDNOTES_PORTRAIT', label: 'MS · Field Notes — Portrait', desc: 'Vertical 4K · full-width specimen card + tall agenda column + P.S. ticker', icon: Cake },
      { type: 'MS_GREENHOUSE_PORTRAIT', label: 'MS · Greenhouse — Portrait', desc: 'Vertical 4K · large herbarium plate + vertical specimen index', icon: Cake },
      { type: 'MS_HOMEROOM_PORTRAIT',   label: 'MS · Homeroom — Portrait',   desc: 'Vertical 4K · chalkboard hero + tall corkboard agenda + manila folder clubs', icon: Cake },
      { type: 'MS_PAPER_PORTRAIT',      label: 'MS · Paper — Portrait',      desc: 'Vertical 4K · real broadsheet portrait (masthead + drop-cap + departments)', icon: Cake },
      { type: 'MS_PLAYLIST_PORTRAIT',   label: 'MS · Playlist — Portrait',   desc: 'Vertical 4K · Spotify-mobile aesthetic — album cover + transport + tall queue', icon: Cake },
      { type: 'MS_STUDIO_PORTRAIT',     label: 'MS · Studio — Portrait',     desc: 'Vertical 4K · turntable+VU side-by-side + 4 cassettes vertical + single footer', icon: Cake },
      // Cafeteria variants
      { type: 'ANIMATED_CAFETERIA',           label: 'Animated Cafeteria · Food Truck',     desc: 'Food-truck menu board — weekly menu, swappable food emojis, lunch chef, allergen ticker', icon: UtensilsCrossed },
      { type: 'ANIMATED_CAFETERIA_MS',        label: 'Animated Cafeteria · Middle School',  desc: '4K cafeteria for middle schoolers — sport-stadium menu vibe', icon: UtensilsCrossed },
      { type: 'ANIMATED_CAFETERIA_HS',        label: 'Animated Cafeteria · High School',    desc: '4K cafeteria for high schoolers — café aesthetic', icon: UtensilsCrossed },
      { type: 'ANIMATED_CAFETERIA_CHALKBOARD',label: 'Animated Cafeteria · Chalkboard',     desc: 'Classic green-chalkboard menu board with chalk-textured text', icon: UtensilsCrossed },
      { type: 'ANIMATED_CAFETERIA_FOODTRUCK', label: 'Animated Cafeteria · Food Truck (Classic)', desc: 'Food-truck service window — striped awning, order window, chalkboard menu', icon: UtensilsCrossed },
      // Animated full-screen scenes (lobby / hallway / info)
      { type: 'ANIMATED_MAIN_ENTRANCE',       label: 'Animated Main Entrance Welcome',      desc: 'Grand-entrance welcome board — marquee bulbs, heraldic crests, info tiles, balloon cluster', icon: Cake },
      { type: 'ANIMATED_HALLWAY_SCHEDULE',    label: 'Animated Hallway Schedule',           desc: 'Notebook-paper hallway schedule with daily classes', icon: CalendarDays },
      { type: 'ANIMATED_BELL_SCHEDULE',       label: 'Animated Bell Schedule',              desc: 'Period times with current/next-up highlights', icon: Bell },
      { type: 'ANIMATED_BUS_BOARD',           label: 'Animated Bus Route Board',            desc: 'School-bus route board — driving-bus graphic, route rows with ETAs, late warnings', icon: Cake },
      { type: 'ANIMATED_MORNING_NEWS',        label: 'Animated Morning News',               desc: 'Anchor-desk style morning announcements with headlines', icon: Megaphone },
      { type: 'ANIMATED_ACHIEVEMENT_SHOWCASE',label: 'Animated Achievement Showcase',       desc: 'Trophy-case style scrolling student achievements', icon: Cake },
      { type: 'ANIMATED_WELCOME_PORTRAIT',    label: 'Animated Welcome · Portrait',         desc: 'Vertical 4K rainbow-ribbon welcome scene', icon: Cake },
      // Elementary themed welcome boards
      { type: 'SCRAPBOOK_HALLWAY',   label: 'Scrapbook · Hallway',   desc: 'Cut-and-paste scrapbook hallway with washi tape + polaroids', icon: Cake },
      { type: 'SCRAPBOOK_CAFETERIA', label: 'Scrapbook · Cafeteria', desc: 'Cut-and-paste scrapbook cafeteria menu board', icon: UtensilsCrossed },
      { type: 'STORYBOOK_HALLWAY',   label: 'Storybook · Hallway',   desc: 'Open-book spread hallway with illuminated drop caps', icon: Cake },
      { type: 'STORYBOOK_CAFETERIA', label: 'Storybook · Cafeteria', desc: 'Open-book spread cafeteria menu', icon: UtensilsCrossed },
      { type: 'BULLETIN_HALLWAY',    label: 'Bulletin Board · Hallway',   desc: 'Cork bulletin-board hallway with pinned index cards', icon: Cake },
      { type: 'BULLETIN_CAFETERIA',  label: 'Bulletin Board · Cafeteria', desc: 'Cork bulletin-board cafeteria menu', icon: UtensilsCrossed },
    ],
  },
] as const;

export const WIDGET_META: Record<string, { label: string; icon: LucideIcon; desc: string }> = {};
WIDGET_GROUPS.forEach(g => g.types.forEach(t => {
  WIDGET_META[t.type] = { label: t.label, icon: t.icon as LucideIcon, desc: t.desc };
}));

export function widgetLabel(type: string): string {
  return WIDGET_META[type]?.label ?? type;
}

export function widgetIcon(type: string): LucideIcon {
  return WIDGET_META[type]?.icon ?? Square;
}

export const ZONE_COLORS: Record<string, { bg: string; border: string; text: string; accent: string }> = {
  VIDEO:           { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#8b5cf6' },
  STREAMING:       { bg: '#fdf4ff', border: '#e9d5ff', text: '#7e22ce', accent: '#a855f7' },
  IMAGE:           { bg: '#f0f9ff', border: '#93c5fd', text: '#1d4ed8', accent: '#3b82f6' },
  IMAGE_CAROUSEL:  { bg: '#f0f9ff', border: '#93c5fd', text: '#1d4ed8', accent: '#3b82f6' },
  PLAYLIST:        { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#8b5cf6' },
  WEBPAGE:         { bg: '#ecfdf5', border: '#6ee7b7', text: '#047857', accent: '#10b981' },
  TEXT:            { bg: '#f8fafc', border: '#cbd5e1', text: '#334155', accent: '#64748b' },
  RICH_TEXT:       { bg: '#f8fafc', border: '#cbd5e1', text: '#334155', accent: '#64748b' },
  RSS_FEED:        { bg: '#fff7ed', border: '#fdba74', text: '#c2410c', accent: '#f97316' },
  SOCIAL_FEED:     { bg: '#fdf2f8', border: '#f9a8d4', text: '#be185d', accent: '#ec4899' },
  ANNOUNCEMENT:    { bg: '#fffbeb', border: '#fcd34d', text: '#a16207', accent: '#f59e0b' },
  BELL_SCHEDULE:   { bg: '#eef2ff', border: '#a5b4fc', text: '#4338ca', accent: '#6366f1' },
  LUNCH_MENU:      { bg: '#f0fdf4', border: '#86efac', text: '#15803d', accent: '#22c55e' },
  CALENDAR:        { bg: '#eff6ff', border: '#93c5fd', text: '#1e40af', accent: '#3b82f6' },
  COUNTDOWN:       { bg: '#fff1f2', border: '#fda4af', text: '#be123c', accent: '#f43f5e' },
  STAFF_SPOTLIGHT: { bg: '#f0fdfa', border: '#5eead4', text: '#0f766e', accent: '#14b8a6' },
  CLOCK:           { bg: '#f9fafb', border: '#d1d5db', text: '#374151', accent: '#6b7280' },
  WEATHER:         { bg: '#ecfeff', border: '#67e8f9', text: '#0e7490', accent: '#06b6d4' },
  LOGO:            { bg: '#eef2ff', border: '#a5b4fc', text: '#4338ca', accent: '#6366f1' },
  TICKER:          { bg: '#fffbeb', border: '#fcd34d', text: '#a16207', accent: '#f59e0b' },
  EMPTY:           { bg: '#f8fafc', border: '#e2e8f0', text: '#94a3b8', accent: '#cbd5e1' },
  // Touch / Interactive (Sprint 4 placeholders — unused; the Touch
  // palette below replaces them. TOUCH_BUTTON and TOUCH_MENU were
  // never wired into the picker per the file-header note, but had
  // ZONE_COLOR entries. Removed TOUCH_MENU here so Phase D2.10's
  // real TOUCH_MENU kiosk-nav button can take that key.
  TOUCH_BUTTON:       { bg: '#eef2ff', border: '#a5b4fc', text: '#3730a3', accent: '#4f46e5' },
  ROOM_FINDER:        { bg: '#f0fdfa', border: '#5eead4', text: '#0f766e', accent: '#14b8a6' },
  ON_SCREEN_KEYBOARD: { bg: '#f1f5f9', border: '#cbd5e1', text: '#334155', accent: '#475569' },
  WAYFINDING_MAP:     { bg: '#fef3c7', border: '#fcd34d', text: '#92400e', accent: '#f59e0b' },
  QUICK_POLL:         { bg: '#fdf2f8', border: '#f9a8d4', text: '#be185d', accent: '#ec4899' },
  ANIMATED_WELCOME:     { bg: '#fbcfe8', border: '#ec4899', text: '#831843', accent: '#ec4899' },
  ANIMATED_WELCOME_MS:  { bg: '#fef3c7', border: '#dc2626', text: '#7f1d1d', accent: '#dc2626' },
  ANIMATED_WELCOME_HS:  { bg: '#fef3c7', border: '#ec4899', text: '#831843', accent: '#f59e0b' },
  ANIMATED_CAFETERIA:   { bg: '#fef3c7', border: '#dc2626', text: '#7c2d12', accent: '#dc2626' },
  ANIMATED_BACKGROUND:  { bg: '#fbcfe8', border: '#ec4899', text: '#831843', accent: '#ec4899' },
  // Sprint 11h decorations — one canonical color for all variants;
  // each tile in the palette gets the same pinkish theme so it's
  // recognizable as a "decoration" group at a glance.
  DECORATION:                   { bg: '#fae8ff', border: '#e879f9', text: '#86198f', accent: '#d946ef' },
  DECORATION_CONFETTI:          { bg: '#fae8ff', border: '#e879f9', text: '#86198f', accent: '#d946ef' },
  DECORATION_RAINBOW_RIBBON:    { bg: '#fae8ff', border: '#e879f9', text: '#86198f', accent: '#d946ef' },
  DECORATION_BALLOONS:          { bg: '#fae8ff', border: '#e879f9', text: '#86198f', accent: '#d946ef' },
  DECORATION_CLOUDS:            { bg: '#fae8ff', border: '#e879f9', text: '#86198f', accent: '#d946ef' },
  DECORATION_SPARKLES:          { bg: '#fae8ff', border: '#e879f9', text: '#86198f', accent: '#d946ef' },
  DECORATION_TICKER:            { bg: '#fae8ff', border: '#e879f9', text: '#86198f', accent: '#d946ef' },
  DECORATION_NEON_BUZZ:         { bg: '#fae8ff', border: '#e879f9', text: '#86198f', accent: '#d946ef' },
  DECORATION_PULSE_GLOW:        { bg: '#fae8ff', border: '#e879f9', text: '#86198f', accent: '#d946ef' },
  // Phase D2.9 — every touch palette tile resolves to widgetType
  // 'TOUCH_POINT' on the canvas, so the canonical color theme lives
  // under that key. Violet to match the AI-generate / interactivity
  // brand language used elsewhere. Each palette-tile type also gets
  // an entry so the palette button itself can render the right tint
  // before the zone is created.
  TOUCH_POINT:                  { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#7c3aed' },
  TOUCH_HOTSPOT:                { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#7c3aed' },
  TOUCH_TAP_PROMPT:             { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#7c3aed' },
  TOUCH_CIRCLE:                 { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#7c3aed' },
  TOUCH_SQUARE:                 { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#7c3aed' },
  TOUCH_ARROW_RIGHT:            { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#7c3aed' },
  TOUCH_ARROW_LEFT:             { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#7c3aed' },
  TOUCH_ARROW_UP:               { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#7c3aed' },
  TOUCH_ARROW_DOWN:             { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#7c3aed' },
  TOUCH_HOME:                   { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#7c3aed' },
  TOUCH_BACK:                   { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#7c3aed' },
  TOUCH_NEXT:                   { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#7c3aed' },
  TOUCH_CLOSE:                  { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#7c3aed' },
  TOUCH_MENU:                   { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#7c3aed' },
  TOUCH_HELP:                   { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#7c3aed' },
  TOUCH_PLAY:                   { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#7c3aed' },
  TOUCH_QR:                     { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#7c3aed' },
  TOUCH_INFO:                   { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#7c3aed' },
  TOUCH_PHONE:                  { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#7c3aed' },
  TOUCH_EMAIL:                  { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#7c3aed' },
  TOUCH_SHARE:                  { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#7c3aed' },
  TOUCH_HEART:                  { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#7c3aed' },
  TOUCH_STAR:                   { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#7c3aed' },
  TOUCH_SEARCH:                 { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#7c3aed' },
  TOUCH_VOLUME:                 { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#7c3aed' },
  TOUCH_PRINT:                  { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#7c3aed' },
  // ── Restaurant / QSR vertical (warm cream + caramel + deep red) ──
  RESTAURANT_MENU_BOARD:        { bg: '#fef3c7', border: '#fcd34d', text: '#7a1f1f', accent: '#e8b94a' },
  RESTAURANT_COMBO_CAROUSEL:    { bg: '#fef2f2', border: '#fca5a5', text: '#7a1f1f', accent: '#dc2626' },
  RESTAURANT_WAIT_TIME:         { bg: '#fef9c3', border: '#fde047', text: '#854d0e', accent: '#d68a1f' },
  RESTAURANT_LOYALTY_TICKER:    { bg: '#fff7ed', border: '#fdba74', text: '#9a3412', accent: '#ea580c' },
  RESTAURANT_SPECIALS_CALLOUT:  { bg: '#fee2e2', border: '#fca5a5', text: '#7a1f1f', accent: '#b91c1c' },
  RESTAURANT_ALLERGY_LEGEND:    { bg: '#ecfdf5', border: '#86efac', text: '#15803d', accent: '#22c55e' },
};

// Hit-target validator — warn if a zone would render smaller than WCAG 44px
// at the template's target resolution. Returns { ok, warnings[] }.
export const MIN_TOUCH_TARGET_PX = 44;

export function validateTouchHitTargets(
  zones: Array<{ id: string; name: string; widgetType: string; x: number; y: number; width: number; height: number; touchAction?: unknown }>,
  screenWidth: number,
  screenHeight: number,
): { ok: boolean; warnings: Array<{ zoneId: string; zoneName: string; reason: string }> } {
  const warnings: Array<{ zoneId: string; zoneName: string; reason: string }> = [];
  const touchWidgets = new Set([
    'TOUCH_BUTTON', 'TOUCH_MENU', 'ROOM_FINDER', 'ON_SCREEN_KEYBOARD',
    'WAYFINDING_MAP', 'QUICK_POLL',
  ]);
  for (const z of zones) {
    const interactive = touchWidgets.has(z.widgetType) || !!z.touchAction;
    if (!interactive) continue;
    const pxW = (z.width / 100) * screenWidth;
    const pxH = (z.height / 100) * screenHeight;
    if (pxW < MIN_TOUCH_TARGET_PX || pxH < MIN_TOUCH_TARGET_PX) {
      warnings.push({
        zoneId: z.id,
        zoneName: z.name,
        reason: `Too small for touch (${Math.round(pxW)}×${Math.round(pxH)}px; needs ≥ ${MIN_TOUCH_TARGET_PX}px)`,
      });
    }
  }
  return { ok: warnings.length === 0, warnings };
}

export function getZoneColor(type: string) {
  return ZONE_COLORS[type] ?? ZONE_COLORS.EMPTY;
}

export const RESOLUTION_PRESETS = [
  { label: '4K UHD', sub: 'Landscape', w: 3840, h: 2160 },
  { label: '4K UHD', sub: 'Portrait', w: 2160, h: 3840 },
  { label: 'Full HD', sub: 'Landscape', w: 1920, h: 1080 },
  { label: 'Full HD', sub: 'Portrait', w: 1080, h: 1920 },
  { label: '720p', sub: 'Landscape', w: 1280, h: 720 },
  { label: 'Ultra-Wide', sub: '21:9', w: 2560, h: 1080 },
  { label: 'LED Banner', sub: '5:1', w: 2500, h: 500 },
  { label: 'LED Tall', sub: '1:3', w: 480, h: 1440 },
  { label: 'Square', sub: '1:1', w: 1080, h: 1080 },
];

export const GRID_SIZES = [1, 2, 5, 10, 25] as const;
export const DEFAULT_GRID_SIZE = 5;

export const SNAP_THRESHOLD = 1.5;
export const MIN_ZONE_SIZE = 3;
