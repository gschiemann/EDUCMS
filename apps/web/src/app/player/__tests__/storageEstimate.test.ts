import { readPlayerStorageEstimate, storageEstimateText } from '../storageEstimate';

test.each([
  [{ usage: 0, quota: 256 * 1024 * 1024 }, '0 B', '256 MB', 0],
  [{ usage: 96 * 1024 * 1024, quota: 256 * 1024 * 1024 }, '96 MB', '256 MB', 37.5],
  [{ usage: 0.5, quota: 1 }, '<1 B', '1 B', 50],
  [{ usage: 0, quota: 0.1 }, '0 B', '<1 B', 0],
  [{ usage: 900 * 1024 * 1024, quota: 256 * 1024 * 1024 }, '900 MB', '256 MB', 100],
] as const)('storage estimate %j retains truthful values', async (estimate, used, total, percent) => {
  const value = await readPlayerStorageEstimate({ estimate: async () => estimate });
  expect(storageEstimateText(value)).toEqual({ used, total, percent });
});

test.each([{}, { usage: -1, quota: 1 }, { usage: NaN, quota: 1 }, { usage: 1, quota: 0 },
  { usage: 1, quota: Infinity }, { quota: 1 }, { usage: 1 }])('invalid estimate %j remains unknown', async estimate => {
  expect(await readPlayerStorageEstimate({ estimate: async () => estimate })).toBeNull();
});

test('unsupported rejected and synchronous failures remain unknown', async () => {
  expect(await readPlayerStorageEstimate()).toBeNull();
  expect(await readPlayerStorageEstimate({ estimate: async () => { throw new Error('unavailable'); } })).toBeNull();
  expect(await readPlayerStorageEstimate({ estimate: () => { throw new Error('unavailable'); } })).toBeNull();
  expect(storageEstimateText(null)).toBeNull();
});
