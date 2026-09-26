/**
 * Wrong-checksum memory for the large-asset drive (2026-09-26).
 *
 * A large file whose COMPLETE download fails PRECACHE_VERIFY (`sha256-mismatch`)
 * is purged from staging and, without this, re-downloaded whole on every
 * retry tick — the retry policy caps at 10 minutes, so a stored digest that is
 * simply wrong for the bytes at that URL would cost a 4K screen ~141 MB every
 * 10 minutes for as long as the playlist stays published. The bytes are the
 * same each time; the verdict cannot change until either side changes.
 *
 * So the (stable URL, sha256) pair is remembered for QUARANTINE_MS and skipped
 * — the item stays not-ready (unverified bytes are never played), the drive
 * reports a failure exactly as before, and it logs ONCE. A NEW sha256 for the
 * same URL (a re-upload, a re-mux, a corrected row) clears the mark at once,
 * and a different URL is a different pair. Persisted in localStorage so a
 * page reload does not restart the loop; bounded; every storage touch is
 * guarded — a blocked or full store degrades to session memory, never to a
 * throw.
 *
 * Pure apart from the injected store + clock: unit-tested without the page.
 */

export const DIGEST_QUARANTINE_MS = 6 * 60 * 60 * 1000;
const STORAGE_KEY = 'edu_player_bad_digests_v1';
const MAX_ENTRIES = 64;

type Entry = { key: string; sha256: string; untilMs: number };

type StoreLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Origin + path: the same identity the worker's stableKey uses (a rotated `?token=` is the same file). */
export function quarantineKey(url: string): string {
  try {
    const u = new URL(url, 'https://educms.local');
    return `${u.origin}${u.pathname}`;
  } catch {
    return String(url || '').split('?')[0].split('#')[0];
  }
}

export class DigestQuarantine {
  private memory: Entry[] | null = null;
  private readonly logged = new Set<string>();

  constructor(
    private readonly store: StoreLike | null,
    private readonly ttlMs: number = DIGEST_QUARANTINE_MS,
  ) {}

  /** True when this exact (url, sha256) pair failed verification within the window. */
  isQuarantined(url: string, sha256: string, nowMs: number): boolean {
    const key = quarantineKey(url);
    const want = sha256.toLowerCase();
    const entries = this.load(nowMs);
    const hit = entries.find((e) => e.key === key);
    if (!hit) return false;
    if (hit.sha256 !== want) {
      // The manifest moved to a new digest for this URL: the old verdict no
      // longer applies. Forget it so the new bytes get their download.
      this.save(entries.filter((e) => e !== hit));
      return false;
    }
    return true;
  }

  /** Record that the complete download of `url` did not hash to `sha256`. */
  quarantine(url: string, sha256: string, nowMs: number): void {
    const key = quarantineKey(url);
    const entries = this.load(nowMs).filter((e) => e.key !== key);
    entries.push({ key, sha256: sha256.toLowerCase(), untilMs: nowMs + this.ttlMs });
    // Bounded: oldest expiry first out. Sixty-four wrong digests at once is
    // not a state a real screen reaches; the cap only keeps the store sane.
    entries.sort((a, b) => a.untilMs - b.untilMs);
    while (entries.length > MAX_ENTRIES) entries.shift();
    this.save(entries);
  }

  /** How many pairs are quarantined right now (diagnostics). */
  count(nowMs: number): number {
    return this.load(nowMs).length;
  }

  /** Log a skip once per pair per page life — a 10-minute tick must not spam. */
  shouldLog(url: string, sha256: string): boolean {
    const id = `${quarantineKey(url)}|${sha256.toLowerCase()}`;
    if (this.logged.has(id)) return false;
    this.logged.add(id);
    return true;
  }

  private load(nowMs: number): Entry[] {
    let entries: Entry[] | null = this.memory;
    if (!entries && this.store) {
      try {
        const raw = this.store.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        entries = Array.isArray(parsed)
          ? parsed.filter((e): e is Entry =>
              !!e && typeof e.key === 'string' && typeof e.sha256 === 'string' && Number.isFinite(e.untilMs))
          : [];
      } catch {
        entries = [];
      }
    }
    if (!entries) entries = [];
    const live = entries.filter((e) => e.untilMs > nowMs);
    if (live.length !== entries.length) this.save(live);
    else this.memory = live;
    return live;
  }

  private save(entries: Entry[]): void {
    this.memory = entries;
    if (!this.store) return;
    try {
      if (entries.length === 0) this.store.removeItem(STORAGE_KEY);
      else this.store.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      /* quota / blocked storage — the in-memory copy still holds for this page life */
    }
  }
}

function pageStorage(): StoreLike | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

let shared: DigestQuarantine | null = null;

/** The page-wide instance (lazy, so an SSR import never touches storage). */
export function digestQuarantine(): DigestQuarantine {
  if (!shared) shared = new DigestQuarantine(pageStorage());
  return shared;
}

export function __resetDigestQuarantineForTests(): void {
  shared = null;
}
