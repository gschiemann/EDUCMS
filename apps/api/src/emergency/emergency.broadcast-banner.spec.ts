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
 */
import { BroadcastInputSchema, normalizeHex, sanitizeBannerOptions } from '@cms/api-types';
import { makeWorld, SCHOOL, GYM, schoolAdmin } from './emergency.targeting.world';

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
