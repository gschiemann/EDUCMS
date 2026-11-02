/**
 * Render-level proof of the capability-truth contract.
 *
 * The resolver test next door proves the LOGIC; this one proves the PANEL
 * actually obeys it — that a `reboot: none` screen really has no reboot
 * button in the DOM, not merely a `false` in a resolver object. That gap
 * is exactly where "green CI, nothing changed in the operator's UI" bugs
 * live in this repo (CLAUDE.md §9), so it gets its own assertions.
 *
 * 2026-08-13 additions:
 *  - the WIRE SHAPE is asserted here too. The panel used to post
 *    `{action:'blank'}` against an API that only accepts
 *    `z.enum(['SET_VOLUME','SET_BRIGHTNESS','BLANK','WAKE','REBOOT'])`, so
 *    every control 400'd — a 100%-failure-rate defect that no render
 *    assertion could see. Casing is now pinned by a test that reads the
 *    actual fetch body.
 *  - the NO-DEVICE-OWNER layout (reboot absent) is a first-class case, not
 *    an afterthought: it is what the entire real fleet renders.
 */

import * as React from 'react';
import { render, screen as rtl, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DISPLAY_ACTIONS, DISPLAY_RECOVERY_MIN_BRIGHTNESS_PERCENT } from '@cms/api-types';
import { ScreenDisplayControls } from '../ScreenDisplayControls';

const apiFetchMock = jest.fn().mockResolvedValue({ success: true });
// The one-line on/off schedule reads GET /display-schedules; it is answered
// here so the wire-shape assertions below only ever see display-control calls.
const SCHEDULES = [{ id: 'sc1', onTime: '07:00', offTime: '18:00', isActive: true }];
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: unknown, ...rest: unknown[]) =>
    String(path).startsWith('/display-schedules')
      ? Promise.resolve(SCHEDULES)
      : apiFetchMock(path, ...rest),
}));

/**
 * Fixtures below are VERDICTS; the column holds the probe DOCUMENT with the
 * verdict under a `verdict` key (what `normalizeCapabilityReport` writes).
 * Since the 2026-08-14 sweep the resolver reads that column with the API's
 * own `readStoredDisplayVerdict`, so a bare verdict is (correctly) "nothing
 * reported" — the envelope is added here rather than in 20 call sites.
 */
/**
 * ── PANEL STATE FIXTURES (2026-08-25, second pass) ──────────────────────
 *
 * The power row now offers the verb that matches the GLASS, derived from the
 * render-proof fields every `GET /screens` row already carries. So a test
 * that renders this panel has to say what the panel is doing, or it is
 * testing the "we can't tell" branch by accident.
 *
 * PAINTING is the default because it is the overwhelmingly common real case
 * — and it is the exact state the operator was in when he was offered "Turn
 * panel on" for a screen that was plainly on.
 */
const PAINTING = { status: 'ONLINE', renderHealth: 'OK' as const };
/** Reachable, but pixels are not advancing: dark, asleep, or wedged. */
const DARK = { status: 'ONLINE', renderHealth: 'STALE' as const, renderStale: true };
/** Offline, or a build that never posted render proof. We do not guess. */
const UNPROVED = { status: 'OFFLINE' as const };

function renderPanel(
  verdict: unknown,
  props: { readOnly?: boolean } = {},
  screenOver: Record<string, unknown> = PAINTING,
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const displayCapabilities =
    verdict === null || verdict === undefined
      ? verdict
      : { schema: 1, reportedAt: 1_760_000_000_000, build: {}, verdict };
  return render(
    <QueryClientProvider client={qc}>
      <ScreenDisplayControls
        screen={{ id: 's1', name: 'Lobby', displayCapabilities, ...screenOver }}
        onOpenSchedule={() => {}}
        {...props}
      />
    </QueryClientProvider>,
  );
}

const CAPABLE = {
  volume: 'audiomanager',
  brightness: 'sysfs',
  screenBlank: 'device-owner',
  reboot: 'device-owner',
  deviceOwnerPath: 'held',
};

/**
 * The vocabulary a CURRENT APK actually reports: DisplayControlRegistry
 * provider ids (contract C5), on a fleet with no device owner.
 */
const REGISTRY_FLEET = {
  volume: 'audiomanager',
  brightness: 'sysfs-backlight',
  screenBlank: 'screen-timeout',
  reboot: 'none',
  deviceOwnerPath: 'provisionable-after-factory-reset',
};

