import { createHash } from 'crypto';
import { nativeVideoAsset } from './native-shared-video';
import { nativeVideoCandidate } from './native-video';

/**
 * native-video-items — protocol 3 of the per-face native video engine
 * (2026-10-12, built on protocol 2 in native-video.ts; design and the hardware
 * test matrix in docs/research/2026-10-12-native-video/02-protocol-3.md).
 *
 * Protocol 2 hands native ONE solo, muted video per face. Protocol 3 lists
 * EVERY file native may play inside content that is not a solo video:
 *
 *   • a MIXED playlist — each muted H.264 MP4 item is a slot `item:<item_id>`;
 *     images / web pages / PDFs keep rendering in the WebView, and the player
 *     hands off at item boundaries (first native frame pre-rolled and held
 *     behind the page, released only once that slot is on glass);
 *   • a TEMPLATE — each eligible VIDEO zone is a slot `zone:<zone_id>`; the APK
 *     positions a hardware surface at the zone's measured rect ABOVE the
 *     WebView (1.1.41, one compositing contract: the WebView stays opaque
 *     black, no hole). At most NATIVE_VIDEO_MAX_ZONES zones; the rest stay web.
 *
 * The manifest carries only IDENTITY + FILE facts (url, hash, size, coded
 * size, fps): the rect, rotation and fit are measured by the page from the
 * rendered DOM (TemplateScaler, body rotation, zone rotation) and sent on the
 * bridge — they depend on the device viewport, never on the server.
 *
 * Refusals (every one leaves the screen exactly on today's web path):
 * emergency content (the emergency branch returns before; `isEmergency`
 * must read false here too), frame-locked sync, repeats, canvas overrides,
 * audio-on items, interactive / multi-scene templates, zones with opacity,
 * rounded corners, a non-right-angle rotation or a background of their own,
 * and any zone that ANOTHER zone overlaps (`zone-overlap`): a native slot is
 * composed above the window, so nothing of the page — above or below the
 * zone in the template — can draw over it. That is the one limitation of
 * the above-window contract; transitions between native items are hard cuts
 * handed over by the held first frame.
 *
 * The solo-video manifest keeps its protocol-2 `nativeVideo` and gets NO
 * `nativeVideoItems`, so today's payload hash does not move for those
 * screens. Deterministic per (screen, schedule, assets): safe inside the
 * hashed, hot-cached manifest — no clock, no telemetry.
 */

export const NATIVE_VIDEO_MAX_ZONES = 2;

const UUID_RE = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const obj = (x: unknown): x is Record<string, any> =>
  !!x && typeof x === 'object' && !Array.isArray(x);
const num = (x: unknown): x is number =>
  typeof x === 'number' && Number.isFinite(x);

export interface NativeVideoItemSlot {
  slot: string;
  asset: NonNullable<ReturnType<typeof nativeVideoAsset>>;
  /** `loop`: a template zone repeats; a playlist item plays once per showing. */
  loop: boolean;
}

/** The manifest's playlist is a candidate when it is NOT a protocol-2 solo. */
export function nativeVideoItemsCandidate(manifest: Record<string, any>): boolean {
  if (!obj(manifest) || nativeVideoCandidate(manifest)) return false;
  const pls = manifest.playlists;
  if (!Array.isArray(pls) || pls.length !== 1 || !obj(pls[0])) return false;
  const pl = pls[0];
  if (pl.template) {
    return (
      Array.isArray(pl.template.zones) &&
      pl.template.zones.some(
        (z: any) =>
          obj(z) && z.widgetType === 'VIDEO' && typeof z.defaultConfig?.assetUrl === 'string',
      )
    );
  }
  return (
    Array.isArray(pl.items) &&
    pl.items.some((i: any) => obj(i) && i.mime_type === 'video/mp4' && i.muted === true)
  );
}

/** The VIDEO zone config facts the hole can honour; everything else is web. */
export function templateVideoZoneConfigEligible(cfg: unknown): cfg is Record<string, any> {
  if (!obj(cfg)) return false;
  if (typeof cfg.assetUrl !== 'string' || !cfg.assetUrl) return false;
  if (cfg.muted === false || cfg.autoplay === false || cfg.hidden === true) return false;
  if (cfg.opacity !== undefined && cfg.opacity !== 1) return false;
  if (cfg._zoneOpacity !== undefined && cfg._zoneOpacity !== 1) return false;
  if (cfg.borderRadius !== undefined && cfg.borderRadius !== 0) return false;
  const rot = cfg._zoneRotation ?? 0;
  if (!num(rot) || ((rot % 90) + 90) % 90 !== 0) return false;
  const fit = cfg.fit ?? cfg.fitMode ?? 'cover';
  if (!['cover', 'contain', 'fill'].includes(fit)) return false;
  const bg = typeof cfg.bgColor === 'string' ? cfg.bgColor.trim() : '';
  if (bg && bg !== 'transparent' && bg !== 'inherit') return false;
  return true;
}

interface ZoneBox {
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  index: number;
}

