/**
 * direct-upload.ts — every media upload in the dashboard goes browser → Supabase
 * Storage DIRECTLY, never through the API (2026-09-23, 4K video).
 *
 *   1. POST /assets/presign        → a fresh object path + a token that can write ONLY it
 *   2. bytes → Supabase:
 *        • > 6 MB: TUS RESUMABLE (`/storage/v1/upload/resumable/sign`, 6 MB chunks, the token
 *          as `x-signature`). A dropped connection resumes from the last chunk the server
 *          acknowledged; a token about to expire is renewed mid-upload (POST
 *          /assets/presign/renew — bound to this user, tenant and path by a server ticket);
 *        • ≤ 6 MB, or when TUS is unreachable before a single byte landed: one signed PUT.
 *   3. POST /assets/complete-upload → the server re-checks the REAL stored size and type,
 *      creates the Asset and queues the signage transcode for a video. Idempotent for
 *      this user's own retry, so a lost response is safe to re-send.
 *
 * The API never holds the bytes (it used to buffer every upload in its RAM — the same
 * process that delivers lockdown alerts), so the ceiling is storage's: 2 GB for video.
 * The service-role key never reaches the browser; the token authorises one object.
 *
 * XMLHttpRequest, not fetch: it is the only browser API with UPLOAD progress events, which
 * is what makes a 1.5 GB upload's bar move on a phone. Safari/iOS 12+ compatible.
 */
import { apiFetch } from '@/lib/api-client';

/** Supabase requires exactly 6 MB TUS chunks (the last one may be shorter). */
export const RESUMABLE_CHUNK_BYTES = 6 * 1024 * 1024;
/** Mirrors the API: video up to 2 GiB − 1 byte on the direct path. */
export const MAX_DIRECT_VIDEO_BYTES = 2 * 1024 * 1024 * 1024 - 1;
/** Everything else keeps the old outer cap (the server applies the tighter per-type caps). */
export const MAX_DIRECT_OTHER_BYTES = 500 * 1024 * 1024;

/** The client-side ceiling for a file (the server re-checks the real stored bytes). */
export function maxUploadBytesFor(file: { type?: string; name?: string }): number {
  const type = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  const isVideo = type.startsWith('video/') || /\.(mp4|m4v|webm)$/.test(name);
  return isVideo ? MAX_DIRECT_VIDEO_BYTES : MAX_DIRECT_OTHER_BYTES;
}

