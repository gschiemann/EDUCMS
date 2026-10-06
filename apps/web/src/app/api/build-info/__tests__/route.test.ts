/** @jest-environment node */
import { GET } from '../route';

const saved = process.env.NEXT_PUBLIC_BUILD_SHA;
const savedId = process.env.NEXT_PUBLIC_BUNDLE_ID;
beforeEach(() => {
  process.env.NEXT_PUBLIC_BUILD_SHA = '123456789abc123456789abc123456789abc12345678';
  process.env.NEXT_PUBLIC_BUNDLE_ID = 'fedcba987654';
});
afterEach(() => {
  if (saved === undefined) delete process.env.NEXT_PUBLIC_BUILD_SHA; else process.env.NEXT_PUBLIC_BUILD_SHA = saved;
  if (savedId === undefined) delete process.env.NEXT_PUBLIC_BUNDLE_ID; else process.env.NEXT_PUBLIC_BUNDLE_ID = savedId;
});

test('an older running player receives no deployment-triggered reload identity, without losing diagnostic evidence', async () => {
  const res = await GET(new Request('https://signage.example/api/build-info', {
    headers: { referer: 'https://signage.example/player?fp=test-device' },
  }));
  expect(await res.json()).toMatchObject({ sha: null, bundleId: null,
    shaFull: '123456789abc123456789abc123456789abc12345678', playerActivation: 'idle-or-operator' });
  expect(res.headers.get('cache-control')).toBe('private, no-store');
});

test.each([
  ['https://signage.example/api/build-info', 'https://signage.example/screens'],
  ['https://signage.example/api/build-info?playerPolicy=idle', 'https://signage.example/player'],
  ['https://signage.example/api/build-info', 'https://other.example/player'],
  ['https://signage.example/api/build-info', ''],
])('dashboard and idle-aware callers still see the actual deployed identity: %s %s', async (url, referer) => {
  const res = await GET(new Request(url, { headers: { referer } }));
  expect(await res.json()).toMatchObject({ sha: '123456789abc', bundleId: 'fedcba987654' });
});