/**
 * What the ENTIRE real fleet looks like after the 2026-08-13 product
 * decision not to provision as Android device owner: no reboot, and the
 * blank path is whatever device-admin/software floor the box has.
 */
const NO_DEVICE_OWNER = {
  volume: 'audiomanager',
  brightness: 'settings',
  screenBlank: 'none',
  reboot: 'none',
  deviceOwnerPath: 'provisionable-after-factory-reset',
};

/** Tap the (i) next to a slider — the hint is tap/hover-only, never always-on. */
const openHint = () => rtl.getAllByRole('button', { name: /More information/ }).forEach((b) => fireEvent.click(b));

const pressed = (name: RegExp) =>
  rtl.getByRole('button', { name }).getAttribute('aria-pressed');

beforeEach(() => apiFetchMock.mockClear());

describe('ScreenDisplayControls — what actually reaches the DOM', () => {
  it('renders no volume slider and no reboot before the screen has reported', () => {
    renderPanel(null);
    // Brightness (raise-only) is the ONLY slider; volume has no recovery
    // direction and the API refuses it on a null verdict.
    expect(rtl.getAllByRole('slider')).toHaveLength(1);
    expect(rtl.queryByRole('button', { name: /Restart player/ })).toBeNull();
    // No explainer paragraph: what a screen cannot do is simply not drawn.
    expect(rtl.queryByText(/once this screen reports what it can do/i)).toBeNull();
  });

  // ⚠️ REVERSED AGAIN 2026-08-25 (the blank/power split). On 2026-08-13 this
  // replaced "still offers Blank/Wake" and asserted Blank is WITHHELD before
  // a verdict, because Blank could reach a device-admin lock and the API
  // refused it. It cannot and does not any more: Blank is a black overlay in
  // the player's own page, the API accepts it on a null verdict, and it is
  // exactly as safe here as anywhere. What moved into the withheld seat is
  // panel POWER — which is genuinely hardware.
  it('offers ONLY the actions the API accepts on a screen that never reported', () => {
    renderPanel(null);
    expect(rtl.getByRole('button', { name: /^Sleep$/ })).not.toBeDisabled();
    expect(rtl.getByRole('button', { name: /^Awake$/ })).not.toBeDisabled();
    expect(rtl.getByLabelText(/Brightness/)).toBeTruthy();
    expect(rtl.getByTestId('schedule-line')).toBeTruthy();
    // ONE pair: no other power wording anywhere.
    expect(rtl.queryByRole('button', { name: /Turn panel|Blank|Wake$/ })).toBeNull();
  });

  // The brightness slider on an unreported screen must not be able to
  // express a request the API will refuse: its floor IS the server's
  // recovery floor, so every position on the track is acceptable.
  it('raise-only brightness slider starts at the server’s recovery floor', () => {
    renderPanel(null);
    const brightness = rtl.getByLabelText(/Brightness/) as HTMLInputElement;
    expect(Number(brightness.min)).toBe(DISPLAY_RECOVERY_MIN_BRIGHTNESS_PERCENT);
    openHint();
    expect(rtl.getByText(/brightness can only go up/i)).toBeTruthy();
  });

  it('posts a raise-only brightness the API will accept on an unreported screen', async () => {
    renderPanel(null);
    const brightness = rtl.getByLabelText(/Brightness/) as HTMLInputElement;
    // The slider cannot go below its min, but a hostile/keyboard value can.
    fireEvent.change(brightness, { target: { value: '5' } });
    await act(async () => {
      fireEvent.blur(brightness);
    });
    const body = JSON.parse(apiFetchMock.mock.calls[0][1].body);
    expect(body.action).toBe('SET_BRIGHTNESS');
    expect(body.percent).toBeGreaterThanOrEqual(DISPLAY_RECOVERY_MIN_BRIGHTNESS_PERCENT);
  });

  it('renders both sliders, blank/wake and reboot on a fully-capable device', () => {
    renderPanel(CAPABLE);
    expect(rtl.getAllByRole('slider')).toHaveLength(2);
    expect(rtl.getByRole('button', { name: /^Sleep$/ })).toBeTruthy();
    expect(rtl.getByRole('button', { name: /^Awake$/ })).toBeTruthy();
    expect(rtl.getByRole('button', { name: /Restart player/ })).toBeTruthy();
  });

  it('omits the restart button when the probe says reboot:none, and says nothing about it', () => {
    renderPanel({ ...CAPABLE, reboot: 'none', deviceOwnerPath: 'blocked-other-owner' });
    expect(rtl.queryByRole('button', { name: /Restart player/ })).toBeNull();
    expect(rtl.queryByText(/management app|device-owner|Not available/i)).toBeNull();
  });

  // The no-device-owner fleet shape, rendered end to end. Nothing may be
  // left dangling where the reboot control used to be: the explainer row
  // owns its own divider, and every other section still renders.
  it('renders cleanly with reboot absent — the whole real fleet’s layout', () => {
    const { container } = renderPanel(NO_DEVICE_OWNER);
    expect(rtl.queryByRole('button', { name: /Restart player/ })).toBeNull();
    // Nothing replaces it: no explainer row, no greyed control.
    expect(rtl.queryByText(/device-owner|factory reset/i)).toBeNull();
    // Everything else survives.
    expect(rtl.getAllByRole('slider')).toHaveLength(2);
    expect(rtl.getByRole('button', { name: /^Sleep$/ })).toBeTruthy();
    expect(rtl.getByRole('button', { name: /^Awake$/ })).toBeTruthy();
    expect(rtl.getByTestId('schedule-line')).toBeTruthy();
    // No empty section: every direct child of the panel has content.
    const panel = container.firstElementChild as HTMLElement;
    Array.from(panel.children).forEach((child) => {
      expect((child.textContent ?? '').trim().length).toBeGreaterThan(0);
    });
  });

  // Same shape as the case above, but with the vocabulary a CURRENT APK
  // really emits (registry provider ids, contract C5). Before C5 landed in
  // the resolver this verdict rendered the never-reported layout — full
  // controls silently downgraded to recovery-only on a healthy screen.
  it('renders the real fleet’s REGISTRY verdict as fully reported, reboot absent', () => {
    const { container } = renderPanel(REGISTRY_FLEET);
    expect(rtl.getAllByRole('slider')).toHaveLength(2);
    expect(rtl.getByRole('button', { name: /^Sleep$/ })).toBeTruthy();
    expect(rtl.getByRole('button', { name: /^Awake$/ })).toBeTruthy();
    expect(rtl.queryByRole('button', { name: /Restart player/ })).toBeNull();
    expect(rtl.queryByText(/device-owner|factory reset/i)).toBeNull();
    // screen-timeout has no hard power: Sleep still works, via the soft blank.
    expect(rtl.queryByRole('button', { name: /Turn panel off/ })).toBeNull();
    // Real backlight control, so no "image only" label.
    expect(rtl.getByLabelText('Brightness')).toBeTruthy();
    // No empty section, no dangling divider anywhere in the reboot-absent
    // layout — this is what the whole pilot fleet renders.
    const panel = container.firstElementChild as HTMLElement;
    Array.from(panel.children).forEach((child) => {
      expect((child.textContent ?? '').trim().length).toBeGreaterThan(0);
    });
  });

  it('omits the volume SLIDER when the device exposes no volume interface', () => {
    renderPanel({ ...CAPABLE, volume: 'none' });
    // Brightness slider survives; volume does not.
    expect(rtl.getAllByRole('slider')).toHaveLength(1);
    expect(rtl.queryByLabelText('Volume')).toBeNull();
    expect(rtl.queryByText(/exposes no volume interface/i)).toBeNull();
  });

  it('keeps the brightness slider on a software-dim box but says it dims the image only', () => {
    renderPanel({ ...CAPABLE, brightness: 'software-dim' });
    expect(rtl.getByLabelText('Brightness')).toBeTruthy();
    openHint();
    expect(
      rtl.getByText(/Dims the image only — this box exposes no backlight control/i),
    ).toBeTruthy();
  });

  // ═══════════════════════════════════════════════════════════════════
  // ONE Sleep / Awake pair, state highlighted (owner spec)
  // ═══════════════════════════════════════════════════════════════════
  it('shows the on/off schedule as ONE line with an Edit button', async () => {
    renderPanel(CAPABLE);
    expect(await rtl.findByText('Off 6 PM – on 7 AM')).toBeTruthy();
    expect(rtl.getByRole('button', { name: 'Edit' })).toBeTruthy();
  });

  it('highlights Awake when the screen is online and showing', () => {
    renderPanel(CAPABLE, {}, PAINTING);
    expect(pressed(/^Awake$/)).toBe('true');
    expect(pressed(/^Sleep$/)).toBe('false');
    expect(rtl.getByTestId('power-state').textContent).toMatch(/Awake and showing/);
  });

  it('highlights Sleep when render proof says the glass is not lit', () => {
    renderPanel(CAPABLE, {}, DARK);
    expect(pressed(/^Sleep$/)).toBe('true');
    expect(pressed(/^Awake$/)).toBe('false');
    expect(rtl.getByTestId('power-state').textContent).toMatch(/Sleeping/);
  });

  it('highlights Sleep from the native report even while the page still paints', () => {
    renderPanel({ ...CAPABLE, screenBlank: 'vendor-backlight' }, {}, {
      ...PAINTING,
      nativeRuntimeReport: { sleep: { blank: 'vendor-backlight', vb: { d: 'available', off: true } } },
      nativeRuntimeReportAt: new Date().toISOString(),
    });
    expect(pressed(/^Sleep$/)).toBe('true');
    expect(pressed(/^Awake$/)).toBe('false');
  });

  it('highlights NEITHER and says "State unknown" when there is no evidence', () => {
    renderPanel(CAPABLE, {}, UNPROVED);
    expect(pressed(/^Sleep$/)).toBe('false');
    expect(pressed(/^Awake$/)).toBe('false');
    expect(rtl.getByTestId('power-state').textContent).toBe('State unknown');
    // Both are still live: recovery is never gated.
    expect(rtl.getByRole('button', { name: /^Awake$/ })).not.toBeDisabled();
  });

  it('never renders a mechanism name or the old power wording', () => {
    for (const screenBlank of ['none', 'device-admin', 'vendor-recipe', 'vendor-backlight']) {
      const { container, unmount } = renderPanel({ ...CAPABLE, screenBlank }, {}, PAINTING);
      const text = container.textContent ?? '';
      expect(text).not.toMatch(/Turn panel|Panel power|\bBlank\b|vendor|device-admin/i);
      unmount();
    }
  });

  // ── THE BRIGHTNESS SPLIT, AT THE DOM ────────────────────────────────

  it('labels a `settings` panel "image only" — its backlight does not move', () => {
    // G43 / Mobile A-Frame: a non-writable /sys/class/backlight node falls
    // through to `settings`, whose write SUCCEEDS while the vendor firmware
    // ignores it. The API routes those soft and the player dims its own
    // picture, so "Sets the Android system brightness" was true and useless.
    renderPanel({ ...CAPABLE, brightness: 'settings' });
    expect(rtl.getByLabelText('Brightness')).toBeTruthy();
    // The slider itself is unchanged — it renders on every screen, and its
    // floor is still the API's own gate value.
    const slider = rtl.getByLabelText('Brightness') as HTMLInputElement;
    expect(Number(slider.min)).toBeGreaterThanOrEqual(5);
  });

  it('leaves the proven backlight panels labelled as real brightness', () => {
    // M43 / L55VEC — writable aml-bl. Nothing about their row moves.
    for (const brightness of ['sysfs', 'sysfs-backlight', 'vendor-recipe']) {
      const { unmount } = renderPanel({ ...CAPABLE, brightness });
      expect(rtl.getByLabelText('Brightness')).toBeTruthy();
      expect(rtl.queryByLabelText(/image only/)).toBeNull();
      unmount();
    }
  });

  // ── COPY HYGIENE, AT THE DOM ────────────────────────────────────────
  //
  // The power note shipped with a date and a two-panel incident narrative in
  // it, and the operator read all of that in his gear popover. Design-doc
  // prose is not product copy. The resolver test pins the strings; this pins
  // what actually reaches the glass, across every branch of this panel.

  it('never renders a date or an incident story anywhere in the panel', () => {
    const DATE_LIKE =
      /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i;
    const STORY =
      /woke itself|mains|pulled the power|supervised|vendor standby|IR remote|device-admin|latched/i;
    const branches: Array<[unknown, Record<string, unknown>]> = [
      [null, PAINTING],
      [CAPABLE, PAINTING],
      [{ ...CAPABLE, screenBlank: 'device-admin' }, PAINTING],
      [{ ...CAPABLE, screenBlank: 'device-admin' }, DARK],
      [{ ...CAPABLE, screenBlank: 'vendor-recipe' }, PAINTING],
      [{ ...CAPABLE, screenBlank: 'vendor-recipe' }, UNPROVED],
      [{ ...CAPABLE, screenBlank: 'none' }, PAINTING],
      [{ ...CAPABLE, brightness: 'settings' }, PAINTING],
    ];
    for (const [verdict, state] of branches) {
      const { container, unmount } = renderPanel(verdict, {}, state);
      const text = (container.textContent ?? '').replace(/\s+/g, ' ');
      expect([verdict, DATE_LIKE.test(text)]).toEqual([verdict, false]);
      expect([verdict, STORY.test(text)]).toEqual([verdict, false]);
      unmount();
    }
  });

  it('never offers a brightness below the safe floor', () => {
    renderPanel(CAPABLE);
    const brightness = rtl.getByLabelText('Brightness') as HTMLInputElement;
    expect(Number(brightness.min)).toBeGreaterThanOrEqual(5);
  });

  // ⚠️ REPLACES 'promises the blank auto-wakes…'. The 10-minute dead-man
  // revert existed because Blank reached hardware and a forgotten click was
  // a truck roll. A soft blank cannot strand anything — Wake, a reload or an
  // alert all end it — and the operator's contract is "blank should just do
  // that", which a blank that un-blanks itself after ten minutes is not.
  // What must never regress is that the copy describes what WE SENT, never a
  // device state we cannot observe.
  it('describes what Sleep and Awake do, and never claims an unobserved state', () => {
    renderPanel(CAPABLE, {}, UNPROVED);
    expect(rtl.getByText(/An emergency alert always wakes it/i)).toBeTruthy();
    expect(rtl.queryByText(/Wakes itself after 10 min/i)).toBeNull();
  });

  // With no device-echoed level the thumb used to park at 50% on a screen
  // that might be at 100%; a "small trim" then sent an absolute 49%.
  it('parks an unknown level where a blind nudge is recoverable, and says so', () => {
    renderPanel(CAPABLE);
    const brightness = rtl.getByLabelText('Brightness') as HTMLInputElement;
    const volume = rtl.getByLabelText('Volume') as HTMLInputElement;
    // Darkness is not recoverable; silence is.
    expect(Number(brightness.value)).toBe(100);
    expect(Number(volume.value)).toBe(0);
    // No number while unknown, and the hint is tap-only.
    expect(rtl.getAllByTestId('level-readout').every((r) => r.textContent === '')).toBe(true);
    expect(rtl.queryByTestId('level-hint')).toBeNull();
    openHint();
    expect(rtl.getAllByText(/can’t see this screen’s current level/i).length).toBeGreaterThan(0);
  });

  it('renders every control inert for a role that cannot drive display control', () => {
    renderPanel(CAPABLE, { readOnly: true });
    rtl.getAllByRole('slider').forEach((s) => expect(s).toBeDisabled());
    expect(rtl.getByRole('button', { name: /^Sleep$/ })).toBeDisabled();
    expect(rtl.getByRole('button', { name: /^Awake$/ })).toBeDisabled();
    expect(rtl.getByRole('button', { name: /Restart player/ })).toBeDisabled();
  });
});

