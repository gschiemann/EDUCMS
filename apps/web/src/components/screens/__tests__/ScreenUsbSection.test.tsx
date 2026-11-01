/**
 * ScreenUsbSection (2026-10-26, M43 on site: "inserted a USB … nothing
 * happens") — the drawer's "USB drive" line: what the screen last did with a
 * stick, in plain words, from its own reports; problems in amber; admins
 * only; read only while Technical details is open.
 */
import { act, render, screen } from '@testing-library/react';
import type { ScreenUsbEvent } from '@/hooks/use-api';
import en from '@/i18n/messages/en.json';
import es from '@/i18n/messages/es.json';
import zh from '@/i18n/messages/zh.json';

let state: { data?: { events: ScreenUsbEvent[] } | unknown; isError?: boolean } = {};
const calls: Array<[string | null, boolean]> = [];
let role = 'SCHOOL_ADMIN';
jest.mock('@/hooks/use-api', () => ({
  useScreenUsbEvents: (id: string | null, enabled = true) => {
    calls.push([id, enabled]);
    return { data: state.data, isError: !!state.isError, isLoading: !state.data && !state.isError };
  },
}));
jest.mock('@/lib/store', () => ({
  useAppStore: (sel: (s: { user: { id: string; role: string } }) => unknown) => sel({ user: { id: 'u1', role } }),
}));

import { ScreenUsbSection, readUsbEvents, usbOutcomeKey } from '../ScreenUsbSection';

const ev = (over: Partial<ScreenUsbEvent>): ScreenUsbEvent => ({
  id: over.id ?? 'e',
  outcome: 'DETECTED',
  reason: 'drive: a USB drive was found',
  bundleVersion: null,
  assetCount: 0,
  createdAt: '2026-10-26T16:40:00.000Z',
  ...over,
});

beforeEach(() => {
  state = {};
  calls.length = 0;
  role = 'SCHOOL_ADMIN';
});

async function mount(enabled = true) {
  await act(async () => {
    render(<ScreenUsbSection screenId="scr-1" enabled={enabled} />);
  });
}

describe('ScreenUsbSection', () => {
  it('says the newest report in plain words — a problem in amber — and lists the earlier ones', async () => {
    state.data = {
      events: [
        ev({ id: 'c', outcome: 'NEEDS_ACCESS', reason: 'no-file-access: All files access is not granted' }),
        ev({ id: 'b', outcome: 'DETECTED' }),
        ev({ id: 'a', outcome: 'IMPORTED', reason: 'imported: 6 files', bundleVersion: '1761495599000', assetCount: 6 }),
      ],
    };
    await mount();
    const latest = screen.getByTestId('screen-usb-latest');
    expect(latest.textContent).toContain('Needs permission to read USB drives — on the screen, choose Allow');
    expect(latest.className).toContain('text-amber-800');
    expect(latest.getAttribute('data-outcome')).toBe('NEEDS_ACCESS');
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.getAttribute('data-outcome'))).toEqual(['DETECTED', 'IMPORTED']);
    expect(items[1].textContent).toContain('Playlist imported from the drive');
    expect(calls[calls.length - 1]).toEqual(['scr-1', true]);
  });

  it('says so in words when the screen has never reported a drive', async () => {
    state.data = { events: [] };
    await mount();
    expect(screen.getByTestId('screen-usb-none').textContent).toBe('No USB drive reported yet.');
    expect(screen.getByText(/Players before 1\.1\.55 report only a finished or refused import/)).toBeTruthy();
  });

  it('an answer it cannot read renders nothing; a failed read says so', async () => {
    state.data = [{ id: 'x' }];
    await mount();
    expect(screen.queryByTestId('screen-usb')).toBeNull();
  });

  it('a failed read says so', async () => {
    state.isError = true;
    await mount();
    expect(screen.getByRole('status').textContent).toBe('Couldn’t load what this screen did with USB drives.');
  });

  it('is not asked for while Technical details is closed, and only admins see it', async () => {
    await mount(false);
    expect(calls).toEqual([]);
    expect(screen.queryByTestId('screen-usb')).toBeNull();
    role = 'CONTRIBUTOR';
    state.data = { events: [ev({})] };
    await mount(true);
    expect(screen.queryByTestId('screen-usb')).toBeNull();
  });
});

describe('usbOutcomeKey', () => {
  it('maps every outcome the players send, by the reason’s code', () => {
    expect(usbOutcomeKey('DETECTED', 'drive: a USB drive was found')).toBe('detected');
    expect(usbOutcomeKey('NEEDS_ACCESS', 'no-file-access: …')).toBe('needsAccess');
    expect(usbOutcomeKey('NEEDS_ACCESS', 'no-settings-page: …')).toBe('noAccessPage');
    expect(usbOutcomeKey('NO_PACKAGE', 'no-package: …')).toBe('noPackage');
    expect(usbOutcomeKey('WAITING_KEY', 'no-key: …')).toBe('waitingKey');
    expect(usbOutcomeKey('REJECTED', 'other-organization: package is for another organization')).toBe('otherOrg');
    expect(usbOutcomeKey('REJECTED', 'unverified: file does not match its checksum')).toBe('unverified');
    expect(usbOutcomeKey('REJECTED', 'no-space: …')).toBe('noSpace');
    expect(usbOutcomeKey('REJECTED', 'unreadable: …')).toBe('unreadable');
    expect(usbOutcomeKey('REJECTED', 'manifest.json missing or too large')).toBe('rejected');
    expect(usbOutcomeKey('IMPORTED', 'imported: 6 files')).toBe('imported');
    // Players before 1.1.55.
    expect(usbOutcomeKey('ACCEPTED', null)).toBe('imported');
    expect(usbOutcomeKey('REJECTED_SIGNATURE', 'signature does not match')).toBe('unverified');
    expect(usbOutcomeKey('REJECTED_HASH', null)).toBe('unverified');
    expect(usbOutcomeKey('SOMETHING_NEW', null)).toBe('unknown');
  });

  it('every key the section can say exists in all three catalogs', () => {
    const keys = ['title', 'loading', 'loadFailed', 'none', 'note', 'detected', 'needsAccess', 'noAccessPage', 'noPackage', 'waitingKey', 'otherOrg', 'unverified', 'noSpace', 'unreadable', 'rejected', 'imported', 'unknown'];
    for (const catalog of [en, es, zh] as Array<{ screens: { usb?: Record<string, string> } }>) {
      for (const key of keys) {
        expect(typeof catalog.screens.usb?.[key]).toBe('string');
      }
    }
  });

  it('readUsbEvents keeps only well-formed rows', () => {
    expect(readUsbEvents(null)).toBeNull();
    expect(readUsbEvents({ events: 'no' })).toBeNull();
    expect(readUsbEvents({ events: [ev({ id: 'ok' }), { id: 'bad', outcome: 'X' }, ev({ id: 'when', createdAt: 'soon' })] })!.map((e) => e.id)).toEqual(['ok']);
  });
});
