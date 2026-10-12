import { createHash } from 'crypto';
import { nativeVideoAsset } from './native-shared-video';

/**
 * native-video — the per-face NATIVE VIDEO ENGINE descriptor (protocol 2,
 * 2026-10-12).
 *
 * WHY. The best signage players (BrightSign, Goodview's own CMS, OptiSigns,
 * Xibo for Android) decode video natively onto a hardware surface and draw
 * the layout in a browser layer ABOVE it. Our player decoded video inside the
 * WebView. On a single 4K Amlogic / Goodview screen that is already fine
 * (0–0.7 % dropped), but on the double-sided DH43 (ONE rk3288, TWO panels)
 * the WebView drops 38–55 % of frames when both faces play video, while
 * Goodview's CMS plays both smoothly with MediaPlayer + SurfaceView.
 *
 * WHAT. When a screen is enrolled (below) and its normal content is ONE solo,
 * muted video, the manifest carries `nativeVideo`: the exact file (url, hash,
 * size, coded size, fps) and how to fit it, for THIS screen only. The APK
 * reads it from this screen's own authenticated manifest (never from the
 * page), downloads and SHA-256-verifies the file on disk, and plays it on a
 * hardware decoder under the WebView. Every face of a double-sided unit is
 * its own Screen row, so each face gets its own independent descriptor — any
 * combination of video / template / image across the two faces works.
 *
 * The descriptor is INERT on every APK without protocol 2 (the page only uses
 * it after the APK proves `protocol: 2`), on the browser player, and on every
 * NovaStar Taurus (hard-excluded here: Taurus stays web). Everything the
 * player already refuses to hand native stays on the web path: emergency
 * content (the emergency branch returns before this is built), frame-locked
 * sync, templates, mixed playlists, audio, canvas overrides, unsupported
 * files. Web <video> is the automatic fallback on any native error.
 *
 * Deterministic per (screen, schedule, asset, env): safe inside the hashed,
 * hot-cached manifest — no clock, no telemetry.
 *
 * ROLLOUT — `PLAYER_NATIVE_VIDEO` (Railway env), a comma-separated token list:
 *   unset / empty   → `faces` (the default)
 *   `faces`         → every face of a double-sided unit (a screen with a
 *                     back side, or a back side itself)
 *   `all`           → every screen
 *   `off`/`0`/`false`/`no` → nobody (kill switch; wins over everything)
 *   `model:<id>`    → every screen whose hardwareModel is <id>
 *                     (e.g. `model:goodview-ep6n`)
 *   `<screen uuid>` → that screen
 *   `-<screen uuid>` / `-model:<id>` → never that screen / model (wins)
 *   e.g. `faces,model:generic-android,-<uuid>`
 * Anything unrecognised is ignored (so a typo enrols nobody new).
 */

const UUID_RE = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const obj = (x: unknown): x is Record<string, any> =>
  !!x && typeof x === 'object' && !Array.isArray(x);

/** Hardware that never takes the native engine, whatever the switch says. */
export const NATIVE_VIDEO_NEVER_MODELS: ReadonlySet<string> = new Set([
  'novastar-taurus',
]);

export interface NativeVideoRollout {
  off: boolean;
  faces: boolean;
  all: boolean;
  ids: Set<string>;
  models: Set<string>;
  excludeIds: Set<string>;
  excludeModels: Set<string>;
}

export function parseNativeVideoRollout(
  env: Record<string, string | undefined> = process.env,
): NativeVideoRollout {
  const r: NativeVideoRollout = {
    off: false,
    faces: false,
    all: false,
    ids: new Set(),
    models: new Set(),
    excludeIds: new Set(),
    excludeModels: new Set(),
  };
  const raw = (env.PLAYER_NATIVE_VIDEO ?? '').trim();
  if (!raw) {
    r.faces = true;
    return r;
  }
  for (const t0 of raw.split(',')) {
    const t = t0.trim();
    if (!t) continue;
    const lower = t.toLowerCase();
    if (['off', '0', 'false', 'no'].includes(lower)) r.off = true;
    else if (lower === 'faces') r.faces = true;
    else if (lower === 'all') r.all = true;
    else if (lower.startsWith('-model:') && lower.length > 7)
      r.excludeModels.add(lower.slice(7));
    else if (lower.startsWith('model:') && lower.length > 6)
      r.models.add(lower.slice(6));
    else if (t.startsWith('-') && UUID_RE.test(t.slice(1)))
      r.excludeIds.add(t.slice(1).toLowerCase());
    else if (UUID_RE.test(t)) r.ids.add(lower);
  }
  return r;
}

