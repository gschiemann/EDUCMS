/**
 * The Screens map's Locations rail, as data — pure, so it can be unit-tested
 * without Leaflet.
 *
 * Operators think in LOCATIONS first, then the GROUPS at that location, then
 * the EQUIPMENT in each group (2026-09-14, Greg: "make sure we show location,
 * then down to group, then down to equipment"). A location is one physical
 * address; a group is a screen group; equipment is the screens.
 *
 * Every location and group the operator has set up is listed, whether or not
 * anything is paired there yet (Greg: "does this only show locations that
 * have equipment?" — it used to): a group with an address but no screens is
 * its own location reading "No screens yet"; a group at an address that has
 * screens sits inside that location, also reading "No screens yet".
 */

export type ScreenForMap = {
  id: string;
  name: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  address?: string | null;
  geoSource?: 'screen' | 'group' | 'tenant' | 'none';
  lastPingAt?: string | null;
  lastCacheReport?: { emergency?: { count?: number; bytes?: number } } | null;
  /** The screen's group, for the Location → Group → Equipment rail. */
  screenGroupId?: string | null;
  screenGroupName?: string | null;
};

/** A screen group as the rail needs it: name plus wherever it is pinned. */
export type MapGroup = {
  id: string;
  name: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

// 4 glance-states for the map. The old taxonomy had 6 (three "Online · …"
// micro-states + Offline-as-red), which overwhelmed the legend. The richer
// emergency-cache / stale-sync detail is preserved in the per-pin popup via
// onlineDetail() — just kept off the at-a-glance key.
export type StatusKey = 'EMERGENCY' | 'ONLINE' | 'OFFLINE' | 'PENDING';

/** Severity order for cluster worst-case coloring: higher = worse. */
export const STATUS_SEVERITY: Record<StatusKey, number> = {
  EMERGENCY: 3,
  OFFLINE: 2,
  PENDING: 1,
  ONLINE: 0,
};

export function classifyScreen(s: ScreenForMap, emergencyActive: boolean): StatusKey {
  if (emergencyActive && s.status === 'ONLINE') return 'EMERGENCY';
  if (s.status === 'PENDING' || !s.status) return 'PENDING';
  if (s.status !== 'ONLINE') return 'OFFLINE';
  return 'ONLINE';
}

export const UNGROUPED_KEY = '__ungrouped__';

/** One group inside a location. `id === null` is "Not in a group". */
export type StoreGroup = {
  id: string | null;
  name: string;
  devices: ScreenForMap[];
  /** Worst status across its devices; null when it has none. */
  status: StatusKey | null;
};

export type Store = {
  key: string;
  label: string; // street line, e.g. "12657 Alcosta Blvd"
  city: string | null; // "San Ramon, CA"
  lat: number; // centroid
  lng: number;
  devices: ScreenForMap[];
  /** Location → Group → Equipment: the same devices, by group, plus groups with none. */
  groups: StoreGroup[];
  status: StatusKey; // worst status across devices (drives the rollup dot); PENDING when empty
  fromTenant: boolean; // true if these pins are the building fallback, not real per-screen pins
};

/** Normalize an address into a stable grouping key (drops unit noise + trailing country). */
export function normalizeAddrKey(addr?: string | null): string | null {
  if (!addr) return null;
  const k = addr
    .toLowerCase()
    .replace(/,?\s*(usa|united states)\.?$/i, '')
    // A ZIP on one copy of the address and not the other must not split a
    // location in two (a group typed with the ZIP, a screen without).
    .replace(/,?\s*\b\d{5}(-\d{4})?\b\s*$/, '')
    .replace(/\bste\b|\bsuite\b|\bunit\b|\bapt\b|#\s*\w+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return k || null;
}

/** Split a formatted address into a short street line + a "City, ST" line. */
export function storeLabel(addr?: string | null): { label: string; city: string | null } {
  if (!addr) return { label: 'Pinned location', city: null };
  const parts = addr
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !/^(usa|united states)\.?$/i.test(p));
  const label = parts[0] ?? addr;
  // Prefer "City, ST" from the next two segments when they look like one.
  const city =
    parts.length >= 3 ? `${parts[1]}, ${parts[2].replace(/\s*\d{5}(-\d{4})?$/, '').trim()}` : parts[1] ?? null;
  return { label, city: city || null };
}

const worstOf = (devices: ScreenForMap[], emergencyActive: boolean): StatusKey | null => {
  let worst: StatusKey | null = null;
  let sev = -1;
  for (const d of devices) {
    const st = classifyScreen(d, emergencyActive);
    if (STATUS_SEVERITY[st] > sev) { sev = STATUS_SEVERITY[st]; worst = st; }
  }
  return worst;
};

const locKey = (address: string | null | undefined, lat: number, lng: number) =>
  normalizeAddrKey(address) ?? `${lat.toFixed(4)},${lng.toFixed(4)}`;

/**
 * Group located screens into locations (worst-status-first, then most
 * devices), each holding its groups (worst first, populated before empty,
 * "Not in a group" last), each holding its equipment.
 */
export function deriveStores(located: ScreenForMap[], emergencyActive: boolean, groups: MapGroup[] = []): Store[] {
  const byKey = new Map<string, ScreenForMap[]>();
  for (const s of located) {
    if (s.latitude == null || s.longitude == null) continue;
    const key = locKey(s.address, s.latitude, s.longitude);
    const arr = byKey.get(key);
    if (arr) arr.push(s);
    else byKey.set(key, [s]);
  }
  // Groups that are pinned somewhere: their key is where they live. A group
  // whose address text differs from its screens' but whose pin sits within
  // ~50 m of an existing location belongs to that location, not a new one.
  const centroids = [...byKey.entries()].map(([key, devs]) => ({
    key,
    lat: devs.reduce((a, s) => a + (s.latitude as number), 0) / devs.length,
    lng: devs.reduce((a, s) => a + (s.longitude as number), 0) / devs.length,
  }));
  const NEAR = 0.0005; // degrees, ≈ 50 m
  const groupKey = new Map<string, string>();
  for (const g of groups) {
    if (g.latitude == null || g.longitude == null) continue;
    const own = locKey(g.address, g.latitude, g.longitude);
    const near = byKey.has(own) ? own : centroids.find((c) => Math.abs(c.lat - (g.latitude as number)) < NEAR && Math.abs(c.lng - (g.longitude as number)) < NEAR)?.key;
    groupKey.set(g.id, near ?? own);
  }
  // A pinned group with no located screens is a location of its own.
  const emptyStores: Store[] = [];
  for (const g of groups) {
    const key = groupKey.get(g.id);
    if (!key || byKey.has(key) || emptyStores.some((st) => st.key === key)) continue;
    const { label, city } = g.address ? storeLabel(g.address) : { label: g.name, city: null };
    emptyStores.push({
      key, label, city, lat: g.latitude as number, lng: g.longitude as number,
      devices: [], groups: [], status: 'PENDING', fromTenant: false,
    });
  }

  const nameOf = (id: string | null, fallback: string | null | undefined) =>
    (id && groups.find((g) => g.id === id)?.name) || fallback || 'Group';

  const buildGroups = (key: string, devices: ScreenForMap[]): StoreGroup[] => {
    const buckets = new Map<string, StoreGroup>();
    for (const d of devices) {
      const id = d.screenGroupId ?? null;
      const k = id ?? UNGROUPED_KEY;
      const g = buckets.get(k);
      if (g) g.devices.push(d);
      else buckets.set(k, { id, name: id ? nameOf(id, d.screenGroupName) : 'Not in a group', devices: [d], status: null });
    }
    // Groups pinned at this address with nothing in them yet.
    for (const g of groups) {
      if (groupKey.get(g.id) === key && !buckets.has(g.id)) buckets.set(g.id, { id: g.id, name: g.name, devices: [], status: null });
    }
    const out = [...buckets.values()].map((g) => ({ ...g, status: worstOf(g.devices, emergencyActive) }));
    out.sort((a, b) => {
      if ((a.id === null) !== (b.id === null)) return a.id === null ? 1 : -1;          // ungrouped last
      if ((a.devices.length === 0) !== (b.devices.length === 0)) return a.devices.length === 0 ? 1 : -1; // empty after populated
      const sa = a.status ? STATUS_SEVERITY[a.status] : -1, sb = b.status ? STATUS_SEVERITY[b.status] : -1;
      return sb - sa || b.devices.length - a.devices.length || a.name.localeCompare(b.name);
    });
    return out;
  };

  const stores: Store[] = [];
  for (const [key, devices] of byKey) {
    const lat = devices.reduce((a, s) => a + (s.latitude as number), 0) / devices.length;
    const lng = devices.reduce((a, s) => a + (s.longitude as number), 0) / devices.length;
    const { label, city } = storeLabel(devices[0].address);
    stores.push({
      key, label, city, lat, lng, devices,
      groups: buildGroups(key, devices),
      status: worstOf(devices, emergencyActive) ?? 'PENDING',
      fromTenant: devices.every((d) => d.geoSource === 'tenant'),
    });
  }
  for (const st of emptyStores) st.groups = buildGroups(st.key, []);
  stores.push(...emptyStores);
  stores.sort(
    (a, b) =>
      STATUS_SEVERITY[b.status] - STATUS_SEVERITY[a.status] || b.devices.length - a.devices.length || a.label.localeCompare(b.label),
  );
  return stores;
}
