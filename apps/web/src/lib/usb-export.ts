/**
 * Download a playlist for a USB drive — the ONE implementation every surface
 * uses (playlists menu "Export to USB", the playlist page's "Download to USB",
 * the create wizard's "USB drive" destination).
 *
 * Greg, 2026-10-22: "make the USB process super simple … just allow people to
 * download the playlist to a USB by default … our app auto senses when someone
 * puts the USB stick in and reads our playlist and retains all the settings".
 * So there is no setting, key or PIN anywhere on this path: the API signs the
 * package itself (`POST /api/v1/usb-export/bundle`), and the player accepts
 * the downloaded .zip exactly as it is — nobody has to unzip anything.
 *
 * On a browser that can write into a folder (Chrome / Edge) the operator picks
 * the USB drive and we write the package straight onto it. The folder is
 * picked FIRST, while the click still counts as a user gesture — building a
 * large package can take longer than the browser keeps that gesture alive.
 * Everywhere else (Safari, Firefox, or a flow with no click to spend, like the
 * wizard's Create) it is an ordinary .zip download.
 */

import { API_URL } from '@/lib/api-url';

/** When the package plays (the wizard passes the window it just set). */
export interface UsbSchedule {
  daysOfWeek?: string | null;
  timeStart?: string | null;
  timeEnd?: string | null;
}

/** True when this browser can write straight into a USB folder. */
export function canWriteToUsbFolder(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/** Ask the API for the signed package. */
export async function fetchUsbBundle(args: {
  token: string | null | undefined;
  playlistId: string;
  playlistName: string;
  schedule?: UsbSchedule | null;
}): Promise<ArrayBuffer> {
  const base = API_URL.replace(/\/+$/, '');
  const res = await fetch(`${base}/usb-export/bundle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(args.token ? { Authorization: `Bearer ${args.token}` } : {}),
    },
    body: JSON.stringify({
      playlistIds: [args.playlistId],
      // A screen running off a stick is exactly the one that cannot fetch an
      // alert board later.
      includeEmergency: true,
      bundleLabel: args.playlistName,
      ...(args.schedule ? { schedule: args.schedule } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { message?: string });
    throw new Error(body.message || `HTTP ${res.status}`);
  }
  return res.arrayBuffer();
}

/** `VenueOS-USB-<playlist>-<time>.zip` — recognisable on a stick, never colliding. */
export function bundleFileName(playlistName: string, now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safe = playlistName.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'Playlist';
  return `VenueOS-USB-${safe}-${stamp}.zip`;
}

/** Hand the package to the browser as a plain .zip. */
export function downloadBundleAsZip(buf: ArrayBuffer, playlistName: string, now: Date): void {
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = bundleFileName(playlistName, now);
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked later: some browsers start reading the blob after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

type DirHandle = FileSystemDirectoryHandle;

async function pickUsbFolder(): Promise<DirHandle> {
  return (window as unknown as {
    showDirectoryPicker: (o: object) => Promise<DirHandle>;
  }).showDirectoryPicker({ mode: 'readwrite', id: 'venueos-usb', startIn: 'desktop' });
}

/** Unpack the package into a folder (the USB drive). Returns files written. */
export async function writeBundleToFolder(
  dir: DirHandle,
  buf: ArrayBuffer,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buf);
  const entries = Object.entries(zip.files).filter(([, f]) => !f.dir);
  let done = 0;
  for (const [path, file] of entries) {
    const segs = path.split('/').filter(Boolean);
    let d: DirHandle = dir;
    for (let i = 0; i < segs.length - 1; i++) {
      d = await d.getDirectoryHandle(segs[i], { create: true });
    }
    const fh = await d.getFileHandle(segs[segs.length - 1], { create: true });
    const w = await fh.createWritable();
    // arraybuffer, not uint8array: a generic Uint8Array<ArrayBufferLike> no
    // longer satisfies FileSystemWriteChunkType under this TS lib.
    await w.write(await file.async('arraybuffer'));
    await w.close();
    done += 1;
    onProgress?.(done, entries.length);
  }
  return done;
}

export type UsbExportProgress =
  | { phase: 'building' }
  | { phase: 'writing'; done: number; total: number };

export type UsbExportOutcome =
  | { kind: 'folder'; files: number }
  | { kind: 'zip'; fileName: string }
  | { kind: 'cancelled' };

/**
 * The whole "Download to USB" action. `allowFolder: false` forces the .zip
 * (for flows where the click was already spent, e.g. after creating a
 * playlist). A dismissed folder picker is `cancelled`, never an error.
 */
export async function exportPlaylistToUsb(args: {
  token: string | null | undefined;
  playlistId: string;
  playlistName: string;
  schedule?: UsbSchedule | null;
  allowFolder?: boolean;
  onProgress?: (p: UsbExportProgress) => void;
  now?: () => Date;
}): Promise<UsbExportOutcome> {
  let dir: DirHandle | null = null;
  if (args.allowFolder !== false && canWriteToUsbFolder()) {
    try {
      dir = await pickUsbFolder();
    } catch (e) {
      if ((e as { name?: string } | null)?.name === 'AbortError') return { kind: 'cancelled' };
      dir = null; // a picker that cannot open falls back to the download
    }
  }
  args.onProgress?.({ phase: 'building' });
  const buf = await fetchUsbBundle(args);
  if (dir) {
    const files = await writeBundleToFolder(dir, buf, (done, total) => args.onProgress?.({ phase: 'writing', done, total }));
    return { kind: 'folder', files };
  }
  const now = (args.now ?? (() => new Date()))();
  downloadBundleAsZip(buf, args.playlistName, now);
  return { kind: 'zip', fileName: bundleFileName(args.playlistName, now) };
}
