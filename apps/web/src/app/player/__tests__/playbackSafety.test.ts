import { PlaybackSafety, PLAYBACK_SAFETY_MS } from '../playbackSafety';
class Store {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}
const at = 1_700_000_000_000;
const url = 'https://cdn.example/test.mp4?token=secret';
const sha = 'a'.repeat(64);
describe('normal playback interruption circuit breaker', () => {
  test('one interrupted boot uses conservative playback, two set aside only the affected file', () => {
    const store = new Store();
    new PlaybackSafety(store, at).begin(url, sha, 'assemble', at);
    const first = new PlaybackSafety(store, at + 1);
    expect(first.conservative(at + 1)).toBe(true);
    expect(first.blocked(url, sha, at + 1)).toBe(false);
    first.begin(url, sha, 'start', at + 2);
    const second = new PlaybackSafety(store, at + 3);
    expect(second.blocked(url.replace('secret', 'rotated'), sha, at + 3)).toBe(true);
    expect(second.blocked(url, 'b'.repeat(64), at + 3)).toBe(false);
    expect(second.blocked('https://cdn.example/other.mp4', sha, at + 3)).toBe(false);
    expect(second.blocked(url, sha, at + 3 + PLAYBACK_SAFETY_MS)).toBe(false);
    expect(second.conservative(at + 3 + PLAYBACK_SAFETY_MS)).toBe(false);
    expect([...store.data.values()].join()).not.toContain('secret');
  });
  test('normal navigation and successful preparation never count as an interruption', () => {
    const store = new Store();
    const guard = new PlaybackSafety(store, at);
    guard.begin(url, sha, 'verify', at)();
    guard.begin(url, sha, 'start', at);
    guard.orderlyExit();
    expect(new PlaybackSafety(store, at + 1).conservative(at + 1)).toBe(false);
  });
  test('a boot counts a file once across phases and does not swallow another operation', () => {
    const store = new Store();
    const first = new PlaybackSafety(store, at);
    const done = first.begin(url, sha, 'verify', at);
    first.begin(url, sha, 'assemble', at);
    done();
    const next = new PlaybackSafety(store, at + 1);
    expect(next.blocked(url, sha, at + 1)).toBe(false);
    next.begin(url, sha, 'start', at + 1);
    next.begin(url, sha, 'verify', at + 1);
    expect(new PlaybackSafety(store, at + 2).blocked(url, sha, at + 2)).toBe(true);
  });
  test('ancient breadcrumbs, corrupt storage and a denied storage API cannot brick boot', () => {
    const store = new Store();
    new PlaybackSafety(store, at).begin(url, sha, 'verify', at);
    expect(new PlaybackSafety(store, at + 46 * 60_000).conservative(at + 46 * 60_000)).toBe(false);
    store.setItem('edu_normal_playback_safety_v1', '{oops');
    expect(() => new PlaybackSafety(store, at)).not.toThrow();
    const broken = { getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); }, removeItem() {} };
    const guard = new PlaybackSafety(broken, at);
    guard.rendererFailed(at);
    expect(guard.conservative(at + 1)).toBe(true);
  });
});
