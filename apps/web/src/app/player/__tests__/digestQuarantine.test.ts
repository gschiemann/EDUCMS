import { DIGEST_QUARANTINE_MS, DigestQuarantine, quarantineKey } from '../digestQuarantine';

class MemoryStore {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.has(k) ? this.data.get(k)! : null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

const URL_A = 'https://cdn.example.com/storage/v1/object/public/assets/t1/4k.mp4?token=abc';
const SHA_1 = 'a'.repeat(64);
const SHA_2 = 'b'.repeat(64);
const T0 = 1_700_000_000_000;

describe('DigestQuarantine — a wrong stored checksum must not become a repeating 4K download', () => {
  it('remembers a failed pair for six hours, then lets one real retry through', () => {
    const q = new DigestQuarantine(new MemoryStore());
    expect(q.isQuarantined(URL_A, SHA_1, T0)).toBe(false);
    q.quarantine(URL_A, SHA_1, T0);
    expect(q.isQuarantined(URL_A, SHA_1, T0 + 1)).toBe(true);
    expect(q.isQuarantined(URL_A, SHA_1, T0 + DIGEST_QUARANTINE_MS - 1)).toBe(true);
    expect(q.isQuarantined(URL_A, SHA_1, T0 + DIGEST_QUARANTINE_MS)).toBe(false);
    expect(DIGEST_QUARANTINE_MS).toBe(6 * 60 * 60 * 1000);
  });

  it('a NEW digest for the same URL clears the mark at once — a re-upload gets its download', () => {
    const q = new DigestQuarantine(new MemoryStore());
    q.quarantine(URL_A, SHA_1, T0);
    expect(q.isQuarantined(URL_A, SHA_2, T0 + 1)).toBe(false);
    // And the old pair is gone too, not lurking behind the new one.
    expect(q.isQuarantined(URL_A, SHA_1, T0 + 2)).toBe(false);
    expect(q.count(T0 + 2)).toBe(0);
  });

  it('keys on the stable URL: a rotated signed-URL token is the same file, another path is not', () => {
    const q = new DigestQuarantine(new MemoryStore());
    q.quarantine(URL_A, SHA_1, T0);
    expect(q.isQuarantined(URL_A.replace('token=abc', 'token=def'), SHA_1, T0 + 1)).toBe(true);
    expect(q.isQuarantined('https://cdn.example.com/storage/v1/object/public/assets/t1/other.mp4', SHA_1, T0 + 1)).toBe(false);
    expect(quarantineKey(URL_A)).toBe('https://cdn.example.com/storage/v1/object/public/assets/t1/4k.mp4');
    // A relative path (legacy manifest) still gets one stable identity.
    expect(quarantineKey('/assets/a.mp4?x=1#t')).toBe('https://educms.local/assets/a.mp4');
  });

  it('survives a page reload through the store, and prunes what expired', () => {
    const store = new MemoryStore();
    new DigestQuarantine(store).quarantine(URL_A, SHA_1, T0);
    const reloaded = new DigestQuarantine(store);
    expect(reloaded.isQuarantined(URL_A, SHA_1, T0 + 60_000)).toBe(true);
    expect(reloaded.count(T0 + 60_000)).toBe(1);
    expect(reloaded.count(T0 + DIGEST_QUARANTINE_MS + 1)).toBe(0);
    expect(store.getItem('edu_player_bad_digests_v1')).toBeNull(); // pruned away entirely
  });

  it('is bounded to 64 pairs (oldest expiry out first) and tolerates garbage in the store', () => {
    const store = new MemoryStore();
    store.setItem('edu_player_bad_digests_v1', '{not json');
    const q = new DigestQuarantine(store);
    for (let i = 0; i < 70; i++) q.quarantine(`https://x/f${i}.mp4`, SHA_1, T0 + i);
    expect(q.count(T0 + 100)).toBe(64);
    expect(q.isQuarantined('https://x/f0.mp4', SHA_1, T0 + 100)).toBe(false); // evicted
    expect(q.isQuarantined('https://x/f69.mp4', SHA_1, T0 + 100)).toBe(true);
  });

  it('a store that throws degrades to page memory — never a throw, never forgotten within the page', () => {
    const broken = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('quota'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    const q = new DigestQuarantine(broken);
    expect(() => q.quarantine(URL_A, SHA_1, T0)).not.toThrow();
    expect(q.isQuarantined(URL_A, SHA_1, T0 + 1)).toBe(true);
    expect(new DigestQuarantine(null).isQuarantined(URL_A, SHA_1, T0)).toBe(false);
  });

  it('logs a skipped pair once per page life', () => {
    const q = new DigestQuarantine(new MemoryStore());
    expect(q.shouldLog(URL_A, SHA_1)).toBe(true);
    expect(q.shouldLog(URL_A, SHA_1)).toBe(false);
    expect(q.shouldLog(URL_A, SHA_2)).toBe(true);
  });
});
