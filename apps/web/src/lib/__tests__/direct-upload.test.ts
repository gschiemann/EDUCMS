/**
 * direct-upload — the browser half of 2 GB uploads (2026-09-23).
 *
 * Driven against an in-memory TUS server that behaves like Supabase's
 * (`/upload/resumable/sign`: create → 201 + Location, PATCH at the exact
 * Upload-Offset → 204 + new offset, HEAD → current offset, x-signature checked
 * on EVERY request including its expiry, 6 MB chunks). The presign / renew /
 * complete answers are cut from AssetsController's real responses.
 *
 * Pinned:
 *   • > 6 MB goes TUS in 6 MB chunks with the token as x-signature and the
 *     digit-only cacheControl Supabase needs for `max-age`;
 *   • a dropped connection RESUMES from the server's offset (bytes already
 *     accepted are never re-sent), and progress never goes backwards;
 *   • a token that expires mid-upload is renewed with the presign's ticket and
 *     the SAME chunk is resent;
 *   • TUS unreachable before a single byte → the single signed PUT;
 *   • ≤ 6 MB → the single PUT;
 *   • a 413 is "too-large" (never retried), an abort stops everything, and a
 *     connection that never comes back fails after the bounded retries.
 */
import {
  uploadAssetDirect,
  DirectUploadError,
  RESUMABLE_CHUNK_BYTES,
  RESUME_DELAYS_MS,
  tusMetadata,
  jwtExpiryMs,
  maxUploadBytesFor,
  formatUploadCap,
  MAX_DIRECT_VIDEO_BYTES,
  type DirectUploadDeps,
  type XhrResult,
} from '../direct-upload';

const MB = 1024 * 1024;
const PATH = 'tenant-1/0f6b1c2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d.mp4';
const SUPA = 'https://proj.supabase.co';
const ENDPOINT = `${SUPA}/storage/v1/upload/resumable/sign`;

