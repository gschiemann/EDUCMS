/**
 * "What can I upload?" — one answer everywhere (2026-10-05, lib/upload-accept.ts).
 *
 * Pinned:
 *   1. the rule itself: MOV / AVI / MKV / WMV / MPG / 3GP / TS / M2TS / MTS and
 *      HEIC are TAKEN by the Media Library (empty / generic types decided by the
 *      name); SVG and unknown files are refused with words that say what IS taken;
 *      the alert-content editor and a screen's own alert media take less, and say
 *      where to go instead;
 *   2. the words exist in English, Spanish and Chinese — really translated;
 *   3. SINGLE SOURCE: every place in the dashboard that uploads a file reads this
 *      module (found by scanning the source for the upload calls, so a NEW entry
 *      point that skips it fails here), and none of them carries a hand-written
 *      format list or a "QuickTime .mov isn't supported" sentence any more.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import { renderHook } from '@testing-library/react';
import en from '@/i18n/messages/en.json';
import es from '@/i18n/messages/es.json';
import zh from '@/i18n/messages/zh.json';
import {
  ALERT_CONTENT_ACCEPT,
  ALERT_MEDIA_ACCEPT,
  LIBRARY_ACCEPT,
  LIBRARY_IMAGE_ACCEPT,
  isConvertedAfterUpload,
  isLibraryImageFile,
  libraryAccept,
  uploadProblemFor,
  useUploadProblemText,
} from '../upload-accept';

const f = (name: string, type = '') => ({ name, type });

describe('uploadProblemFor — the Media Library (direct path)', () => {
  it.each([
    ['IMG_0042.MOV', 'video/quicktime'],
    ['clip.avi', 'video/x-msvideo'],
    ['clip.avi', 'video/avi'],
    ['match.mkv', ''],
    ['talk.wmv', 'video/x-ms-wmv'],
    ['old.mpg', 'video/mpeg'],
    ['old.mpeg', ''],
    ['phone.3gp', 'video/3gpp'],
    ['broadcast.ts', 'video/mp2t'],
    ['broadcast.ts', 'text/vnd.trolltech.linguist'], // a Linux desktop's idea of .ts
    ['camcorder.m2ts', ''],
    ['00012.MTS', 'model/vnd.mts'],
    ['IMG_0043.HEIC', ''],
    ['photo.heif', 'image/heif'],
    ['clip.mp4', 'video/mp4'],
    ['photo.jpg', 'image/jpeg'],
    ['doc.pdf', 'application/pdf'],
    ['tone.mp3', 'audio/mpeg'],
  ])('%s (%j) is TAKEN', (name, type) => {
    expect(uploadProblemFor(f(name, type))).toBeNull();
  });

  it('SVG is refused as SVG; an unknown file as unsupported', () => {
    expect(uploadProblemFor(f('logo.svg', 'image/svg+xml'))).toEqual({ code: 'svg' });
    expect(uploadProblemFor(f('LOGO.SVG'))).toEqual({ code: 'svg' });
    for (const name of ['old.flv', 'notes.docx', 'photo.avif', 'no-extension', 'scan.tiff']) {
      expect(uploadProblemFor(f(name))).toEqual({ code: 'unsupported' });
    }
  });

  it('a picker of one kind refuses the others — a HEIC with no type is still a picture', () => {
    expect(uploadProblemFor(f('IMG_0043.HEIC'), { kinds: ['image'] })).toBeNull();
    expect(uploadProblemFor(f('clip.mov', 'video/quicktime'), { kinds: ['image'] })).toEqual({ code: 'wrong-kind', kinds: ['image'] });
    expect(uploadProblemFor(f('clip.mov', 'video/quicktime'), { kinds: ['video'] })).toBeNull();
    expect(isLibraryImageFile(f('IMG_0043.HEIC'))).toBe(true);
    expect(isLibraryImageFile(f('clip.mov'))).toBe(false);
  });

  it('isConvertedAfterUpload: the videos whose URL changes when the MP4 is swapped in — not MP4, not HEIC', () => {
    for (const name of ['a.mov', 'a.avi', 'a.mkv', 'a.wmv', 'a.mpg', 'a.3gp', 'a.ts', 'a.m2ts', 'a.mts']) {
      expect(isConvertedAfterUpload(f(name))).toBe(true);
    }
    for (const name of ['a.mp4', 'a.m4v', 'a.webm', 'a.heic', 'a.jpg']) expect(isConvertedAfterUpload(f(name))).toBe(false);
  });
});

describe('uploadProblemFor — the two alert-content surfaces take less', () => {
  it('the lockdown / evacuate editor (/assets/upload): HEIC yes (converted before it is stored), MOV → the Media Library', () => {
    expect(uploadProblemFor(f('IMG_0043.HEIC'), { path: 'multipart' })).toBeNull();
    expect(uploadProblemFor(f('lockdown.mp4', 'video/mp4'), { path: 'multipart' })).toBeNull();
    expect(uploadProblemFor(f('IMG_0042.MOV', 'video/quicktime'), { path: 'multipart' })).toEqual({ code: 'convert-in-library', label: 'MOV' });
  });

  it('a screen’s own alert media (/assets/emergency-upload): screen-ready only — HEIC and MOV are sent elsewhere', () => {
    expect(uploadProblemFor(f('lockdown.mp4', 'video/mp4'), { path: 'emergency' })).toBeNull();
    expect(uploadProblemFor(f('IMG_0043.HEIC'), { path: 'emergency' })).toEqual({ code: 'not-alert-media', label: 'HEIC' });
    expect(uploadProblemFor(f('clip.mkv'), { path: 'emergency' })).toEqual({ code: 'not-alert-media', label: 'MKV' });
    expect(uploadProblemFor(f('logo.svg'), { path: 'emergency' })).toEqual({ code: 'svg' });
  });
});

describe('the accept attributes', () => {
  it('the Media Library offers every format; pictures-only offers HEIC; nothing offers SVG', () => {
    const all = LIBRARY_ACCEPT.split(',');
    for (const e of ['.mov', '.qt', '.avi', '.mkv', '.wmv', '.mpg', '.mpeg', '.3gp', '.ts', '.m2ts', '.mts', '.heic', '.heif', '.mp4', '.m4v', '.webm', '.jpg', '.png', '.gif', '.bmp', '.ico', '.mp3', '.pdf']) {
      expect(all).toContain(e);
    }
    expect(LIBRARY_IMAGE_ACCEPT.split(',')).toEqual(expect.arrayContaining(['.heic', 'image/heic', '.jpg']));
    expect(LIBRARY_IMAGE_ACCEPT).not.toMatch(/video|audio|pdf/);
    expect(libraryAccept(['video'])).not.toMatch(/image|audio/);
    for (const a of [LIBRARY_ACCEPT, LIBRARY_IMAGE_ACCEPT, ALERT_CONTENT_ACCEPT, ALERT_MEDIA_ACCEPT]) expect(a).not.toMatch(/svg/);
  });

  it('the alert surfaces never offer what they cannot take', () => {
    expect(ALERT_CONTENT_ACCEPT.split(',')).toContain('.heic');
    expect(ALERT_CONTENT_ACCEPT.split(',')).not.toContain('.mov');
    expect(ALERT_MEDIA_ACCEPT.split(',')).not.toContain('.heic');
    expect(ALERT_MEDIA_ACCEPT.split(',')).not.toContain('.mov');
    expect(ALERT_MEDIA_ACCEPT.split(',')).toContain('.mp4');
  });
});

describe('the words', () => {
  const words = () => renderHook(() => useUploadProblemText()).result.current;

  it('say what to do, in plain words, with the real format lists', () => {
    const t = words();
    expect(t({ code: 'unsupported' }, f('old.flv'))).toBe(
      "old.flv can't be uploaded. Upload photos (JPG, PNG, WebP, GIF, BMP, ICO, HEIC), video (MP4, M4V, WebM, MOV, AVI, MKV, WMV, MPG, 3GP, TS), audio (MP3, OGG, WAV, M4A) or PDF.",
    );
    expect(t({ code: 'svg' }, f('logo.svg'))).toMatch(/Export it as PNG.*Settings → Branding/);
    expect(t({ code: 'wrong-kind', kinds: ['image'] }, f('clip.mov'))).toBe(
      "clip.mov can't be used here — this takes JPG, PNG, WebP, GIF, BMP, ICO, HEIC.",
    );
    expect(t({ code: 'convert-in-library', label: 'MOV' }, f('IMG_0042.MOV'))).toMatch(
      /^IMG_0042\.MOV is a MOV video\..*Upload it to the Media Library first.*export it as MP4 \(H\.264\)\.$/,
    );
    expect(t({ code: 'not-alert-media', label: 'HEIC' }, f('IMG_0043.HEIC'))).toMatch(
      /^IMG_0043\.HEIC can't be alert media as it is.*JPG, PNG, WebP, GIF, BMP, ICO, MP4, M4V, WebM, MP3, OGG, WAV, M4A, PDF.*Media Library, which converts it\.$/,
    );
  });

  it('every uploadFormats word exists in English, Spanish and Chinese — really translated, same placeholders', () => {
    const catalogs = { en, es, zh } as unknown as Record<string, Record<string, Record<string, string>>>;
    const keys = Object.keys(catalogs.en.uploadFormats);
    expect(keys.length).toBeGreaterThanOrEqual(10);
    const placeholders = (s: string) => Array.from(s.matchAll(/\{(\w+)\}/g), (m) => m[1]).sort();
    for (const key of keys) {
      for (const lang of ['es', 'zh']) {
        const w = catalogs[lang].uploadFormats?.[key];
        expect(w).toEqual(expect.stringMatching(/\S/));
        expect(w).not.toBe(catalogs.en.uploadFormats[key]);
        expect(placeholders(w)).toEqual(placeholders(catalogs.en.uploadFormats[key]));
      }
    }
    for (const lang of ['en', 'es', 'zh']) {
      const s = catalogs[lang].assetsLib.supportedCopy;
      expect(placeholders(s)).toEqual(['audio', 'images', 'video', 'videos']);
      expect(s).toMatch(/HEIC/);
      expect(s).toMatch(/MOV/);
    }
  });
});

// ── SINGLE SOURCE ───────────────────────────────────────────────────────────

const SRC = resolve(__dirname, '../..');

/** Every dashboard file that sends a file to the server (found by its call, not by a list). */
function uploadEntryPoints(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name === '__tests__' || name === 'node_modules') continue;
        walk(p);
      } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        const src = readFileSync(p, 'utf8');
        // A call, or an endpoint path ending in a quote (code, not a comment).
        if (/uploadAssetDirect\(|\/assets\/upload[`'"]|\/assets\/emergency-upload[`'"]/.test(src)) out.push(relative(SRC, p));
      }
    }
  };
  walk(SRC);
  return out.sort();
}

