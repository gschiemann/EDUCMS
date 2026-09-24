/**
 * storage-stream — whole-object transfers that never buffer (2026-09-23).
 * Driven against a real local HTTP server so the streaming, hashing, byte
 * budget and error paths run through actual sockets, not mocks.
 */
import * as http from 'node:http';
import { createHash, randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  streamDownloadToFile,
  streamUploadFile,
  sha256File,
  StreamTransferError,
} from './storage-stream';

const PAYLOAD = randomBytes(3 * 1024 * 1024 + 17); // odd size on purpose
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

let server: http.Server;
let base: string;
let received: { headers: http.IncomingHttpHeaders; bytes: Buffer } | null =
  null;
let dir: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-stream-spec-'));
  server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/ok') {
      res.writeHead(200, {
        'content-type': 'video/mp4',
        'content-length': String(PAYLOAD.length),
      });
      // Write in several chunks so the meter sees a real stream.
      let off = 0;
      const pump = () => {
        while (off < PAYLOAD.length) {
          const next = PAYLOAD.subarray(off, off + 256 * 1024);
          off += next.length;
          if (!res.write(next)) return void res.once('drain', pump);
        }
        res.end();
      };
      pump();
      return;
    }
    if (req.method === 'GET' && req.url === '/missing') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"error":"not_found"}');
      return;
    }
    if (req.method === 'GET' && req.url === '/stall') {
      res.writeHead(200, { 'content-type': 'video/mp4' });
      res.write(PAYLOAD.subarray(0, 1000)); // …and never finishes
      return;
    }
    if (req.method === 'POST' && req.url?.startsWith('/up')) {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        received = { headers: req.headers, bytes: Buffer.concat(chunks) };
        const status = req.url === '/up-reject' ? 413 : 200;
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(
          status === 200
            ? '{"Key":"assets/x"}'
            : '{"error":"Payload too large"}',
        );
      });
      return;
    }
    res.writeHead(500);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address() as any;
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((r) => server.close(() => r()));
  await fs.rm(dir, { recursive: true, force: true });
});

describe('streamDownloadToFile', () => {
  it('writes exactly the served bytes and hashes them as they pass', async () => {
    const dest = path.join(dir, 'ok.bin');
    const out = await streamDownloadToFile(
      `${base}/ok`,
      { authorization: 'Bearer x' },
      dest,
      { maxBytes: PAYLOAD.length },
    );
    expect(out.bytes).toBe(PAYLOAD.length);
    expect(out.sha256).toBe(sha(PAYLOAD));
    expect(out.contentType).toBe('video/mp4');
    expect(sha(await fs.readFile(dest))).toBe(sha(PAYLOAD));
  });

  it('aborts at the byte budget and removes the partial file (a surprise-size object cannot fill the disk)', async () => {
    const dest = path.join(dir, 'budget.bin');
    await expect(
      streamDownloadToFile(`${base}/ok`, {}, dest, { maxBytes: 1024 * 1024 }),
    ).rejects.toMatchObject({ code: 'budget' });
    await expect(fs.stat(dest)).rejects.toBeTruthy();
  });

  it('rejects a non-200 with its status and a short body', async () => {
    const err = await streamDownloadToFile(
      `${base}/missing`,
      {},
      path.join(dir, 'm.bin'),
      { maxBytes: 10 },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(StreamTransferError);
    expect(err.status).toBe(404);
    expect(err.message).toContain('not_found');
  });

  it('gives up on a stalled transfer after the inactivity budget', async () => {
    const err = await streamDownloadToFile(
      `${base}/stall`,
      {},
      path.join(dir, 's.bin'),
      {
        maxBytes: PAYLOAD.length,
        inactivityMs: 200,
      },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(StreamTransferError);
    expect(['timeout', 'network']).toContain(err.code);
  });
});

describe('streamUploadFile', () => {
  it('streams the file with an exact Content-Length and the caller’s headers', async () => {
    const src = path.join(dir, 'src.bin');
    await fs.writeFile(src, PAYLOAD);
    const res = await streamUploadFile(
      `${base}/up`,
      { 'content-type': 'video/mp4', 'x-upsert': 'true' },
      src,
    );
    expect(res.status).toBe(200);
    expect(received!.headers['content-length']).toBe(String(PAYLOAD.length));
    expect(received!.headers['content-type']).toBe('video/mp4');
    expect(sha(received!.bytes)).toBe(sha(PAYLOAD));
  });

  it('resolves (does not throw) on an HTTP rejection — the caller decides', async () => {
    const src = path.join(dir, 'src2.bin');
    await fs.writeFile(src, PAYLOAD.subarray(0, 1000));
    const res = await streamUploadFile(`${base}/up-reject`, {}, src);
    expect(res.status).toBe(413);
    expect(res.body).toContain('Payload too large');
  });
});

describe('sha256File', () => {
  it('matches an in-memory hash', async () => {
    const src = path.join(dir, 'h.bin');
    await fs.writeFile(src, PAYLOAD);
    expect(await sha256File(src)).toBe(sha(PAYLOAD));
  });
});
