/**
 * Themed widget defaults registry.
 *
 * The Animated, Bulletin, Scrapbook, and Storybook themed widgets emit
 * `data-field="..."` hotspots all over their markup but don't ship a
 * DEFAULTS export the way the MS pack does. Without a defaults map,
 * PropertiesPanel falls back to JSON-only editing — operators see no
 * form fields.
 *
 * This file is the single source of truth for what fields each themed
 * widget exposes to the editor. PropertiesPanel iterates the entries
 * for the selected widgetType and auto-builds a Text/TextArea field
 * per key (TextArea when `multiline: true`).
 *
 * Adding a new field to a widget:
 *   1. Add the `data-field="key"` attribute on the rendered text
 *      element so canvas click-to-edit lands here.
 *   2. Append `{ key, label, default, multiline? }` to the registry
 *      below.
 *   3. The widget reads `cfg.key || 'default text'` as it always has.
 *
 * APPROVED 2026-04-27 — these are the 17 widgets that previously had
 * no PropertiesPanel case. Each operator-facing label is human-
 * readable, every multiline flag is intentional (true only for fields
 * over 80 chars or that semantically expect a paragraph).
 */

/**
 * `kind` discriminates how PropertiesPanel renders the field:
 *   - undefined / 'text'   → single-line TextField (the default)
 *   - 'multiline'          → TextAreaField (same as `multiline: true`)
 *   - 'array-schedule'     → ScheduleRowsField (time/name/room rows) writing
 *                            the given `arrayKey` ({num,time,name,room}[])
 *   - 'array-bell'         → BellScheduleEditor writing `periods`
 *                            ({num,label,startTime,endTime,room}[])
 *   - 'array-menu'         → WeekMenuEditor writing `weekMenu` (+ `menuItems`
 *                            fallback), the {emoji,name,meta,price} day map
 *   - 'array-cards'        → MenuCardsField writing `cards` ({title,desc}[])
 *   - 'image'              → AssetPickerField (image) writing the given key
 *
 * 2026-05-28 (P0-3, Opus 4.8 audit §19): the registry previously listed only
 * decorative scalar text and never enumerated the list-array fields the widget
 * renders as its PRIMARY content (schedule rows, lunch-menu items) or its image
 * fields (cafeteria photo). The operator could rename "Today's Schedule" but
 * could not edit a single period beneath it, nor swap the food photo. These
 * `kind`-tagged entries close that gap; the THEMED auto-form in PropertiesPanel
 * special-cases each `kind` to render the matching array / asset-picker editor
 * (modeled on the already-shipped LUNCH_MENU + BELL_SCHEDULE + AssetPickerField
 * controls) instead of a Text/TextArea.
 */
export type ThemedFieldKind =
  | 'text'
  | 'multiline'
  | 'array-schedule'
  | 'array-bell'
  | 'array-menu'
  | 'array-cards'
  | 'image';

export interface ThemedField {
  key: string;
  label: string;
  default: string;
  multiline?: boolean;
  /** How to render this field; omit for a plain single-line text input. */
  kind?: ThemedFieldKind;
}

