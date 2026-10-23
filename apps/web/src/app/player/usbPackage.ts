/**
 * A playlist that arrived on a USB stick (2026-10-22, Greg: "our app auto
 * senses when someone puts the USB stick in and reads our playlist and retains
 * all the settings").
 *
 * The Android APK finds the package on the stick, verifies its signature and
 * every file's SHA-256, copies it to the device and serves the verified
 * manifest at `USB_PACKAGE_PATH` (same origin, answered by the app itself —
 * nothing leaves the box). Its media is served from the device under the
 * files' ORIGINAL urls, so the service worker caches them exactly as it would
 * after a network publish.
 *
 * This module decides what the page plays. Pure: no React, no DOM, no network.
 *
 *   • The USB playlists REPLACE the manifest's playlists — every setting the
 *     package carries (order, durations, transitions, mute, template + zones +
 *     scenes, schedule window) goes through the ordinary manifest path.
 *   • EMERGENCY FIRST: an emergency manifest is NEVER touched. An alert always
 *     wins over a stick, and the stick returns when the alert clears.
 *   • "The last thing you did wins": the USB playlists keep playing until the
 *     server PUBLISHES something new to this screen — a change in the set of
 *     playlists its manifest names, measured against what it named when the
 *     stick went in. Then the stick is retired and stays retired (re-reading
 *     the same package does not bring it back; a NEW package does).
 *   • A package from another organization is ignored.
 *   • Fields that would drive the native video engine or lockstep sync from
 *     the SERVER's content are dropped while the stick plays, so the glass
 *     can never show one thing and the native layer another.
 */

export const USB_PACKAGE_PATH = '/__venueos/usb/package.json';
export const USB_IMPORTED_EVENT = 'venueos-usb-imported';
export const LS_USB_OVERLAY = 'edu_usb_overlay_v1';

export interface UsbPackage {
  bundleVersion: string;
  tenantId: string;
  label: string | null;
  playlists: Array<Record<string, unknown>>;
}

/** What persists across reloads: which package, and the server state it beat. */
export interface UsbOverlayMemo {
  bundleVersion: string;
  /** Playlist set the server named when the stick went in; null = not yet seen. */
  baseSig: string | null;
  retired: boolean;
}

export interface UsbOverlayState {
  pkg: UsbPackage | null;
  memo: UsbOverlayMemo | null;
  /** Last playlist set a LIVE normal manifest named (for a new import's base). */
  lastLiveSig: string | null;
}

/** Keys that would make the native layer play the server's content instead. */
const SERVER_CONTENT_KEYS = ['nativeVideo', 'nativeSharedVideo', 'nativeVideoItems', 'sync'] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** The verified manifest the APK serves → a package, or null when unusable. */
export function parseUsbPackage(json: unknown): UsbPackage | null {
  if (!isRecord(json)) return null;
  if (json.schema !== 'edu-cms-usb-bundle/v1') return null;
  const bundleVersion = typeof json.bundleVersion === 'string' ? json.bundleVersion : '';
  const tenantId = typeof json.tenantId === 'string' ? json.tenantId : '';
  if (!bundleVersion || !tenantId || !Array.isArray(json.playlists)) return null;
  const playlists = json.playlists
    .filter(isRecord)
    .filter((p) => typeof p.id === 'string' && Array.isArray(p.items))
    .map((p) => ({ ...p }));
  if (playlists.length === 0) return null;
  return {
    bundleVersion,
    tenantId,
    label: typeof json.bundleLabel === 'string' ? json.bundleLabel : null,
    playlists,
  };
}

/** Which playlists a manifest names — what a new publish changes. */
export function serverPlaylistSig(manifest: unknown): string {
  if (!isRecord(manifest) || !Array.isArray(manifest.playlists)) return '';
  return manifest.playlists
    .filter(isRecord)
    .map((p) => String(p.id ?? ''))
    .sort()
    .join(',');
}

/** A package has arrived (boot read or a fresh import). */
export function adoptUsbPackage(state: UsbOverlayState, pkg: UsbPackage | null): UsbOverlayState {
  if (!pkg) return { ...state, pkg: null };
  const same = state.memo?.bundleVersion === pkg.bundleVersion;
  const memo: UsbOverlayMemo = same && state.memo
    ? state.memo
    : { bundleVersion: pkg.bundleVersion, baseSig: state.lastLiveSig, retired: false };
  return { ...state, pkg, memo };
}

export function usbOverlayActive(state: UsbOverlayState): boolean {
  return !!state.pkg && !!state.memo && !state.memo.retired && state.memo.bundleVersion === state.pkg.bundleVersion;
}

/**
 * The manifest the page should apply, and the state after seeing it.
 * `fromCache` = an offline replay: it may SHOW the stick but never moves the
 * baseline or retires it (only the server of record speaks for a publish).
 */
export function applyUsbOverlay(
  manifest: unknown,
  state: UsbOverlayState,
  fromCache: boolean,
): { manifest: unknown; state: UsbOverlayState } {
  if (!isRecord(manifest)) return { manifest, state };
  // EMERGENCY FIRST — never touched, never changes the stick's state.
  if (manifest.isEmergency === true) return { manifest, state };
  let next = state;
  if (!fromCache) {
    const sig = serverPlaylistSig(manifest);
    next = { ...next, lastLiveSig: sig };
    if (usbOverlayActive(next) && next.memo) {
      if (next.memo.baseSig === null) {
        next = { ...next, memo: { ...next.memo, baseSig: sig } };
      } else if (next.memo.baseSig !== sig) {
        next = { ...next, memo: { ...next.memo, retired: true } };
      }
    }
  }
  if (!usbOverlayActive(next) || !next.pkg) return { manifest, state: next };
  const tenantId = typeof manifest.tenantId === 'string' ? manifest.tenantId : null;
  if (tenantId && tenantId !== next.pkg.tenantId) return { manifest, state: next };
  const out: Record<string, unknown> = { ...manifest, playlists: next.pkg.playlists, usbBundleVersion: next.pkg.bundleVersion };
  for (const k of SERVER_CONTENT_KEYS) delete out[k];
  return { manifest: out, state: next };
}

/** A stand-in manifest for a paired screen that has nothing else to show. */
export function usbOnlyManifest(pkg: UsbPackage, screenId: string): Record<string, unknown> {
  return { version: '1.0', screenId, tenantId: pkg.tenantId, isEmergency: false, playlists: pkg.playlists, usbBundleVersion: pkg.bundleVersion };
}

export function readUsbMemo(storage: Pick<Storage, 'getItem'> | null | undefined): UsbOverlayMemo | null {
  try {
    const raw = storage?.getItem(LS_USB_OVERLAY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (!isRecord(j) || typeof j.bundleVersion !== 'string') return null;
    return {
      bundleVersion: j.bundleVersion,
      baseSig: typeof j.baseSig === 'string' ? j.baseSig : null,
      retired: j.retired === true,
    };
  } catch {
    return null;
  }
}

export function writeUsbMemo(storage: Pick<Storage, 'setItem' | 'removeItem'> | null | undefined, memo: UsbOverlayMemo | null): void {
  try {
    if (!memo) storage?.removeItem(LS_USB_OVERLAY);
    else storage?.setItem(LS_USB_OVERLAY, JSON.stringify(memo));
  } catch { /* storage full or blocked: the stick still plays this session */ }
}
