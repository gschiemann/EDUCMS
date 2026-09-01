/**
 * Render-level proof of the setup section (2026-08-25, v1.1.6).
 *
 * The parser test next door proves the LOGIC; this proves the PANEL obeys
 * it — that a screen with no report really renders NOTHING in the DOM, and
 * that "Open setup on this panel" posts the wire shape the API accepts.
 * That gap is exactly where "green CI, nothing changed in the operator's
 * UI" bugs live in this repo (CLAUDE.md §9), and the sibling panel's own
 * history includes a control that posted `{action:'blank'}` at an API that
 * only takes SCREAMING_CASE and failed 100% of the time. Casing gets a
 * test here for the same reason.
 */

import * as React from 'react';
import { render, screen as rtl, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DISPLAY_ACTIONS } from '@cms/api-types';
import { ScreenSetupSection } from '../ScreenSetupSection';

const apiFetchMock = jest.fn().mockResolvedValue({ success: true, delivered: true });
jest.mock('@/lib/api-client', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

const REPORT = {
  setup: {
    granted: 4,
    required: 4,
    complete: true,
    steps: [
      { key: 'installPromptShown', name: 'Install updates', applies: true, held: true, offered: true, optional: false, launch: 'direct' },
      { key: 'writeSettingsPromptShown', name: 'Brightness control', applies: true, held: true, offered: true, optional: false, launch: 'fallback' },
      { key: 'batteryExemptPromptShown', name: 'Keep Venue OS running', applies: true, held: true, offered: true, optional: false, launch: 'direct' },
      { key: 'homeSetupPromptShown', name: 'Come back after updates', applies: true, held: true, offered: true, optional: false, launch: 'direct' },
      { key: 'deviceAdminPromptShown', name: 'Turn the screen off (advanced)', applies: true, held: false, offered: false, optional: true, launch: null },
      { key: 'managerInstallPromptShown', name: 'Background updates', applies: true, held: false, offered: false, optional: true, launch: null },
    ],
  },
};

function renderSection(
  report: unknown,
  screenOver: Record<string, unknown> = {},
  props: { readOnly?: boolean } = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ScreenSetupSection
        screen={{ id: 's1', name: 'Lobby', playerVersion: '1.1.6', ...screenOver }}
        inventoryReport={report}
        readOnly={props.readOnly}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiFetchMock.mockClear();
  apiFetchMock.mockResolvedValue({ success: true, delivered: true });
});

describe('ScreenSetupSection', () => {
  it('renders NOTHING when the panel has never reported setup', () => {
    // ⚠️ THE RULE. An older APK and a fully-provisioned panel must never
    // look the same, and "no evidence" must never render as a clean bill.
    const { container } = renderSection(null);
    expect(container).toBeEmptyDOMElement();
    const older = renderSection({ admin: {}, brightness: {} });
    expect(older.container).toBeEmptyDOMElement();
  });

  it('states the outstanding optional work the completion card used to hide', () => {
    renderSection(REPORT);
    expect(rtl.getByText('4 of 4 required')).toBeInTheDocument();
    expect(
      rtl.getByText('2 optional steps were never set up on this panel.'),
    ).toBeInTheDocument();
  });

  it('names the Settings pages this MODEL hides — knowledge for the next 50 panels', () => {
    renderSection(REPORT);
    const callout = rtl.getByText(/This model hides some Settings pages/).parentElement!;
    // The grant whose `launch` was 'fallback' is NAMED in the callout — the
    // row list also carries that name, hence the scoped read.
    expect(callout.textContent).toContain('Brightness control');
    expect(callout.textContent).toContain('fall back to a broader menu');
  });

  it('never labels the un-readable Manager appop as "Needed"', () => {
    // Android exposes no way to read another package's appop, so `held` is a
    // hard false there. Telling an operator to go grant something that may
    // already be on is its own small lie.
    renderSection(REPORT);
    expect(rtl.getByText('Unknown')).toBeInTheDocument();
  });

  it('posts the OPEN_SETUP wire shape the API accepts', async () => {
    renderSection(REPORT);
    fireEvent.click(rtl.getByRole('button', { name: /Open setup on this panel/i }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    const [path, init] = apiFetchMock.mock.calls[0];
    expect(path).toBe('/screens/s1/display-control');
    const body = JSON.parse((init as any).body);
    expect(body).toEqual({ action: 'OPEN_SETUP' });
    // The verb has to exist in the shared enum or the API 400s it.
    expect(DISPLAY_ACTIONS).toContain(body.action);
    // ⚠️ The success copy states the SEND, not the glass (2026-09-01,
    // field report G65-B): "Sent to the panel", never "the setup list is
    // on the panel now" — a claim about a screen this dashboard cannot see.
    await waitFor(() =>
      expect(rtl.getByText(/Sent to the panel/)).toBeInTheDocument(),
    );
    expect(rtl.queryByText(/is on the panel now/)).not.toBeInTheDocument();
  });

  it('reports a poll-only screen as QUEUED, never as success', async () => {
    apiFetchMock.mockResolvedValue({ success: true, delivered: false });
    renderSection(REPORT);
    fireEvent.click(rtl.getByRole('button', { name: /Open setup on this panel/i }));
    await waitFor(() =>
      expect(rtl.getByText(/no live push channel/)).toBeInTheDocument(),
    );
  });

  it('hides the button on a pre-1.1.6 APK and points at the on-panel gesture', () => {
    // The bridge method shipped in v1.1.6; below that the frame is delivered
    // and then dropped as `no-bridge`. A button with a 100% failure rate is
    // exactly what this panel is not allowed to render.
    renderSection(REPORT, { playerVersion: '1.1.5' });
    expect(rtl.queryByRole('button', { name: /Open setup on this panel/i })).toBeNull();
    expect(rtl.getByText(/press and hold the\s+top-left corner for 6 seconds/i)).toBeInTheDocument();
  });

  it('is inert for a read-only role', () => {
    renderSection(REPORT, {}, { readOnly: true });
    const btn = rtl.getByRole('button', { name: /Open setup on this panel/i });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});
