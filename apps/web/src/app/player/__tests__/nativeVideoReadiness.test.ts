import { NativeVideoResumeWaiter, queryNativeVideoAvailability, readNativeVideoAvailability } from "../nativeVideoReadiness";
import { nativeVideoNext } from "../NativeDualVideo";

const reply = (epoch: number, overrides: Record<string, unknown> = {}) => ({
  version: 1, protocol: 2,
  availability: { version: 1, foreground: true, interactive: true, focused: true, focusRequired: true, uiClear: true, ready: true, epoch, ...overrides },
});
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe("native lifecycle recovery", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("older APKs and malformed readiness cannot authorize recovery", () => {
    expect(readNativeVideoAvailability({ version: 1, protocol: 2 })).toBeNull();
    expect(readNativeVideoAvailability(reply(1, { foreground: false }))).toBeNull();
    expect(readNativeVideoAvailability(reply(-1))).toBeNull();
    expect(readNativeVideoAvailability(reply(1, { epoch: "1" }))).toBeNull();
    expect(readNativeVideoAvailability(JSON.stringify(reply(2)))?.epoch).toBe(2);
    expect(readNativeVideoAvailability(reply(2, { focused: false, focusRequired: false }))?.ready).toBe(true);
    expect(nativeVideoNext(2, "activity-paused", 0, true)).toBe("stay");
    expect(nativeVideoNext(1, "activity-paused", 0, true, true)).toBe("stay");
    expect(nativeVideoNext(2, "activity-paused", 20, true, true)).toBe("wait");
    expect(nativeVideoNext(2, "page-stopped", 0, true, true)).toBe("wait");
    expect(nativeVideoNext(2, "codec-failed", 0, true, true)).toBe("block");
    expect(nativeVideoNext(2, "credential-changed", 0, true, true)).toBe("stay");
    expect(nativeVideoNext(2, "emergency-held", 0, true, true)).toBe("stay");
  });

  it("a resume before the failed-state poll is consumed exactly once", async () => {
    const ready = jest.fn();
    const read = jest.fn(async () => reply(8));
    const ticket = new NativeVideoResumeWaiter(read, () => true, 7, ready);
    ticket.start();
    await settle();
    expect(ready).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(1);
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("waits through pause and native UI, then takes only a new ready epoch", async () => {
    let state = reply(7, { foreground: false, ready: false });
    const ready = jest.fn();
    const ticket = new NativeVideoResumeWaiter(async () => state, () => true, 7, ready);
    ticket.start(); await settle();
    await jest.advanceTimersByTimeAsync(2000);
    state = reply(7, { uiClear: false, ready: false });
    await jest.advanceTimersByTimeAsync(1000);
    state = reply(7);
    await jest.advanceTimersByTimeAsync(1000);
    expect(ready).not.toHaveBeenCalled();
    state = reply(8);
    await jest.advanceTimersByTimeAsync(500);
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("hidden documents and unfocused windows never consume readiness", async () => {
    let visible = false;
    let state = reply(2);
    const ready = jest.fn();
    const ticket = new NativeVideoResumeWaiter(async () => state, () => visible, 1, ready);
    ticket.start(); await settle();
    await jest.advanceTimersByTimeAsync(1500);
    visible = true;
    state = reply(2, { focused: false, ready: false });
    await jest.advanceTimersByTimeAsync(1500);
    expect(ready).not.toHaveBeenCalled();
    state = reply(3);
    await jest.advanceTimersByTimeAsync(500);
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("identity/unmount cancellation ignores even a late successful reply", async () => {
    let resolve!: (v: unknown) => void;
    const ready = jest.fn();
    const ticket = new NativeVideoResumeWaiter(() => new Promise(r => { resolve = r; }), () => true, 1, ready);
    ticket.start(); await settle(); ticket.stop();
    resolve(reply(2)); await settle();
    await jest.advanceTimersByTimeAsync(10_000);
    expect(ready).not.toHaveBeenCalled();
  });

  it("bounds a bridge call whose body never resolves", async () => {
    const pending = queryNativeVideoAvailability(() => new Promise(() => undefined));
    await jest.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toBeNull();
  });
});
