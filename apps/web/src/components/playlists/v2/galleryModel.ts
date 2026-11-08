/**
 * Playlists gallery v2 — the pure half (design preview, 2026-11-02).
 *
 * Greg on the v1 card grid: "playlist are exciting its what on the screen so
 * this menu needs to present them very well and make it easy to find what is
 * playing where". Everything the v2 card says about WHERE a playlist plays,
 * which way round its content is, and what the Filter menu can narrow by is
 * decided here from data the page already loads (playlists, schedules,
 * screens, groups) — no new request. Verdicts that already exist (schedule
 * state, delivery, needs-attention) stay in `v1/playlistOps.ts` and are read,
 * never re-derived.
 */
import {
  isScheduleEligibleNow, resolveTargetScreenIds,
  type OpsGroupRef, type OpsScheduleRef, type OpsScreenRef, type PlaylistSummaryRow,
} from '../v1/playlistOps';

export type ContentOrientation = 'portrait' | 'landscape' | 'unknown';

/** The raw screen fields this file reads beyond `OpsScreenRef`. */
export interface GalleryScreenRef extends OpsScreenRef {
  location?: string | null;
  orientation?: string | null;
}

const dims = (w: unknown, h: unknown): ContentOrientation => {
  const W = Number(w);
  const H = Number(h);
  if (!Number.isFinite(W) || !Number.isFinite(H) || W <= 0 || H <= 0) return 'unknown';
  return H > W ? 'portrait' : 'landscape';
};

/** Orientation of a "1080x1920" resolution string, or of a screen's lock. */
export function screenOrientation(screen: GalleryScreenRef | undefined): ContentOrientation {
  if (!screen) return 'unknown';
  const lock = String(screen.orientation ?? '').toUpperCase();
  if (lock.startsWith('PORTRAIT')) return 'portrait';
  if (lock.startsWith('LANDSCAPE')) return 'landscape';
  const m = /(\d+)\s*[x×]\s*(\d+)/i.exec(String(screen.resolution ?? ''));
  return m ? dims(m[1], m[2]) : 'unknown';
}

/** Width × height the API recorded for an asset, when it recorded one. */
function assetOrientation(asset: any): ContentOrientation {
  if (!asset) return 'unknown';
  const meta = asset.processingMeta && typeof asset.processingMeta === 'object' ? asset.processingMeta : null;
  const od = meta?.originalDimensions;
  if (od) { const o = dims(od.w ?? od.width, od.h ?? od.height); if (o !== 'unknown') return o; }
  const probe = meta?.probe;
  if (probe) { const o = dims(probe.width, probe.height); if (o !== 'unknown') return o; }
  return dims(asset.width, asset.height);
}

/**
 * Which way round a playlist's content is. Evidence in order: the template's
 * own canvas; the first visual item's recorded size; the screens it plays on.
 * `unknown` when nothing says — the card then draws the uniform frame and
 * lets the picture sit in it as it is.
 */
export function playlistOrientation(
  raw: any,
  targetScreens: GalleryScreenRef[],
): ContentOrientation {
  const tpl = raw?.template;
  if (tpl) { const o = dims(tpl.screenWidth, tpl.screenHeight); if (o !== 'unknown') return o; }
  for (const it of (raw?.items as any[]) ?? []) {
    const o = assetOrientation(it?.asset);
    if (o !== 'unknown') return o;
  }
  const votes = targetScreens.map(screenOrientation).filter((o) => o !== 'unknown');
  if (votes.length > 0) {
    const portrait = votes.filter((o) => o === 'portrait').length;
    return portrait * 2 > votes.length ? 'portrait' : 'landscape';
  }
  return 'unknown';
}

/** The first item a picture can be made from — an image, or a video poster. */
export interface HeroPicture { src: string; isVideo: boolean; count: number }

/** One of a playlist's items as a picture the card can show whole. */
export interface PreviewPicture { key: string; src: string; isVideo: boolean }

/**
 * The playlist's actual items as pictures, in play order: images, and videos
 * through their poster frame. The same file twice is shown once. `total` is
 * every visual item (the "+N" a card may say), `pictures` at most `max`.
 */
