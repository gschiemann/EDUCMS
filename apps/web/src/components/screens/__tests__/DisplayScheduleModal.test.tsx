/**
 * Render-level proof that the schedule editor tells the operator the truth
 * about "off" BEFORE they save.
 *
 * WHY THIS FILE EXISTS. On 2026-08-25 the operator saved one 07:00/14:45
 * window on a screen GROUP and got four different outcomes across five
 * panels — one dark and unrecoverable, two rebooted, two that did nothing.
 * Every one of those outcomes was predictable from the panel's own reported
 * power mechanism, and this editor showed none of it. The server now routes
 * each panel's scheduled off onto the path its hardware can survive; this
 * asserts the editor SAYS SO, in the DOM, not merely in a resolver object.
 *
 * Same discipline as ScreenDisplayControls.test.tsx next door, and for the
 * same reason (CLAUDE.md §9): a logic test passing while the string never
 * reaches the screen is this repo's signature failure.
 */

import * as React from 'react';
import { fireEvent, render, screen as rtl, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import en from '@/i18n/messages/en.json';
import { DisplayScheduleModal } from '../DisplayScheduleModal';

/** Verdict fixtures, in the envelope the column actually holds. */
const stored = (screenBlank: string) => ({
  schema: 1,
  reportedAt: 1_760_000_000_000,
  build: { manufacturer: 'Droidlogic', model: 'M43GUQ-CS1382D-C' },
  verdict: {
    volume: 'audiomanager',
    brightness: 'settings',
    screenBlank,
    reboot: 'none',
    hardPowerOff: 'none',
    deviceOwnerPath: 'blocked-other-owner',
  },
});

let screensFixture: any[] = [];
let schedulesFixture: Record<string, unknown>[] = [];

/**
 * The mutation doubles echo back a row with an id, exactly like the API
 * (POST returns `created`, PUT returns the re-read row). That return value is
 * load-bearing now: the form binds to it after a save instead of resetting.
 *
 * Declared at module scope and only ever DEREFERENCED inside the factory's
 * arrow bodies — the factory itself is hoisted above these initialisers, so
 * touching them eagerly would be a TDZ error.
 */
type Body = Record<string, unknown>;
const createMock = jest.fn(async (body: Body) => ({ id: 'created-1', ...body }));
const updateMock = jest.fn(async (body: Body & { id: string }) => ({ ...body }));
const deleteMock = jest.fn(async (id: string) => ({ success: true, id }));
const confirmMock = jest.fn(async (opts: Body) => opts !== null);

jest.mock('@/hooks/use-api', () => ({
  useDisplaySchedules: () => ({ data: schedulesFixture, isLoading: false }),
  useCreateDisplaySchedule: () => ({ mutateAsync: createMock, isPending: false }),
  useUpdateDisplaySchedule: () => ({ mutateAsync: updateMock, isPending: false }),
  useDeleteDisplaySchedule: () => ({ mutateAsync: deleteMock, isPending: false }),
  useScreens: () => ({ data: screensFixture }),
}));

jest.mock('@/components/ui/app-dialog', () => ({
  appConfirm: (opts: Record<string, unknown>) => confirmMock(opts),
}));

jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));

// `screens.display` holds a nested `note` object alongside its strings, so
// it is not assignable to Record<string, string> directly.
const COPY = en.screens.display as unknown as Record<string, string>;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * The two soft-off lines deliberately OPEN with the same sentence — they say
 * the same thing about the same behaviour — so identifying them by their
 * shared prefix would match either. Match the distinctive TAIL of the
 * all-panels line instead; the "some" line is identified by its counts.
 */
const SOFT_ALL = new RegExp(esc(COPY.scheduleSoftOffAll.slice(-40)));

function renderModal(
  target: {
    kind: 'screen' | 'group';
    id: string;
    name: string;
  },
  readOnly = false,
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DisplayScheduleModal target={target} readOnly={readOnly} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

/**
 * The zone the editor itself defaults to. Fixture rows use it so an overlap
 * fixture stays an overlap on a CI box in any timezone — the resolver
 * deliberately makes no claim across two different zones.
 */
const BROWSER_TZ = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago';
  } catch {
    return 'America/Chicago';
  }
})();

/** The one row the operator sees in "Saved schedules". */
const row = (over: Record<string, unknown> = {}) => ({
  id: 'ds-1',
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  onTime: '07:00',
  offTime: '22:00',
  timezone: BROWSER_TZ,
  isActive: true,
  ...over,
});

