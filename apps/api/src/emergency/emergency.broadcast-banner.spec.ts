/**
 * BROADCAST BANNER OPTIONS (2026-11-01) - colour + scrolling/static.
 *
 * Proves, against the REAL controller on the shared targeting world:
 *   - validation: strict body schema; bad hex / mode / speed refused;
 *   - sanitising: a hex is stored canonical (#rrggbb, lower case); hostile
 *     strings never reach the row, the push or the poll;
 *   - delivery: the options travel in the signed push AND the device poll
 *     (the fallback tier), for tenant, group and hand-picked-screen sends;
 *   - scope: CRITICAL ignores the options; a send without them is byte for
 *     byte what it was before (no `banner` key anywhere).
 *   - text size (2026-11-23): small / large are accepted, stored and carried
 *     in the signed push and the poll for every path a banner travels
 *     (tenant, district copies, group, hand-picked screens); medium is the
 *     absence of the key, so a medium send is byte for byte an older one.
 */
import { BroadcastInputSchema, normalizeHex, sanitizeBannerOptions } from '@cms/api-types';
import { makeWorld, DISTRICT, SCHOOL, SIBLING, GYM, schoolAdmin, districtAdmin } from './emergency.targeting.world';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

type Row = Record<string, any>;

function matches(row: Row, where: Row): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === 'OR') { if (!(v as Row[]).some((c) => matches(row, c))) return false; continue; }
    if (k === 'AND') { if (!(v as Row[]).every((c) => matches(row, c))) return false; continue; }
    const cell = row[k];
    if (v === null) { if (cell !== null && cell !== undefined) return false; continue; }
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const op = v as Row;
      if ('in' in op && !op.in.includes(cell)) return false;
      if ('has' in op && !(Array.isArray(cell) && cell.includes(op.has))) return false;
      if ('gt' in op && !(cell instanceof Date && cell.getTime() > op.gt.getTime())) return false;
      continue;
    }
    if (cell !== v) return false;
  }
  return true;
}

function world() {
  const w = makeWorld();
  const rows: Row[] = [];
  Object.assign(w.client.emergencyMessage, {
    create: jest.fn(async ({ data }: any) => {
      const r = { createdAt: new Date(), clearedAt: null, mediaUrls: null, audioUrl: null, ...data };
      rows.push(r);
      return r;
    }),
    findUnique: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
    findMany: jest.fn(async ({ where }: any) => rows.filter((r) => matches(r, where))),
  });
  const polled = async (screenId: string): Promise<Row[]> => {
    const res: any = await w.emergency.deviceMessages({ user: { kind: 'device', sub: screenId } } as any);
    return res.active;
  };
  const pushes = () => (w.redis.publish as jest.Mock).mock.calls.map((c) => c[1] as Row);
  return { ...w, rows, polled, pushes };
}

const send = (extra: Row = {}) =>
  ({ scopeType: 'tenant', scopeId: SCHOOL, text: 'Early dismissal at 1 pm', severity: 'INFO', ...extra }) as any;

describe('BroadcastInputSchema banner field', () => {
  const base = { scopeType: 'tenant', scopeId: SCHOOL, text: 'hi', severity: 'INFO' };
  it('accepts a colour, mode and speed', () => {
    const r = BroadcastInputSchema.safeParse({ ...base, banner: { color: '#1D4ED8', mode: 'scroll', speed: 'fast' } });
    expect(r.success).toBe(true);
  });
  it('accepts a request with no banner (older clients)', () => {
    expect(BroadcastInputSchema.safeParse(base).success).toBe(true);
  });
  it.each([
    [{ color: 'red' }],
    [{ color: 'url(javascript:alert(1))' }],
    [{ color: '#12' }],
    [{ color: '#gggggg' }],
    [{ color: '#1234567' }],
    [{ mode: 'blink' }],
    [{ speed: 'warp' }],
    [{ color: '#fff', extra: 1 }],
  ])('refuses %j', (banner) => {
    expect(BroadcastInputSchema.safeParse({ ...base, banner }).success).toBe(false);
  });
});

describe('hex sanitising', () => {
  it.each([
    ['#ABC', '#aabbcc'],
    ['1d4ed8', '#1d4ed8'],
    [' #1D4ED8 ', '#1d4ed8'],
  ])('%s -> %s', (input, out) => expect(normalizeHex(input)).toBe(out));
  it.each(['', 'red', '#12', '#12345', '#1234567', 'rgb(0,0,0)', '#zzz', null, 42, undefined])('rejects %p', (v) => {
    expect(normalizeHex(v)).toBeNull();
  });
  it('sanitizeBannerOptions drops hostile values and defaults the rest', () => {
    expect(sanitizeBannerOptions({ color: 'expression(x)', mode: 'scroll', speed: 'bogus', extra: 1 })).toEqual({ mode: 'scroll', speed: 'normal' });
    expect(sanitizeBannerOptions({ color: '#FFF' })).toEqual({ color: '#ffffff', mode: 'static', speed: 'normal' });
    expect(sanitizeBannerOptions({})).toBeNull();
    expect(sanitizeBannerOptions('x')).toBeNull();
    expect(sanitizeBannerOptions(null)).toBeNull();
  });
});

