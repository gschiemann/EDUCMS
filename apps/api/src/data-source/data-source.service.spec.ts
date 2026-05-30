/**
 * DataSourceService normalization tests — JSON shapes + CSV quoting.
 *
 * The SSRF gate is proven separately (data-source.ssrf.spec.ts) using the
 * REAL safeFetch. HERE we mock safeFetch so we can feed known payloads and
 * assert the normalizer flattens them into clean string-map rows — the
 * contract the TICKER consumer relies on.
 */
import { Logger } from '@nestjs/common';

// Mock safe-fetch so these tests are hermetic (no network) and we control
// the bytes the parser sees. The SSRF behavior is covered elsewhere.
jest.mock('../branding/safe-fetch', () => ({
  __esModule: true,
  safeFetch: jest.fn(),
}));

import { safeFetch } from '../branding/safe-fetch';
import { DataSourceService } from './data-source.service';

const mockedFetch = safeFetch as unknown as jest.Mock;

function asResponse(body: string) {
  return {
    body: Buffer.from(body, 'utf8'),
    contentType: 'text/plain',
    finalUrl: 'https://example.com/feed',
    status: 200,
  };
}

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined as any);
});
afterEach(() => jest.clearAllMocks());
afterAll(() => jest.restoreAllMocks());

describe('DataSourceService.fetchNormalized — JSON', () => {
  it('normalizes a top-level array of objects', async () => {
    mockedFetch.mockResolvedValue(
      asResponse(JSON.stringify([{ team: 'Lincoln', score: 21 }, { team: 'Adams', score: 14 }])),
    );
    const svc = new DataSourceService();
    const out = await svc.fetchNormalized('https://example.com/x.json', 'json');
    expect(out.rows).toEqual([
      { team: 'Lincoln', score: '21' },
      { team: 'Adams', score: '14' },
    ]);
    expect(out.columns).toEqual(['team', 'score']);
    expect(out.totalRows).toBe(2);
  });

  it('unwraps an object with a single array property', async () => {
    mockedFetch.mockResolvedValue(asResponse(JSON.stringify({ items: [{ name: 'A' }, { name: 'B' }] })));
    const svc = new DataSourceService();
    const out = await svc.fetchNormalized('https://example.com/x.json', 'json');
    expect(out.rows).toEqual([{ name: 'A' }, { name: 'B' }]);
  });

  it('prefers a conventionally-named array (data) when several exist', async () => {
    mockedFetch.mockResolvedValue(
      asResponse(JSON.stringify({ meta: [1, 2], data: [{ k: 'v' }] })),
    );
    const svc = new DataSourceService();
    const out = await svc.fetchNormalized('https://example.com/x.json', 'json');
    expect(out.rows).toEqual([{ k: 'v' }]);
  });

  it('coerces nested objects/arrays in a cell to a JSON string', async () => {
    mockedFetch.mockResolvedValue(
      asResponse(JSON.stringify([{ name: 'X', tags: ['a', 'b'] }])),
    );
    const svc = new DataSourceService();
    const out = await svc.fetchNormalized('https://example.com/x.json', 'json');
    expect(out.rows[0].name).toBe('X');
    expect(out.rows[0].tags).toBe('["a","b"]');
  });

  it('maps an array of scalars to a single "value" column', async () => {
    mockedFetch.mockResolvedValue(asResponse(JSON.stringify(['one', 'two'])));
    const svc = new DataSourceService();
    const out = await svc.fetchNormalized('https://example.com/x.json', 'json');
    expect(out.rows).toEqual([{ value: 'one' }, { value: 'two' }]);
  });

  it('throws on invalid JSON', async () => {
    mockedFetch.mockResolvedValue(asResponse('{not json'));
    const svc = new DataSourceService();
    await expect(svc.fetchNormalized('https://example.com/x.json', 'json')).rejects.toThrow(/JSON/i);
  });
});

describe('DataSourceService.fetchNormalized — CSV', () => {
  it('parses a simple CSV keyed by header', async () => {
    mockedFetch.mockResolvedValue(asResponse('name,price\nBurger,9.99\nFries,3.50\n'));
    const svc = new DataSourceService();
    const out = await svc.fetchNormalized('https://example.com/x.csv', 'csv');
    expect(out.rows).toEqual([
      { name: 'Burger', price: '9.99' },
      { name: 'Fries', price: '3.50' },
    ]);
    expect(out.columns).toEqual(['name', 'price']);
  });

  it('handles quoted fields with embedded commas + doubled quotes', async () => {
    mockedFetch.mockResolvedValue(
      asResponse('item,note\n"Combo, large","He said ""hi"""\n'),
    );
    const svc = new DataSourceService();
    const out = await svc.fetchNormalized('https://example.com/x.csv', 'csv');
    expect(out.rows[0]).toEqual({ item: 'Combo, large', note: 'He said "hi"' });
  });

  it('handles CRLF line endings (Google Sheets export style)', async () => {
    mockedFetch.mockResolvedValue(asResponse('a,b\r\n1,2\r\n3,4\r\n'));
    const svc = new DataSourceService();
    const out = await svc.fetchNormalized('https://example.com/x.csv', 'csv');
    expect(out.rows).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });
});
