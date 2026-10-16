import { discoverNativeVideoProtocol } from '../nativeVideoProtocolProbe';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('discovers a bridge that arrives after mount, then stops probing', async () => {
  let available = false;
  const state = jest.fn(async () => ({ version: 1, protocol: 2, state: 'idle' }));
  const found = jest.fn();
  discoverNativeVideoProtocol({ has: () => available, state }, found);
  await jest.advanceTimersByTimeAsync(2500);
  expect(state).not.toHaveBeenCalled();
  available = true;
  await jest.advanceTimersByTimeAsync(500);
  expect(found).toHaveBeenCalledWith(2);
  await jest.advanceTimersByTimeAsync(30_000);
  expect(state).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it('bounds unsupported bridges and ignores a response arriving after unmount', async () => {
  const absent = jest.fn(() => false), state = jest.fn(), found = jest.fn();
  discoverNativeVideoProtocol({ has: absent, state }, found);
  await jest.advanceTimersByTimeAsync(30_000);
  expect(absent.mock.calls.length).toBeLessThanOrEqual(30);
  expect(state).not.toHaveBeenCalled();
  expect(found).not.toHaveBeenCalled();
  let resolve!: (value: unknown) => void;
  const stop = discoverNativeVideoProtocol({ has: () => true,
    state: () => new Promise(r => { resolve = r; }) }, found);
  stop(); resolve({ version: 1, protocol: 2 });
  await jest.advanceTimersByTimeAsync(30_000);
  expect(found).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

it('recovers from an invalid first reply without overlapping calls', async () => {
  const state = jest.fn().mockResolvedValueOnce(null).mockResolvedValue({ version: 1, protocol: 2 });
  const found = jest.fn();
  discoverNativeVideoProtocol({ has: () => true, state }, found);
  await jest.advanceTimersByTimeAsync(1000);
  expect(found).toHaveBeenCalledWith(2);
  expect(state).toHaveBeenCalledTimes(2);
});

it('stops within the startup window even if the native call never answers', async () => {
  const state = jest.fn(() => new Promise<unknown>(() => {})), found = jest.fn();
  discoverNativeVideoProtocol({ has: () => true, state }, found);
  await jest.advanceTimersByTimeAsync(30_000);
  expect(state).toHaveBeenCalledTimes(1);
  expect(found).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});
