import {
  UPLOAD_FORMATS,
  formatAllowedOn,
  isMp4Labelled,
  normaliseDeclaredType,
  resolveUploadFormat,
  storedExtensionFor,
  uploadAcceptAttribute,
  uploadExtension,
  uploadFormatCopyParams,
  uploadFormatForType,
  uploadFormatsFor,
  uploadMimeTypesFor,
} from './upload-formats';

/** The video containers 2026-10-05 opened, with every type a browser was seen to send for them. */
const CONVERTED_VIDEO: Array<[string, string, string[]]> = [
  ['.mov', 'video/quicktime', ['video/quicktime']],
  ['.qt', 'video/quicktime', []],
  ['.avi', 'video/x-msvideo', ['video/x-msvideo', 'video/avi', 'video/msvideo', 'video/vnd.avi']],
  ['.mkv', 'video/x-matroska', ['video/x-matroska', 'application/x-matroska']],
  ['.wmv', 'video/x-ms-wmv', ['video/x-ms-wmv']],
  ['.mpg', 'video/mpeg', ['video/mpeg']],
  ['.mpeg', 'video/mpeg', ['video/mpeg', 'video/x-mpeg']],
  ['.3gp', 'video/3gpp', ['video/3gpp']],
  ['.ts', 'video/mp2t', ['video/mp2t', 'video/vnd.dlna.mpeg-tts']],
  ['.m2ts', 'video/mp2t', ['video/mp2t', 'video/vnd.dlna.mpeg-tts']],
  ['.mts', 'video/mp2t', ['video/mp2t']],
];

/** What /assets/upload and /assets/emergency-upload took before 2026-10-05 — byte for byte. */
const PRE_2026_10_05_LIST = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/x-icon', 'image/bmp',
  'video/mp4', 'video/webm', 'video/x-m4v',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4',
  'application/pdf',
];

