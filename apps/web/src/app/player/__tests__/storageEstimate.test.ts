import { readPlayerStorageEstimate, requestPersistentStorage, storageEstimateText } from '../storageEstimate';

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

describe('requestPersistentStorage', () => {
  const CHROME = 'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.74 Safari/537.36';
  const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0';

  test('asks once and reports what the browser decided', async () => {
    const persist = jest.fn(async () => true);
    expect(await requestPersistentStorage({ persist, persisted: async () => false }, CHROME)).toBe('granted');
    expect(persist).toHaveBeenCalledTimes(1);
    expect(await requestPersistentStorage({ persist: async () => false, persisted: async () => false }, CHROME)).toBe('declined');
  });

  test('does not ask again when the origin is already persistent', async () => {
    const persist = jest.fn(async () => true);
    expect(await requestPersistentStorage({ persist, persisted: async () => true }, CHROME)).toBe('already-persistent');
    expect(persist).not.toHaveBeenCalled();
  });

  test('never asks Firefox, which would put a permission prompt on the glass', async () => {
    const persist = jest.fn(async () => true);
    expect(await requestPersistentStorage({ persist, persisted: async () => false }, FIREFOX)).toBe('skipped');
    expect(persist).not.toHaveBeenCalled();
  });

  test('an old engine without persisted() is still asked', async () => {
    expect(await requestPersistentStorage({ persist: async () => true }, CHROME)).toBe('granted');
  });

  test('missing API, rejections and synchronous throws read as unsupported', async () => {
    expect(await requestPersistentStorage()).toBe('unsupported');
    expect(await requestPersistentStorage({}, CHROME)).toBe('unsupported');
    expect(await requestPersistentStorage({ persist: async () => { throw new Error('denied'); } }, CHROME)).toBe('unsupported');
    expect(await requestPersistentStorage({ persist: () => { throw new Error('denied'); } }, CHROME)).toBe('unsupported');
    expect(await requestPersistentStorage({ persist: async () => true, persisted: async () => { throw new Error('x'); } }, CHROME)).toBe('unsupported');
  });
});
