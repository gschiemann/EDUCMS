/**
 * playback-copy-text (2026-10-05): a publish that cannot prepare files for 1080p
 * screens NAMES them, in the operator's language. The bodies below are cut from
 * the producer — MediaPublicationService.playbackCopyRefusal and GET /schedules
 * (`pendingMediaFiles`) in apps/api/src/schedules.
 */
import en from '@/i18n/messages/en.json';
import es from '@/i18n/messages/es.json';
import zh from '@/i18n/messages/zh.json';
import { useTranslations } from 'next-intl';
import {
  playbackCopyErrorText,
  playbackCopyFileList,
  playbackCopyFiles,
  translateFailedPublications,
  withPlaybackCopyText,
} from '../playback-copy-text';

// The jest stand-in for next-intl resolves the real en.json (with ICU plurals).
const t = useTranslations('playbackCopy');

/** What api-client throws for a refused publish: message + `code` + the whole `body`. */
function apiError(body: Record<string, unknown>): Error & { code?: unknown; body?: unknown } {
  const e = new Error(String(body.message)) as Error & { code?: unknown; body?: unknown };
  e.code = body.code;
  e.body = body;
  return e;
}

const TWO_BAD = {
  code: 'IMAGE_PLAYBACK_COPY_FAILED',
  message:
    "These files can't be prepared for 1080p screens: “menu-board.jpg”, “not-really-a.png”. Remove or replace them, then publish again. The previous content stays on screen.",
  files: [
    { assetId: 'txt', name: 'menu-board.jpg' },
    { assetId: 'mp4', name: 'not-really-a.png' },
  ],
  retryable: false,
};

describe('a refused publish names its files', () => {
  it('in English, with exactly the server\'s words', () => {
    expect(playbackCopyErrorText(t, apiError(TWO_BAD))).toBe(TWO_BAD.message);
    expect(
      playbackCopyErrorText(
        t,
        apiError({ ...TWO_BAD, files: [TWO_BAD.files[0]], message: 'x' }),
      ),
    ).toBe("“menu-board.jpg” can't be prepared for 1080p screens. Remove or replace it, then publish again. The previous content stays on screen.");
  });

  it('a "not just now" refusal says to publish again', () => {
    const body = {
      code: 'VIDEO_PLAYBACK_COPY_QUEUE_FAILED',
      message: 'x',
      files: [{ assetId: 'v1', name: 'Gym loop.mp4' }],
      retryable: true,
    };
    expect(playbackCopyErrorText(t, apiError(body))).toBe(
      "The 1080p copy of “Gym loop.mp4” couldn't be made just now. The previous content stays on screen — publish again in a minute.",
    );
  });

  it('withPlaybackCopyText rewrites the message every caller shows — and leaves any other error alone', () => {
    const err = withPlaybackCopyText(t, apiError({ ...TWO_BAD, message: 'SERVER SENTENCE' }));
    expect(err.message).toBe(TWO_BAD.message);
    const other = withPlaybackCopyText(t, apiError({ code: 'SCHEDULE_PLAYLIST_NOT_FOUND', message: 'Playlist not found' }));
    expect(other.message).toBe('Playlist not found');
    // An older API (no `files`) keeps its own sentence.
    const old = withPlaybackCopyText(t, apiError({ code: 'IMAGE_PLAYBACK_COPY_FAILED', message: 'OLD SENTENCE' }));
    expect(old.message).toBe('OLD SENTENCE');
  });

  it('five names at most, then "and N more"; a long name is cut', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    expect(playbackCopyFileList(t, names)).toBe('“a”, “b”, “c”, “d”, “e” and 2 more');
    expect(playbackCopyFileList(t, ['x'.repeat(200)]).endsWith('…”')).toBe(true);
  });

  it('playbackCopyFiles keeps only well-formed entries', () => {
    expect(playbackCopyFiles([{ assetId: 'a', name: 'n' }, { assetId: 1 }, null, 'x'])).toEqual([{ assetId: 'a', name: 'n' }]);
    expect(playbackCopyFiles([])).toBeNull();
    expect(playbackCopyFiles(undefined)).toBeNull();
  });
});

describe('a held publish that failed later (GET /schedules → pendingMediaFiles)', () => {
  const failed = {
    id: 'rule-1',
    pendingMedia: true,
    pendingMediaError: 'SERVER WORDS',
    pendingMediaFiles: [{ assetId: 'v1', name: 'Gym loop.mp4' }],
  };

  it('its pendingMediaError becomes the words in the operator\'s language; other rows are untouched', () => {
    const ok = { id: 'rule-2', pendingMedia: false, pendingMediaError: null };
    const legacy = { id: 'rule-3', pendingMedia: true, pendingMediaError: 'A playback copy could not be prepared. Retry publishing this playlist.' };
    const out = translateFailedPublications(t, [failed, ok, legacy]);
    expect(out[0].pendingMediaError).toBe(
      "“Gym loop.mp4” can't be prepared for 1080p screens. Remove or replace it, then publish again. The previous content stays on screen.",
    );
    expect(out[1]).toBe(ok);
    expect(out[2]).toBe(legacy);
  });

  it('the same array comes back when nothing needs words (a stable query `select`)', () => {
    const rows = [{ id: 'r', pendingMedia: false, pendingMediaError: null }];
    expect(translateFailedPublications(t, rows)).toBe(rows);
    expect(translateFailedPublications(t, undefined)).toBeUndefined();
  });
});

describe('the words exist in English, Spanish and Chinese', () => {
  const KEYS: Array<[string, string[]]> = [
    ['cannotPrepare', ['files', 'count']],
    ['notNow', ['files']],
    ['quoted', ['name']],
    ['andMore', ['names', 'count']],
    ['separator', []],
  ];
  const catalogs = { en, es, zh } as unknown as Record<string, { playbackCopy: Record<string, string> }>;

  it.each(Object.keys(catalogs))('%s', (lang) => {
    for (const [key, placeholders] of KEYS) {
      const value = catalogs[lang].playbackCopy[key];
      expect(typeof value).toBe('string');
      for (const p of placeholders) {
        // Chinese has no plural forms, so its sentences need no {count}.
        if (lang === 'zh' && p === 'count' && key === 'cannotPrepare') continue;
        expect(value).toContain(`{${p}`);
      }
    }
    if (lang !== 'en') {
      expect(catalogs[lang].playbackCopy.cannotPrepare).not.toBe(catalogs.en.playbackCopy.cannotPrepare);
      expect(catalogs[lang].playbackCopy.notNow).not.toBe(catalogs.en.playbackCopy.notNow);
    }
  });
});
