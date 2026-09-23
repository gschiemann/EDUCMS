import type { CatalogSnapshot, NormalizedItem, NormalizedLocation } from './square';

/** Toast supplies the API hostname with the restaurant's API credentials. */
export interface ToastCredentials {
  clientId: string;
  clientSecret: string;
  apiBaseUrl: string;
  restaurants: { guid: string; name: string }[];
}

export type ToastAccess = Pick<ToastCredentials, 'clientId' | 'clientSecret' | 'apiBaseUrl'>;

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseToastAccess(raw: Record<string, unknown>): ToastAccess {
  const clientId = String(raw.clientId || '').trim();
  const clientSecret = String(raw.clientSecret || '').trim();
  const base = String(raw.apiBaseUrl || '').trim().replace(/\/$/, '');
  if (!clientId || !clientSecret) throw new Error('Toast client ID and client secret are required.');
  let url: URL;
  try { url = new URL(base); } catch { throw new Error('Enter the Toast API endpoint from your Toast developer portal.'); }
  // Never let a credential-bearing request reach a user-controlled host.
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.toasttab\.com$/i.test(url.hostname) ||
      url.pathname !== '/' || url.search || url.hash || url.port || url.username || url.password) {
    throw new Error('Toast API endpoint must be an HTTPS toasttab.com hostname.');
  }
  return { clientId, clientSecret, apiBaseUrl: url.origin };
}

export function parseToastCredentials(raw: Record<string, unknown>): ToastCredentials {
  const access = parseToastAccess(raw);
  const rows = Array.isArray(raw.restaurants) ? raw.restaurants : [
    { guid: raw.restaurantGuid, name: raw.restaurantName || 'Restaurant' },
  ];
  const restaurants = rows.map((r: any) => ({
    guid: String(r?.guid || '').trim(), name: String(r?.name || '').trim(),
  }));
  if (!restaurants.length || restaurants.length > 50 || restaurants.some((r) => !GUID.test(r.guid) || !r.name)) {
    throw new Error('Add 1–50 Toast restaurant GUIDs, each with a location name.');
  }
  if (new Set(restaurants.map((r) => r.guid.toLowerCase())).size !== restaurants.length) {
    throw new Error('Toast restaurant GUIDs must be unique.');
  }
  return { ...access, restaurants };
}

/** Partner API credentials can enumerate accessible stores. Standard restaurant
 * API credentials may lack this permission; callers then ask for a GUID. */
