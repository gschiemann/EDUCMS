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
 * THE NATIVE VIDEO ENGINE'S SWITCHES (player 1.1.41 → 1.1.43, plan 2026-10-17
 * §4E), per screen — `PLAYER_NATIVE_VIDEO_EXPERIMENTS` (Railway env), comma
 * tokens `<name>:<screen uuid>` or `<name>:all`. Since 1.1.43 the APK decides
 * its own DEFAULTS from the device's facts (owner 2026-10-18: no settings);
 * a token is the lead's kill switch or test override, never a setting.
 *
 * The three M43 experiments, default OFF, `true` switches one on:
 *   webview-invisible   the player WebView goes INVISIBLE while a solo native
 *                       session presents (restored VISIBLE on any end, and
 *                       FIRST on an emergency hold). Measured: no gain; off.
 *   surface-frame-rate  `Surface.setFrameRate(fps, ONLY_IF_SEAMLESS)` on API 30+;
 *   decoder-rotation    the Activity stays in the panel's natural orientation
 *                       and the decoder rotates the picture.
 * The two pacing behaviours of 1.1.42, DEFAULT ON in an APK ≥ 1.1.43 — a
 * NEGATIVE token (`-<name>:<uuid|all>`) sends `false`, the kill switch:
 *   vsync-snap          every output is released at the vsync closest to its
 *                       due time on a Choreographer-measured grid, with a
 *                       grid-sized lead and a media-clock slew ≤ 0.3 ms/frame.
 *                       `-vsync-snap:<…>` switches it OFF; the positive token
 *                       is accepted and changes nothing (absent = on).
 *   prefer-60hz         when the panel lists a ~60 Hz mode of the SAME
 *                       resolution, the APK asks for it once per process at the
 *                       first native session boundary after boot (before that
 *                       session's surface exists), then PROVES it — the mode
 *                       must change and frames must keep flowing within 10 s,
 *                       and the first native frame confirms — or reverts and
 *                       blocks the automatic request on that unit for 24 h.
 *                       `-prefer-60hz:<…>` switches it OFF (a mode this process
 *                       asked for is reverted at the next boundary); the
 *                       positive token is accepted and changes nothing — it
 *                       can never force a request past the safety net's block.
 * On an APK ≥ 1.1.43 a token for these two can only REMOVE behaviour.
 * A negative token for one of the three experiments changes nothing (they are
 * off anyway); an unknown or malformed token enables and disables nothing; a
 * negative token wins over a positive one for the same screen. The flags ride
 * on the hashed `nativeVideo` descriptor as `experiments` (omitted when no
 * token names the screen, so nobody else's payload hash moves) and stay
 * OUTSIDE `revision`: flipping one never restarts a session on the glass; it
 * applies to the next native session. Deterministic per (screen, env). An APK
 * before 1.1.42 ignores the two pacing keys; 1.1.42 reads `true` as on and
 * ignores `false` (its defaults were off).
 */
export const NATIVE_VIDEO_EXPERIMENTS = ['webviewInvisible', 'surfaceFrameRate', 'decoderRotation', 'vsyncSnap', 'prefer60hz'] as const;
export type NativeVideoExperiment = (typeof NATIVE_VIDEO_EXPERIMENTS)[number];
/** `true` switches an experiment on; `false` is the kill switch of a 1.1.43 default (`vsyncSnap`, `prefer60hz`). */
export type NativeVideoExperimentFlags = Partial<Record<NativeVideoExperiment, boolean>>;
/** The behaviours an APK ≥ 1.1.43 runs by default — the only ones a negative token can switch off. */
export const NATIVE_VIDEO_DEFAULT_ON: ReadonlySet<NativeVideoExperiment> = new Set(['vsyncSnap', 'prefer60hz']);
const EXPERIMENT_TOKENS: Record<string, NativeVideoExperiment> = {
  'webview-invisible': 'webviewInvisible',
  'surface-frame-rate': 'surfaceFrameRate',
  'decoder-rotation': 'decoderRotation',
  'vsync-snap': 'vsyncSnap',
  'prefer-60hz': 'prefer60hz',
};

export interface NativeVideoExperimentTargets {
  all: boolean;
  ids: Set<string>;
  /** 1.1.43: the negative tokens — the kill switch for everyone / for these screens. */
  offAll: boolean;
  offIds: Set<string>;
}

export function parseNativeVideoExperiments(
  env: Record<string, string | undefined> = process.env,
): Record<NativeVideoExperiment, NativeVideoExperimentTargets> {
  const r = Object.fromEntries(
    NATIVE_VIDEO_EXPERIMENTS.map((e) => [e, { all: false, ids: new Set<string>(), offAll: false, offIds: new Set<string>() }]),
  ) as Record<NativeVideoExperiment, NativeVideoExperimentTargets>;
  const raw = (env.PLAYER_NATIVE_VIDEO_EXPERIMENTS ?? '').trim();
  if (!raw) return r;
  for (const t0 of raw.split(',')) {
    let t = t0.trim();
    const negative = t.startsWith('-');
    if (negative) t = t.slice(1).trim();
    const at = t.indexOf(':');
    if (at <= 0) continue;
    const name = EXPERIMENT_TOKENS[t.slice(0, at).trim().toLowerCase()];
    const target = t.slice(at + 1).trim();
    if (!name) continue;
    const isAll = target.toLowerCase() === 'all';
    const isId = UUID_RE.test(target);
    if (!isAll && !isId) continue;
    if (negative) {
      if (isAll) r[name].offAll = true;
      else r[name].offIds.add(target.toLowerCase());
    } else if (isAll) r[name].all = true;
    else r[name].ids.add(target.toLowerCase());
  }
  return r;
}

/**
 * The flags for ONE screen, or null when no token names it (the descriptor
 * then carries no `experiments` key and the APK runs its defaults). `true`
 * for a positive token; `false` for a negative token on a default-on
 * behaviour (the kill switch wins over a positive token for the same screen).
 */
export function nativeVideoExperimentsFor(
  screenId: string,
  env: Record<string, string | undefined> = process.env,
): NativeVideoExperimentFlags | null {
  const id = String(screenId ?? '').toLowerCase();
  if (!UUID_RE.test(id)) return null;
  const r = parseNativeVideoExperiments(env);
  const out: NativeVideoExperimentFlags = {};
  for (const e of NATIVE_VIDEO_EXPERIMENTS) {
    const off = NATIVE_VIDEO_DEFAULT_ON.has(e) && (r[e].offAll || r[e].offIds.has(id));
    if (off) out[e] = false;
    else if (r[e].all || r[e].ids.has(id)) out[e] = true;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * NATIVE-FIRST (design `docs/design/NATIVE-FIRST-ONE-STORE.md` §8.1, phase 1;
 * owner D1, 2026-10-19) — the lead's switch, per face, for "the engine
 * decision moves BEFORE the mount": a solo muted video whose file is verified
 * on disk starts on the hardware engine at frame 0 and the web `<video>` is
 * never created; the app owns the session, so a page reload no longer takes
 * the picture off the glass. Never an operator setting (owner 2026-10-18):
 * the APK decides its own default per device class (`DeviceClassPolicy`,
 * FALSE on every class in this release) and this env only overrides it.
 *
 * `PLAYER_NATIVE_FIRST` (Railway env), comma tokens — the grammar of
 * `PLAYER_NATIVE_VIDEO`:
 *   unset / empty             → nobody named: the descriptor carries NO key
 *                               and the APK runs its class default
 *   `all`                     → every screen
 *   `<screen uuid>`           → that screen (= that face)
 *   `model:<id>`              → every screen whose hardwareModel is <id>
 *   `class:<soc>/android-<N>` → every screen whose APK last REPORTED that
 *                               device class (`lastVideoReport.native.device
 *                               .class`, 1.1.41+). A screen that has not
 *                               reported one yet is matched by no `class:`
 *                               token, in or out — use `-<uuid>` or `off` for
 *                               an immediate stop.
 *   `-<uuid>` / `-model:<id>` / `-class:<…>` → never that screen / model /
 *                               class: `false`, and it wins over any inclusion
 *   `off`/`0`/`false`/`no`    → `false` for every screen; wins over everything
 * Anything unrecognised is ignored (a typo names nobody).
 *
 * Carried per face as `nativeFirst: boolean` on the hashed `nativeVideo`
 * descriptor, OUTSIDE `revision` (the 1.1.41 experiment-flag rule): a flip
 * changes the ETag and never restarts a presenting session — it applies at
 * the next content boundary. Absent when nothing names the screen, so nobody
 * else's payload hash moves. Emergency manifests still get no descriptor at
 * all (the second lock in `buildNativeVideoDescriptor`).
 *
 * An INCLUSION also enrols the screen in the native engine itself
 * (`nativeVideoEnrolled`): naming a screen for native-first without giving it
 * a descriptor would do nothing. `PLAYER_NATIVE_VIDEO=off`, its exclusions
 * and the Taurus hard exclusion still win over it.
 */
const DEVICE_CLASS_RE = /^[a-z]+\/android-[0-9]{1,2}$/;

export interface NativeFirstRollout {
  off: boolean;
  all: boolean;
  ids: Set<string>;
  models: Set<string>;
  classes: Set<string>;
  excludeIds: Set<string>;
  excludeModels: Set<string>;
  excludeClasses: Set<string>;
}

export function parseNativeFirstRollout(
  env: Record<string, string | undefined> = process.env,
): NativeFirstRollout {
  const r: NativeFirstRollout = {
    off: false,
    all: false,
    ids: new Set(),
    models: new Set(),
    classes: new Set(),
    excludeIds: new Set(),
    excludeModels: new Set(),
    excludeClasses: new Set(),
  };
  const raw = (env.PLAYER_NATIVE_FIRST ?? '').trim();
  if (!raw) return r;
  for (const t0 of raw.split(',')) {
    const t = t0.trim().toLowerCase();
    if (!t) continue;
    const negative = t.startsWith('-');
    const body = negative ? t.slice(1).trim() : t;
    if (!negative && ['off', '0', 'false', 'no'].includes(body)) r.off = true;
    else if (!negative && body === 'all') r.all = true;
    else if (body.startsWith('model:') && body.length > 6)
      (negative ? r.excludeModels : r.models).add(body.slice(6));
    else if (body.startsWith('class:') && DEVICE_CLASS_RE.test(body.slice(6)))
      (negative ? r.excludeClasses : r.classes).add(body.slice(6));
    else if (UUID_RE.test(body)) (negative ? r.excludeIds : r.ids).add(body);
  }
  return r;
}

/** The device class this screen's APK last reported, or '' (never guessed). */
export function reportedDeviceClass(screen: { lastVideoReport?: unknown } | null | undefined): string {
  const report = obj(screen?.lastVideoReport) ? (screen!.lastVideoReport as Record<string, any>) : null;
  const native = report && obj(report.native) ? report.native : null;
  const cls = native && obj(native.device) ? native.device.class : null;
  return typeof cls === 'string' && DEVICE_CLASS_RE.test(cls) ? cls : '';
}

/**
 * This face's native-first override: `true` (named), `false` (`off` or an
 * exclusion — the kill switch), or `null` (not named: no key on the
 * descriptor, the APK's class default applies). Deterministic per
 * (screen row, env) — safe inside the hashed, hot-cached manifest.
 */
export function nativeFirstFor(
  screen: { id: string; hardwareModel?: string | null; lastVideoReport?: unknown },
  env: Record<string, string | undefined> = process.env,
): boolean | null {
  const id = String(screen?.id ?? '').toLowerCase();
  if (!UUID_RE.test(id)) return null;
  const r = parseNativeFirstRollout(env);
  if (r.off) return false;
  const model = String(screen.hardwareModel ?? '').toLowerCase();
  const cls = reportedDeviceClass(screen);
  if (r.excludeIds.has(id) || (model && r.excludeModels.has(model)) || (cls && r.excludeClasses.has(cls)))
    return false;
  if (r.all || r.ids.has(id) || (model && r.models.has(model)) || (cls && r.classes.has(cls)))
    return true;
  return null;
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
    lastVideoReport?: unknown;
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
  // Native-first names this screen: it needs the descriptor to do anything.
  if (nativeFirstFor(screen, env) === true) return true;
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
/**
 * The playlist the player will actually show: the first REPLACE row in the
 * manifest's deterministic order (screen pin > group, priority, newest —
 * effective-schedule.ts), exactly the player's own pick. Conservative: an
 * APPEND row would mix items in, and a winner with a day/time window could be
 * closed right now (this descriptor carries no clock), so both → null.
 * (2026-10-12: VisionCore had a pinned playlist AND an older group one; the
 * old `length !== 1` rule silently sent no descriptor.)
 */
export function nativeVideoWinner(manifest: Record<string, any>): Record<string, any> | null {
  const pls = manifest?.playlists;
  if (!Array.isArray(pls) || pls.length === 0) return null;
  if (pls.some((p: any) => p?.schedule?.mode === 'append')) return null;
  const winner = pls.find((p: any) => (p?.schedule?.mode ?? 'replace') === 'replace');
  if (!winner || !obj(winner.schedule)) return null;
  const sc = winner.schedule;
  if (sc.daysOfWeek || sc.timeStart || sc.timeEnd) return null;
  return winner;
}

export function nativeVideoCandidate(manifest: Record<string, any>): boolean {
  const winner = nativeVideoWinner(manifest);
  if (!winner) return false;
  const items = winner.items;
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
  const pl = nativeVideoWinner(m)!;
  if (pl.template || !obj(pl.schedule) || pl.schedule.mode !== 'replace')
    return null;
  // A solo video: one item, or N copies of the same file (the player
  // collapses copies to one item — collapseCopies.ts).
  const item = pl.items[0];
  if (!pl.items.every((i: any) => i.muted === true)) return null;
  const asset = nativeVideoAsset(item, a, env);
  if (!asset) return null;
  // Match the web full-screen playlist default: scale both axes to the whole
  // viewport, preserving every source edge without bars or cropping.
  const transform = { orientation: m.orientation, fit: 'fill' as const };
  const revision = createHash('sha256')
    .update(JSON.stringify([s.tenantId, s.id, faceIndex, pl.id, asset, transform]))
    .digest('hex');
  // Outside the revision on purpose (see NATIVE_VIDEO_EXPERIMENTS); absent when none is on.
  const experiments = nativeVideoExperimentsFor(s.id, env);
  // Native-first (§8.1): outside the revision too — a flip never restarts a
  // presenting session; absent when the env names nobody (class default).
  const nativeFirst = nativeFirstFor(s as { id: string }, env);
  return {
    version: 2,
    screenId: s.id,
    tenantId: s.tenantId,
    faceIndex,
    revision,
    asset,
    transform,
    ...(experiments ? { experiments } : {}),
    ...(nativeFirst !== null ? { nativeFirst } : {}),
  };
}
