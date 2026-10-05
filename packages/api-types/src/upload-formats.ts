/**
 * upload-formats.ts — WHAT AN UPLOAD MAY BE, in one table (2026-10-05).
 *
 * Owner's rule: "support as many files as possible but they must work 100% of
 * the time." Every iPhone video (`.mov`) and every iPhone photo (HEIC) used to be
 * refused with "export as MP4" — and so were AVI, MKV, WMV, MPG, 3GP and MPEG-TS —
 * while competitors take them and convert them on their servers. The server can
 * now do the same: the signage transcode turns any video that is not screen-safe
 * into an H.264 MP4 that replaces it (apps/api/src/storage/video-transcode), and
 * complete-upload converts a HEIC photo to JPEG before the asset exists.
 *
 * Before this file the list lived in SEVEN places that disagreed: the API's
 * allow-list, its extension map, the storage bucket's MIME list, the Media
 * Library's `accept` string and its pre-check, the asset picker, the
 * template-builder picker — and the playlist "Add media" dialog had no list at
 * all. The same file got four different answers. Everything now reads THIS table:
 * the API (`assets.controller.ts`, `supabase-storage.service.ts`), every web
 * upload entry point (`apps/web/src/lib/upload-accept.ts`), and the words that
 * say what is accepted.
 *
 * WHERE A FORMAT MAY BE UPLOADED (`UploadPath`):
 *   • 'direct'    — the Media Library path every dashboard picker uses (presign →
 *                   storage → complete-upload). Takes EVERY format below: HEIC is
 *                   converted before the asset exists, a video in another
 *                   container is converted by the transcode after it.
 *   • 'multipart' — POST /assets/upload. Alert content (the lockdown / evacuate
 *                   editor) is uploaded here and bound into its protected playlist
 *                   at once, and the transcode NEVER converts emergency content
 *                   (a URL the never-evict cache holds must not change under it).
 *                   So a format converted AFTER upload is refused here — it would
 *                   stay unconverted forever. HEIC is converted before it is stored.
 *   • 'emergency' — POST /assets/emergency-upload (a screen's own alert media): no
 *                   asset row, no conversion of any kind. Screen-ready formats only.
 *
 * NO I/O, no Node APIs: shared by the API (Node) and the dashboard (browser).
 */

export type UploadKind = 'image' | 'video' | 'audio' | 'pdf';

/**
 * How a format reaches a screen:
 *   'as-is'                — stored as uploaded (a picture may be re-encoded in its
 *                            own format, a video may still be converted when its
 *                            CODEC is not screen-safe);
 *   'convert-at-upload'    — converted before it is stored (HEIC → JPEG): nothing
 *                            downstream ever sees the original;
 *   'convert-after-upload' — stored, then the signage transcode replaces it with an
 *                            H.264 MP4; until then the library says "Optimizing for
 *                            screens…".
 */
export type UploadHandling = 'as-is' | 'convert-at-upload' | 'convert-after-upload';

/** Which upload endpoint a file is judged for — see the header. */
export type UploadPath = 'direct' | 'multipart' | 'emergency';

export interface UploadFormat {
  /** The name an operator knows it by; the copy lists these. */
  label: string;
  kind: UploadKind;
  /** Lower-case, with the dot. The first is the one a stored object is named with when the file's own name has none of them. */
  extensions: readonly string[];
  /** The type the object is stored under — what storage records and the bucket allows. */
  mimeType: string;
  /** Other types browsers and operating systems report for the same file; normalised to `mimeType`. */
  aliases: readonly string[];
  handling: UploadHandling;
}