function zoneBox(z: Record<string, any>, index: number): ZoneBox | null {
  const { x, y, width, height } = z;
  if (![x, y, width, height].every(num) || width <= 0 || height <= 0) return null;
  if (x < 0 || y < 0 || x + width > 100.001 || y + height > 100.001) return null;
  return { x, y, width, height, zIndex: num(z.zIndex) ? z.zIndex : 0, index };
}

function overlaps(a: ZoneBox, b: ZoneBox): boolean {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  );
}

/**
 * The zones of a template that may play natively, in order, capped at
 * NATIVE_VIDEO_MAX_ZONES. Pure: the geometry is the manifest's percent
 * geometry, the same the player lays out.
 */
export function nativeTemplateVideoZones(template: Record<string, any>): Array<Record<string, any>> {
  if (!obj(template) || template.isTouchEnabled === true) return [];
  if (Array.isArray(template.scenes) && template.scenes.length > 0) return [];
  const zones: unknown[] = Array.isArray(template.zones) ? template.zones : [];
  const boxes = zones.map((z, i) => (obj(z) ? zoneBox(z, i) : null));
  const out: Array<Record<string, any>> = [];
  zones.forEach((z, i) => {
    if (!obj(z) || z.widgetType !== 'VIDEO' || typeof z.id !== 'string' || !z.id) return;
    if (z.touchAction || z.sceneId) return;
    if (!templateVideoZoneConfigEligible(z.defaultConfig)) return;
    const box = boxes[i];
    if (!box) return;
    // 1.1.41: above the window, so ANY overlapping zone — above or below — keeps this one web.
    const overlapped = boxes.some((b, j) => !!b && j !== i && overlaps(b, box));
    if (overlapped) return;
    out.push(z);
  });
  return out.slice(0, NATIVE_VIDEO_MAX_ZONES);
}

/**
 * The protocol-3 descriptor for ONE screen (= one face), or null. `assetById`
 * resolves a playlist item's asset; `assetByUrl` resolves a template zone's
 * `assetUrl` to the tenant's asset row (the zone config stores the URL only).
 */
export function buildNativeVideoItems(input: {
  screen: Record<string, any>;
  manifest: Record<string, any>;
  assetById: (id: string) => Record<string, any> | null | undefined;
  assetByUrl: (url: string) => Record<string, any> | null | undefined;
  env?: NodeJS.ProcessEnv;
}): Record<string, any> | null {
  const { screen: s, manifest: m } = input;
  const env = input.env ?? process.env;
  if (
    !obj(s) ||
    !obj(m) ||
    ![s.id, s.tenantId].every((x) => typeof x === 'string' && UUID_RE.test(x)) ||
    s.status === 'REVOKED' ||
    m.screenId !== s.id ||
    m.tenantId !== s.tenantId ||
    // Life safety: never for emergency content (second lock; the emergency
    // manifest branch returns before this is reached).
    m.isEmergency !== false ||
    // Frame-locked sync stays on the web timeline.
    m.sync?.enabled !== false ||
    (m.repeats ?? 1) !== 1 ||
    m.canvasW ||
    m.canvasH ||
    !['LANDSCAPE', 'PORTRAIT', 'AUTO'].includes(m.orientation)
  )
    return null;
  const faceIndex = s.faceOfScreenId != null ? (s.faceIndex === 1 ? 1 : null) : 0;
  if (faceIndex === null) return null;
  if (!nativeVideoItemsCandidate(m)) return null;
  const pl = m.playlists[0];
  if (!obj(pl.schedule) || pl.schedule.mode !== 'replace' || typeof pl.id !== 'string') return null;

  const items: NativeVideoItemSlot[] = [];
  if (pl.template) {
    for (const z of nativeTemplateVideoZones(pl.template)) {
      const cfg = z.defaultConfig as Record<string, any>;
      const a = input.assetByUrl(cfg.assetUrl);
      if (!obj(a) || a.mimeType !== 'video/mp4' || a.fileUrl !== cfg.assetUrl) continue;
      if (a.processingMeta?.screen?.ready === false) continue;
      const asset = nativeVideoAsset(
        {
          mime_type: 'video/mp4',
          muted: true,
          asset_id: a.id,
          asset_hash: a.fileHash,
          asset_size: a.fileSize,
          url: a.fileUrl,
        },
        a,
        env,
      );
      if (!asset) continue;
      items.push({ slot: `zone:${z.id}`, asset, loop: cfg.loop !== false });
    }
  } else {
    if (!Array.isArray(pl.items)) return null;
    for (const i of pl.items) {
      if (!obj(i) || typeof i.item_id !== 'string' || !i.item_id) continue;
      if (i.mime_type !== 'video/mp4' || i.muted !== true) continue;
      const asset = nativeVideoAsset(i, input.assetById(String(i.asset_id)), env);
      if (!asset) continue;
      items.push({ slot: `item:${i.item_id}`, asset, loop: false });
    }
  }
  if (items.length === 0) return null;
  const revision = createHash('sha256')
    .update(JSON.stringify([s.tenantId, s.id, faceIndex, pl.id, m.orientation, items]))
    .digest('hex');
  return {
    version: 3,
    screenId: s.id,
    tenantId: s.tenantId,
    faceIndex,
    revision,
    orientation: m.orientation,
    items,
  };
}