/**
 * Is this screen enrolled? `hasBackFace` is asked ONLY when the answer turns
 * on it (a primary under `faces`), so the single-sided fleet pays no query.
 */
export async function nativeVideoEnrolled(
  screen: {
    id: string;
    hardwareModel?: string | null;
    faceOfScreenId?: string | null;
  },
  hasBackFace: () => Promise<boolean>,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  const r = parseNativeVideoRollout(env);
  const id = String(screen.id ?? '').toLowerCase();
  const model = String(screen.hardwareModel ?? '').toLowerCase();
  if (r.off || !UUID_RE.test(id)) return false;
  if (model && NATIVE_VIDEO_NEVER_MODELS.has(model)) return false;
  if (r.excludeIds.has(id) || (model && r.excludeModels.has(model)))
    return false;
  if (r.all || r.ids.has(id) || (model && r.models.has(model))) return true;
  if (!r.faces) return false;
  if (screen.faceOfScreenId) return true;
  try {
    return await hasBackFace();
  } catch {
    return false;
  }
}

/**
 * Cheap pre-check on the built payload: is the CONTENT a native candidate at
 * all? Lets the controller skip the enrollment lookup for everything else.
 */
export function nativeVideoCandidate(manifest: Record<string, any>): boolean {
  const pls = manifest?.playlists;
  if (!Array.isArray(pls) || pls.length !== 1) return false;
  const items = pls[0]?.items;
  return (
    Array.isArray(items) &&
    items.length >= 1 &&
    items.every(
      (i: any) =>
        i?.mime_type === 'video/mp4' &&
        i.asset_id === items[0].asset_id &&
        i.asset_hash === items[0].asset_hash &&
        i.url === items[0].url,
    )
  );
}

/**
 * The protocol-2 descriptor for ONE screen (= one face), or null. Every
 * refusal leaves the screen exactly on today's web path.
 */
export function buildNativeVideoDescriptor(input: {
  screen: Record<string, any>;
  manifest: Record<string, any>;
  asset: Record<string, any> | null | undefined;
  env?: NodeJS.ProcessEnv;
}): Record<string, any> | null {
  const { screen: s, manifest: m, asset: a } = input;
  const env = input.env ?? process.env;
  if (
    !obj(s) ||
    !obj(m) ||
    ![s.id, s.tenantId].every((x) => typeof x === 'string' && UUID_RE.test(x)) ||
    s.status === 'REVOKED' ||
    m.screenId !== s.id ||
    m.tenantId !== s.tenantId ||
    // Life safety: never for emergency content (the emergency manifest
    // branch returns before this is ever reached; this is the second lock).
    m.isEmergency !== false ||
    // Frame-locked sync stays on the web timeline (the conductor owns it).
    m.sync?.enabled !== false ||
    (m.repeats ?? 1) !== 1 ||
    m.canvasW ||
    m.canvasH ||
    !['LANDSCAPE', 'PORTRAIT', 'AUTO'].includes(m.orientation)
  )
    return null;
  const faceIndex =
    s.faceOfScreenId != null ? (s.faceIndex === 1 ? 1 : null) : 0;
  if (faceIndex === null) return null;
  if (!nativeVideoCandidate(m)) return null;
  const pl = m.playlists[0];
  if (pl.template || !obj(pl.schedule) || pl.schedule.mode !== 'replace')
    return null;
  // A solo video: one item, or N copies of the same file (the player
  // collapses copies to one item — collapseCopies.ts).
  const item = pl.items[0];
  if (!pl.items.every((i: any) => i.muted === true)) return null;
  const asset = nativeVideoAsset(item, a, env);
  if (!asset) return null;
  // Normal content crops to fill, never stretches (owner decision
  // 2026-10-11, mediaFit.ts DEFAULT_PLAYLIST_MEDIA_FIT).
  const transform = { orientation: m.orientation, fit: 'cover' as const };
  const revision = createHash('sha256')
    .update(JSON.stringify([s.tenantId, s.id, faceIndex, pl.id, asset, transform]))
    .digest('hex');
  return {
    version: 2,
    screenId: s.id,
    tenantId: s.tenantId,
    faceIndex,
    revision,
    asset,
    transform,
  };
}
