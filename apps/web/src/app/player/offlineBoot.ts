/** Local replay is a content fallback, never an authentication decision.
 * The API still verifies the canonical credential on every live request.
 * Expired credentials retain their own saved content while renewal retries.
 */
export const LEGACY_MANIFEST_KEY = 'edu_manifest_cache_v1';
const PREFIX = 'edu_manifest_cache_v2:';
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
export interface SavedManifest { at: number; m: any; screenId: string; fingerprint: string }
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

function identity(token: string | null) {
  try {
    const parts = token?.split('.');
    if (parts?.length !== 3) return null;
    const raw = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const p = JSON.parse(atob(raw + '='.repeat((4 - raw.length % 4) % 4)));
    return p?.kind === 'device' && uuid(p.sub) ? { screenId: p.sub, tenantId: p.tenantId } : null;
  } catch { return null; }
}
function parsed(raw: string | null): any { try { return raw ? JSON.parse(raw) : null; } catch { return null; } }
function valid(value: any, screenId: string): boolean {
  return !!value && Number.isFinite(value.at) && value.at > 0 && value.m?.screenId === screenId &&
    uuid(value.m?.tenantId) && Array.isArray(value.m?.playlists);
}
function emergency(m: any): boolean {
  const legacy = m?.emergency || m?.override;
  return m?.isEmergency === true || !!(legacy && (legacy.active === true || legacy.status === 'ACTIVE' || legacy.type));
}

export function saveManifest(store: Store, m: any, screenId: string, fingerprint: string, playable = false, at = Date.now()): void {
  if (!uuid(screenId) || m?.screenId !== screenId || !uuid(m?.tenantId) || !Array.isArray(m?.playlists) || !fingerprint) return;
  const record: SavedManifest = { at, m, screenId, fingerprint };
  try { store.setItem(PREFIX + screenId + (playable ? ':playing' : ':latest'), JSON.stringify(record)); } catch { /* retain the prior durable snapshot */ }
}

export function readOfflineManifest(store: Store, token: string | null, fingerprint: string): SavedManifest | null {
  const own = identity(token);
  if (!own || !fingerprint) return null;
  try {
    const scoped = (suffix: string): SavedManifest | null => {
      const v = parsed(store.getItem(PREFIX + own.screenId + suffix));
      if (!valid(v, own.screenId) || v.screenId !== own.screenId || v.fingerprint !== fingerprint) return null;
      if (own.tenantId && own.tenantId !== v.m.tenantId) return null;
      return v;
    };
    const latest = scoped(':latest');
    // A saved alert outranks a previously playing normal playlist.
    if (latest && emergency(latest.m)) return latest;
    const playing = scoped(':playing');
    if (playing && !emergency(playing.m)) return playing;
    if (latest) return latest;
    // Existing installations already have a v1 manifest. Adopt it only
    // when both screen and tenant match the stored device credential.
    const old = parsed(store.getItem(LEGACY_MANIFEST_KEY));
    if (!valid(old, own.screenId) || old.m.tenantId !== own.tenantId) return null;
    return { ...old, screenId: own.screenId, fingerprint };
  } catch { return null; }
}

export function clearOfflineManifests(store: Store): void {
  try {
    const keys: string[] = [LEGACY_MANIFEST_KEY];
    for (let i = 0; i < store.length; i++) { const key = store.key(i); if (key?.startsWith(PREFIX)) keys.push(key); }
    for (const key of keys) store.removeItem(key);
  } catch { /* best effort when storage is inaccessible */ }
}
