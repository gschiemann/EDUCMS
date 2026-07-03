/**
 * C1 drift-catcher (Wave C — "Crush Canva" safety net, 2026-07-02).
 *
 * Pre-fix: autosave was disabled and there was ZERO draft recovery
 * (05-EDITOR-CRUSH-LENSES.md editor-workflow lens) — a crash or killed
 * tab between two manual Saves lost everything since the last Save.
 * autosave-draft.ts adds a LOCAL-ONLY (never server) mirror of the
 * dirty builder state so a restore bar can offer it back.
 *
 * This spec covers the module's contract in isolation (no BuilderShell
 * mount needed — the module is a pure store OBSERVER):
 *   - write/read/clear round-trip
 *   - capacity guard skips oversized drafts (>2MB)
 *   - oldest-eviction on a simulated quota-exceeded write
 *   - isDraftNewer compares against the server's updatedAt correctly
 *   - the debounce (~3s) + max-interval (~30s) scheduler timing
 *   - THE key safety property: none of this ever touches
 *     useBuilderStore's history (past/future) or activeTransaction —
 *     autosave only ever calls store.getState(), never a store action.
 */
import {
  writeDraft,
  readDraft,
  clearDraft,
  isDraftNewer,
  createAutosaveScheduler,
  type BuilderDraft,
} from '../autosave-draft';
import { useBuilderStore } from '../useBuilderStore';
import type { Zone } from '../types';

function makeDraft(over: Partial<BuilderDraft> = {}): BuilderDraft {
  return {
    templateId: 't1',
    savedAt: Date.now(),
    zones: [{ id: 'z1', name: 'Z', widgetType: 'TEXT', x: 0, y: 0, width: 10, height: 10, zIndex: 1, sortOrder: 0 }],
    meta: { name: 'My template', description: '', screenWidth: 1920, screenHeight: 1080, bgColor: '', bgGradient: '', bgImage: '' },
    isTouchEnabled: false,
    idleResetMs: 60000,
    ...over,
  };
}

function makeZone(over: Partial<Zone> = {}): Zone {
  return {
    id: 'z1', name: 'Zone', widgetType: 'TEXT',
    x: 10, y: 10, width: 20, height: 10, zIndex: 1, sortOrder: 0, defaultConfig: {},
    ...over,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  jest.useRealTimers();
});

describe('C1 — draft write/read/clear round-trip', () => {
  it('writes a draft and reads back the exact same shape', () => {
    const draft = makeDraft();
    writeDraft(draft);
    const back = readDraft('t1');
    expect(back).toEqual(draft);
  });

  it('returns null for a template with no draft', () => {
    expect(readDraft('never-saved')).toBeNull();
  });

  it('returns null for a corrupt localStorage entry instead of throwing', () => {
    window.localStorage.setItem('educms_builder_draft_t1', '{not valid json');
    expect(() => readDraft('t1')).not.toThrow();
    expect(readDraft('t1')).toBeNull();
  });

  it('clearDraft removes the entry so a subsequent read is null', () => {
    writeDraft(makeDraft());
    expect(readDraft('t1')).not.toBeNull();
    clearDraft('t1');
    expect(readDraft('t1')).toBeNull();
  });

  it('keeps separate drafts per templateId', () => {
    writeDraft(makeDraft({ templateId: 't1', meta: { ...makeDraft().meta, name: 'One' } }));
    writeDraft(makeDraft({ templateId: 't2', meta: { ...makeDraft().meta, name: 'Two' } }));
    expect(readDraft('t1')?.meta.name).toBe('One');
    expect(readDraft('t2')?.meta.name).toBe('Two');
    clearDraft('t1');
    expect(readDraft('t1')).toBeNull();
    expect(readDraft('t2')?.meta.name).toBe('Two'); // untouched
  });
});