export async function discoverToastRestaurants(raw: Record<string, unknown>): Promise<{ restaurants: ToastCredentials['restaurants']; manualRequired: boolean }> {
  const access = parseToastAccess(raw);
  const token = await authenticateToast({ ...access, restaurants: [] });
  let response = await fetch(`${access.apiBaseUrl}/partners/v1/restaurants`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 401) throw new Error('Toast rejected the API credentials.');
  if (response.status === 403 || response.status === 404) {
    // Management-group/analytics accounts can enumerate restaurants without
    // partner access. Standard menu-only credentials may lack both scopes.
    response = await fetch(`${access.apiBaseUrl}/era/v1/restaurants-information`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  if (response.status === 403 || response.status === 404) return { restaurants: [], manualRequired: true };
  if (!response.ok) throw new Error(`Toast store discovery failed (${response.status}). Try again or enter your restaurant GUID.`);
  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new Error('Toast returned an invalid store list.');
  const byGuid = new Map<string, { guid: string; name: string }>();
  for (const row of body) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    if (item.deleted === true || item.archived === true || item.active === false) continue;
    const guid = String(item.restaurantGuid || '').trim();
    if (!GUID.test(guid)) continue;
    const name = String(item.locationName || item.restaurantName || 'Restaurant').trim();
    byGuid.set(guid.toLowerCase(), { guid, name: name || 'Restaurant' });
  }
  return { restaurants: [...byGuid.values()], manualRequired: byGuid.size === 0 };
}

type ToastItem = {
  guid?: string; multiLocationId?: string; name?: string; description?: string;
  price?: number | null; pricingStrategy?: string; image?: string | null;
  images?: string[] | null; visibility?: string[] | null;
};
type ToastGroup = { guid?: string; name?: string; menuItems?: ToastItem[]; menuGroups?: ToastGroup[] };
type ToastMenu = { guid?: string; name?: string; menuGroups?: ToastGroup[] };

function pickImage(item: ToastItem): string | undefined {
  const raw = item.images?.find(Boolean) || item.image || '';
  try { const u = new URL(raw); return u.protocol === 'https:' ? u.href : undefined; } catch { return undefined; }
}

/** Menus V2 returns the resolved price for this restaurant and menu. */
export function normalizeToastMenus(payload: { menus?: ToastMenu[] }, locationGuid: string): CatalogSnapshot {
  const categories = new Map<string, { externalId: string; name: string; sortOrder: number }>();
  const items = new Map<string, NormalizedItem>();
  let order = 0;
  for (const menu of payload.menus || []) {
    const visit = (group: ToastGroup) => {
      const category = String(group.name || menu.name || 'Menu').trim();
      const categoryId = String(group.guid || category);
      if (!categories.has(categoryId)) categories.set(categoryId, { externalId: categoryId, name: category, sortOrder: order++ });
      for (const item of group.menuItems || []) {
        if (!item.guid || !item.name || !Array.isArray(item.visibility) || item.visibility.length === 0) continue;
        // Size/open prices cannot be represented as one truthful board price.
        // TIME_SPECIFIC_PRICE needs time-rule evaluation, so omit it too.
        if (!['BASE_PRICE', 'MENU_SPECIFIC_PRICE'].includes(item.pricingStrategy || '') ||
            typeof item.price !== 'number' || !Number.isFinite(item.price) || item.price < 0) continue;
        const externalId = String(item.multiLocationId || item.guid);
        if (items.has(externalId)) continue;
        items.set(externalId, {
          externalId, name: item.name.trim(), description: item.description?.trim() || undefined,
          priceCents: Math.round(item.price * 100), categoryExternalId: categoryId,
          category, imageUrl: pickImage(item), available: true,
          locationPrices: [{ externalLocationId: locationGuid, priceCents: Math.round(item.price * 100), available: true }],
        });
      }
      for (const child of group.menuGroups || []) visit(child);
    };
    for (const group of menu.menuGroups || []) visit(group);
  }
  return { items: [...items.values()], categories: [...categories.values()] };
}

async function authenticateToast(creds: ToastCredentials): Promise<string> {
  const auth = await fetch(`${creds.apiBaseUrl}/authentication/v1/authentication/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: creds.clientId, clientSecret: creds.clientSecret, userAccessType: 'TOAST_MACHINE_CLIENT' }),
  });
  if (!auth.ok) throw new Error(`Toast authentication failed (${auth.status}). Check API access and credentials.`);
  const token = (await auth.json() as any)?.token?.accessToken;
  if (typeof token !== 'string' || !token) throw new Error('Toast authentication returned no access token.');
  return token;
}

/** Check each mapped restaurant's published menu timestamp before downloading its full catalog. */
export async function toastMenusChanged(raw: Record<string, unknown>, lastSyncedAt: Date | null): Promise<boolean> {
  if (!lastSyncedAt || !Number.isFinite(lastSyncedAt.getTime())) return true;
  const creds = parseToastCredentials(raw);
  const token = await authenticateToast(creds);
  for (const restaurant of creds.restaurants) {
    const response = await fetch(`${creds.apiBaseUrl}/menus/v2/metadata`, {
      headers: { Authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': restaurant.guid },
    });
    if (!response.ok) throw new Error(`Toast menu metadata failed for ${restaurant.name} (${response.status}).`);
    const lastUpdated = (await response.json() as { lastUpdated?: unknown })?.lastUpdated;
    const publishedAt = typeof lastUpdated === 'string' ? Date.parse(lastUpdated) : NaN;
    if (!Number.isFinite(publishedAt)) throw new Error(`Toast returned invalid menu metadata for ${restaurant.name}.`);
    // lastSyncedAt is recorded when the full sync finishes. A menu published
    // while a multi-store sync is in flight can therefore predate that value
    // even though its store was already fetched. A small overlap forces one
    // harmless extra sync instead of missing that publication indefinitely.
    if (publishedAt > lastSyncedAt.getTime() - 5 * 60_000) return true;
  }
  return false;
}

export async function toastFetchCatalog(raw: Record<string, unknown>): Promise<CatalogSnapshot> {
  const creds = parseToastCredentials(raw);
  const token = await authenticateToast(creds);

  const merged = new Map<string, NormalizedItem>();
  const categories = new Map<string, CatalogSnapshot['categories'][number]>();
  for (const restaurant of creds.restaurants) {
    const response = await fetch(`${creds.apiBaseUrl}/menus/v2/menus`, {
      headers: { Authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': restaurant.guid },
    });
    if (!response.ok) throw new Error(`Toast menu fetch failed for ${restaurant.name} (${response.status}). Check GUID, menus:read access and published menu.`);
    const body = await response.json() as { menus?: ToastMenu[] };
    if (!Array.isArray(body.menus)) throw new Error(`Toast returned an invalid menu for ${restaurant.name}.`);
    const snapshot = normalizeToastMenus(body, restaurant.guid);
    for (const cat of snapshot.categories) categories.set(cat.externalId, cat);
    for (const item of snapshot.items) {
      // A multiLocationId ties the same product across restaurant GUIDs.
      // Where Toast doesn't supply one, the GUID remains the stable key.
      let existing = merged.get(item.externalId);
      if (!existing) {
        // Some Toast chains have independent GUIDs and no multiLocationId.
        // Pair the same named product across stores, but never collapse two
        // items within the same restaurant.
        const key = `${item.category?.toLowerCase()}|${item.name.toLowerCase()}`;
        existing = [...merged.values()].find((candidate) =>
          `${candidate.category?.toLowerCase()}|${candidate.name.toLowerCase()}` === key &&
          !candidate.locationPrices?.some((p) => p.externalLocationId === restaurant.guid),
        );
      }
      if (existing) {
        existing.locationPrices?.push(...(item.locationPrices || []));
        if (!existing.imageUrl && item.imageUrl) existing.imageUrl = item.imageUrl;
      } else merged.set(item.externalId, item);
    }
  }
  for (const item of merged.values()) {
    const present = new Set(item.locationPrices?.map((p) => p.externalLocationId));
    for (const restaurant of creds.restaurants) {
      if (!present.has(restaurant.guid)) item.locationPrices?.push({ externalLocationId: restaurant.guid, available: false });
    }
  }
  return { items: [...merged.values()], categories: [...categories.values()] };
}

export function toastLocations(raw: Record<string, unknown>): NormalizedLocation[] {
  return parseToastCredentials(raw).restaurants.map((r) => ({ externalId: r.guid, name: r.name, status: 'ACTIVE' }));
}