export const UPLOAD_FORMATS: readonly UploadFormat[] = [
  // ── pictures ──────────────────────────────────────────────────────────────
  { label: 'JPG', kind: 'image', extensions: ['.jpg', '.jpeg'], mimeType: 'image/jpeg', aliases: ['image/jpg', 'image/pjpeg'], handling: 'as-is' },
  { label: 'PNG', kind: 'image', extensions: ['.png'], mimeType: 'image/png', aliases: ['image/x-png'], handling: 'as-is' },
  { label: 'WebP', kind: 'image', extensions: ['.webp'], mimeType: 'image/webp', aliases: [], handling: 'as-is' },
  { label: 'GIF', kind: 'image', extensions: ['.gif'], mimeType: 'image/gif', aliases: [], handling: 'as-is' },
  { label: 'BMP', kind: 'image', extensions: ['.bmp'], mimeType: 'image/bmp', aliases: ['image/x-bmp', 'image/x-ms-bmp'], handling: 'as-is' },
  { label: 'ICO', kind: 'image', extensions: ['.ico'], mimeType: 'image/x-icon', aliases: ['image/vnd.microsoft.icon'], handling: 'as-is' },
  // Every iPhone photo since iOS 11. Real ones are TILED (a grid of 512×512 HEVC
  // tiles), carry the rotation as an `irot` property and are usually Display P3;
  // the converter (apps/api/src/assets/heif-convert.ts) handles all three.
  {
    label: 'HEIC',
    kind: 'image',
    extensions: ['.heic', '.heif'],
    mimeType: 'image/heic',
    aliases: ['image/heif', 'image/heic-sequence', 'image/heif-sequence'],
    handling: 'convert-at-upload',
  },
  // ── video ─────────────────────────────────────────────────────────────────
  { label: 'MP4', kind: 'video', extensions: ['.mp4'], mimeType: 'video/mp4', aliases: [], handling: 'as-is' },
  { label: 'M4V', kind: 'video', extensions: ['.m4v'], mimeType: 'video/x-m4v', aliases: [], handling: 'as-is' },
  // WebM plays in every Chromium; the library still converts it (not an MP4 container).
  { label: 'WebM', kind: 'video', extensions: ['.webm'], mimeType: 'video/webm', aliases: [], handling: 'as-is' },
  { label: 'MOV', kind: 'video', extensions: ['.mov', '.qt'], mimeType: 'video/quicktime', aliases: [], handling: 'convert-after-upload' },
  {
    label: 'AVI',
    kind: 'video',
    extensions: ['.avi'],
    mimeType: 'video/x-msvideo',
    aliases: ['video/avi', 'video/msvideo', 'video/vnd.avi', 'video/x-avi'],
    handling: 'convert-after-upload',
  },
  {
    label: 'MKV',
    kind: 'video',
    extensions: ['.mkv'],
    mimeType: 'video/x-matroska',
    aliases: ['video/matroska', 'application/x-matroska'],
    handling: 'convert-after-upload',
  },
  { label: 'WMV', kind: 'video', extensions: ['.wmv'], mimeType: 'video/x-ms-wmv', aliases: [], handling: 'convert-after-upload' },
  {
    label: 'MPG',
    kind: 'video',
    extensions: ['.mpg', '.mpeg'],
    mimeType: 'video/mpeg',
    aliases: ['video/x-mpeg', 'video/mpg', 'video/x-mpg'],
    handling: 'convert-after-upload',
  },
  { label: '3GP', kind: 'video', extensions: ['.3gp'], mimeType: 'video/3gpp', aliases: [], handling: 'convert-after-upload' },
  // MPEG transport stream: broadcast / screen-recorder `.ts`, AVCHD camcorder `.m2ts` / `.mts`.
  {
    label: 'TS',
    kind: 'video',
    extensions: ['.ts', '.m2ts', '.mts'],
    mimeType: 'video/mp2t',
    aliases: ['video/vnd.dlna.mpeg-tts', 'video/m2ts', 'video/x-m2ts'],
    handling: 'convert-after-upload',
  },
  // ── audio ─────────────────────────────────────────────────────────────────
  { label: 'MP3', kind: 'audio', extensions: ['.mp3'], mimeType: 'audio/mpeg', aliases: ['audio/mp3', 'audio/mpeg3', 'audio/x-mpeg-3'], handling: 'as-is' },
  { label: 'OGG', kind: 'audio', extensions: ['.ogg'], mimeType: 'audio/ogg', aliases: [], handling: 'as-is' },
  { label: 'WAV', kind: 'audio', extensions: ['.wav'], mimeType: 'audio/wav', aliases: ['audio/x-wav', 'audio/wave', 'audio/vnd.wave'], handling: 'as-is' },
  { label: 'M4A', kind: 'audio', extensions: ['.m4a'], mimeType: 'audio/mp4', aliases: ['audio/x-m4a', 'audio/m4a'], handling: 'as-is' },
  // ── documents ─────────────────────────────────────────────────────────────
  { label: 'PDF', kind: 'pdf', extensions: ['.pdf'], mimeType: 'application/pdf', aliases: ['application/x-pdf'], handling: 'as-is' },
];

/** May this format be uploaded on this path? (see the header) */
export function formatAllowedOn(format: UploadFormat, path: UploadPath): boolean {
  if (path === 'direct') return true;
  if (path === 'multipart') return format.handling !== 'convert-after-upload';
  return format.handling === 'as-is';
}

/** The formats a path takes, in table order. */
export function uploadFormatsFor(path: UploadPath): UploadFormat[] {
  return UPLOAD_FORMATS.filter((f) => formatAllowedOn(f, path));
}