export const THEMED_WIDGET_FIELDS: Record<string, ThemedField[]> = {
  ANIMATED_HALLWAY_SCHEDULE: [
    { key: 'title',              label: 'Title',                            default: 'LEARN · GROW · SHINE' },
    { key: 'tagline',            label: 'Tagline',                          default: 'every day a new adventure' },
    { key: 'dateTag',            label: 'Date tag',                         default: 'Mon · 4/19' },
    { key: 'notebookTitle',      label: 'Notebook title',                   default: 'Period by Period' },
    { key: 'notebookSub',        label: 'Notebook subtitle',                default: "~ today's schedule ~" },
    // PRIMARY content — the schedule itself (reads cfg.periods {num,time,name,room}[]).
    { key: 'periods',            label: 'Schedule rows',                    default: '', kind: 'array-schedule' },
    { key: 'announceBadge',      label: 'Announcement badge label',         default: 'Announcement' },
    { key: 'announceMsg',        label: 'Announcement message',             default: 'Assembly in the gym Friday at 2 PM — all classes welcome!', multiline: true },
    { key: 'attendancePercent',  label: 'Attendance % (e.g. 97%)',          default: '97%' },
    { key: 'attendanceSub',      label: 'Attendance sub-label',             default: '~ here today ~' },
    { key: 'weatherEmoji',       label: 'Weather icon (emoji)',             default: '☀️' },
    { key: 'weatherTemp',        label: 'Weather temp',                     default: '42°' },
    { key: 'weatherDesc',        label: 'Weather desc',                     default: 'sunny + crisp' },
    { key: 'countdownLabel',     label: 'Countdown label',                  default: 'Field Day in' },
    { key: 'countdownDate',      label: 'Countdown target date (YYYY-MM-DD)', default: '' },
    { key: 'countdownNumber',    label: 'Countdown number (manual override)', default: '8' },
    { key: 'countdownUnit',      label: 'Countdown unit',                   default: 'days' },
    { key: 'tickerStamp',        label: 'Ticker stamp',                     default: 'Hallway News' },
    { key: 'tickerMessages',     label: 'Ticker messages (one per line)',   default: '', multiline: true },
  ],

  // Real portrait companion — same field shape as landscape so the
  // editor's behavior is identical regardless of orientation.
  ANIMATED_HALLWAY_SCHEDULE_PORTRAIT: [
    { key: 'title',              label: 'Title',                            default: 'LEARN · GROW · SHINE' },
    { key: 'tagline',            label: 'Tagline',                          default: 'every day a new adventure' },
    { key: 'dateTag',            label: 'Date tag',                         default: 'Mon · 4/19' },
    { key: 'notebookTitle',      label: 'Notebook title',                   default: 'Period by Period' },
    { key: 'notebookSub',        label: 'Notebook subtitle',                default: "~ today's schedule ~" },
    { key: 'periods',            label: 'Schedule rows',                    default: '', kind: 'array-schedule' },
    { key: 'announceBadge',      label: 'Announcement badge label',         default: 'Announcement' },
    { key: 'announceMsg',        label: 'Announcement message',             default: 'Assembly in the gym Friday at 2 PM — all classes welcome!', multiline: true },
    { key: 'attendancePercent',  label: 'Attendance % (e.g. 97%)',          default: '97%' },
    { key: 'attendanceSub',      label: 'Attendance sub-label',             default: '~ here today ~' },
    { key: 'weatherEmoji',       label: 'Weather icon (emoji)',             default: '☀️' },
    { key: 'weatherTemp',        label: 'Weather temp',                     default: '42°' },
    { key: 'weatherDesc',        label: 'Weather desc',                     default: 'sunny + crisp' },
    { key: 'countdownLabel',     label: 'Countdown label',                  default: 'Field Day in' },
    { key: 'countdownDate',      label: 'Countdown target date (YYYY-MM-DD)', default: '' },
    { key: 'countdownNumber',    label: 'Countdown number (manual override)', default: '8' },
    { key: 'countdownUnit',      label: 'Countdown unit',                   default: 'days' },
    { key: 'tickerStamp',        label: 'Ticker stamp',                     default: 'Hallway News' },
    { key: 'tickerMessages',     label: 'Ticker messages (one per line)',   default: '', multiline: true },
  ],

  ANIMATED_BELL_SCHEDULE: [
    { key: 'eyebrow',     label: 'Eyebrow',     default: "★ Today's Bell Schedule ★" },
    { key: 'title',       label: 'Title',       default: 'BELL SCHEDULE' },
    { key: 'subtitle',    label: 'Subtitle',    default: 'Monday · April 19 · 2026 · REGULAR BELL' },
    { key: 'currentBadge', label: 'Current badge', default: 'LIVE · IN SESSION' },
    // PRIMARY content — the bell periods (reads cfg.periods
    // {num,label,startTime,endTime,room}[]; same shape BELL_SCHEDULE writes).
    { key: 'periods',     label: 'Bell periods', default: '', kind: 'array-bell' },
    { key: 'tickerStamp', label: 'Ticker stamp', default: 'BELL SCHEDULE' },
    { key: 'tickerMessages', label: 'Ticker messages (one per line)', default: '', multiline: true },
  ],

  ANIMATED_BELL_SCHEDULE_PORTRAIT: [
    { key: 'eyebrow',     label: 'Eyebrow',     default: "★ Today's Bell Schedule ★" },
    { key: 'title',       label: 'Title',       default: 'BELL SCHEDULE' },
    { key: 'subtitle',    label: 'Subtitle',    default: 'Monday · April 19 · 2026 · REGULAR BELL' },
    { key: 'currentBadge', label: 'Current badge', default: 'LIVE · IN SESSION' },
    { key: 'periods',     label: 'Bell periods', default: '', kind: 'array-bell' },
    { key: 'tickerStamp', label: 'Ticker stamp', default: 'BELL SCHEDULE' },
    { key: 'tickerMessages', label: 'Ticker messages (one per line)', default: '', multiline: true },
  ],

  ANIMATED_BUS_BOARD: [
    { key: 'logoEmoji',     label: 'Shield icon (emoji)',            default: '🚌' },
    { key: 'title',         label: 'Title',                          default: 'Bus Board' },
    { key: 'subtitle',      label: 'Subtitle',                       default: 'Eagle Elementary · after-school routes' },
    { key: 'nextBusLabel',  label: 'Next bus label',                 default: 'NEXT BUS' },
    { key: 'nextBusRoute',  label: 'Next bus route',                 default: 'Route 1 · Maplewood' },
    { key: 'nextBusEta',    label: 'Next bus ETA (number)',          default: '20' },
    { key: 'nextBusEtaUnit', label: 'Next bus ETA unit',             default: 'MINUTES' },
    { key: 'weatherEmoji',  label: 'Weather icon (emoji)',           default: '☀️' },
    { key: 'weatherTemp',   label: 'Weather temp',                   default: '68°' },
    { key: 'weatherDesc',   label: 'Weather desc',                   default: 'SUNNY · NO DELAYS' },
    { key: 'tickerStamp',   label: 'Ticker stamp',                   default: 'Bus News' },
    { key: 'tickerMessages', label: 'Ticker messages (one per line)', default: '', multiline: true },
  ],

  ANIMATED_MORNING_NEWS: [
    { key: 'recLabel',     label: 'Recording label',                  default: '● LIVE · ON AIR' },
    { key: 'showTitle',    label: 'Show title',                       default: 'THE DAILY DIGEST' },
    { key: 'showTagline',  label: 'Show tagline',                     default: 'Your 5-minute school news' },
    { key: 'leadLiveTag',  label: 'Live tag on screen',               default: 'LIVE' },
    { key: 'leadEmoji',    label: 'Lead emoji',                       default: '🏆' },
    { key: 'leadCategory', label: 'Lead category',                    default: 'Top Story · Sports' },
    { key: 'leadHeadline', label: 'Lead headline',                    default: 'Varsity Football Clinches District Title' },
    { key: 'leadByline',   label: 'Lead byline',                      default: 'Reported by the 5th-grade newsroom · Coverage at 2:30', multiline: true },
    { key: 'breakingText', label: 'Breaking-ticker text',             default: 'Early dismissal FRIDAY at 1:15 PM · book fair extended through next Tuesday', multiline: true },
    { key: 'weatherEmoji', label: 'Weather emoji',                    default: '☀️' },
    { key: 'weatherTemp',  label: 'Weather temp',                     default: '68°' },
    { key: 'weatherDesc',  label: 'Weather desc',                     default: 'SUNNY · LIGHT WIND' },
    { key: 'weatherHiLo',  label: 'Weather hi/lo',                    default: 'H 72° · L 51°' },
    { key: 'tickerStamp',  label: 'Ticker stamp',                     default: 'DAILY DIGEST' },
    { key: 'tickerMessages', label: 'Ticker messages (one per line)', default: '', multiline: true },
  ],

  ANIMATED_ACHIEVEMENT_SHOWCASE: [
    { key: 'eyebrow',        label: 'Eyebrow',                          default: '★ Wall of Fame ★' },
    { key: 'title',          label: 'Title',                            default: 'Student of the Week' },
    { key: 'dateBar',        label: 'Date bar',                         default: 'monday · april 19 · 2026' },
    { key: 'heroIcon',       label: 'Medal icon (emoji)',                default: '🏆' },
    { key: 'awardLabel',     label: 'Award label',                      default: 'Academic Excellence' },
    { key: 'heroName',       label: 'Hero name',                        default: 'MAYA CHEN' },
    { key: 'heroReason',     label: 'Hero reason (use Enter for 2 lines)', default: 'perfect score on the state-wide spelling bee,\nAND she tutors 3rd graders after school!', multiline: true },
    { key: 'leftHeader',     label: 'Left list header',                 default: '★ HONOR ROLL ★' },
    { key: 'rightHeader',    label: 'Right list header',                default: '★ KINDNESS STARS ★' },
    { key: 'tickerStamp',    label: 'Ticker stamp',                     default: 'WALL OF FAME' },
    { key: 'tickerMessages', label: 'Ticker messages (one per line)',   default: '', multiline: true },
  ],

  ANIMATED_MAIN_ENTRANCE: [
    { key: 'eyebrow',          label: 'Eyebrow',                          default: 'welcome to' },
    { key: 'title',            label: 'School title',                     default: 'LINCOLN ELEMENTARY' },
    { key: 'subtitle',         label: 'Subtitle',                         default: 'where curious minds begin · since 1962' },
    { key: 'leftCrestEmoji',   label: 'Left crest emoji',                 default: '🦅' },
    { key: 'leftCrestLabel',   label: 'Left crest label',                 default: 'GO EAGLES' },
    { key: 'rightCrestEmoji',  label: 'Right crest emoji',                default: '📚' },
    { key: 'rightCrestLabel',  label: 'Right crest label',                default: 'LEARN DAILY' },
    { key: 'tile1Emoji',       label: 'Tile 1 emoji',                     default: '🔔' },
    { key: 'tile1Label',       label: 'Tile 1 label',                     default: 'SCHOOL BELL' },
    { key: 'tile1Big',         label: 'Tile 1 main',                      default: '8:15 AM' },
    { key: 'tile1Sub',         label: 'Tile 1 sub',                       default: 'first bell · see you in class' },
    { key: 'tile2Emoji',       label: 'Tile 2 emoji',                     default: '☀️' },
    { key: 'tile2Label',       label: 'Tile 2 label',                     default: "TODAY'S FORECAST" },
    { key: 'tile2Big',         label: 'Tile 2 main',                      default: '68°' },
    { key: 'tile2Sub',         label: 'Tile 2 sub',                       default: 'sunny + crisp, recess outside!' },
    { key: 'tile3Emoji',       label: 'Tile 3 emoji',                     default: '🎉' },
    { key: 'tile3Label',       label: 'Tile 3 label',                     default: 'COMING UP' },
    { key: 'tile3Big',         label: 'Tile 3 main',                      default: 'Spring Musical' },
    { key: 'tile3Sub',         label: 'Tile 3 sub',                       default: 'Thursday April 28 · 7pm' },
    { key: 'tickerStamp',      label: 'Ticker stamp',                     default: 'Welcome' },
    { key: 'tickerMessages',   label: 'Ticker messages (one per line)',   default: '', multiline: true },
  ],

  ANIMATED_CAFETERIA_CHALKBOARD: [
    { key: 'title',          label: 'Title',                                 default: "Today's Menu" },
    { key: 'subtitle',       label: 'Subtitle',                              default: '~ hot + fresh + ready at 11:30 ~' },
    // PRIMARY content — weekly menu (reads cfg.weekMenu {emoji,name,meta,price}[])
    { key: 'weekMenu',       label: 'Menu items',                            default: '', kind: 'array-menu' },
    { key: 'specialLabel',   label: 'Special label',                         default: "Today's Special" },
    { key: 'specialName',    label: 'Special name',                          default: 'Stuffed Crust Pepperoni' },
    { key: 'countdownLabel', label: 'Countdown label',                       default: 'Pizza Day in' },
    { key: 'countdownDate',  label: 'Countdown target date (YYYY-MM-DD)',    default: '' },
    { key: 'countdownUnit',  label: 'Countdown unit',                        default: '' },
    { key: 'chefName',       label: 'Chef name',                             default: 'Ms. Rodriguez' },
    { key: 'chefRole',       label: 'Chef role',                             default: 'lunch hero of the week' },
    { key: 'chefPhotoUrl',   label: 'Chef photo (upload)',                   default: '', kind: 'image' },
    { key: 'tickerStamp',    label: 'Ticker stamp',                          default: 'Chalkboard News' },
    { key: 'tickerMessages', label: 'Ticker messages (one per line)',        default: '', multiline: true },
  ],

  ANIMATED_CAFETERIA_FOODTRUCK: [
    { key: 'title',           label: 'Title',                                 default: 'LUNCH IS ON' },
    { key: 'subtitle',        label: 'Subtitle',                              default: '~ freshly rolled every day ~' },
    { key: 'weekMenu',        label: 'Menu items',                            default: '', kind: 'array-menu' },
    { key: 'specialEmoji',    label: 'Special emoji',                         default: '' },
    { key: 'specialLabel',    label: 'Special label',                         default: 'Pickup Special' },
    { key: 'specialName',     label: 'Special name',                          default: 'Street Taco Bowl' },
    { key: 'countdownLabel',  label: 'Countdown label',                       default: 'Taco Tuesday in' },
    { key: 'countdownDate',   label: 'Countdown target date (YYYY-MM-DD)',    default: '' },
    { key: 'countdownNumber', label: 'Countdown number (manual override)',    default: '' },
    { key: 'countdownUnit',   label: 'Countdown unit',                        default: '' },
    { key: 'chefName',        label: 'Chef name',                             default: 'Ms. Rodriguez' },
    { key: 'chefRole',        label: 'Chef role',                             default: 'lunch hero of the week' },
    { key: 'chefPhotoUrl',    label: 'Chef photo (upload)',                   default: '', kind: 'image' },
    { key: 'birthdayNames',   label: 'Birthday names (one per line)',         default: '' },
    { key: 'tickerStamp',     label: 'Ticker stamp',                          default: 'CAFÉ NEWS' },
    { key: 'tickerMessages',  label: 'Ticker messages (one per line)',        default: '', multiline: true },
  ],

  ANIMATED_CAFETERIA_FOODTRUCK_PORTRAIT: [
    { key: 'title',           label: 'Title',                                 default: 'LUNCH IS ON' },
    { key: 'subtitle',        label: 'Subtitle',                              default: '~ freshly rolled every day ~' },
    { key: 'weekMenu',        label: 'Menu items',                            default: '', kind: 'array-menu' },
    { key: 'specialEmoji',    label: 'Special emoji',                         default: '' },
    { key: 'specialLabel',    label: 'Special label',                         default: 'Pickup Special' },
    { key: 'specialName',     label: 'Special name',                          default: 'Street Taco Bowl' },
    { key: 'countdownLabel',  label: 'Countdown label',                       default: 'Taco Tuesday in' },
    { key: 'countdownDate',   label: 'Countdown target date (YYYY-MM-DD)',    default: '' },
    { key: 'countdownNumber', label: 'Countdown number (manual override)',    default: '' },
    { key: 'countdownUnit',   label: 'Countdown unit',                        default: '' },
    { key: 'chefName',        label: 'Chef name',                             default: 'Ms. Rodriguez' },
    { key: 'chefRole',        label: 'Chef role',                             default: 'lunch hero of the week' },
    { key: 'chefPhotoUrl',    label: 'Chef photo (upload)',                   default: '', kind: 'image' },
    { key: 'birthdayNames',   label: 'Birthday names (one per line)',         default: '' },
    { key: 'tickerStamp',     label: 'Ticker stamp',                          default: 'CAFÉ NEWS' },
    { key: 'tickerMessages',  label: 'Ticker messages (one per line)',        default: '', multiline: true },
  ],

  ANIMATED_CAFETERIA_MS: [
    { key: 'title',           label: 'Title',                                 default: 'EAGLE EATS' },
    { key: 'subtitle',        label: 'Subtitle',                              default: '~ fuel up, Eagles ~' },
    { key: 'weekMenu',        label: 'Menu items',                            default: '', kind: 'array-menu' },
    { key: 'specialEmoji',    label: 'Special emoji',                         default: '🍕' },
    { key: 'specialLabel',    label: 'Special label',                         default: 'PICKUP SPECIAL' },
    { key: 'specialName',     label: 'Special name',                          default: 'Stuffed Crust' },
    { key: 'countdownEmoji',  label: 'Countdown emoji',                       default: '🏈' },
    { key: 'countdownLabel',  label: 'Countdown label',                       default: 'Game Day in' },
    { key: 'countdownDate',   label: 'Countdown target date (YYYY-MM-DD)',    default: '' },
    { key: 'countdownNumber', label: 'Countdown number (manual override)',    default: '' },
    { key: 'countdownUnit',   label: 'Countdown unit',                        default: '' },
    { key: 'chefRole',        label: 'Chef role',                             default: 'LUNCH CHEF' },
    { key: 'chefEmoji',       label: 'Chef emoji',                            default: '' },
    { key: 'chefName',        label: 'Chef name',                             default: 'CHEF RIVERA' },
    { key: 'chefPhotoUrl',    label: 'Chef photo (upload)',                   default: '', kind: 'image' },
    { key: 'birthdayNames',   label: 'Birthday names (one per line)',         default: '' },
    { key: 'tickerStamp',     label: 'Ticker stamp',                          default: 'Eagle Eats' },
    { key: 'tickerMessages',  label: 'Ticker messages (one per line)',        default: '', multiline: true },
  ],

  ANIMATED_CAFETERIA_HS: [
    { key: 'title',           label: 'Title',                                 default: 'CAMPUS CAFÉ' },
    { key: 'subtitle',        label: 'Subtitle',                              default: 'open 7am · closes at the bell' },
    { key: 'weekMenu',        label: 'Menu items',                            default: '', kind: 'array-menu' },
    { key: 'specialEmoji',    label: 'Special emoji',                         default: '🥪' },
    { key: 'specialLabel',    label: 'Special label',                         default: "Today's Pick" },
    { key: 'specialName',     label: 'Special name',                          default: 'Turkey Club Wrap' },
    { key: 'countdownEmoji',  label: 'Countdown emoji',                       default: '🎓' },
    { key: 'countdownLabel',  label: 'Countdown label',                       default: 'Graduation in' },
    { key: 'countdownDate',   label: 'Countdown target date (YYYY-MM-DD)',    default: '' },
    { key: 'countdownNumber', label: 'Countdown number (manual override)',    default: '' },
    { key: 'countdownUnit',   label: 'Countdown unit',                        default: '' },
    { key: 'chefName',        label: 'Chef name',                             default: 'MR. PATEL' },
    { key: 'chefRole',        label: 'Chef role',                             default: 'café chef' },
    { key: 'chefPhotoUrl',    label: 'Chef photo (upload)',                   default: '', kind: 'image' },
    { key: 'birthdayNames',   label: 'Birthday names (one per line)',         default: '' },
    { key: 'tickerStamp',     label: 'Ticker stamp',                          default: 'Campus News' },
    { key: 'tickerMessages',  label: 'Ticker messages (one per line)',        default: '', multiline: true },
  ],

  ANIMATED_WELCOME_PORTRAIT: [
    { key: 'title',               label: 'Title',                default: 'Welcome, Friends!' },
    { key: 'subtitle',            label: 'Subtitle',             default: 'today is going to be amazing ✨' },
    { key: 'weatherDesc',         label: 'Weather desc',         default: '' },
    { key: 'countdownLabel',      label: 'Countdown label',      default: 'Field Trip in' },
    { key: 'announcementLabel',   label: 'Announcement label',   default: 'Big News' },
    { key: 'announcementMessage', label: 'Announcement message', default: 'Book Fair starts Monday! 📚 Come find your new favorite story.', multiline: true },
    { key: 'teacherRole',         label: 'Teacher role',         default: 'Teacher of the Week' },
    { key: 'teacherName',         label: 'Teacher name',         default: 'Mrs. Johnson' },
    { key: 'tickerStamp',         label: 'Ticker stamp',         default: 'SCHOOL NEWS' },
  ],

  BULLETIN_HALLWAY: [
    { key: 'title',           label: 'Title',           default: 'LEARN · GROW · SHINE' },
    { key: 'subtitle',        label: 'Subtitle',        default: '~ every day a new adventure ~' },
    { key: 'scheduleStamp',   label: 'Schedule stamp',  default: '~ TODAY ~' },
    { key: 'scheduleTitle',   label: 'Schedule title',  default: "Today's Schedule" },
    // PRIMARY content — the schedule itself (reads cfg.rows {num,time,name,room}[]).
    { key: 'rows',            label: 'Schedule rows',   default: '', kind: 'array-schedule' },
    { key: 'attendanceLabel', label: 'Attendance label', default: 'ATTENDANCE TODAY' },
    { key: 'attendancePct',   label: 'Attendance %',    default: '97' },
    { key: 'attendanceDay',   label: 'Attendance day',  default: 'Mon · April 19' },
    { key: 'clockLabel',      label: 'Clock label',     default: '~ time check ~' },
    { key: 'weatherLabel',    label: 'Weather label',   default: '~ sunny + crisp ~' },
    { key: 'annMsg',          label: 'Announcement message', default: 'Assembly in the gym Friday at 2 PM — all classes welcome!', multiline: true },
    { key: 'countdownLabel',  label: 'Countdown label', default: 'FIELD DAY IN' },
    { key: 'tickerStamp',     label: 'Ticker stamp',    default: 'HALLWAY NEWS' },
  ],

  BULLETIN_CAFETERIA: [
    { key: 'title',          label: 'Title',          default: "TODAY'S MENU" },
    { key: 'subtitle',       label: 'Subtitle',       default: "~ what's cooking in the kitchen ~" },
    // PRIMARY content — the food photo (reads cfg.photoEmoji; URL or emoji).
    { key: 'photoEmoji',     label: 'Food photo',     default: '', kind: 'image' },
    { key: 'photoStamp',     label: 'Photo stamp',    default: '~ TODAY IN THE KITCHEN ~' },
    { key: 'photoCaption',   label: 'Photo caption',  default: 'served fresh today' },
    // PRIMARY content — the menu itself (reads cfg.weekMenu / cfg.menuItems).
    { key: 'weekMenu',       label: 'Menu items',     default: '', kind: 'array-menu' },
    { key: 'memoMessage',    label: 'Memo message',   default: 'Pizza Friday is BACK! Cheese + pepperoni in line 2.', multiline: true },
    { key: 'countdownLabel', label: 'Countdown label', default: 'NEXT MEAL IN' },
    { key: 'tickerStamp',    label: 'Ticker stamp',   default: 'FROM THE KITCHEN' },
  ],

  SCRAPBOOK_HALLWAY: [
    { key: 'title',             label: 'Title',             default: 'LEARN · GROW · SHINE' },
    { key: 'subtitle',          label: 'Subtitle',          default: 'every day a new adventure' },
    { key: 'schedulePageLabel', label: 'Schedule page label', default: "~ Today's Schedule ~" },
    { key: 'scheduleTitle',     label: 'Schedule title',    default: 'Period by Period' },
    // PRIMARY content — the schedule itself (reads cfg.rows {num,time,name,room}[]).
    { key: 'rows',              label: 'Schedule rows',     default: '', kind: 'array-schedule' },
    { key: 'attendanceLabel',   label: 'Attendance label',  default: '~ here today ~' },
    { key: 'attendancePct',     label: 'Attendance %',      default: '97' },
    { key: 'attendanceDay',     label: 'Attendance day',    default: 'Mon · 4/19' },
    { key: 'weatherTemp',       label: 'Weather temp',      default: '42°' },
    { key: 'weatherDesc',       label: 'Weather desc',      default: 'sunny + crisp' },
    { key: 'annLabel',          label: 'Announcement label', default: 'Announcement' },
    { key: 'annMsg',            label: 'Announcement msg',  default: 'Assembly in the gym Friday at 2 PM — all classes welcome!', multiline: true },
    { key: 'countdownLabel',    label: 'Countdown label',   default: 'Field Day in' },
    { key: 'tickerStamp',       label: 'Ticker stamp',      default: 'HALLWAY NEWS' },
  ],

  SCRAPBOOK_CAFETERIA: [
    { key: 'title',           label: 'Title',           default: "Today's Menu" },
    { key: 'subtitle',        label: 'Subtitle',        default: "what's cooking in the kitchen" },
    // Polaroid is an emoji-only slot (cfg.polaroidEmoji renders as text, no
    // <img> path) so it stays a plain text field rather than an asset picker.
    { key: 'polaroidEmoji',   label: 'Polaroid emoji',  default: '🍝' },
    { key: 'polaroidCaption', label: 'Polaroid caption', default: '~ snapped this morning ~' },
    // PRIMARY content — the menu cards (reads cfg.cards {title,desc}[]).
    { key: 'cards',           label: 'Menu cards',      default: '', kind: 'array-cards' },
    { key: 'specialLabel',    label: 'Special label',   default: "Today's Special" },
    { key: 'specialMsg',      label: 'Special message', default: 'Pizza Friday is BACK! 🍕 Cheese + pepperoni in line 2.', multiline: true },
    { key: 'countdownLabel',  label: 'Countdown label', default: 'Next meal in' },
    { key: 'tickerStamp',     label: 'Ticker stamp',    default: 'FROM THE KITCHEN' },
  ],

  STORYBOOK_HALLWAY: [
    { key: 'chapter',            label: 'Chapter',             default: 'In which we begin our day' },
    { key: 'title',              label: 'Title',               default: 'LEARN · GROW · SHINE' },
    { key: 'subtitle',           label: 'Subtitle',            default: 'every day, a new adventure' },
    { key: 'scheduleTitle',      label: 'Schedule title',      default: "Today's Schedule" },
    { key: 'scheduleSub',        label: 'Schedule sub',        default: 'period by period, hour by hour' },
    // PRIMARY content — the schedule itself (reads cfg.rows {num,time,name,room}[]).
    { key: 'rows',               label: 'Schedule rows',       default: '', kind: 'array-schedule' },
    { key: 'attendanceTopLabel', label: 'Attendance top label', default: 'Attendance today' },
    { key: 'attendancePct',      label: 'Attendance %',        default: '97' },
    { key: 'attendanceBotLabel', label: 'Attendance bottom',   default: '— a fine showing —' },
    { key: 'clockLabel',         label: 'Clock label',         default: '~ noon hour ~' },
    { key: 'weatherTemp',        label: 'Weather temp',        default: '42°' },
    { key: 'weatherDesc',        label: 'Weather desc',        default: '~ clear skies ~' },
    { key: 'annLabel',           label: 'Announcement label',  default: 'An announcement —' },
    { key: 'annMsg',             label: 'Announcement msg',    default: "Assembly in the gymnasium, Friday at two o'clock — all classes welcome!", multiline: true },
    { key: 'countdownLabel',     label: 'Countdown label',     default: 'until field day' },
    { key: 'countdownUnit',      label: 'Countdown unit',      default: '' },
    { key: 'pageNumLeft',        label: 'Page num left',       default: '— xiv —' },
    { key: 'pageNumRight',       label: 'Page num right',      default: '— xv —' },
    { key: 'tickerStamp',        label: 'Ticker stamp',        default: 'A WORD FROM THE HALLS' },
  ],

  STORYBOOK_CAFETERIA: [
    { key: 'chapter',        label: 'Chapter',        default: 'Chapter Twelve' },
    { key: 'title',          label: 'Title',          default: "Today's Menu" },
    { key: 'subtitle',       label: 'Subtitle',       default: 'in which the kitchen serves a feast' },
    // PRIMARY content — the food photo (reads cfg.heroEmoji; URL or emoji).
    { key: 'heroEmoji',      label: 'Food photo',     default: '', kind: 'image' },
    { key: 'heroCaption',    label: 'Hero caption',   default: 'from the kitchen' },
    // PRIMARY content — the menu itself (reads cfg.weekMenu / cfg.menuItems).
    { key: 'weekMenu',       label: 'Menu items',     default: '', kind: 'array-menu' },
    { key: 'noteLabel',      label: 'Note label',     default: 'A note from the cook —' },
    { key: 'noteMessage',    label: 'Note message',   default: 'Pizza Friday returns at last! Cheese & pepperoni in line two.', multiline: true },
    { key: 'countdownLabel', label: 'Countdown label', default: 'until next meal' },
    { key: 'tickerStamp',    label: 'Ticker stamp',   default: 'FROM THE KITCHEN' },
  ],
};