describe('upload-formats — the one table', () => {
  it.each(CONVERTED_VIDEO)('%s is a video the transcode converts (stored as %s)', (ext, mime, types) => {
    for (const declared of ['', 'application/octet-stream', ...types]) {
      const r = resolveUploadFormat(`clip${ext}`, declared);
      expect(r.format?.kind).toBe('video');
      expect(r.format?.handling).toBe('convert-after-upload');
      expect(r.mimeType).toBe(mime);
    }
    // An upper-case name from a camera or an iPhone, no type at all.
    expect(resolveUploadFormat(`IMG_0001${ext.toUpperCase()}`, '').mimeType).toBe(mime);
  });

  it('a type the browser sends for the wrong reason leaves the decision to the extension', () => {
    // A Linux desktop with Qt installed calls .ts a "Qt translation"; some systems call .mts a 3-D model.
    expect(resolveUploadFormat('match.ts', 'text/vnd.trolltech.linguist').mimeType).toBe('video/mp2t');
    expect(resolveUploadFormat('00012.MTS', 'model/vnd.mts').mimeType).toBe('video/mp2t');
  });

  it.each([
    ['IMG_0042.HEIC', ''],
    ['IMG_0042.heic', 'image/heic'],
    ['photo.heif', 'image/heif'],
    ['photo.heif', ''],
    ['burst.heic', 'image/heic-sequence'],
  ])('HEIC %s (%j) is a photo converted at upload, stored as image/heic until then', (name, type) => {
    const r = resolveUploadFormat(name, type);
    expect(r.format?.label).toBe('HEIC');
    expect(r.format?.handling).toBe('convert-at-upload');
    expect(r.mimeType).toBe('image/heic');
  });

  it('a specific declared type wins over the name (the bytes are checked later anyway)', () => {
    expect(resolveUploadFormat('clip.mov', 'video/mp4').mimeType).toBe('video/mp4');
  });

  it('SVG, documents and unknown files match nothing', () => {
    for (const [name, type] of [
      ['logo.svg', 'image/svg+xml'],
      ['logo.svg', ''],
      ['notes.docx', ''],
      ['clip.flv', 'video/x-flv'],
      ['no-extension', ''],
      ['photo.avif', 'image/avif'],
    ]) {
      const r = resolveUploadFormat(name, type);
      expect(r.format).toBeNull();
      expect(r.mimeType).toBe(normaliseDeclaredType(type));
    }
  });

  it('every extension and type appears once — no two formats claim the same one', () => {
    const exts = UPLOAD_FORMATS.flatMap((f) => f.extensions);
    expect(new Set(exts).size).toBe(exts.length);
    const aliases = UPLOAD_FORMATS.flatMap((f) => f.aliases);
    expect(new Set(aliases).size).toBe(aliases.length);
    for (const a of aliases) expect(UPLOAD_FORMATS.some((f) => f.mimeType === a)).toBe(false);
    for (const f of UPLOAD_FORMATS) for (const e of f.extensions) expect(e).toMatch(/^\.[a-z0-9]+$/);
  });

  it('the direct path takes everything; multipart never takes a container that is converted AFTER upload', () => {
    expect(uploadFormatsFor('direct')).toHaveLength(UPLOAD_FORMATS.length);
    const multipart = uploadFormatsFor('multipart');
    expect(multipart.some((f) => f.handling === 'convert-after-upload')).toBe(false);
    expect(multipart.map((f) => f.label)).toContain('HEIC');
    expect(multipart.map((f) => f.label)).not.toContain('MOV');
  });

  it("the screen-emergency media endpoint's list is exactly what it took before (it converts nothing)", () => {
    expect([...uploadMimeTypesFor('emergency')].sort()).toEqual([...PRE_2026_10_05_LIST].sort());
    expect(uploadFormatsFor('emergency').every((f) => f.handling === 'as-is')).toBe(true);
  });

  it('the multipart list is the old list plus HEIC — nothing else changed there', () => {
    expect([...uploadMimeTypesFor('multipart')].sort()).toEqual([...PRE_2026_10_05_LIST, 'image/heic'].sort());
  });

  it('formatAllowedOn agrees with uploadFormatsFor for every format and path', () => {
    for (const path of ['direct', 'multipart', 'emergency'] as const) {
      for (const f of UPLOAD_FORMATS) {
        expect(uploadFormatsFor(path).includes(f)).toBe(formatAllowedOn(f, path));
      }
    }
  });

  it('the accept attribute lists every extension and stored type of its path, and never SVG', () => {
    const direct = uploadAcceptAttribute('direct').split(',');
    for (const f of UPLOAD_FORMATS) {
      for (const e of f.extensions) expect(direct).toContain(e);
      expect(direct).toContain(f.mimeType);
    }
    expect(direct.join(',')).not.toMatch(/svg/);
    const emergency = uploadAcceptAttribute('emergency').split(',');
    expect(emergency).not.toContain('.mov');
    expect(emergency).not.toContain('.heic');
    expect(uploadAcceptAttribute('direct', ['image']).split(',')).toEqual(
      expect.arrayContaining(['.jpg', '.png', '.heic', 'image/heic']),
    );
    expect(uploadAcceptAttribute('direct', ['image'])).not.toMatch(/video|audio|pdf/);
  });

  it('the copy lists come from the same table', () => {
    const p = uploadFormatCopyParams('direct');
    expect(p.images).toBe('JPG, PNG, WebP, GIF, BMP, ICO, HEIC');
    expect(p.videos).toBe('MP4, M4V, WebM, MOV, AVI, MKV, WMV, MPG, 3GP, TS');
    expect(p.audio).toBe('MP3, OGG, WAV, M4A');
    expect(uploadFormatCopyParams('emergency').videos).toBe('MP4, M4V, WebM');
  });

  it('a stored object is named with an extension its type agrees with', () => {
    const mov = uploadFormatForType('video/quicktime')!;
    expect(storedExtensionFor(mov, 'IMG_0001.MOV')).toBe('.mov');
    expect(storedExtensionFor(mov, 'clip')).toBe('.mov');
    const mp4 = uploadFormatForType('video/mp4')!;
    expect(storedExtensionFor(mp4, 'clip.mov')).toBe('.mp4');
    expect(storedExtensionFor(uploadFormatForType('image/heic')!, 'photo.HEIF')).toBe('.heif');
  });

  it('uploadExtension reads only the last dot of the base name', () => {
    expect(uploadExtension('a.b/c')).toBe('');
    expect(uploadExtension('dir.v2/IMG.MOV')).toBe('.mov');
    expect(uploadExtension('.hidden')).toBe('');
    expect(uploadExtension(undefined)).toBe('');
  });

  it('isMp4Labelled: only an MP4 type AND an MP4 extension (or none) count', () => {
    expect(isMp4Labelled('video/mp4', '.mp4')).toBe(true);
    expect(isMp4Labelled('video/x-m4v', '.m4v')).toBe(true);
    expect(isMp4Labelled('video/mp4; codecs="avc1"', '.MP4')).toBe(true);
    expect(isMp4Labelled(null, null)).toBe(true);
    expect(isMp4Labelled('video/quicktime', '.mov')).toBe(false);
    expect(isMp4Labelled('video/mp4', '.mov')).toBe(false); // MP4 type, QuickTime name
    expect(isMp4Labelled('video/3gpp', '.3gp')).toBe(false);
    expect(isMp4Labelled('video/webm', '.webm')).toBe(false);
  });
});