describe('banner options delivery', () => {
  it('stores the sanitised options and delivers them in the push AND the poll', async () => {
    const w = world();
    await w.emergency.broadcastText(send({ banner: { color: '#1D4ED8', mode: 'scroll', speed: 'slow' } }), schoolAdmin);
    const expected = { color: '#1d4ed8', mode: 'scroll', speed: 'slow' };
    expect(w.rows[0].bannerStyle).toEqual(expected);
    expect(w.pushes()[0].payload.banner).toEqual(expected);
    const view = (await w.polled('lobby'))[0];
    expect(view.banner).toEqual(expected);
    expect(view.type).toBe('TEXT_BROADCAST');
  });

  it('works for a group send and for a hand-picked set of screens', async () => {
    const g = world();
    await g.emergency.broadcastText(send({ scopeType: 'group', scopeId: GYM, banner: { color: '#15803d', mode: 'static' } }), schoolAdmin);
    expect((await g.polled('gym-1'))[0].banner).toEqual({ color: '#15803d', mode: 'static', speed: 'normal' });
    expect(g.pushes()[0].payload.banner).toEqual({ color: '#15803d', mode: 'static', speed: 'normal' });

    const s = world();
    await s.emergency.broadcastText(send({ screenIds: ['lobby', 'office'], banner: { mode: 'scroll', speed: 'fast' } }), schoolAdmin);
    expect(s.rows[0].bannerStyle).toEqual({ mode: 'scroll', speed: 'fast' });
    expect((await s.polled('office'))[0].banner).toEqual({ mode: 'scroll', speed: 'fast' });
    expect(s.pushes()[0].payload.banner).toEqual({ mode: 'scroll', speed: 'fast' });
  });

  it('a send without options is unchanged: no banner key on the row, push or poll', async () => {
    const w = world();
    await w.emergency.broadcastText(send(), schoolAdmin);
    expect('bannerStyle' in w.rows[0]).toBe(false);
    expect('banner' in w.pushes()[0].payload).toBe(false);
    expect('banner' in (await w.polled('lobby'))[0]).toBe(false);
  });

  it('CRITICAL ignores the options everywhere', async () => {
    const w = world();
    await w.emergency.broadcastText(send({ severity: 'CRITICAL', banner: { color: '#15803d', mode: 'scroll' } }), schoolAdmin);
    expect('bannerStyle' in w.rows[0]).toBe(false);
    expect('banner' in w.pushes()[0].payload).toBe(false);
    expect('banner' in (await w.polled('lobby'))[0]).toBe(false);
  });

  it('re-sanitises a stored value on the way out (a tampered row cannot inject)', async () => {
    const w = world();
    await w.emergency.broadcastText(send({ banner: { color: '#1d4ed8' } }), schoolAdmin);
    w.rows[0].bannerStyle = { color: 'url(//evil)', mode: 'scroll', speed: 'x' };
    expect((await w.polled('lobby'))[0].banner).toEqual({ mode: 'scroll', speed: 'normal' });
  });
});

