/**
 * storage-stream.ts — move WHOLE objects between Supabase Storage and local
 * disk without ever holding them in memory (2026-09-23, large-video wave).
 *
 * Every other object path in this codebase buffers: `download()` returns a
 * Buffer, `uploadToBucket()` builds a Blob, and the transport's node:https
 * fallback (storage-transport.ts) collects the whole response. That is fine
 * for a 25 MB image and fatal for a 2 GB video — the API container would hold
 * the file (twice, briefly) while it is also the process that delivers
 * lockdown alerts. The transcode worker therefore streams:
 *
 *   storage ──GET──▶ hash + byte-count ──▶ temp file      (streamDownloadToFile)
 *   temp file ──POST (Content-Length)──▶ storage          (streamUploadFile)
 *
 * Plain node:https (http for a local dev URL), NOT undici fetch: node:https is
 * the transport this codebase has already proven from the production
 * container (storage-transport.ts header, the 2026-07-31 "fetch failed"
 * incident), and it pipes a file stream with no buffering. Both directions
 * are bounded by an INACTIVITY timeout (a stalled socket is the hang signal;
 * a 2 GB transfer legitimately takes minutes), an optional AbortSignal, and —
 * for downloads — a hard byte budget, so a surprise-sized object can never
 * fill the disk.
 */
import * as http from 'node:http';
import * as https from 'node:https';
import { createHash } from 'crypto';
import { createReadStream, createWriteStream, promises as fs } from 'fs';
import { Transform, type TransformCallback } from 'stream';
import { pipeline } from 'stream/promises';

/** Default inactivity budget for one streamed transfer. */
export const STREAM_INACTIVITY_MS = 120_000;

export interface StreamDownloadResult {
  bytes: number;
  sha256: string;
  contentType: string | null;
}

export class StreamTransferError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: 'http' | 'budget' | 'aborted' | 'timeout' | 'network',
  ) {
    super(message);
    this.name = 'StreamTransferError';
  }
}

function clientFor(url: URL): typeof https | typeof http {
  return url.protocol === 'http:' ? http : https;
}

/** Collect a SMALL error body (capped) so a failure message can say why. */
function readSmallBody(res: http.IncomingMessage, cap = 4096): Promise<string> {
  return new Promise((resolve) => {
    let out = '';
    res.setEncoding('utf8');
    res.on('data', (c: string) => {
      if (out.length < cap) out += c.slice(0, cap - out.length);
    });
    res.on('end', () => resolve(out));
    res.on('error', () => resolve(out));
  });
}

/** Counts and hashes bytes as they pass; errors the moment the budget is exceeded. */
class MeterTransform extends Transform {
  bytes = 0;
  readonly hash = createHash('sha256');
  constructor(private readonly maxBytes: number) {
    super();
  }
  _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.bytes += chunk.length;
    if (this.bytes > this.maxBytes) {
      cb(
        new StreamTransferError(
          `download exceeded its ${this.maxBytes}-byte budget`,
          null,
          'budget',
        ),
      );
      return;
    }
    this.hash.update(chunk);
    cb(null, chunk);
  }
}

/**
 * GET `url` to `destPath`. Resolves with the byte count, the SHA-256 of
 * exactly the bytes written, and the response content-type. Rejects (and
 * removes the partial file) on a non-200, a blown byte budget, an abort, or
 * an inactivity timeout.
 */
export async function streamDownloadToFile(
  urlStr: string,
  headers: Record<string, string>,
  destPath: string,
  opts: { maxBytes: number; inactivityMs?: number; signal?: AbortSignal },
): Promise<StreamDownloadResult> {
  const url = new URL(urlStr);
  const inactivityMs = opts.inactivityMs ?? STREAM_INACTIVITY_MS;
  const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const req = clientFor(url).request(
      url,
      { method: 'GET', headers, signal: opts.signal },
      resolve,
    );
    req.setTimeout(inactivityMs, () =>
      req.destroy(
        new StreamTransferError(
          `download stalled for ${inactivityMs}ms`,
          null,
          'timeout',
        ),
      ),
    );
    req.on('error', (e: any) =>
      reject(
        e instanceof StreamTransferError
          ? e
          : new StreamTransferError(
              `download failed: ${e?.message ?? e}`,
              null,
              opts.signal?.aborted ? 'aborted' : 'network',
            ),
      ),
    );
    req.end();
  });

  const status = res.statusCode ?? 0;
  if (status !== 200) {
    const body = await readSmallBody(res);
    throw new StreamTransferError(
      `download returned ${status}: ${body.slice(0, 300)}`,
      status,
      'http',
    );
  }
  res.setTimeout?.(inactivityMs, () =>
    res.destroy(
      new StreamTransferError(
        `download stalled for ${inactivityMs}ms`,
        null,
        'timeout',
      ),
    ),
  );
  const meter = new MeterTransform(opts.maxBytes);
  try {
    await pipeline(res, meter, createWriteStream(destPath));
  } catch (e: any) {
    await fs.rm(destPath, { force: true }).catch(() => undefined);
    if (e instanceof StreamTransferError) throw e;
    throw new StreamTransferError(
      `download interrupted: ${e?.message ?? e}`,
      null,
      opts.signal?.aborted ? 'aborted' : 'network',
    );
  }
  const ct = res.headers['content-type'];
  return {
    bytes: meter.bytes,
    sha256: meter.hash.digest('hex'),
    contentType: typeof ct === 'string' ? ct : null,
  };
}

/**
 * POST (or PUT) the file at `srcPath` to `url` with an exact Content-Length,
 * streamed from disk. Resolves `{ status, body }` for ANY HTTP status (the
 * caller decides what a non-2xx means); rejects only on a network failure,
 * an abort, or an inactivity timeout.
 */
export async function streamUploadFile(
  urlStr: string,
  headers: Record<string, string>,
  srcPath: string,
  opts: {
    method?: 'POST' | 'PUT';
    inactivityMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<{ status: number; body: string }> {
  const url = new URL(urlStr);
  const inactivityMs = opts.inactivityMs ?? STREAM_INACTIVITY_MS;
  const { size } = await fs.stat(srcPath);
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (e: any) => {
      if (settled) return;
      settled = true;
      reject(
        e instanceof StreamTransferError
          ? e
          : new StreamTransferError(
              `upload failed: ${e?.message ?? e}`,
              null,
              opts.signal?.aborted ? 'aborted' : 'network',
            ),
      );
    };
    const req = clientFor(url).request(
      url,
      {
        method: opts.method ?? 'POST',
        headers: { ...headers, 'content-length': String(size) },
        signal: opts.signal,
      },
      (res) => {
        void readSmallBody(res).then((body) => {
          if (settled) return;
          settled = true;
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.setTimeout(inactivityMs, () =>
      req.destroy(
        new StreamTransferError(
          `upload stalled for ${inactivityMs}ms`,
          null,
          'timeout',
        ),
      ),
    );
    req.on('error', fail);
    const src = createReadStream(srcPath);
    src.on('error', (e) => {
      req.destroy(e);
      fail(e);
    });
    src.pipe(req);
  });
}

/** SHA-256 of a file, streamed. */
export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(
    createReadStream(path),
    async (source: AsyncIterable<Buffer>) => {
      for await (const chunk of source) hash.update(chunk);
    },
  );
  return hash.digest('hex');
}