/** Every stored type a path can produce (each format's `mimeType`, deduplicated). */
export function uploadMimeTypesFor(path: UploadPath): string[] {
  return [...new Set(uploadFormatsFor(path).map((f) => f.mimeType))];
}

/** `image/heic; foo=bar ` → `image/heic`; anything else → ''. */
export function normaliseDeclaredType(type: string | null | undefined): string {
  return String(type || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

/** `IMG_0001.MOV` → `.mov`; no extension → ''. */
export function uploadExtension(filename: string | null | undefined): string {
  const name = String(filename || '');
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

const BY_TYPE = new Map<string, UploadFormat>();
const BY_EXTENSION = new Map<string, UploadFormat>();
for (const f of UPLOAD_FORMATS) {
  if (!BY_TYPE.has(f.mimeType)) BY_TYPE.set(f.mimeType, f);
  for (const a of f.aliases) if (!BY_TYPE.has(a)) BY_TYPE.set(a, f);
  for (const e of f.extensions) BY_EXTENSION.set(e, f);
}

export interface ResolvedUpload {
  /** The format the file is taken as, or null when nothing in the table matches. */
  format: UploadFormat | null;
  /** The type to store it under: the format's `mimeType`, else the declared type as sent. */
  mimeType: string;
  /** The file name's own extension, lower-case ('' when it has none). */
  extension: string;
}

/**
 * What an upload IS, from what the browser said and what the file is called.
 * A specific type the browser declared wins (it is derived from the same name
 * anyway); an EMPTY or generic one (`application/octet-stream`, a Linux desktop
 * calling `.ts` "Qt translation", `model/vnd.mts` for an AVCHD clip) leaves the
 * decision to the extension. The bytes are checked later (complete-upload's
 * content check): neither the name nor the declared type is the truth.
 */
export function resolveUploadFormat(
  filename: string | null | undefined,
  declaredType: string | null | undefined,
): ResolvedUpload {
  const declared = normaliseDeclaredType(declaredType);
  const extension = uploadExtension(filename);
  const format = BY_TYPE.get(declared) ?? BY_EXTENSION.get(extension) ?? null;
  return { format, mimeType: format ? format.mimeType : declared, extension };
}

/** The format a STORED type names (canonical or alias), or null. */
export function uploadFormatForType(type: string | null | undefined): UploadFormat | null {
  return BY_TYPE.get(normaliseDeclaredType(type)) ?? null;
}

/**
 * The extension a stored object is named with: the file's own when it is one of
 * its format's (lower-cased), else the format's first. The manifest and the player
 * read a URL's extension, so it must agree with the type it is stored under.
 */
export function storedExtensionFor(format: UploadFormat, filename: string | null | undefined): string {
  const own = uploadExtension(filename);
  return format.extensions.includes(own) ? own : format.extensions[0];
}

/**
 * The `accept` attribute for a file input on this path, optionally narrowed to
 * some kinds. Extensions AND types: Safari / iOS map an extension to a file kind
 * more reliably, and a type catches a file whose name has no extension.
 */
export function uploadAcceptAttribute(path: UploadPath, kinds?: readonly UploadKind[]): string {
  const formats = uploadFormatsFor(path).filter((f) => !kinds || kinds.includes(f.kind));
  const out = new Set<string>();
  for (const f of formats) for (const e of f.extensions) out.add(e);
  for (const f of formats) out.add(f.mimeType);
  return [...out].join(',');
}

/** "JPG, PNG, WebP, …" — the labels of a path's formats of one kind, for copy. */
export function uploadFormatLabels(path: UploadPath, kind: UploadKind): string {
  return [...new Set(uploadFormatsFor(path).filter((f) => f.kind === kind).map((f) => f.label))].join(', ');
}

/** The format lists the "what can I upload" copy interpolates, for one path. */
export function uploadFormatCopyParams(path: UploadPath): { images: string; videos: string; audio: string } {
  return {
    images: uploadFormatLabels(path, 'image'),
    videos: uploadFormatLabels(path, 'video'),
    audio: uploadFormatLabels(path, 'audio'),
  };
}

/**
 * Is a file with this stored type / extension an MP4 BY NAME? A screen is handed a
 * file by its type and URL, and the library calls an asset what its name says, so a
 * converted video must end as one — whatever the bytes inside happen to be.
 */
export function isMp4Labelled(mimeType: string | null | undefined, extension: string | null | undefined): boolean {
  const type = normaliseDeclaredType(mimeType);
  const ext = String(extension || '').toLowerCase();
  const typeOk = !type || type === 'video/mp4' || type === 'video/x-m4v';
  const extOk = !ext || ext === '.mp4' || ext === '.m4v';
  return typeOk && extOk;
}