/** The upload client, the hook built on it and the rule itself — not entry points. */
const NOT_ENTRY_POINTS = new Set(['lib/direct-upload.ts', 'lib/use-upload-error-text.ts', 'lib/upload-accept.ts']);

describe('SINGLE SOURCE — every upload entry point reads lib/upload-accept.ts', () => {
  const entries = uploadEntryPoints().filter((p) => !NOT_ENTRY_POINTS.has(p));

  it('finds the known entry points (a negative control for the scan itself)', () => {
    for (const known of [
      'hooks/use-library-uploads.ts',
      'app/[schoolId]/playlists/ClassicPlaylistsPage.tsx',
      'components/assets/AssetPicker.tsx',
      'components/template-builder/PropertiesPanel.tsx',
      'components/settings/PanicContentEditor.tsx',
      'components/settings/ScreenEmergencyContentConfig.tsx',
    ]) {
      expect(entries).toContain(known);
    }
  });

  it('the library and wizard delegate to the shared validated uploader', () => {
    for (const file of ['app/[schoolId]/assets/page.tsx', 'components/playlists/WizardMediaUpload.tsx']) {
      const src = readFileSync(join(SRC, file), 'utf8');
      expect(src).toContain("from '@/hooks/use-library-uploads'");
      expect(src).toContain("from '@/lib/upload-accept'");
    }
  });

  it.each(uploadEntryPoints().filter((p) => !NOT_ENTRY_POINTS.has(p)))('%s imports the shared rule and carries no format list of its own', (file) => {
    const src = readFileSync(join(SRC, file), 'utf8');
    expect(src).toContain("from '@/lib/upload-accept'");
    // The hand-written lists and refusals of before 2026-10-05.
    expect(src).not.toMatch(/accept=["'][^"']*(?:\.jpg|\.mp4|image\/png|video\/mp4)[^"']*["']/);
    expect(src).not.toMatch(/['"]video\/mp4,video\/webm['"]/);
    expect(src).not.toMatch(/QuickTime \.mov isn't supported|MOV is unsupported|AVI (?:is|isn't) (?:un)?supported/);
  });
});