describe('banner text size (2026-11-23)', () => {
  const base = { scopeType: 'tenant', scopeId: SCHOOL, text: 'hi', severity: 'INFO' };
  it('the request schema accepts small / medium / large and refuses anything else', () => {
    for (const size of ['small', 'medium', 'large']) {
      expect(BroadcastInputSchema.safeParse({ ...base, banner: { mode: 'scroll', speed: 'slow', size } }).success).toBe(true);
    }
    for (const size of ['huge', 'LARGE', '', 3]) {
      expect(BroadcastInputSchema.safeParse({ ...base, banner: { mode: 'scroll', size } }).success).toBe(false);
    }
  });

  it('a tenant send stores the size and carries it in the signed push AND the poll', async () => {
    const w = world();
    await w.emergency.broadcastText(send({ banner: { mode: 'scroll', speed: 'slow', size: 'large' } }), schoolAdmin);
    const expected = { mode: 'scroll', speed: 'slow', size: 'large' };
    expect(w.rows[0].bannerStyle).toEqual(expected);
    const push = w.pushes()[0];
    expect(push.type).toBe('TEXT_BROADCAST');
    expect(push.signature).toEqual(expect.any(String));
    expect(push.payload.banner).toEqual(expected);
    expect((await w.polled('lobby'))[0].banner).toEqual(expected);
  });

  it('every district copy carries the size: one row, one push and one poll answer per school', async () => {
    const w = world();
    const res: any = await w.emergency.broadcastText(
      send({ scopeId: DISTRICT, banner: { color: '#15803d', mode: 'static', size: 'small' } }),
      districtAdmin,
    );
    const expected = { color: '#15803d', mode: 'static', speed: 'normal', size: 'small' };
    expect(res.affectedTenantIds).toEqual(expect.arrayContaining([DISTRICT, SCHOOL, SIBLING]));
    expect(w.rows.length).toBe(res.affectedTenantIds.length);
    for (const row of w.rows) expect(row.bannerStyle).toEqual(expected);
    const pushes = w.pushes();
    expect(pushes.length).toBe(res.affectedTenantIds.length);
    for (const p of pushes) expect(p.payload.banner).toEqual(expected);
    expect((await w.polled('lobby'))[0].banner).toEqual(expected); // school
    expect((await w.polled('sib-1'))[0].banner).toEqual(expected); // sibling school
    expect((await w.polled('district-1'))[0].banner).toEqual(expected); // the district itself
  });

  it('a group send and a hand-picked set of screens carry the size', async () => {
    const g = world();
    await g.emergency.broadcastText(send({ scopeType: 'group', scopeId: GYM, banner: { mode: 'static', size: 'large' } }), schoolAdmin);
    expect(g.rows[0].bannerStyle).toEqual({ mode: 'static', speed: 'normal', size: 'large' });
    expect(g.pushes()[0].payload.banner).toEqual({ mode: 'static', speed: 'normal', size: 'large' });
    expect((await g.polled('gym-1'))[0].banner).toEqual({ mode: 'static', speed: 'normal', size: 'large' });

    const s = world();
    await s.emergency.broadcastText(send({ screenIds: ['lobby', 'office'], banner: { mode: 'scroll', speed: 'fast', size: 'small' } }), schoolAdmin);
    expect(s.rows[0].bannerStyle).toEqual({ mode: 'scroll', speed: 'fast', size: 'small' });
    for (const p of s.pushes()) expect(p.payload.banner).toEqual({ mode: 'scroll', speed: 'fast', size: 'small' });
    expect((await s.polled('office'))[0].banner).toEqual({ mode: 'scroll', speed: 'fast', size: 'small' });
  });

  it('medium is the absence of the key: an explicit medium send is byte for byte a send from before sizes', async () => {
    const a = world();
    await a.emergency.broadcastText(send({ banner: { mode: 'scroll', speed: 'slow', size: 'medium' } }), schoolAdmin);
    const b = world();
    await b.emergency.broadcastText(send({ banner: { mode: 'scroll', speed: 'slow' } }), schoolAdmin);
    expect(a.rows[0].bannerStyle).toEqual({ mode: 'scroll', speed: 'slow' });
    expect('size' in a.rows[0].bannerStyle).toBe(false);
    expect(JSON.stringify(a.rows[0].bannerStyle)).toBe(JSON.stringify(b.rows[0].bannerStyle));
    expect(JSON.stringify(a.pushes()[0].payload.banner)).toBe(JSON.stringify(b.pushes()[0].payload.banner));
    expect(JSON.stringify((await a.polled('lobby'))[0].banner)).toBe(JSON.stringify((await b.polled('lobby'))[0].banner));
  });

  it('CRITICAL ignores the size everywhere', async () => {
    const w = world();
    await w.emergency.broadcastText(send({ severity: 'CRITICAL', banner: { mode: 'static', size: 'large' } }), schoolAdmin);
    expect('bannerStyle' in w.rows[0]).toBe(false);
    expect('banner' in w.pushes()[0].payload).toBe(false);
    expect('banner' in (await w.polled('lobby'))[0]).toBe(false);
  });

  it('a stored size is re-sanitised on the way out (unknown = medium, never injected)', async () => {
    const w = world();
    await w.emergency.broadcastText(send({ banner: { mode: 'static', size: 'large' } }), schoolAdmin);
    w.rows[0].bannerStyle = { mode: 'static', speed: 'normal', size: '<script>' };
    expect((await w.polled('lobby'))[0].banner).toEqual({ mode: 'static', speed: 'normal' });
    w.rows[0].bannerStyle = { mode: 'static', speed: 'normal', size: 'medium' };
    expect('size' in (await w.polled('lobby'))[0].banner).toBe(false);
  });

  it('sanitizeBannerOptions keeps the canonical key order with a size', () => {
    expect(Object.keys(sanitizeBannerOptions({ size: 'large', speed: 'fast', mode: 'scroll', color: '#fff' })!)).toEqual(['color', 'mode', 'speed', 'size']);
  });
});