/** "2 GB" / "500 MB" — binary units, the way the rest of the app formats sizes. */
export function formatUploadCap(bytes: number): string {
  const GiB = 1024 * 1024 * 1024;
  if (bytes >= GiB - 1024 * 1024) return `${Math.round((bytes / GiB) * 10) / 10} GB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export interface DirectUploadProgress {
  loaded: number;
  total: number;
  /** 0–1 of the bytes sent to storage. */
  fraction: number;
}
export type DirectUploadPhase = 'preparing' | 'uploading' | 'reconnecting' | 'finalizing';

/** What `POST /assets/complete-upload` answers (AssetsController.completeUpload). */
export interface CompletedAsset {
  id: string;
  fileUrl: string;
  mimeType: string;
  fileSize: number | null;
  fileHash: string | null;
  originalName: string | null;
  status: string;
  altText: string | null;
  posterUrl: string | null;
}

export type DirectUploadErrorCode = 'too-large' | 'unsupported' | 'network' | 'storage' | 'server' | 'aborted' | 'expired';

export class DirectUploadError extends Error {
  constructor(
    readonly code: DirectUploadErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DirectUploadError';
  }
}

interface PresignResponse {
  uploadUrl?: string;
  signedUrl?: string;
  token?: string;
  storagePath: string;
  fileUrl: string;
  mimeType?: string;
  maxFileSize?: number;
  resumable?: {
    endpoint: string;
    bucketName: string;
    objectName: string;
    chunkSize: number;
    cacheControl: string;
  } | null;
  renewTicket?: string;
}

interface RenewResponse {
  token: string;
  signedUrl: string;
  uploadUrl?: string;
}

/** A minimal XHR result. `status` 0 = network / CORS failure. */
export interface XhrResult {
  status: number;
  header(name: string): string | null;
  body: string;
}

/** Test seams. Production uses the real API client, XMLHttpRequest and timers. */
export interface DirectUploadDeps {
  postJson<T>(path: string, body: Record<string, unknown>): Promise<T>;
  request(
    method: 'POST' | 'PATCH' | 'HEAD' | 'PUT',
    url: string,
    headers: Record<string, string>,
    body: Blob | null,
    onUploadProgress?: (loaded: number) => void,
    signal?: AbortSignal,
  ): Promise<XhrResult>;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  now(): number;
}

export interface DirectUploadOptions {
  folderId?: string | null;
  signal?: AbortSignal;
  onProgress?: (p: DirectUploadProgress) => void;
  onPhase?: (phase: DirectUploadPhase) => void;
  deps?: Partial<DirectUploadDeps>;
}

/** Backoff between attempts that made NO progress (reset whenever the server accepts bytes). */
export const RESUME_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000, 30_000, 30_000];
/** Renew the storage token when it has less than this left. */
const RENEW_MARGIN_MS = 5 * 60_000;

function xhrRequest(
  method: 'POST' | 'PATCH' | 'HEAD' | 'PUT',
  url: string,
  headers: Record<string, string>,
  body: Blob | null,
  onUploadProgress?: (loaded: number) => void,
  signal?: AbortSignal,
): Promise<XhrResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const done = (status: number) =>
      resolve({
        status,
        header: (n) => {
          try {
            return xhr.getResponseHeader(n);
          } catch {
            return null;
          }
        },
        body: typeof xhr.responseText === 'string' ? xhr.responseText : '',
      });
    xhr.open(method, url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    if (onUploadProgress && xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable || e.loaded) onUploadProgress(e.loaded);
      };
    }
    xhr.onload = () => done(xhr.status);
    xhr.onerror = () => done(0);
    xhr.ontimeout = () => done(0);
    xhr.onabort = () => done(-1);
    if (signal) {
      if (signal.aborted) {
        done(-1);
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(body);
  });
}

const realDeps: DirectUploadDeps = {
  postJson: <T,>(path: string, body: Record<string, unknown>) =>
    apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  request: xhrRequest,
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(t);
        resolve();
      }, { once: true });
    }),
  now: () => Date.now(),
};

/** `exp` (ms) of a JWT, unverified — only to know when to renew. null = unreadable. */
export function jwtExpiryMs(token: string | undefined | null): number | null {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = JSON.parse(json)?.exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** TUS Upload-Metadata: comma-separated `key base64(utf8 value)`. */
export function tusMetadata(meta: Record<string, string>): string {
  return Object.entries(meta)
    .map(([k, v]) => {
      // UTF-8 bytes as a binary string (no TextEncoder dependency), then base64.
      const bin = encodeURIComponent(v).replace(/%([0-9A-F]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
      return `${k} ${btoa(bin)}`;
    })
    .join(',');
}

const isSignatureProblem = (r: XhrResult) =>
  (r.status === 400 || r.status === 401 || r.status === 403) && /signature|jwt|expired|jws|unauthori[sz]ed/i.test(r.body || '');

function mapApiError(e: any): DirectUploadError {
  if (e instanceof DirectUploadError) return e;
  const status = typeof e?.status === 'number' ? e.status : undefined;
  const message = e?.message || 'Upload failed.';
  if (status === 413) return new DirectUploadError('too-large', message, status);
  if (status === 415) return new DirectUploadError('unsupported', message, status);
  return new DirectUploadError('server', message, status);
}

/**
 * Upload one file to the media library, directly to storage. Resolves with the
 * created asset; rejects with a DirectUploadError whose `code` a component maps
 * to its own (translated) words.
 */
export async function uploadAssetDirect(file: File, opts: DirectUploadOptions = {}): Promise<CompletedAsset> {
  const deps: DirectUploadDeps = { ...realDeps, ...(opts.deps || {}) };
  const total = file.size;
  const report = (loaded: number) =>
    opts.onProgress?.({ loaded: Math.min(loaded, total), total, fraction: total > 0 ? Math.min(1, loaded / total) : 1 });
  const aborted = () => {
    if (opts.signal?.aborted) throw new DirectUploadError('aborted', 'Upload cancelled.');
  };
  const contentType = file.type || 'application/octet-stream';

  opts.onPhase?.('preparing');
  let presign: PresignResponse;
  try {
    presign = await deps.postJson<PresignResponse>('/assets/presign', {
      filename: file.name,
      contentType,
      size: file.size,
      folderId: opts.folderId ?? null,
    });
  } catch (e) {
    throw mapApiError(e);
  }
  aborted();
  const storedType = presign.mimeType || contentType;

  // ── token lifecycle (TUS re-checks it on every chunk) ────────────────────
  let token = presign.token || '';
  let signedUrl = presign.uploadUrl || presign.signedUrl || '';
  let tokenExpiry = jwtExpiryMs(token) ?? deps.now() + 50 * 60_000;
  let renewing: Promise<boolean> | null = null;
  const renew = (): Promise<boolean> => {
    if (!presign.renewTicket) return Promise.resolve(false);
    if (!renewing) {
      renewing = deps
        .postJson<RenewResponse>('/assets/presign/renew', { storagePath: presign.storagePath, renewTicket: presign.renewTicket })
        .then((r) => {
          if (!r?.token) return false;
          token = r.token;
          signedUrl = r.uploadUrl || r.signedUrl || signedUrl;
          tokenExpiry = jwtExpiryMs(token) ?? deps.now() + 50 * 60_000;
          return true;
        })
        .catch(() => false)
        .finally(() => {
          renewing = null;
        });
    }
    return renewing;
  };
  const freshToken = async () => {
    if (tokenExpiry - deps.now() < RENEW_MARGIN_MS) await renew();
  };

  // ── single signed PUT ─────────────────────────────────────────────────────
  const putOnce = async (): Promise<void> => {
    let attempt = 0;
    for (;;) {
      aborted();
      report(0);
      const r = await deps.request(
        'PUT',
        signedUrl,
        {
          'Content-Type': storedType,
          // SUPABASE EGRESS FIX (2026-05-23): without it a signed-URL upload is
          // stored `no-cache` and every screen re-downloads it on every play.
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
        file,
        report,
        opts.signal,
      );
      if (r.status === -1) throw new DirectUploadError('aborted', 'Upload cancelled.');
      if (r.status >= 200 && r.status < 300) {
        report(total);
        return;
      }
      if (r.status === 413) throw new DirectUploadError('too-large', 'Storage refused the file as too large.', 413);
      if (r.status === 415 || /mime type/i.test(r.body)) throw new DirectUploadError('unsupported', 'Storage refused this file type.', r.status);
      if (isSignatureProblem(r) && attempt === 0 && (await renew())) {
        attempt += 1;
        continue;
      }
      if (r.status === 0 && attempt < 1) {
        attempt += 1;
        opts.onPhase?.('reconnecting');
        await deps.sleep(2_000, opts.signal);
        opts.onPhase?.('uploading');
        continue;
      }
      throw new DirectUploadError(r.status === 0 ? 'network' : 'storage', `Storage upload failed (${r.status}).`, r.status);
    }
  };

  // ── TUS resumable ─────────────────────────────────────────────────────────
  /** Returns 'fallback' when TUS was unusable before a single byte landed. */
  const tus = async (): Promise<'done' | 'fallback'> => {
    const r = presign.resumable!;
    const chunk = r.chunkSize > 0 ? r.chunkSize : RESUMABLE_CHUNK_BYTES;
    const base = { 'Tus-Resumable': '1.0.0' };
    await freshToken();
    // 1. create
    let create = await deps.request(
      'POST',
      r.endpoint,
      {
        ...base,
        'x-signature': token,
        'Upload-Length': String(total),
        'Upload-Metadata': tusMetadata({
          bucketName: r.bucketName,
          objectName: r.objectName,
          contentType: storedType,
          cacheControl: r.cacheControl || '31536000',
        }),
      },
      null,
      undefined,
      opts.signal,
    );
    if (create.status === -1) throw new DirectUploadError('aborted', 'Upload cancelled.');
    if (isSignatureProblem(create) && (await renew())) {
      create = await deps.request(
        'POST',
        r.endpoint,
        {
          ...base,
          'x-signature': token,
          'Upload-Length': String(total),
          'Upload-Metadata': tusMetadata({
            bucketName: r.bucketName,
            objectName: r.objectName,
            contentType: storedType,
            cacheControl: r.cacheControl || '31536000',
          }),
        },
        null,
        undefined,
        opts.signal,
      );
    }
    if (create.status === 413) throw new DirectUploadError('too-large', 'Storage refused the file as too large.', 413);
    if (create.status === 415 || /mime type/i.test(create.body)) throw new DirectUploadError('unsupported', 'Storage refused this file type.', create.status);
    const location = create.status === 201 ? create.header('Location') : null;
    if (!location) return 'fallback'; // TUS unreachable or refused before any byte — use the single PUT
    const uploadUrl = new URL(location, r.endpoint).toString();

    // 2. send chunks; resume from the server's offset after any failure
    let offset = 0;
    let stalls = 0;
    report(0);
    while (offset < total) {
      aborted();
      await freshToken();
      const end = Math.min(offset + chunk, total);
      const res = await deps.request(
        'PATCH',
        uploadUrl,
        {
          ...base,
          'x-signature': token,
          'Upload-Offset': String(offset),
          'Content-Type': 'application/offset+octet-stream',
        },
        file.slice(offset, end),
        (loaded) => report(offset + loaded),
        opts.signal,
      );
      if (res.status === -1) throw new DirectUploadError('aborted', 'Upload cancelled.');
      if (res.status === 204 || res.status === 200) {
        const next = Number(res.header('Upload-Offset'));
        offset = Number.isFinite(next) && next > offset ? next : end;
        stalls = 0;
        report(offset);
        opts.onPhase?.('uploading');
        continue;
      }
      if (res.status === 413) throw new DirectUploadError('too-large', 'Storage refused the file as too large.', 413);
      if (res.status === 404 || res.status === 410) throw new DirectUploadError('expired', 'The upload expired on the storage side.', res.status);
      if (isSignatureProblem(res)) {
        // The token expired mid-upload: renew and resend this chunk at once.
        if (await renew()) continue;
        throw new DirectUploadError('expired', 'The upload could not be continued.', res.status);
      }
      // Network drop, 409 (offset mismatch), 423 (locked), 429, 5xx: back off, then ask
      // the server where it got to and carry on from there.
      stalls += 1;
      if (stalls > RESUME_DELAYS_MS.length) {
        throw new DirectUploadError('network', 'The connection dropped and the upload could not resume.', res.status);
      }
      opts.onPhase?.('reconnecting');
      await deps.sleep(RESUME_DELAYS_MS[stalls - 1], opts.signal);
      aborted();
      await freshToken();
      const head = await deps.request('HEAD', uploadUrl, { ...base, 'x-signature': token }, null, undefined, opts.signal);
      if (head.status === -1) throw new DirectUploadError('aborted', 'Upload cancelled.');
      if (head.status === 404 || head.status === 410) throw new DirectUploadError('expired', 'The upload expired on the storage side.', head.status);
      const at = Number(head.header('Upload-Offset'));
      if ((head.status === 200 || head.status === 204) && Number.isFinite(at) && at >= 0 && at <= total) {
        // Bytes that landed before the connection dropped count as progress.
        if (at > offset) stalls = 0;
        offset = at;
        report(offset);
      }
    }
    return 'done';
  };

  opts.onPhase?.('uploading');
  const useTus = !!presign.resumable?.endpoint && total > RESUMABLE_CHUNK_BYTES;
  if (useTus) {
    const how = await tus();
    if (how === 'fallback') await putOnce();
  } else {
    await putOnce();
  }
  aborted();

  // ── register (idempotent for this user's own retry) ────────────────────────
  opts.onPhase?.('finalizing');
  try {
    return await deps.postJson<CompletedAsset>('/assets/complete-upload', {
      storagePath: presign.storagePath,
      filename: file.name,
      contentType: storedType,
      size: file.size,
      folderId: opts.folderId ?? null,
    });
  } catch (e) {
    throw mapApiError(e);
  }
}