/**
 * Portrait companions of themed widgets. A portrait widget is a
 * layout-only port of its landscape sibling and reads the IDENTICAL
 * config keys (verified: e.g. AnimatedBusBoard{,Portrait}Widget read
 * the same `cfg.*`). It therefore reuses the landscape field set
 * verbatim — aliased here rather than duplicated so the two stay in
 * sync. Without this, selecting one of these portrait widgets in the
 * builder showed an EMPTY properties panel ("template not editable").
 * The portrait keys already declared explicitly above are left as-is.
 */
const PORTRAIT_OF: Record<string, string> = {
  ANIMATED_ACHIEVEMENT_SHOWCASE_PORTRAIT: 'ANIMATED_ACHIEVEMENT_SHOWCASE',
  ANIMATED_BUS_BOARD_PORTRAIT:            'ANIMATED_BUS_BOARD',
  ANIMATED_MAIN_ENTRANCE_PORTRAIT:        'ANIMATED_MAIN_ENTRANCE',
  ANIMATED_MORNING_NEWS_PORTRAIT:         'ANIMATED_MORNING_NEWS',
  ANIMATED_CAFETERIA_HS_PORTRAIT:         'ANIMATED_CAFETERIA_HS',
  ANIMATED_CAFETERIA_MS_PORTRAIT:         'ANIMATED_CAFETERIA_MS',
  ANIMATED_CAFETERIA_CHALKBOARD_PORTRAIT: 'ANIMATED_CAFETERIA_CHALKBOARD',
  BULLETIN_HALLWAY_PORTRAIT:              'BULLETIN_HALLWAY',
  BULLETIN_CAFETERIA_PORTRAIT:            'BULLETIN_CAFETERIA',
  SCRAPBOOK_HALLWAY_PORTRAIT:             'SCRAPBOOK_HALLWAY',
  SCRAPBOOK_CAFETERIA_PORTRAIT:           'SCRAPBOOK_CAFETERIA',
  STORYBOOK_HALLWAY_PORTRAIT:             'STORYBOOK_HALLWAY',
  STORYBOOK_CAFETERIA_PORTRAIT:           'STORYBOOK_CAFETERIA',
};
for (const [portrait, landscape] of Object.entries(PORTRAIT_OF)) {
  if (THEMED_WIDGET_FIELDS[landscape] && !THEMED_WIDGET_FIELDS[portrait]) {
    THEMED_WIDGET_FIELDS[portrait] = THEMED_WIDGET_FIELDS[landscape];
  }
}

/**
 * True if a widgetType has a defaults entry — PropertiesPanel uses this
 * to know whether to dispatch to the auto-form case for themed widgets.
 */
export function hasThemedDefaults(widgetType: string): boolean {
  return !!THEMED_WIDGET_FIELDS[widgetType];
}
