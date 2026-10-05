/**
 * The `assets` bucket's MIME allow-list reaches production at boot (2026-10-05).
 *
 * THE BUG THIS PINS. onModuleInit sends the size limit AND the MIME list in one
 * `updateBucket`. Since 2026-09-23 the size asked for is 2 GB, which Supabase
 * refuses while the project's global upload limit is 500 MB ("assets bucket is
 * still capped at 500MB" in every boot log) — and the refusal threw the MIME list
 * away with it. A type added to the list (MOV, AVI, MKV, WMV, MPG, 3GP, TS, HEIC
 * on 2026-10-05) would never have reached production: the API would accept a
 * .mov and storage would answer "mime type not allowed". Now a refused size is
 * followed by a MIME-only update (no `fileSizeLimit`: storage leaves the cap as
 * it is), and the list is read back and any missing type named in the log.
 */
import { uploadMimeTypesFor } from '@cms/api-types';

type Call = { fn: string; id: string; options?: Record<string, unknown> };
const calls: Call[] = [];
let world: {
  fullUpdateError: { message: string } | null;
  mimeOnlyError: { message: string } | null;
  readBack: {
    file_size_limit?: number;
    allowed_mime_types?: string[] | null;
  } | null;
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: {
      createBucket: (id: string, options: Record<string, unknown>) => {
        calls.push({ fn: 'createBucket', id, options });
        return Promise.resolve({
          error: { message: 'The resource already exists' },
        });
      },
      updateBucket: (id: string, options: Record<string, unknown>) => {
        calls.push({ fn: 'updateBucket', id, options });
        if (id !== 'assets') return Promise.resolve({ error: null });
        if ('fileSizeLimit' in options)
          return Promise.resolve({ error: world.fullUpdateError });
        return Promise.resolve({ error: world.mimeOnlyError });
      },
      getBucket: (id: string) => {
        calls.push({ fn: 'getBucket', id });
        return Promise.resolve(
          world.readBack
            ? { data: world.readBack, error: null }
            : { data: null, error: { message: 'boom' } },
        );
      },
    },
  }),
}));

import {
  ASSETS_BUCKET_FILE_SIZE_LIMIT,
  ASSETS_BUCKET_MIME_TYPES,
  SupabaseStorageService,
} from './supabase-storage.service';

const MB = 1024 * 1024;
const SIZE_REFUSED = {
  message: 'The object exceeded the maximum allowed size',
};

async function boot() {
  calls.length = 0;
  const svc = new SupabaseStorageService();
  const logs: string[] = [];
  const logger = (
    svc as unknown as {
      logger: Record<'log' | 'warn' | 'error', (m: string) => void>;
    }
  ).logger;
  logger.log = (m: string) => logs.push(`LOG ${m}`);
  logger.warn = (m: string) => logs.push(`WARN ${m}`);
  logger.error = (m: string) => logs.push(`ERROR ${m}`);
  await svc.onModuleInit();
  const assets = calls.filter((c) => c.id === 'assets');
  return { svc, logs, assets };
}

describe('the assets bucket MIME allow-list', () => {
  const env = { ...process.env };
  beforeAll(() => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-for-tests';
  });
  afterAll(() => {
    process.env = env;
  });

  it('is every type the Media Library stores (from the shared table) plus the import PowerPoint types — and never SVG', () => {
    expect([...ASSETS_BUCKET_MIME_TYPES].sort()).toEqual(
      [
        ...uploadMimeTypesFor('direct'),
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.ms-powerpoint',
      ].sort(),
    );
    for (const t of [
      'video/quicktime',
      'video/x-msvideo',
      'video/x-matroska',
      'video/x-ms-wmv',
      'video/mpeg',
      'video/3gpp',
      'video/mp2t',
      'image/heic',
    ]) {
      expect(ASSETS_BUCKET_MIME_TYPES).toContain(t);
    }
    expect(ASSETS_BUCKET_MIME_TYPES).not.toContain('image/svg+xml');
  });

  it('PRODUCTION TODAY: the 2 GB size is refused → the list is applied ON ITS OWN, without a size, so the cap is untouched', async () => {
    world = {
      fullUpdateError: SIZE_REFUSED,
      mimeOnlyError: null,
      readBack: {
        file_size_limit: 500 * MB,
        allowed_mime_types: [...ASSETS_BUCKET_MIME_TYPES],
      },
    };
    const { svc, logs, assets } = await boot();
    const updates = assets.filter((c) => c.fn === 'updateBucket');
    expect(updates).toHaveLength(2);
    expect(updates[0].options).toEqual({
      public: true,
      fileSizeLimit: ASSETS_BUCKET_FILE_SIZE_LIMIT,
      allowedMimeTypes: [...ASSETS_BUCKET_MIME_TYPES],
    });
    expect(updates[1].options).toEqual({
      public: true,
      allowedMimeTypes: [...ASSETS_BUCKET_MIME_TYPES],
    });
    expect(updates[1].options).not.toHaveProperty('fileSizeLimit');
    expect(logs.some((l) => /MIME allow-list applied on its own/.test(l))).toBe(
      true,
    );
    expect(logs.some((l) => /still REFUSES/.test(l))).toBe(false);
    // The cap the API advertises is still the one storage really has.
    expect(svc.assetsBucketCap()).toBe(500 * MB);
  });

  it('when the full update succeeds there is no second write', async () => {
    world = {
      fullUpdateError: null,
      mimeOnlyError: null,
      readBack: { allowed_mime_types: [...ASSETS_BUCKET_MIME_TYPES] },
    };
    const { assets } = await boot();
    expect(assets.filter((c) => c.fn === 'updateBucket')).toHaveLength(1);
  });

  it('a type storage still refuses is NAMED in the log, with where to add it', async () => {
    world = {
      fullUpdateError: SIZE_REFUSED,
      mimeOnlyError: { message: 'permission denied' },
      // What production holds today: the list as of 2026-09-22.
      readBack: {
        file_size_limit: 500 * MB,
        allowed_mime_types: [
          'image/jpeg',
          'image/png',
          'image/webp',
          'image/gif',
          'image/x-icon',
          'image/bmp',
          'video/mp4',
          'video/webm',
          'video/x-m4v',
          'audio/mpeg',
          'audio/ogg',
          'audio/wav',
          'audio/mp4',
          'application/pdf',
        ],
      },
    };
    const { logs } = await boot();
    const warn = logs.find((l) => /still REFUSES/.test(l)) ?? '';
    expect(warn).toMatch(/video\/quicktime/);
    expect(warn).toMatch(/image\/heic/);
    expect(warn).toMatch(/Allowed MIME types/);
    expect(
      logs.some((l) => /could not apply the MIME allow-list/.test(l)),
    ).toBe(true);
  });

  it('an empty read-back list means "any type" to Supabase — nothing is reported missing; a failed read never throws', async () => {
    world = {
      fullUpdateError: null,
      mimeOnlyError: null,
      readBack: { allowed_mime_types: [] },
    };
    expect((await boot()).logs.some((l) => /still REFUSES/.test(l))).toBe(
      false,
    );
    world = { fullUpdateError: null, mimeOnlyError: null, readBack: null };
    expect(
      (await boot()).logs.some((l) =>
        /Could not read the assets bucket's MIME allow-list back/.test(l),
      ),
    ).toBe(true);
  });
});