/** The labelled delete control, addressed the way a screen reader does. */
const deleteButton = () =>
  rtl.queryByRole('button', {
    name: new RegExp(esc(COPY.scheduleDeleteRow.split('{')[0])),
  });

const activeSwitch = () => rtl.getByRole('switch');
const saveButton = () => rtl.getByRole('button', { name: COPY.scheduleSave });
const updateButton = () => rtl.getByRole('button', { name: COPY.scheduleUpdate });

const SCREEN_TARGET = { kind: 'screen' as const, id: 's1', name: 'G43' };
const GROUP_TARGET = { kind: 'group' as const, id: 'g1', name: 'Front of house' };

describe('DisplayScheduleModal — what "off" will actually do', () => {
  afterEach(() => {
    screensFixture = [];
    schedulesFixture = [];
  });

  it('warns on a single panel whose power we have never proven', () => {
    // The G43's real verdict on the night of the incident.
    screensFixture = [{ id: 's1', displayCapabilities: stored('device-admin') }];
    renderModal(SCREEN_TARGET);
    expect(rtl.getByText(SOFT_ALL)).toBeInTheDocument();
  });

  it('warns on a panel that has never reported at all', () => {
    screensFixture = [{ id: 's1', displayCapabilities: null }];
    renderModal(SCREEN_TARGET);
    expect(rtl.getByText(SOFT_ALL)).toBeInTheDocument();
  });

  it('says NOTHING extra when the panel can genuinely cut its own power', () => {
    // A warning on hardware that does exactly what the operator expects is
    // noise, and noise is how a real warning stops being read.
    screensFixture = [{ id: 's1', displayCapabilities: stored('vendor-recipe') }];
    renderModal(SCREEN_TARGET);
    expect(rtl.queryByText(SOFT_ALL)).toBeNull();
  });

  it('counts a MIXED group per panel — the incident group’s own shape', () => {
    screensFixture = [
      { id: 'a', screenGroupId: 'g1', displayCapabilities: stored('vendor-recipe') },
      { id: 'b', screenGroupId: 'g1', displayCapabilities: stored('device-admin') },
      { id: 'c', screenGroupId: 'g1', displayCapabilities: stored('screen-timeout') },
      { id: 'd', screenGroupId: 'g1', displayCapabilities: null },
      // Another group's screen must not be counted.
      { id: 'e', screenGroupId: 'g2', displayCapabilities: stored('device-admin') },
    ];
    renderModal(GROUP_TARGET);
    // "3 of these 4 screens…" — resolved per member, not per group.
    expect(rtl.getByText(/\b3 of these 4\b/)).toBeInTheDocument();
    expect(rtl.queryByText(SOFT_ALL)).toBeNull();
  });

  it('reads the group through the nested relation too', () => {
    // GET /screens rows carry `screenGroupId`; the grouped list payload
    // carries `screenGroup.id`. Accept either rather than warn about nothing.
    screensFixture = [
      { id: 'a', screenGroup: { id: 'g1' }, displayCapabilities: stored('device-admin') },
    ];
    renderModal(GROUP_TARGET);
    expect(rtl.getByText(SOFT_ALL)).toBeInTheDocument();
  });

  it('warns about nothing while the fleet list is still loading', () => {
    // An empty list must not render "0 of these 0 screens".
    screensFixture = [];
    renderModal(GROUP_TARGET);
    expect(rtl.queryByText(SOFT_ALL)).toBeNull();
    expect(rtl.queryByText(/of these/)).toBeNull();
  });

  it('keeps the standing explainer — the new line adds to it, never replaces it', () => {
    screensFixture = [{ id: 's1', displayCapabilities: stored('device-admin') }];
    renderModal(SCREEN_TARGET);
    expect(
      rtl.getByText(new RegExp(COPY.scheduleExplainer.slice(0, 40))),
    ).toBeInTheDocument();
  });

  it('still says it with a saved row on screen and a save in flight behind it', async () => {
    // The soft-off note is the one piece of this editor that a panel's
    // safety depends on. It has to survive every later change to the
    // surface around it, so it is asserted with the delete control and the
    // saved-state confirmation both live rather than only on an empty modal.
    screensFixture = [{ id: 's1', displayCapabilities: stored('device-admin') }];
    schedulesFixture = [row()];
    renderModal(SCREEN_TARGET);
    expect(rtl.getByText(SOFT_ALL)).toBeInTheDocument();
    expect(deleteButton()).toBeInTheDocument();

    fireEvent.click(saveButton());
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(rtl.getByText(SOFT_ALL)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────
// "how do i delete a scheduled on/off?" — asked while looking at it
// ─────────────────────────────────────────────────────────────────────

describe('DisplayScheduleModal — deleting a schedule', () => {
  beforeEach(() => {
    schedulesFixture = [row()];
    confirmMock.mockClear();
    deleteMock.mockClear();
    confirmMock.mockResolvedValue(true);
  });
  afterEach(() => {
    schedulesFixture = [];
  });

  it('is a labelled, high-contrast control at a real touch target', () => {
    renderModal(SCREEN_TARGET);
    const btn = deleteButton();
    expect(btn).toBeInTheDocument();
    // A WORD, not a bare glyph. The old control was an unlabelled
    // `text-slate-300` trash icon — light grey on white — and the operator
    // asked how to delete a schedule while looking straight at it.
    expect(btn!.textContent).toContain(COPY.scheduleDelete);
    expect(btn!.className).not.toContain('text-slate-300');
    // The accessible name names WHICH schedule, so a screen reader reading
    // three rows does not announce "Delete, Delete, Delete".
    expect(btn!.getAttribute('aria-label')).toContain('07:00');
    expect(btn!.getAttribute('aria-label')).toContain(COPY.scheduleDelete);
    // 44px, because this product is operated from a phone. jsdom has no
    // layout, so the target is pinned at the class that produces it.
    expect(btn!.className).toContain('min-h-[44px]');
  });

  it('confirms through the existing appConfirm, with the existing copy', async () => {
    renderModal(SCREEN_TARGET);
    fireEvent.click(deleteButton()!);
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    // One confirmation path, unchanged — no second "are you sure" of our own.
    expect(confirmMock.mock.calls[0][0]).toMatchObject({
      title: COPY.scheduleDeleteTitle,
      message: COPY.scheduleDeleteBody,
      confirmLabel: COPY.scheduleDelete,
      tone: 'danger',
    });
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('ds-1'));
  });

  it('deletes nothing when the operator backs out', async () => {
    confirmMock.mockResolvedValue(false);
    renderModal(SCREEN_TARGET);
    fireEvent.click(deleteButton()!);
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('offers no delete at all to a role that can never use it', () => {
    // A CONTRIBUTOR may READ these rows (GET allows them; every mutation is
    // admin-only). A prominent rose Delete they can never press is the
    // real-button costume this repo bans — so the row stays readable and
    // the control is simply absent.
    renderModal(SCREEN_TARGET, true);
    expect(deleteButton()).toBeNull();
    expect(rtl.getByText(new RegExp(`${esc(COPY.everyDay)}.*07:00`))).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────
// "if i make it not active when i save it turns back on"
// ─────────────────────────────────────────────────────────────────────

describe('DisplayScheduleModal — what a save leaves on screen', () => {
  beforeEach(() => {
    schedulesFixture = [];
    createMock.mockClear();
    updateMock.mockClear();
  });

  /** Turn Active off, save, and wait for the write to land. */
  const pauseAndSave = async () => {
    fireEvent.click(activeSwitch());
    fireEvent.click(saveButton());
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
  };

  it('sends isActive:false and leaves the toggle showing Paused', async () => {
    renderModal(SCREEN_TARGET);
    await pauseAndSave();
    expect(createMock.mock.calls[0][0]).toMatchObject({ isActive: false });
    // THE BUG: `resetForm()` ran on success and set this back to true, so
    // the toggle sprang to Active while the operator was still looking at
    // it and the save read as a revert.
    await waitFor(() => expect(activeSwitch()).toHaveAttribute('aria-checked', 'false'));
    expect(activeSwitch().textContent).toContain(COPY.paused);
  });

  it('says what was saved — the days, the times, and that it is paused', async () => {
    renderModal(SCREEN_TARGET);
    await pauseAndSave();
    const note = await rtl.findByRole('status');
    expect(note.textContent).toContain(COPY.scheduleSavedPaused.split('{')[0].trim());
    expect(note.textContent).toContain(COPY.everyDay);
    expect(note.textContent).toContain('07:00');
    expect(note.textContent).toContain('22:00');
  });

  it('says so for an ACTIVE save too — a save always states its result', async () => {
    renderModal(SCREEN_TARGET);
    fireEvent.click(saveButton());
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    const note = await rtl.findByRole('status');
    expect(note.textContent).toContain(COPY.scheduleSavedActive.split('{')[0].trim());
    expect(note.textContent).not.toContain(COPY.scheduleSavedPaused.split('{')[0].trim());
  });

  it('UPDATES the row it just wrote — a tweak cannot silently add an active one', async () => {
    renderModal(SCREEN_TARGET);
    await pauseAndSave();
    // Exactly what the operator did next: adjust the off time and save
    // again. That used to POST a SECOND row — active, because the toggle
    // had reset — beside the paused one they thought they were editing.
    fireEvent.change(rtl.getByLabelText(COPY.turnOffAt), { target: { value: '14:45' } });
    fireEvent.click(updateButton());
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock.mock.calls[0][0]).toMatchObject({
      id: 'created-1',
      offTime: '14:45',
      isActive: false,
    });
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('retires the confirmation as soon as the form stops matching it', async () => {
    renderModal(SCREEN_TARGET);
    await pauseAndSave();
    expect(rtl.queryByRole('status')).not.toBeNull();
    fireEvent.change(rtl.getByLabelText(COPY.turnOffAt), { target: { value: '14:45' } });
    expect(rtl.queryByRole('status')).toBeNull();
  });

  it('takes one explicit click to get a NEW, Active, blank schedule', async () => {
    renderModal(SCREEN_TARGET);
    await pauseAndSave();
    expect(rtl.getByText(COPY.scheduleEditing)).toBeInTheDocument();

    fireEvent.click(rtl.getByRole('button', { name: COPY.scheduleAddAnother }));

    expect(activeSwitch()).toHaveAttribute('aria-checked', 'true');
    expect(rtl.getByText(COPY.scheduleNew)).toBeInTheDocument();
    expect(saveButton()).toBeInTheDocument();
    expect(rtl.queryByRole('status')).toBeNull();
  });

  it('keeps the form on the failed values when the save is rejected', async () => {
    createMock.mockRejectedValueOnce(new Error('nope'));
    renderModal(SCREEN_TARGET);
    fireEvent.click(activeSwitch());
    fireEvent.click(saveButton());
    await waitFor(() => expect(rtl.getByText('nope')).toBeInTheDocument());
    // Nothing was written, so nothing is confirmed — and Paused stands.
    expect(rtl.queryByRole('status')).toBeNull();
    expect(activeSwitch()).toHaveAttribute('aria-checked', 'false');
    expect(saveButton()).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Two ACTIVE windows on one target
// ─────────────────────────────────────────────────────────────────────

describe('DisplayScheduleModal — overlapping active windows', () => {
  const OVERLAP = new RegExp(esc(COPY.scheduleOverlapNote.slice(0, 40)));
  afterEach(() => {
    schedulesFixture = [];
  });

  it('warns when the draft collides with an active window already saved here', () => {
    // The form's own defaults (every day, 07:00 → 22:00) against the same
    // window already saved — the collision is total.
    schedulesFixture = [row()];
    renderModal(GROUP_TARGET);
    expect(rtl.getByText(OVERLAP)).toBeInTheDocument();
  });

  it('says nothing when the saved window is PAUSED — a paused row is not armed', () => {
    schedulesFixture = [row({ isActive: false })];
    renderModal(GROUP_TARGET);
    expect(rtl.queryByText(OVERLAP)).toBeNull();
  });

  it('says nothing when the DRAFT is paused', () => {
    schedulesFixture = [row()];
    renderModal(GROUP_TARGET);
    fireEvent.click(activeSwitch());
    expect(rtl.queryByText(OVERLAP)).toBeNull();
  });

  it('says nothing about a window that does not actually collide', () => {
    // A late Saturday window beside an every-day 07:00 → 22:00 one is an
    // ordinary configuration. Warning here is how a warning stops being read.
    schedulesFixture = [row({ daysOfWeek: [6], onTime: '22:30', offTime: '23:30' })];
    renderModal(GROUP_TARGET);
    expect(rtl.queryByText(OVERLAP)).toBeNull();
  });

  it('does not accuse a row of overlapping ITSELF while it is being edited', () => {
    schedulesFixture = [row()];
    renderModal(GROUP_TARGET);
    fireEvent.click(rtl.getByText(new RegExp(`${esc(COPY.everyDay)}.*07:00`)));
    expect(rtl.getByText(COPY.scheduleEditing)).toBeInTheDocument();
    expect(rtl.queryByText(OVERLAP)).toBeNull();
  });
});