export function previewPictures(
  raw: any,
  resolveUrl: (asset: any) => string | null,
  max = 8,
): { pictures: PreviewPicture[]; total: number } {
  const items = ((raw?.items as any[]) ?? []).map((it) => it?.asset).filter(Boolean);
  const visual = items.filter((a) => /^(image|video)\//.test(a?.mimeType ?? ''));
  const seen = new Set<string>();
  const pictures: PreviewPicture[] = [];
  for (const a of visual) {
    if (pictures.length >= max) break;
    const src = resolveUrl(a);
    if (!src || seen.has(src)) continue;
    seen.add(src);
    pictures.push({ key: String(a.id ?? src), src, isVideo: String(a.mimeType).startsWith('video/') });
  }
  return { pictures, total: visual.length };
}

/** How many cards a gallery draws before "Show more" (paging, not a scroll trap). */
export const GALLERY_PAGE_SIZE = 24;

/** The first `shown` entries plus how many are left behind "Show more". */
export function pageGallery<T>(entries: T[], shown: number): { page: T[]; remaining: number } {
  const n = Math.max(0, Math.floor(shown));
  return { page: entries.slice(0, n), remaining: Math.max(0, entries.length - n) };
}

export function heroPicture(raw: any, resolveUrl: (asset: any) => string | null): HeroPicture | null {
  const items = ((raw?.items as any[]) ?? []).map((it) => it?.asset).filter(Boolean);
  const visual = items.filter((a) => /^(image|video)\//.test(a?.mimeType ?? ''));
  for (const a of visual) {
    const src = resolveUrl(a);
    if (src) return { src, isVideo: String(a.mimeType).startsWith('video/'), count: visual.length };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Playing where
// ─────────────────────────────────────────────────────────────────────

export interface WherePlace {
  kind: 'group' | 'screen';
  id: string;
  name: string;
  /** Screens behind this place (1 for a screen). */
  screens: number;
  /** For a screen: whether it is checking in. Null for a group. */
  online: boolean | null;
}

export interface PlayingWhere {
  /** Where it is playing RIGHT NOW (ACTIVE) — or where it is set to play. */
  places: WherePlace[];
  /** Distinct screens behind `places`. */
  screenCount: number;
  /** True when the places are live now; false when they are only targets. */
  live: boolean;
  /** Screens behind `places` that are not checking in, by name — the card says which. */
  offline: Array<{ id: string; name: string }>;
}

const isOnline = (s: GalleryScreenRef | undefined) => String(s?.status ?? '').toUpperCase() === 'ONLINE';

/**
 * The groups and screens a playlist is on. For a playlist that is playing,
 * only the rules open right now count (a weekend-only rule is not "playing
 * where" on a Tuesday); otherwise every rule it has. Groups first, then the
 * screens pinned on their own; a screen already inside a listed group is not
 * listed twice.
 */
export function playingWhere(
  row: Pick<PlaylistSummaryRow, 'id' | 'scheduleState'>,
  schedules: OpsScheduleRef[],
  screens: GalleryScreenRef[],
  groups: OpsGroupRef[],
  now: Date,
): PlayingWhere {
  const mine = schedules.filter((s) => s.playlistId === row.id);
  const open = mine.filter((s) => isScheduleEligibleNow(s, now));
  const live = row.scheduleState === 'ACTIVE' && open.length > 0;
  const rules = live ? open : mine;
  const screenById = new Map(screens.map((s) => [s.id, s]));
  const groupById = new Map(groups.map((g) => [g.id, g]));

  const places: WherePlace[] = [];
  const seenGroups = new Set<string>();
  const inGroups = new Set<string>();
  for (const r of rules) {
    if (!r.screenGroupId || seenGroups.has(r.screenGroupId)) continue;
    seenGroups.add(r.screenGroupId);
    const members = resolveTargetScreenIds([{ ...r, screenId: null }], groups, screens);
    members.forEach((id) => inGroups.add(id));
    places.push({
      kind: 'group',
      id: r.screenGroupId,
      name: r.screenGroup?.name || groupById.get(r.screenGroupId)?.name || 'Screen group',
      screens: members.length,
      online: null,
    });
  }
  const seenScreens = new Set<string>();
  for (const r of rules) {
    if (!r.screenId || inGroups.has(r.screenId) || seenScreens.has(r.screenId)) continue;
    seenScreens.add(r.screenId);
    const sc = screenById.get(r.screenId);
    places.push({
      kind: 'screen',
      id: r.screenId,
      name: sc?.name || r.screen?.name || 'Screen',
      screens: 1,
      online: sc ? isOnline(sc) : null,
    });
  }
  const targetIds = resolveTargetScreenIds(rules, groups, screens);
  const offline = targetIds
    .map((id) => screenById.get(id))
    .filter((sc): sc is GalleryScreenRef => !!sc && !isOnline(sc))
    .map((sc) => ({ id: sc.id, name: sc.name || 'Screen' }));
  return { places, screenCount: targetIds.length, live, offline };
}

// ─────────────────────────────────────────────────────────────────────
// Filter + tabs + sort
// ─────────────────────────────────────────────────────────────────────

export type GalleryTab = 'all' | 'playing' | 'scheduled' | 'unassigned' | 'attention';
export type GallerySort = 'playing' | 'updated' | 'name' | 'screens';

export interface GalleryFilters {
  screen: string;
  group: string;
  location: string;
  orientation: '' | 'portrait' | 'landscape';
}

export const EMPTY_GALLERY_FILTERS: GalleryFilters = { screen: '', group: '', location: '', orientation: '' };

/** A screen's location label: the location (tenant) it belongs to, else its own location text. */
export function screenLocation(s: GalleryScreenRef): string | null {
  const name = s.sourceTenant?.name || s.location;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

export interface GalleryEntry {
  row: PlaylistSummaryRow;
  orientation: ContentOrientation;
  where: PlayingWhere;
  attention: boolean;
}

export function matchesGalleryTab(e: GalleryEntry, tab: GalleryTab): boolean {
  switch (tab) {
    case 'playing': return e.row.scheduleState === 'ACTIVE';
    case 'scheduled': return e.row.scheduleState === 'SCHEDULED';
    case 'unassigned': return e.row.scheduleState === 'UNASSIGNED';
    case 'attention': return e.attention;
    default: return true;
  }
}

export function applyGallery(input: {
  entries: GalleryEntry[];
  tab: GalleryTab;
  search: string;
  filters: GalleryFilters;
  sort: GallerySort;
  screens: GalleryScreenRef[];
}): GalleryEntry[] {
  const q = input.search.trim().toLowerCase();
  const f = input.filters;
  const screenById = new Map(input.screens.map((s) => [s.id, s]));
  const out = input.entries.filter((e) => {
    if (!matchesGalleryTab(e, input.tab)) return false;
    if (q && !e.row.searchText.includes(q) && !e.row.name.toLowerCase().includes(q)) return false;
    if (f.orientation && e.orientation !== f.orientation) return false;
    if (f.screen && !e.row.targetScreenIds.includes(f.screen)) return false;
    if (f.group && !e.row.targetScreenIds.some((id) => screenById.get(id)?.screenGroupId === f.group)) return false;
    if (f.location && !e.row.targetScreenIds.some((id) => {
      const s = screenById.get(id);
      return s ? screenLocation(s) === f.location : false;
    })) return false;
    return true;
  });
  const byName = (a: GalleryEntry, b: GalleryEntry) => a.row.name.localeCompare(b.row.name);
  const rank = (e: GalleryEntry) =>
    e.row.scheduleState === 'ACTIVE' ? 0 : e.row.scheduleState === 'SCHEDULED' ? 1 : e.row.scheduleState === 'PAUSED' ? 2 : 3;
  const sorted = [...out];
  switch (input.sort) {
    case 'name': sorted.sort(byName); break;
    case 'screens': sorted.sort((a, b) => (b.where.screenCount - a.where.screenCount) || byName(a, b)); break;
    case 'updated': sorted.sort((a, b) => (Date.parse(b.row.updatedAt) - Date.parse(a.row.updatedAt)) || byName(a, b)); break;
    case 'playing':
    default:
      sorted.sort((a, b) => (rank(a) - rank(b)) || (b.where.screenCount - a.where.screenCount) || byName(a, b));
      break;
  }
  return sorted;
}

export interface GalleryCounts { all: number; playing: number; scheduled: number; unassigned: number; attention: number }

export function countGallery(entries: GalleryEntry[]): GalleryCounts {
  const n = (tab: GalleryTab) => entries.filter((e) => matchesGalleryTab(e, tab)).length;
  return { all: entries.length, playing: n('playing'), scheduled: n('scheduled'), unassigned: n('unassigned'), attention: n('attention') };
}
