/**
 * USB export — the bundle protocol, extracted so more than one surface can
 * trigger it.
 *
 * Greg, 2026-09-16: "export for offline use does what? is that export to USB?
 * does that then make it ready for our player and include the info about the
 * playlist? thats what it should do and the name should be export to USB".
 *
 * It is the USB export, and the bundle IS player-ready — but until now the
 * playlists overflow menu never called it. That entry ran `openWorkspace(id)`,
 * the same function as "Open", so it opened a page instead of exporting
 * anything. These helpers are what make the menu entry real; the playlist
 * detail header's own download control uses them too, so there is one
 * implementation of the protocol rather than two.
 *
 * What the server builds (`POST /api/v1/usb-export/bundle`):
 *   manifest.json   ← schema 'edu-cms-usb-bundle/v1', the playlists with their
 *                     items/templates, plus a flat `assets[]` of
 *                     { url, sha256, localPath, mimeType, sizeBytes }
 *   manifest.sig    ← HMAC-SHA256 over manifest.json, tenant USB ingest key
 *   assets/<sha>.*  ← the media itself
 *
 * The Android player reads exactly that: `UsbIngester.kt` gates on `schema`
 * and verifies each { sha256, localPath }; `UsbCacheIndex.kt` maps url →
 * on-disk copy so the WebView serves local bytes. Emergency playlists ride
 * along so a lockdown still renders on a screen with no network.
 */

import { API_URL } from '@/lib/api-url';

/** True when this browser can write straight into a USB folder. */
export function canWriteToUsbFolder(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/**
 * Ask the API for the signed bundle. `includeEmergency` stays on: a screen
 * running off a stick is exactly the one that cannot fetch an alert later.
 */
export async function fetchUsbBundle(args: {
  token: string | null | undefined;
  playlistId: string;
  playlistName: string;
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
      includeEmergency: true,
      bundleLabel: args.playlistName,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { message?: string });
    throw new Error(body.message || `Bundle failed (${res.status})`);
  }
  return res.arrayBuffer();
}

/** Filename-safe playlist name + a timestamp, so two exports never collide. */
export function bundleFileName(playlistName: string, now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${playlistName.replace(/[^\w.-]+/g, '_')}-${stamp}.zip`;
}

/** Hand the bundle to the browser as a plain .zip. */
export function downloadBundleAsZip(buf: ArrayBuffer, playlistName: string, now: Date): void {
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = bundleFileName(playlistName, now);
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Unpack the bundle directly into a directory the operator picks — the USB
 * stick itself. Written file-by-file (not as a .zip) because the player reads
 * a directory tree, so this is the difference between "a stick that works" and
 * "a stick with an archive on it nothing extracts".
 *
 * Returns the number of files written. Throws `AbortError` if the operator
 * dismisses the picker, which callers treat as "changed their mind", not a
 * failure.
 */
export async function writeBundleToUsbFolder(
  buf: ArrayBuffer,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const dir = await (window as unknown as {
    showDirectoryPicker: (o: object) => Promise<FileSystemDirectoryHandle>;
  }).showDirectoryPicker({ mode: 'readwrite', id: 'edu-cms-usb', startIn: 'desktop' });

  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buf);
  const entries = Object.entries(zip.files).filter(([, f]) => !f.dir);
  let done = 0;
  for (const [path, file] of entries) {
    const segs = path.split('/').filter(Boolean);
    let d: FileSystemDirectoryHandle = dir;
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
