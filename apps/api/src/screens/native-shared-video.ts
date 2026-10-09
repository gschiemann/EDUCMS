import { createHash } from 'crypto';

const uuid = (x: unknown): x is string =>
  typeof x === 'string' &&
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(x);
const obj = (x: unknown): x is Record<string, any> =>
  !!x && typeof x === 'object' && !Array.isArray(x);
export function nativeSharedVideoTarget(
  id: string,
  env = process.env,
): boolean {
  return (env.PLAYER_NATIVE_DUAL_VIDEO ?? '')
    .split(',')
    .map((x) => x.trim())
    .includes(id);
}

/** A native admission is opt-in, tenant-bound, and limited to one full-screen mirrored MP4.
 * Capability support is proved by both native hosts, never stale version telemetry in a cached preamble.
 * The optional field is absent on every other manifest; no new query on the default path.
 */
export function buildNativeSharedVideoDescriptor(input: {
  screen: Record<string, any>;
  peer: Record<string, any>;
  manifest: Record<string, any>;
  asset: Record<string, any>;
  env?: NodeJS.ProcessEnv;
}): Record<string, any> | null {
  const { screen: s, peer: p, manifest: m, asset: a } = input;
  const env = input.env ?? process.env;
  if (
    !nativeSharedVideoTarget(s.id, env) ||
    !nativeSharedVideoTarget(p.id, env) ||
    ![s.id, p.id, s.tenantId].every(uuid) ||
    s.id === p.id ||
    s.tenantId !== p.tenantId ||
    [s, p].some((x) => x.status === 'REVOKED') ||
    m.screenId !== s.id ||
    m.tenantId !== s.tenantId ||
    m.isEmergency !== false ||
    m.sync?.enabled !== false ||
    (m.repeats ?? 1) !== 1 ||
    m.canvasW ||
    m.canvasH ||
    !['LANDSCAPE', 'PORTRAIT', 'AUTO'].includes(m.orientation)
  )
    return null;
  const front = s.faceOfScreenId ? p : s,
    rear = s.faceOfScreenId ? s : p;
  if (
    front.faceOfScreenId ||
    ![null, undefined, 0].includes(front.faceIndex) ||
    rear.faceOfScreenId !== front.id ||
    rear.faceIndex !== 1 ||
    rear.faceContentMode !== 'MIRROR'
  )
    return null;
  if (!Array.isArray(m.playlists) || m.playlists.length !== 1) return null;
  const pl = m.playlists[0],
    sched = pl.schedule;
  if (
    pl.template ||
    !obj(sched) ||
    sched.daysOfWeek ||
    sched.timeStart ||
    sched.timeEnd ||
    sched.mode !== 'replace' ||
    !Array.isArray(pl.items) ||
    pl.items.length !== 1
  )
    return null;
  const item = pl.items[0];
  if (
    item.mime_type !== 'video/mp4' ||
    item.muted !== true ||
    item.asset_id !== a.id ||
    !uuid(a.id) ||
    !/^[a-f0-9]{64}$/.test(item.asset_hash ?? '') ||
    !Number.isSafeInteger(item.asset_size) ||
    item.asset_size <= 0 ||
    item.asset_size > 512 * 1024 * 1024
  )
    return null;
  try {
    const u = new URL(item.url);
    if (
      u.protocol !== 'https:' ||
      u.hostname !== 'bhdaxzfalaycfopvcopm.supabase.co' ||
      u.username ||
      u.password ||
      u.hash ||
      (u.port && u.port !== '443') ||
      !/^\/storage\/v1\/object\/(public|sign)\/assets\//.test(u.pathname) ||
      /[%\\]/.test(u.pathname)
    )
      return null;
  } catch {
    return null;
  }
  const meta = a.processingMeta;
  if (
    !obj(meta) ||
    !obj(meta.probe) ||
    meta.probe.codec !== 'h264' ||
    meta.probe.rotation !== 0 ||
    meta.probe.pixFmt !== 'yuv420p' ||
    !Number.isFinite(meta.probe.fps) ||
    meta.probe.fps <= 0 ||
    meta.probe.fps > 30
  )
    return null;
  // Match URL/hash/size as one unit; never borrow original dimensions for a selected rendition.
  let w: unknown, h: unknown, fps: unknown;
  if (
    item.url === a.fileUrl &&
    item.asset_hash === a.fileHash &&
    item.asset_size === a.fileSize
  ) {
    w = meta.probe.codedWidth;
    h = meta.probe.codedHeight;
    fps = meta.probe.fps;
  } else {
    const r = obj(meta.renditions)
      ? (Object.values(meta.renditions).find(
          (x: any) =>
            obj(x) &&
            x.url === item.url &&
            x.sha256 === item.asset_hash &&
            x.size === item.asset_size &&
            (x.rotation ?? 0) === 0,
        ) as any)
      : null;
    if (!r) return null;
    w = r.width;
    h = r.height;
    fps = r.fps ?? meta.probe.fps;
  }
  if (
    ![w, h].every(
      (x) => Number.isInteger(x) && Number(x) >= 16 && Number(x) <= 4096,
    ) ||
    typeof fps !== 'number' ||
    !Number.isFinite(fps) ||
    fps <= 0 ||
    fps > 30
  )
    return null;
  const asset = {
    id: a.id,
    url: item.url,
    sha256: item.asset_hash,
    size: item.asset_size,
    width: w,
    height: h,
    fps,
  };
  // Same stable revision for both faces. Each face's independent orientation remains separate.
  const revision = createHash('sha256')
    .update(JSON.stringify([s.tenantId, front.id, rear.id, pl.id, asset]))
    .digest('hex');
  return {
    version: 1,
    screenId: s.id,
    tenantId: s.tenantId,
    primaryScreenId: front.id,
    peerScreenId: p.id,
    faceIndex: s.id === front.id ? 0 : 1,
    revision,
    asset,
    transform: { orientation: m.orientation, rotation: 0, fit: 'fill' },
  };
}
