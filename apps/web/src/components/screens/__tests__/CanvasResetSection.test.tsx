/**
 * CanvasResetSection (2026-09-01, G55 field find) — the dashboard's reach into
 * a device-side LED canvas pin. Pinned: it sends RESET_CANVAS over display
 * control for an APK player, renders nothing for a browser player, is inert
 * for a read-only role, and its copy states the SEND, never the glass.
 */
import * as React from 'react';
import { render, screen as rtl, fireEvent, act } from '@testing-library/react';

const mutateMock = jest.fn();
jest.mock('@/hooks/use-api', () => ({
  useDisplayControl: () => ({ mutate: mutateMock, isPending: false }),
  DISPLAY_CONTROL_TIMEOUT_MS: 12_000,
}));

import { CanvasResetSection } from '../CanvasResetSection';

const ANDROID = { id: 'g55', name: 'GUQ55', osInfo: 'Android', resolution: '2160×3840', hardwareModel: 'generic-android' };

describe('CanvasResetSection', () => {
  beforeEach(() => mutateMock.mockReset());

  it('sends RESET_CANVAS for this screen and reports the send, not the glass', () => {
    render(<CanvasResetSection screen={ANDROID} />);
    expect(rtl.getByText('panel 2160×3840')).toBeInTheDocument();
    fireEvent.click(rtl.getByRole('button', { name: /Reset canvas on the screen/ }));
    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock.mock.calls[0][0]).toEqual({ screenId: 'g55', action: 'RESET_CANVAS' });
    // Drive the success callback the way the hook would.
    act(() => { mutateMock.mock.calls[0][1].onSuccess({ delivered: true }); });
    expect(rtl.getByText(/Sent — the screen clears any canvas size/)).toBeInTheDocument();
  });

  it('says "queued" when the screen has no live push channel', () => {
    render(<CanvasResetSection screen={ANDROID} />);
    fireEvent.click(rtl.getByRole('button', { name: /Reset canvas on the screen/ }));
    act(() => { mutateMock.mock.calls[0][1].onSuccess({ delivered: false }); });
    expect(rtl.getByText(/Queued — this screen has no live push channel/)).toBeInTheDocument();
  });

  it('renders nothing for a browser player', () => {
    const { container } = render(
      <CanvasResetSection screen={{ id: 'b1', osInfo: 'macOS', hardwareModel: 'web' }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('is inert for a read-only role', () => {
    render(<CanvasResetSection screen={ANDROID} readOnly />);
    const btn = rtl.getByRole('button', { name: /Reset canvas on the screen/ });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(mutateMock).not.toHaveBeenCalled();
  });
});
