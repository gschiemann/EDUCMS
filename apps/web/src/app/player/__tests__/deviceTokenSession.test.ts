import { createDeviceTokenSession } from '../deviceTokenSession';

type Reply = { token?: string; repair?: boolean };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(mode: 'normal' | 'quota' | 'silent' | 'unreadable' = 'normal') {
  let saved: string | null = 'stored-old';
  const native = jest.fn();
  const warning = jest.fn();
  const storage = {
    getItem: () => { if (mode === 'unreadable') throw new Error('SecurityError'); return saved; },
    setItem: (_key: string, value: string) => {
      if (mode === 'quota') throw new Error('QuotaExceededError');
      if (mode === 'normal') saved = value;
    },
    removeItem: () => { saved = null; },
  };
  const options = {
    storage: () => storage, search: () => '?token=native-bootstrap',
    tokenFromResponse: (response: Reply) => response.token ?? null,
    persistNative: native, onWarning: warning,
  };
  return { session: createDeviceTokenSession(options), options, native, warning, saved: () => saved };
}

it('keeps stored-wins bootstrap precedence over a fossil native URL', () => {
  expect(fixture().session.read()).toBe('stored-old');
});

it.each(['quota', 'silent', 'unreadable'] as const)(
  'uses the accepted renewal for every request when durable storage is %s', async (mode) => {
    const f = fixture(mode);
    await f.session.register(async () => ({ token: 'server-renewed' }));
    expect(f.session.read()).toBe('server-renewed');
    const next = jest.fn(async () => ({}));
    await f.session.register(next);
    expect(next).toHaveBeenCalledWith('server-renewed');
    expect(f.native).toHaveBeenCalledWith('server-renewed');
    expect(f.warning).toHaveBeenCalledWith('credential-persistence-failed');
    if (mode !== 'unreadable') {
      expect(f.saved()).toBeNull();
      expect(createDeviceTokenSession({ ...f.options, search: () => '?token=server-renewed' }).read()).toBe('server-renewed');
    }
  },
);

it('persists a renewal to the sole durable store and existing native writer', async () => {
  const f = fixture();
  await f.session.register(async (prior) => {
    expect(prior).toBe('stored-old');
    return { token: 'server-renewed' };
  });
  expect(f.saved()).toBe('server-renewed');
  expect(createDeviceTokenSession(f.options).read()).toBe('server-renewed');
  expect(f.native).toHaveBeenCalledTimes(1);
});

it('shares one register request across boot, pairing and recovery', async () => {
  const f = fixture();
  const pending = deferred<Reply>();
  const first = jest.fn(() => pending.promise);
  const second = jest.fn();
  const a = f.session.register(first);
  const b = f.session.register(second);
  expect(a).toBe(b);
  await Promise.resolve();
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).not.toHaveBeenCalled();
  pending.resolve({ token: 'server-renewed' });
  expect(await a).toEqual({ token: 'server-renewed' });
  expect(f.native).toHaveBeenCalledTimes(1);
});

it('discards retired responses and verdicts after unpair, even after fresh pairing starts', async () => {
  const f = fixture();
  const old = deferred<Reply>();
  const fresh = deferred<Reply>();
  const a = f.session.register(() => old.promise);
  await Promise.resolve();
  f.session.invalidate();
  expect(f.session.read()).toBeNull(); // neither old storage nor old URL
  const duringTeardown = jest.fn();
  expect(await f.session.register(duringTeardown)).toBeNull();
  expect(duringTeardown).not.toHaveBeenCalled();
  f.session.resume();
  const b = f.session.register((prior) => {
    expect(prior).toBeNull();
    return fresh.promise;
  });
  await Promise.resolve();
  old.resolve({ token: 'retired-token', repair: true });
  expect(await a).toBeNull();
  expect(f.native).not.toHaveBeenCalled();
  const third = jest.fn();
  expect(f.session.register(third)).toBe(b); // old finally cannot clear b
  fresh.resolve({ token: 'fresh-pairing-token' });
  await b;
  expect(f.session.read()).toBe('fresh-pairing-token');
  expect(f.native.mock.calls).toEqual([['fresh-pairing-token']]);
});

it('allows a bounded request failure to retry without losing the held credential', async () => {
  const f = fixture();
  await expect(f.session.register(async () => { throw new Error('timeout'); })).rejects.toThrow('timeout');
  expect(f.session.read()).toBe('stored-old');
  await f.session.register(async () => ({ token: 'retried-token' }));
  expect(f.session.read()).toBe('retried-token');
});

it('rejects malformed server response tokens without persisting or granting success', async () => {
  const f = fixture();
  await expect(f.session.register(async () => ({ token: '<bad token>' }))).rejects.toThrow('malformed');
  expect(f.session.read()).toBe('stored-old');
  expect(f.native).not.toHaveBeenCalled();
});