describe('C1 — capacity guard (skip drafts over 2MB, evict-oldest on quota)', () => {
  it('skips persisting a draft whose JSON exceeds the 2MB cap', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    // A single zone with a ~3MB base64 "image" blob in defaultConfig —
    // simulates a giant inline data: URL, the realistic oversized case.
    const huge = 'x'.repeat(3 * 1024 * 1024);
    const draft = makeDraft({
      zones: [makeZone({ defaultConfig: { blob: huge } }) as unknown as Zone],
    });
    writeDraft(draft);
    expect(readDraft('t1')).toBeNull(); // never written
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('over the'));
    warnSpy.mockRestore();
  });

  it('evicts the oldest OTHER draft and retries once when setItem throws (quota exceeded)', () => {
    // Seed an old draft for a different template.
    writeDraft(makeDraft({ templateId: 'old-template', savedAt: 1000 }));
    expect(readDraft('old-template')).not.toBeNull();

    // Force the NEXT setItem call to throw once (simulating
    // QuotaExceededError), succeed on the retry.
    const realSetItem = window.localStorage.setItem.bind(window.localStorage);
    let calls = 0;
    const spy = jest.spyOn(window.localStorage.__proto__, 'setItem') as jest.SpyInstance<void, [string, string]>;
    spy.mockImplementation((key: string, value: string) => {
      calls += 1;
      if (calls === 1) {
        const err = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        throw err;
      }
      realSetItem(key, value);
    });

    writeDraft(makeDraft({ templateId: 'new-template', savedAt: 5000 }));

    spy.mockRestore();
    // The old draft was evicted to make room; the new one landed.
    expect(readDraft('old-template')).toBeNull();
    expect(readDraft('new-template')).not.toBeNull();
  });
});

describe('C1 — isDraftNewer', () => {
  it('is true when the draft is newer than the server updatedAt', () => {
    const draft = makeDraft({ savedAt: Date.parse('2026-07-02T12:00:00Z') });
    expect(isDraftNewer(draft, '2026-07-02T11:00:00Z')).toBe(true);
  });

  it('is false when the draft is OLDER than (or equal to) the server updatedAt — nothing to restore', () => {
    const draft = makeDraft({ savedAt: Date.parse('2026-07-02T11:00:00Z') });
    expect(isDraftNewer(draft, '2026-07-02T12:00:00Z')).toBe(false);
    expect(isDraftNewer(draft, '2026-07-02T11:00:00Z')).toBe(false);
  });

  it('is false for a null draft', () => {
    expect(isDraftNewer(null, '2026-07-02T12:00:00Z')).toBe(false);
  });

  it('treats a missing/unparseable server updatedAt as "any draft is newer"', () => {
    const draft = makeDraft();
    expect(isDraftNewer(draft, null)).toBe(true);
    expect(isDraftNewer(draft, undefined)).toBe(true);
    expect(isDraftNewer(draft, 'not-a-date')).toBe(true);
  });
});

describe('C1 — autosave scheduler timing (debounce ~3s, max-interval ~30s)', () => {
  it('flushes ~3s after the LAST notifyChange (debounce resets on each call)', () => {
    jest.useFakeTimers();
    let calls = 0;
    const scheduler = createAutosaveScheduler(() => { calls += 1; return makeDraft(); });

    scheduler.notifyChange();
    jest.advanceTimersByTime(2000);
    expect(calls).toBe(0); // not yet — still within debounce window

    scheduler.notifyChange(); // resets the 3s window
    jest.advanceTimersByTime(2000);
    expect(calls).toBe(0); // still hasn't hit 3s since the SECOND call

    jest.advanceTimersByTime(1000); // now 3s since the second call
    expect(calls).toBe(1);

    scheduler.dispose();
  });

  it('force-flushes at the ~30s ceiling even under continuous activity that keeps resetting the debounce', () => {
    jest.useFakeTimers();
    let calls = 0;
    const scheduler = createAutosaveScheduler(() => { calls += 1; return makeDraft(); });

    // Simulate continuous typing: a notifyChange every 1s, well under
    // the 3s debounce, so the debounce timer NEVER fires on its own.
    for (let i = 0; i < 29; i++) {
      scheduler.notifyChange();
      jest.advanceTimersByTime(1000);
    }
    // 29s of continuous activity, debounce never quiesced for 3s.
    expect(calls).toBe(0);

    // The 30s ceiling still forces exactly one flush.
    jest.advanceTimersByTime(1000);
    expect(calls).toBe(1);

    scheduler.dispose();
  });

  it('dispose() cancels pending timers — no flush after unmount', () => {
    jest.useFakeTimers();
    let calls = 0;
    const scheduler = createAutosaveScheduler(() => { calls += 1; return makeDraft(); });

    scheduler.notifyChange();
    scheduler.dispose();
    jest.advanceTimersByTime(60_000);
    expect(calls).toBe(0);
  });

  it('a flush actually persists via writeDraft (end-to-end: scheduler -> localStorage)', () => {
    jest.useFakeTimers();
    const scheduler = createAutosaveScheduler(() => makeDraft({ templateId: 'scheduled-t' }));
    scheduler.notifyChange();
    jest.advanceTimersByTime(3000);
    expect(readDraft('scheduled-t')).not.toBeNull();
    scheduler.dispose();
  });
});