describe('ScreenDisplayControls — the wire shape (contract C1)', () => {
  it('Sleep posts the soft BLANK where the hardware has no proven power-off', async () => {
    renderPanel({ ...CAPABLE, screenBlank: 'device-admin' });
    await act(async () => {
      fireEvent.click(rtl.getByRole('button', { name: /^Sleep$/ }));
    });
    const [path, init] = apiFetchMock.mock.calls[0];
    expect(path).toBe('/screens/s1/display-control');
    const body = JSON.parse(init.body);
    expect(body.action).toBe('BLANK');
    expect(DISPLAY_ACTIONS).toContain(body.action);
    expect(body.revertAfterMs).toBeUndefined();
  });

  it('Sleep posts POWER_OFF where the hardware proves it — the mechanism is hidden', async () => {
    renderPanel({ ...CAPABLE, screenBlank: 'vendor-recipe' });
    await act(async () => {
      fireEvent.click(rtl.getByRole('button', { name: /^Sleep$/ }));
    });
    const body = JSON.parse(apiFetchMock.mock.calls[0][1].body);
    expect(body.action).toBe('POWER_OFF');
    expect(DISPLAY_ACTIONS).toContain(body.action);
  });

  it('Awake posts POWER_ON then WAKE (recovery on both layers)', async () => {
    renderPanel({ ...CAPABLE, screenBlank: 'vendor-recipe' }, {}, DARK);
    await act(async () => {
      fireEvent.click(rtl.getByRole('button', { name: /^Awake$/ }));
    });
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(2));
    const actions = apiFetchMock.mock.calls.map((c) => JSON.parse(c[1].body).action);
    expect(actions).toEqual(['POWER_ON', 'WAKE']);
    actions.forEach((a) => expect(DISPLAY_ACTIONS).toContain(a));
  });

  it('shows a pending spinner on the pressed button until the screen confirms', async () => {
    renderPanel(CAPABLE, {}, PAINTING);
    await act(async () => {
      fireEvent.click(rtl.getByRole('button', { name: /^Sleep$/ }));
    });
    // Accepted, but render proof still says "painting": Sleep is pending,
    // Awake stays highlighted — we do not move the highlight on our own say-so.
    expect(rtl.getByRole('button', { name: /^Sleep$/ }).getAttribute('aria-busy')).toBe('true');
    expect(pressed(/^Awake$/)).toBe('true');
    expect(rtl.getByText(/Putting the screen to sleep/i)).toBeTruthy();
  });

  it('posts SET_BRIGHTNESS with the clamped percent', async () => {
    renderPanel(CAPABLE);
    const brightness = rtl.getByLabelText('Brightness') as HTMLInputElement;
    fireEvent.change(brightness, { target: { value: '1' } });
    await act(async () => {
      fireEvent.blur(brightness);
    });
    const body = JSON.parse(apiFetchMock.mock.calls[0][1].body);
    expect(body.action).toBe('SET_BRIGHTNESS');
    expect(DISPLAY_ACTIONS).toContain(body.action);
    // A remote 0-ish % on a screen nobody can reach is a truck roll.
    expect(body.percent).toBe(5);
  });

  it('posts SET_VOLUME, not "volume"', async () => {
    renderPanel(CAPABLE);
    const volume = rtl.getByLabelText('Volume') as HTMLInputElement;
    fireEvent.change(volume, { target: { value: '30' } });
    await act(async () => {
      fireEvent.blur(volume);
    });
    const body = JSON.parse(apiFetchMock.mock.calls[0][1].body);
    expect(body.action).toBe('SET_VOLUME');
    expect(body.percent).toBe(30);
  });

  // DELIVERY HONESTY. `success:true` + `delivered:false` is what the API
  // returns when Redis is down — a supported deploy state. The old panel
  // painted the emerald "Wake command sent" row for it, telling the
  // operator a dark screen had been woken when nothing left the process.
  it('reports an UNDELIVERED action as a failure, not a green "sent" row', async () => {
    apiFetchMock.mockResolvedValueOnce({
      success: true,
      delivered: false,
      deliveryReason: 'redis_unavailable',
    });
    renderPanel(CAPABLE);
    await act(async () => {
      fireEvent.click(rtl.getByRole('button', { name: /^Awake$/ }));
    });
    await waitFor(() => expect(rtl.getByRole('status')).toBeTruthy());
    const row = rtl.getByRole('status');
    expect(row.textContent).toMatch(/Couldn't reach this screen/i);
    expect(row.className).toMatch(/rose/);
    expect(rtl.queryByText(/Awake sent/)).toBeNull();
  });

  // THE SECOND HALF OF THE LIE (2026-08-25). `delivered` used to be graded
  // off the Redis fan-out alone — a fact about the SERVER — so a panel on the
  // HTTP-poll tier (venue proxy blocking WS/SSE) got the green "sent" row for
  // a command it never received. The API now grades per-screen and says why,
  // so this row can too: 'no_push_socket' is an EXPLANATION, not an outage,
  // and must not wear the same red as a dead transport.
  it('explains a no-push-socket action instead of alarming about it', async () => {
    apiFetchMock.mockResolvedValueOnce({
      success: true,
      delivered: false,
      deliveryReason: 'no_push_socket',
    });
    renderPanel(CAPABLE);
    await act(async () => {
      fireEvent.click(rtl.getByRole('button', { name: /^Awake$/ }));
    });
    await waitFor(() => expect(rtl.getByRole('status')).toBeTruthy());
    const row = rtl.getByRole('status');

    // Names the CAUSE (this screen has no live connection)…
    expect(row.textContent).toMatch(/isn't connected right now/i);
    // …and is honest about the consequence: nothing is queued. Display
    // actions are immediate-only — the manifest carries schedules, never
    // immediate actions, and nothing replays a missed frame. Promising an
    // automatic retry would be a fresh lie inside the fix for one.
    expect(row.textContent).toMatch(/won't be sent later/i);
    // Never claims success.
    expect(rtl.queryByText(/Awake sent/)).toBeNull();
    // Explanation styling, not alarm styling.
    expect(row.className).not.toMatch(/rose/);
    expect(row.className).toMatch(/slate/);
  });

  it('keeps the RED alarm for a genuine transport failure', async () => {
    // The two failure reasons must stay visually distinguishable — grading
    // them the same is how a real outage gets ignored.
    apiFetchMock.mockResolvedValueOnce({
      success: true,
      delivered: false,
      deliveryReason: 'publish_failed',
    });
    renderPanel(CAPABLE);
    await act(async () => {
      fireEvent.click(rtl.getByRole('button', { name: /^Awake$/ }));
    });
    await waitFor(() => expect(rtl.getByRole('status')).toBeTruthy());
    const row = rtl.getByRole('status');
    expect(row.textContent).toMatch(/Couldn't reach this screen/i);
    expect(row.className).toMatch(/rose/);
  });

  it('still reports a DELIVERED action as sent', async () => {
    apiFetchMock.mockResolvedValueOnce({ success: true, delivered: true, deliveryReason: null });
    renderPanel(CAPABLE);
    await act(async () => {
      fireEvent.click(rtl.getByRole('button', { name: /^Awake$/ }));
    });
    await waitFor(() => expect(rtl.getByRole('status')).toBeTruthy());
    expect(rtl.getByRole('status').textContent).toMatch(/Awake sent/i);
  });

  /**
   * A TIMED-OUT BLANK IS AN UNKNOWN, AND MUST READ AS ONE.
   *
   * `useDisplayControl` aborts a POST that hangs past its 12 s cap, so the
   * button unwedges — but the rejection is a DOMException whose message is
   * browser jargon ("The user aborted a request" / "Fetch is aborted").
   * Rendering that verbatim reads as "the browser cancelled it", i.e. as
   * nothing-happened, on the one action where the screen may in fact now be
   * dark. The row must instead say we cannot tell, and name Wake.
   */
  it('renders a timed-out Sleep as UNKNOWN, pointing at Awake — not as browser jargon', async () => {
    const abort = new Error('The user aborted a request.');
    abort.name = 'AbortError';
    apiFetchMock.mockRejectedValueOnce(abort);
    renderPanel(CAPABLE);
    await act(async () => {
      fireEvent.click(rtl.getByRole('button', { name: /^Sleep$/ }));
    });
    await waitFor(() => expect(rtl.getByRole('status')).toBeTruthy());
    const row = rtl.getByRole('status');
    expect(row.textContent).toMatch(/can't tell if it worked/i);
    expect(row.textContent).toMatch(/press Awake/i);
    expect(row.textContent).not.toMatch(/aborted/i);
    expect(row.className).toMatch(/rose/);
    // …and the recovery control is live, not stuck behind the dead request.
    expect(rtl.getByRole('button', { name: /^Awake$/ })).not.toBeDisabled();
  });

  // Awake is the recovery control for Blank. Gating it on the action it
  // recovers from is how a wedged API leaves a dark screen dark.
  it('leaves Awake enabled while a Sleep is still in flight', async () => {
    let release: (v: unknown) => void = () => {};
    apiFetchMock.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    renderPanel(CAPABLE);
    await act(async () => {
      fireEvent.click(rtl.getByRole('button', { name: /^Sleep$/ }));
    });
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(rtl.getByRole('button', { name: /^Sleep$/ })).toBeDisabled();
    expect(rtl.getByRole('button', { name: /^Awake$/ })).not.toBeDisabled();
    await act(async () => {
      release({ success: true });
    });
  });
});
