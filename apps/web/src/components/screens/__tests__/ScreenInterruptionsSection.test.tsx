/**
 * ScreenInterruptionsSection (2026-10-18) — "Interruptions, last 24 h / 72 h"
 * in the screen drawer's Overview: the count is always a line ("0 in 72 h"
 * included), drills are said and not counted, rows that do not count are
 * marked, copy says what the evidence proves, admins only, never polled.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ScreenInterruptionsResponse } from '@/hooks/use-api';
import en from '@/i18n/messages/en.json';
import es from '@/i18n/messages/es.json';
import zh from '@/i18n/messages/zh.json';

let state: { data?: ScreenInterruptionsResponse; isError?: boolean } = {};
const calls: Array<[string | null, number, boolean]> = [];
let role = 'SCHOOL_ADMIN';
jest.mock('@/hooks/use-api', () => ({
  useScreenInterruptions: (id: string | null, hours: number, enabled = true) => {
    calls.push([id, hours, enabled]);
    return { data: state.data, isError: !!state.isError, isLoading: !state.data && !state.isError };
  },
}));
jest.mock('@/lib/store', () => ({
  useAppStore: (sel: (s: { user: { id: string; role: string } }) => unknown) => sel({ user: { id: 'u1', role } }),
}));

import { ScreenInterruptionsSection, interruptionCause, interruptionKindKey, readInterruptions } from '../ScreenInterruptionsSection';

type Ev = ScreenInterruptionsResponse['events'][number];
const ev = (over: Partial<Ev>): Ev => ({
  id: over.id ?? 'e', at: '2026-10-18T09:05:00.000Z', kind: 'page-reload', cause: 'operator', source: 'operator',
  sessionId: null, versionCode: null, interruption: true, drill: false, detail: null, ...over,
});
const response = (events: Ev[], summary: Partial<ScreenInterruptionsResponse['summary']> = {}, hours = 24): ScreenInterruptionsResponse => ({
  screenId: 'scr-1', hours, since: '2026-10-17T09:00:00.000Z', truncated: false, events,
  summary: { interruptions: events.filter((e) => e.interruption).length, drills: 0, byKind: {}, ...summary },
});

beforeEach(() => {
  state = {};
  calls.length = 0;
  role = 'SCHOOL_ADMIN';
});

async function mount(props: { enabled?: boolean } = {}) {
  let out: ReturnType<typeof render> | undefined;
  // RoleGate mounts on the client first (an effect), then renders.
  await act(async () => {
    out = render(<ScreenInterruptionsSection screenId="scr-1" enabled={props.enabled ?? true} />);
  });
  return out!;
}

describe('ScreenInterruptionsSection', () => {
  it('says "0 in 24 h" in so many words when nothing was recorded', async () => {
    state.data = response([]);
    await mount();
    expect(screen.getByText('Interruptions, last 24 h')).toBeTruthy();
    expect(screen.getByTestId('screen-interruptions-count').textContent).toBe('0 in 24 h');
    expect(screen.queryByTestId('screen-interruptions-list')).toBeNull();
    expect(calls[calls.length - 1]).toEqual(['scr-1', 24, true]);
  });

  it('switches to 72 h: a new read, and "0 in 72 h"', async () => {
    state.data = response([], {}, 72);
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByTestId('screen-interruptions-window-72'));
    });
    expect(calls[calls.length - 1]).toEqual(['scr-1', 72, true]);
    expect(screen.getByTestId('screen-interruptions-count').textContent).toBe('0 in 72 h');
    expect(screen.getByTestId('screen-interruptions-window-72').getAttribute('aria-pressed')).toBe('true');
  });

  it('lists what happened in plain words, marks what does not count, and says drills are not counted', async () => {
    state.data = response(
      [
        ev({ id: 'a', kind: 'page-reload', cause: 'wedge-detector', source: 'system' }),
        ev({ id: 'b', kind: 'engine-stop', cause: 'activity-paused', source: 'device' }),
        ev({ id: 'c', kind: 'engine-start', cause: 'native', interruption: false }),
        ev({ id: 'd', kind: 'emergency-start', cause: 'lockdown', drill: true, interruption: false }),
      ],
      { interruptions: 2, drills: 1 },
    );
    await mount();
    expect(screen.getByTestId('screen-interruptions-count').textContent).toBe('2 in 24 h');
    expect(screen.getByTestId('screen-interruptions-drills').textContent).toBe('1 emergency drill — not counted');
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.getAttribute('data-counted'))).toEqual(['true', 'true', 'false', 'false']);
    expect(items[0].textContent).toContain('Page reload — asked by VenueOS: the screen stopped reporting');
    expect(items[1].textContent).toContain('Hardware video stopped — the app was paused');
    expect(items[2].textContent).toContain('Hardware video started');
    expect(items[2].textContent).toContain('not counted');
    expect(items[3].textContent).toContain('Emergency drill started — Lockdown');
  });

  it('an answer it cannot read renders nothing and never throws (a stubbed API, an older API)', async () => {
    for (const body of [[], { events: [] }, { summary: 'x', events: [] }, { summary: { interruptions: '3', drills: 0 }, events: [] }, 'nope', 0]) {
      state.data = body as unknown as ScreenInterruptionsResponse;
      const out = await mount();
      expect(out.container.innerHTML).toBe('');
      out.unmount();
    }
  });

  it('a read that failed is not "0"', async () => {
    state.isError = true;
    await mount();
    expect(screen.queryByTestId('screen-interruptions-count')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Couldn’t load this screen’s interruptions.');
  });

  it('is shown to admins only, and only while the Overview is open', async () => {
    role = 'CONTRIBUTOR';
    state.data = response([]);
    await mount();
    expect(screen.queryByTestId('screen-interruptions')).toBeNull();
    expect(calls).toEqual([]);
    role = 'SCHOOL_ADMIN';
    const out = await mount({ enabled: false });
    expect(out.container.innerHTML).toBe('');
  });
});

describe('reading the answer', () => {
  it('keeps a well-formed answer and drops rows it cannot show', () => {
    const ok = readInterruptions({
      ...response([ev({ id: 'a' })], { interruptions: 1 }),
      events: [ev({ id: 'a' }), { id: 'b', kind: 'page-reload', at: 'not a date' }, null, { kind: 'x' }],
    });
    expect(ok?.summary).toEqual({ interruptions: 1, drills: 0, byKind: {} });
    expect(ok?.events.map((e) => e.id)).toEqual(['a']);
  });

  it('refuses anything without a numeric summary and a list of rows', () => {
    for (const body of [null, undefined, [], {}, { events: [] }, { summary: {}, events: [] }, { summary: { interruptions: 1, drills: 0 }, events: {} }]) {
      expect(readInterruptions(body)).toBeNull();
    }
  });
});

describe('the words for each row', () => {
  it('names every kind, drills apart, and an unknown kind honestly', () => {
    expect(interruptionKindKey({ kind: 'emergency-start', drill: false })).toBe('kindEmergencyStart');
    expect(interruptionKindKey({ kind: 'emergency-start', drill: true })).toBe('kindDrillStart');
    expect(interruptionKindKey({ kind: 'emergency-clear', drill: true })).toBe('kindDrillClear');
    expect(interruptionKindKey({ kind: 'something-new', drill: false })).toBe('kindOther');
  });

  it('says why, with the code when the screen sent one we have no words for', () => {
    expect(interruptionCause({ kind: 'page-reload', cause: 'operator', detail: { publish: true } })).toEqual({ key: 'causeOperatorPublish' });
    expect(interruptionCause({ kind: 'engine-stop', cause: 'brand-new-code', detail: null })).toEqual({ key: 'stopUnknown', values: { code: 'brand-new-code' } });
    expect(interruptionCause({ kind: 'ota-failed', cause: 'failed_aborted', detail: null })).toEqual({ key: 'causeOtaFailedCode', values: { code: 'FAILED_ABORTED' } });
    expect(interruptionCause({ kind: 'ota-download', cause: 'downloading', detail: null })).toBeNull();
    expect(interruptionCause({ kind: 'emergency-clear', cause: 'all-clear', detail: null })).toBeNull();
  });

  it('every message key the section can ask for exists in en, es and zh, and is translated', () => {
    const kinds = ['page-reload', 'app-relaunch', 'engine-start', 'engine-stop', 'engine-swap', 'rendition-swap', 'demotion',
      'ota-download', 'ota-install', 'ota-installed', 'ota-needs-tap', 'ota-failed', 'emergency-start', 'emergency-clear', 'x'];
    const keys = new Set<string>(['title', 'window24', 'window72', 'windowLabel', 'loading', 'count', 'drills', 'notCounted', 'truncated', 'loadFailed', 'note']);
    for (const kind of kinds) for (const drill of [true, false]) keys.add(interruptionKindKey({ kind, drill }));
    const causes: Array<[string, string]> = [
      ['page-reload', 'operator'], ['page-reload', 'wedge-detector'], ['page-reload', 'server-displacement'], ['page-reload', 'bundle-apply'],
      ['app-relaunch', 'reboot'], ['app-relaunch', 'process-restart'], ['app-relaunch', 'update-install'], ['app-relaunch', 'boot-diagnostic'],
      ['engine-swap', 'web-to-native'], ['engine-swap', 'native-to-web'], ['rendition-swap', 'demotion-cleared'], ['demotion', 'visible-stutter'],
      ['ota-installed', 'version-change'], ['ota-installed', 'push-satisfied'], ['ota-failed', 'relaunch_blocked'], ['ota-failed', 'error'],
      ['ota-failed', 'failed_x'], ['engine-stop', 'zzz'],
      ...['activity-paused', 'content-changed', 'emergency-held', 'output-stalled', 'process-ended', 'device-rebooted', 'page-stopped',
        'host-detached', 'document-retired', 'credential-changed', 'page-lease-expired', 'engine-switched', 'peer-stopped', 'failed']
        .map((c) => ['engine-stop', c] as [string, string]),
      ...['lockdown', 'evacuate', 'hold', 'secure', 'weather', 'medical', 'custom', 'alert'].map((c) => ['emergency-start', c] as [string, string]),
    ];
    keys.add('causeOperatorPublish');
    for (const [kind, cause] of causes) {
      const c = interruptionCause({ kind, cause, detail: null });
      expect(c).not.toBeNull();
      keys.add(c!.key);
    }
    const ns = (cat: unknown) => (cat as { screens: { interruptions: Record<string, string> } }).screens.interruptions;
    for (const key of keys) {
      for (const cat of [en, es, zh]) expect(typeof ns(cat)[key]).toBe('string');
      if (!['window24', 'window72'].includes(key)) {
        expect(ns(es)[key]).not.toBe(ns(en)[key]);
        expect(ns(zh)[key]).not.toBe(ns(en)[key]);
      }
    }
  });
});