/** A token that is a real JWT shape with an `exp` (seconds). */
function jwt(expSec: number, tag = 't'): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'HS256' })}.${b64({ url: `assets/${PATH}`, exp: expSec, tag })}.sig`;
}

function file(bytes: number, type = 'video/mp4', name = 'gym-4k.mp4'): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

const res = (status: number, headers: Record<string, string> = {}, body = ''): XhrResult => ({
  status,
  header: (n) => headers[n] ?? headers[n.toLowerCase()] ?? null,
  body,
});

interface Server {
  offset: number;
  created: number;
  patches: Array<{ offset: number; bytes: number; token: string }>;
  heads: number;
  puts: number;
  validTokens: Set<string>;
  /** Called before each PATCH; return a status to fail it instead. */
  failPatch?: (n: number) => number | null;
  /** For a failed PATCH: did the server take the bytes before the response was lost? */
  acceptedDespiteFailure?: (n: number) => boolean;
  createStatus?: number;
  putStatus?: number;
  metadata?: string;
}

function harness(opts: { now?: () => number; server?: Partial<Server>; presignToken?: string; noResumable?: boolean } = {}) {
  let clock = 1_700_000_000_000;
  const now = opts.now ?? (() => clock);
  const firstToken = opts.presignToken ?? jwt(Math.floor(clock / 1000) + 7200, 'first');
  const server: Server = {
    offset: 0,
    created: 0,
    patches: [],
    heads: 0,
    puts: 0,
    validTokens: new Set([firstToken]),
    ...opts.server,
  };
  const calls: string[] = [];
  let renewN = 0;
  const postJson = jest.fn(async (path: string, body: any) => {
    calls.push(`POST ${path}`);
    if (path === '/assets/presign') {
      // Cut from AssetsController.presignUpload's return.
      return {
        uploadUrl: `${SUPA}/storage/v1/object/upload/sign/assets/${PATH}?token=${firstToken}`,
        signedUrl: `${SUPA}/storage/v1/object/upload/sign/assets/${PATH}?token=${firstToken}`,
        token: firstToken,
        storagePath: PATH,
        fileUrl: `${SUPA}/storage/v1/object/public/assets/${PATH}`,
        mimeType: body.contentType,
        maxFileSize: MAX_DIRECT_VIDEO_BYTES,
        resumable: opts.noResumable
          ? null
          : { endpoint: ENDPOINT, bucketName: 'assets', objectName: PATH, chunkSize: 6 * MB, cacheControl: '31536000' },
        renewTicket: 'ur1.ticket',
        renewTicketExpiresAt: clock + 86_400_000,
      };
    }
    if (path === '/assets/presign/renew') {
      expect(body).toEqual({ storagePath: PATH, renewTicket: 'ur1.ticket' });
      renewN += 1;
      const t = jwt(Math.floor(now() / 1000) + 7200, `renewed-${renewN}`);
      server.validTokens.add(t);
      return { token: t, signedUrl: `${SUPA}/sign?token=${t}`, uploadUrl: `${SUPA}/sign?token=${t}`, storagePath: PATH };
    }
    if (path === '/assets/complete-upload') {
      // Cut from AssetsController.completeUpload's return.
      return {
        id: 'asset-new',
        fileUrl: `${SUPA}/storage/v1/object/public/assets/${PATH}`,
        mimeType: body.contentType,
        fileSize: body.size,
        fileHash: null,
        originalName: body.filename,
        status: 'PUBLISHED',
        altText: null,
        posterUrl: null,
      };
    }
    throw new Error(`unexpected ${path}`);
  });

  let patchN = 0;
  const request = jest.fn(async (method: string, url: string, headers: Record<string, string>, body: Blob | null, onUp?: (n: number) => void) => {
    calls.push(`${method} ${url.replace(SUPA, '')}`);
    if (method === 'PUT') {
      server.puts += 1;
      if (server.putStatus) return res(server.putStatus);
      onUp?.(body!.size);
      server.offset = body!.size;
      return res(200, {}, '{"Key":"assets/x"}');
    }
    const token = headers['x-signature'];
    const sigOk = server.validTokens.has(token) && (jwtExpiryMs(token) ?? 0) > now();
    if (method === 'POST') {
      if (server.createStatus !== undefined) return res(server.createStatus);
      if (!sigOk) return res(403, {}, '{"statusCode":"403","error":"Unauthorized","message":"jwt expired"}');
      server.created += 1;
      server.metadata = headers['Upload-Metadata'];
      return res(201, { Location: `${ENDPOINT}/dXBsb2FkLWlk` });
    }
    if (method === 'HEAD') {
      server.heads += 1;
      if (!sigOk) return res(403, {}, 'invalid signature');
      return res(200, { 'Upload-Offset': String(server.offset) });
    }
    if (method === 'PATCH') {
      patchN += 1;
      const forced = server.failPatch?.(patchN);
      if (forced !== null && forced !== undefined) {
        // A drop can happen AFTER the server accepted the bytes (response lost).
        if (server.acceptedDespiteFailure?.(patchN) && Number(headers['Upload-Offset']) === server.offset) {
          server.offset += body!.size;
        }
        return res(forced);
      }
      if (!sigOk) return res(403, {}, '{"message":"jwt expired"}');
      const off = Number(headers['Upload-Offset']);
      if (off !== server.offset) return res(409);
      onUp?.(Math.floor(body!.size / 2));
      onUp?.(body!.size);
      server.offset += body!.size;
      server.patches.push({ offset: off, bytes: body!.size, token });
      return res(204, { 'Upload-Offset': String(server.offset) });
    }
    return res(500);
  });

  const deps: Partial<DirectUploadDeps> = {
    postJson: postJson as any,
    request: request as any,
    sleep: jest.fn(async (ms: number) => {
      clock += ms;
    }),
    now,
  };
  return { deps, server, calls, postJson, request, advance: (ms: number) => (clock += ms) };
}

describe('uploadAssetDirect — TUS resumable for large files', () => {
  it('a 20 MB video goes up in 6 MB chunks with the token as x-signature, then registers', async () => {
    const h = harness();
    const progress: number[] = [];
    const phases: string[] = [];
    const asset = await uploadAssetDirect(file(20 * MB), {
      deps: h.deps,
      onProgress: (p) => progress.push(p.loaded),
      onPhase: (p) => phases.push(p),
    });
    expect(asset.id).toBe('asset-new');
    expect(h.server.created).toBe(1);
    expect(h.server.patches.map((p) => p.bytes)).toEqual([6 * MB, 6 * MB, 6 * MB, 2 * MB]);
    expect(h.server.offset).toBe(20 * MB);
    expect(h.server.puts).toBe(0);
    expect(progress[progress.length - 1]).toBe(20 * MB);
    for (let i = 1; i < progress.length; i++) expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
    expect(phases[0]).toBe('preparing');
    expect(phases[phases.length - 1]).toBe('finalizing');
    // Supabase only turns DIGITS into `max-age=…`; anything else is stored no-cache.
    expect(h.server.metadata).toBe(
      tusMetadata({ bucketName: 'assets', objectName: PATH, contentType: 'video/mp4', cacheControl: '31536000' }),
    );
    const complete = h.postJson.mock.calls.find(([p]) => p === '/assets/complete-upload')![1];
    expect(complete).toEqual({ storagePath: PATH, filename: 'gym-4k.mp4', contentType: 'video/mp4', size: 20 * MB, folderId: null });
  });

  it('RESUMES after a dropped connection from the server offset — accepted bytes are never re-sent', async () => {
    // PATCH #2 drops after the server took it (response lost); #3 drops before.
    const h = harness({ server: { failPatch: (n) => (n === 2 || n === 3 ? 0 : null), acceptedDespiteFailure: (n) => n === 2 } });
    const phases: string[] = [];
    await uploadAssetDirect(file(20 * MB), { deps: h.deps, onPhase: (p) => phases.push(p) });
    expect(h.server.offset).toBe(20 * MB);
    expect(h.server.heads).toBeGreaterThanOrEqual(1);
    const sentAt = h.server.patches.map((p) => p.offset);
    expect(new Set(sentAt).size).toBe(sentAt.length); // no offset uploaded twice
    expect(phases).toContain('reconnecting');
  });

  it('a token that expires MID-UPLOAD is renewed with the ticket and the same chunk resent', async () => {
    const h = harness();
    let call = 0;
    const realRequest = h.deps.request!;
    h.deps.request = jest.fn(async (...args: Parameters<DirectUploadDeps['request']>) => {
      // After the 2nd chunk, time jumps past the first token's expiry (a slow link).
      if (args[0] === 'PATCH' && ++call === 3) h.advance(3 * 3600_000);
      return realRequest(...args);
    }) as any;
    await uploadAssetDirect(file(20 * MB), { deps: h.deps });
    expect(h.postJson.mock.calls.filter(([p]) => p === '/assets/presign/renew').length).toBeGreaterThanOrEqual(1);
    expect(h.server.offset).toBe(20 * MB);
    const tokens = new Set(h.server.patches.map((p) => p.token));
    expect(tokens.size).toBe(2); // first token, then the renewed one
  });

  it('renews PROACTIVELY when the token is about to expire, before the server has to refuse', async () => {
    const soon = jwt(Math.floor(1_700_000_000_000 / 1000) + 60, 'short'); // 60 s left
    const h = harness({ presignToken: soon });
    await uploadAssetDirect(file(8 * MB), { deps: h.deps });
    expect(h.calls.indexOf('POST /assets/presign/renew')).toBeLessThan(h.calls.findIndex((c) => c.startsWith('POST /storage')));
    expect(h.server.patches.every((p) => p.token !== soon)).toBe(true);
  });

  it('TUS unreachable before any byte (CORS / blocked host) → falls back to the single signed PUT', async () => {
    const h = harness({ server: { createStatus: 0 } });
    const asset = await uploadAssetDirect(file(20 * MB), { deps: h.deps });
    expect(asset.id).toBe('asset-new');
    expect(h.server.puts).toBe(1);
    expect(h.server.patches).toEqual([]);
  });

  it('413 at create is TOO-LARGE — no retry, no fallback, nothing registered', async () => {
    const h = harness({ server: { createStatus: 413 } });
    const err = await uploadAssetDirect(file(20 * MB), { deps: h.deps }).catch((e) => e);
    expect(err).toBeInstanceOf(DirectUploadError);
    expect(err.code).toBe('too-large');
    expect(h.server.puts).toBe(0);
    expect(h.postJson.mock.calls.some(([p]) => p === '/assets/complete-upload')).toBe(false);
  });

  it('a connection that never comes back fails after the bounded retries', async () => {
    const h = harness({ server: { failPatch: () => 0 } });
    const err = await uploadAssetDirect(file(20 * MB), { deps: h.deps }).catch((e) => e);
    expect(err.code).toBe('network');
    expect((h.deps.sleep as jest.Mock).mock.calls.length).toBe(RESUME_DELAYS_MS.length);
    expect(h.postJson.mock.calls.some(([p]) => p === '/assets/complete-upload')).toBe(false);
  });

  it('an abort stops the upload and registers nothing', async () => {
    const h = harness();
    const ac = new AbortController();
    const realRequest = h.deps.request!;
    h.deps.request = jest.fn(async (...args: Parameters<DirectUploadDeps['request']>) => {
      if (args[0] === 'PATCH') ac.abort();
      return realRequest(...args);
    }) as any;
    const err = await uploadAssetDirect(file(20 * MB), { deps: h.deps, signal: ac.signal }).catch((e) => e);
    expect(err.code).toBe('aborted');
    expect(h.postJson.mock.calls.some(([p]) => p === '/assets/complete-upload')).toBe(false);
  });
});

describe('uploadAssetDirect — small files and server refusals', () => {
  it('≤ 6 MB takes the single signed PUT (with the immutable cache header)', async () => {
    const h = harness();
    await uploadAssetDirect(file(RESUMABLE_CHUNK_BYTES, 'image/jpeg', 'a.jpg'), { deps: h.deps });
    expect(h.server.puts).toBe(1);
    expect(h.server.created).toBe(0);
    const put = h.request.mock.calls.find(([m]) => m === 'PUT')!;
    expect(put[2]).toEqual({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' });
  });

  it('an API without the resumable descriptor still works (single PUT)', async () => {
    const h = harness({ noResumable: true });
    await uploadAssetDirect(file(20 * MB), { deps: h.deps });
    expect(h.server.puts).toBe(1);
  });

  it('the presign 413 / 415 map to too-large / unsupported with the server message', async () => {
    const h = harness();
    h.postJson.mockImplementationOnce(async () => {
      const e: any = new Error('Video is too large for signage (2.5 GB). Max is 2 GB');
      e.status = 413;
      throw e;
    });
    const err = await uploadAssetDirect(file(10), { deps: h.deps }).catch((e) => e);
    expect(err.code).toBe('too-large');
    expect(err.message).toContain('Max is 2 GB');
    expect(err.apiCode).toBeUndefined();
    expect(err.apiBody).toBeUndefined();
  });

  it("a refusal's machine code and body ride on the error (2026-09-24 — the storage allowance 413 carries numbers)", async () => {
    // Cut from the producer: storageQuotaError() in apps/api/src/assets/storage-quota.service.ts,
    // 10 screens (50 GB), 49.6 GB stored, a 0.9 GB file — exactly what api-client attaches as
    // err.code / err.body when the API answers 413.
    const body = {
      code: 'STORAGE_QUOTA_EXCEEDED',
      message: 'This file needs 0.9 GB; 0.4 GB of your 50 GB is left — delete unused media or add screens.',
      usedBytes: 53257594470,
      includedBytes: 53687091200,
      neededBytes: 966367642,
    };
    const h = harness();
    h.postJson.mockImplementationOnce(async () => {
      const e = new Error(body.message) as Error & { status?: number; code?: string; body?: unknown };
      e.status = 413;
      e.code = body.code;
      e.body = body;
      throw e;
    });
    const err = await uploadAssetDirect(file(10), { deps: h.deps }).catch((e) => e);
    expect(err).toBeInstanceOf(DirectUploadError);
    expect(err.code).toBe('too-large');
    expect(err.source).toBe('api');
    expect(err.apiCode).toBe('STORAGE_QUOTA_EXCEEDED');
    expect(err.apiBody).toEqual(body);
    // Nothing was sent and nothing registered: the refusal came before a byte moved.
    expect(h.server.puts).toBe(0);
  });
});

describe('helpers', () => {
  it('maxUploadBytesFor: 2 GB for video, 500 MB for the rest', () => {
    expect(maxUploadBytesFor({ type: 'video/mp4' })).toBe(2 ** 31 - 1);
    expect(maxUploadBytesFor({ name: 'clip.webm' })).toBe(2 ** 31 - 1);
    expect(maxUploadBytesFor({ type: 'image/png' })).toBe(500 * MB);
    expect(formatUploadCap(2 ** 31 - 1)).toBe('2 GB');
    expect(formatUploadCap(500 * MB)).toBe('500 MB');
  });
  it('jwtExpiryMs reads exp without verifying; garbage is null', () => {
    expect(jwtExpiryMs(jwt(1234))).toBe(1_234_000);
    expect(jwtExpiryMs('nope')).toBeNull();
    expect(jwtExpiryMs(undefined)).toBeNull();
  });
  it('tusMetadata base64-encodes UTF-8 values', () => {
    expect(tusMetadata({ objectName: 'a/b.mp4', name: 'é' })).toBe(`objectName ${btoa('a/b.mp4')},name ${btoa('\xc3\xa9')}`);
  });
});
