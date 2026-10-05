/**
 * SupabaseStorageService.readObjectRange (2026-10-05): a few KB of an object —
 * a PDF's head and tail for the upload content check — never the whole object,
 * and never anything but the bytes asked for. Driven against a local http
 * stand-in for the Storage REST endpoint.
 */
import * as http from 'http';
import type { AddressInfo } from 'net';
import { SupabaseStorageService } from './supabase-storage.service';

const OBJECT = Buffer.from(
  '%PDF-1.4\n' + 'x'.repeat(5000) + '\ntrailer\n%%EOF\n',
  'latin1',
);

type Behaviour = 'range' | 'ignore-range' | 'missing' | 'stall';

describe('readObjectRange', () => {
  let server: http.Server;
  let behaviour: Behaviour = 'range';
  const seen: Array<{ url: string; range?: string; auth?: string }> = [];
  const env = {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      seen.push({
        url: req.url || '',
        range: req.headers.range,
        auth: req.headers.authorization,
      });
      if (behaviour === 'missing') {
        res.statusCode = 404;
        res.end('{"error":"not_found"}');
        return;
      }
      if (behaviour === 'stall') {
        res.statusCode = 206;
        res.setHeader('Content-Length', '1024');
        res.flushHeaders();
        return; // never a byte
      }
      const m = /^bytes=(\d+)-(\d+)$/.exec(String(req.headers.range || ''));
      if (behaviour === 'ignore-range' || !m) {
        res.statusCode = 200;
        res.end(OBJECT);
        return;
      }
      const start = Number(m[1]);
      const end = Math.min(OBJECT.length - 1, Number(m[2]));
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${OBJECT.length}`);
      res.end(OBJECT.subarray(start, end + 1));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    process.env.SUPABASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  });

  afterAll(async () => {
    process.env.SUPABASE_URL = env.url;
    process.env.SUPABASE_SERVICE_ROLE_KEY = env.key;
    if (env.url === undefined) delete process.env.SUPABASE_URL;
    if (env.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    // A stalled response keeps its socket open: drop every connection, then close.
    server.closeAllConnections?.();
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => {
    behaviour = 'range';
    seen.length = 0;
  });

  const storage = () => new SupabaseStorageService();

  it('a 206 answers exactly the bytes asked for, with a service-role Range GET', async () => {
    const head = await storage().readObjectRange('t/a.pdf', 0, 1023);
    expect(head?.length).toBe(1024);
    expect(head?.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const tail = await storage().readObjectRange(
      't/a.pdf',
      OBJECT.length - 16,
      OBJECT.length - 1,
    );
    expect(tail?.toString('latin1')).toBe(
      OBJECT.subarray(OBJECT.length - 16).toString('latin1'),
    );
    expect(seen[0]).toEqual({
      url: '/storage/v1/object/assets/t/a.pdf',
      range: 'bytes=0-1023',
      auth: 'Bearer test-service-key',
    });
  });

  it('a server that ignores the Range: from 0 the body is cut at the length asked for …', async () => {
    behaviour = 'ignore-range';
    const head = await storage().readObjectRange('t/a.pdf', 0, 99);
    expect(head?.length).toBe(100);
  });

  it('… and anywhere else it is refused (null) — the head of the file is never passed off as its tail', async () => {
    behaviour = 'ignore-range';
    expect(await storage().readObjectRange('t/a.pdf', 4000, 4999)).toBeNull();
  });

  it('a missing object, a stalled read and a nonsense range are all null — never a throw', async () => {
    behaviour = 'missing';
    expect(await storage().readObjectRange('t/a.pdf', 0, 9)).toBeNull();
    behaviour = 'stall';
    const started = Date.now();
    expect(await storage().readObjectRange('t/a.pdf', 0, 9, 150)).toBeNull();
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(await storage().readObjectRange('t/a.pdf', 10, 5)).toBeNull();
    expect(await storage().readObjectRange('t/a.pdf', -1, 5)).toBeNull();
  });

  it('storage not configured: null', async () => {
    const url = process.env.SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    try {
      expect(await storage().readObjectRange('t/a.pdf', 0, 9)).toBeNull();
    } finally {
      process.env.SUPABASE_URL = url;
    }
  });
});