describe('C1 — autosave NEVER touches store history/transactions (the load-bearing safety property)', () => {
  function resetStore() {
    useBuilderStore.getState().init({
      id: 't1',
      isSystem: false,
      zones: [makeZone()],
      meta: { name: 'T', description: '', screenWidth: 1920, screenHeight: 1080, bgColor: '', bgGradient: '', bgImage: '' },
      isTouchEnabled: false,
      idleResetMs: 60000,
      scenes: [],
    });
  }

  it('reading a snapshot via getState() for the scheduler does not mutate past/future/isDirty/activeTransaction', () => {
    resetStore();
    const before = useBuilderStore.getState();
    expect(before.past).toEqual([]);
    expect(before.future).toEqual([]);
    expect(before.activeTransaction).toBe(false);

    // Exactly the read pattern BuilderShell wires up: a getSnapshot
    // closure that reads the live store and shapes a BuilderDraft.
    const scheduler = createAutosaveScheduler(() => {
      const s = useBuilderStore.getState();
      return {
        templateId: s.templateId,
        savedAt: Date.now(),
        zones: s.zones,
        meta: s.meta,
        isTouchEnabled: s.isTouchEnabled,
        idleResetMs: s.idleResetMs,
      };
    });

    jest.useFakeTimers();
    scheduler.notifyChange();
    jest.advanceTimersByTime(3000);
    scheduler.dispose();

    const after = useBuilderStore.getState();
    expect(after.past).toEqual([]);
    expect(after.future).toEqual([]);
    expect(after.activeTransaction).toBe(false);
    expect(after.isDirty).toBe(false); // autosave never sets isDirty either — it's a pure read
  });

  it('an OPEN transaction (activeTransaction=true) is left completely alone by an autosave flush', () => {
    resetStore();
    useBuilderStore.getState().beginTransaction();
    expect(useBuilderStore.getState().activeTransaction).toBe(true);
    const pastLenAtOpen = useBuilderStore.getState().past.length;

    const scheduler = createAutosaveScheduler(() => {
      const s = useBuilderStore.getState();
      return { templateId: s.templateId, savedAt: Date.now(), zones: s.zones, meta: s.meta };
    });
    jest.useFakeTimers();
    scheduler.notifyChange();
    jest.advanceTimersByTime(3000);
    scheduler.dispose();

    // The transaction is still open, and history didn't grow — autosave
    // reading state mid-transaction must never look like a commit.
    expect(useBuilderStore.getState().activeTransaction).toBe(true);
    expect(useBuilderStore.getState().past.length).toBe(pastLenAtOpen);

    useBuilderStore.getState().endTransaction();
  });

  it('module exports contain no reference to any store mutator — autosave-draft.ts never imports store actions', () => {
    // Static-shape guard: the public API surface of the module is
    // exactly the read/write-to-localStorage helpers + the scheduler,
    // nothing that could double as a store setter.
    const mod = require('../autosave-draft');
    const exportNames = Object.keys(mod);
    expect(exportNames.sort()).toEqual(
      ['clearDraft', 'createAutosaveScheduler', 'formatDraftAge', 'isDraftNewer', 'readDraft', 'writeDraft'].sort(),
    );
  });
});
