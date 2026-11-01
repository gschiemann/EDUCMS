import {
  parseReferenceRates,
  ReferenceRatesService,
} from './reference-rates.service';
import { ReferenceRatesController } from './reference-rates.controller';
import { safeFetch } from '../branding/safe-fetch';
jest.mock('../branding/safe-fetch', () => ({ safeFetch: jest.fn() }));
const now = Date.parse('2026-10-29T12:00:00Z');
const xml = `<gesmes:Envelope><Cube><Cube time="2026-10-28"><Cube currency="USD" rate="1.1"/><Cube currency="GBP" rate="0.85"/><Cube currency="JPY" rate="170"/></Cube></Cube></gesmes:Envelope>`;
it('uses the actual business-day date and rejects stale or incomplete tables', () => {
  expect(parseReferenceRates(xml, now)).toMatchObject({
    date: '2026-10-28',
    rates: { EUR: 1, USD: 1.1, GBP: 0.85, JPY: 170 },
  });
  expect(() =>
    parseReferenceRates(xml.replace('2026-10-28', '2026-10-01'), now),
  ).toThrow();
  expect(() =>
    parseReferenceRates(xml.replace('2026-10-28', '2026-11-01'), now),
  ).toThrow();
  expect(() => parseReferenceRates('<html>no rates</html>', now)).toThrow();
});
it('coalesces upstream reads and converts reference rates without inventing intraday deltas', async () => {
  jest.useFakeTimers({ now });
  try {
    const cache = new Map<string, string>();
    const redis = {
      publisher: {
        get: async (k: string) => cache.get(k) || null,
        set: async (k: string, v: string) => {
          cache.set(k, v);
          return 'OK';
        },
      },
    };
    (safeFetch as jest.Mock).mockResolvedValue({
      status: 200,
      body: Buffer.from(xml),
    });
    const check = jest.fn();
    const service = new ReferenceRatesService(redis as any, { check } as any);
    const [usd, eur] = await Promise.all([
      service.get('USD'),
      service.get('EUR'),
    ]);
    expect(safeFetch as jest.Mock).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledTimes(1);
    expect(usd.rates.find((p) => p.code === 'EUR')!.rate).toBeCloseTo(1 / 1.1);
    expect(eur.rates.find((p) => p.code === 'USD')!.rate).toBe(1.1);
    expect(usd.date).toBe('2026-10-28');
    expect(usd.rates[0]).not.toHaveProperty('delta');
    await expect(service.get('XYZ')).rejects.toThrow('supported');
  } finally {
    jest.useRealTimers();
  }
});
it('rejects query arrays or injected bases before fetching anything', () => {
  const get = jest.fn();
  const c = new ReferenceRatesController({ get } as any);
  expect(() => c.get(['USD'] as any)).toThrow();
  expect(() => c.get('USD&url=http://localhost')).toThrow();
  c.get('EUR');
  expect(get).toHaveBeenCalledWith('EUR');
});
