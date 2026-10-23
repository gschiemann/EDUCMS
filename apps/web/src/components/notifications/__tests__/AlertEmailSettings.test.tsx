/**
 * Account → Alert emails (2026-10-23): the switch shows the server's state,
 * a click saves the opposite, a failed save keeps the server's state and says
 * so, the language select saves, and non-admins see nothing.
 */
import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

let prefs: any = { enabled: true, locale: null, eligible: true };
const mutateAsync = jest.fn(async (body: any) => {
  prefs = { ...prefs, ...(body.enabled !== undefined ? { enabled: body.enabled } : {}), ...(body.locale !== undefined ? { locale: body.locale } : {}) };
  return prefs;
});

jest.mock('@/hooks/use-api', () => ({
  useAlertEmailPrefs: () => ({ data: prefs, isPending: false, isError: false }),
  useSetAlertEmailPrefs: () => ({ mutateAsync, isPending: false }),
}));

import { AlertEmailSettings } from '../AlertEmailSettings';

beforeEach(() => {
  prefs = { enabled: true, locale: null, eligible: true };
  mutateAsync.mockClear();
});

describe('AlertEmailSettings', () => {
  it('shows the switch ON by default, with the anchor the emails link to', () => {
    const { container } = render(<AlertEmailSettings />);
    expect(screen.getByText('Alert emails')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Alert emails on or off' })).toHaveAttribute('aria-checked', 'true');
    expect(container.querySelector('#alert-emails')).not.toBeNull();
  });

  it('turning it off saves enabled:false and says Saved', async () => {
    const { rerender } = render(<AlertEmailSettings />);
    await act(async () => {
      fireEvent.click(screen.getByRole('switch'));
    });
    expect(mutateAsync).toHaveBeenCalledWith({ enabled: false });
    rerender(<AlertEmailSettings />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('a failed save keeps the server state and says so', async () => {
    mutateAsync.mockImplementationOnce(async () => {
      throw new Error('500');
    });
    render(<AlertEmailSettings />);
    await act(async () => {
      fireEvent.click(screen.getByRole('switch'));
    });
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Couldn’t save. Try again.');
  });

  it('the language select saves the chosen language', async () => {
    render(<AlertEmailSettings />);
    await act(async () => {
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'es' } });
    });
    expect(mutateAsync).toHaveBeenCalledWith({ locale: 'es' });
  });

  it('renders nothing for someone who does not receive alert emails', () => {
    prefs = { enabled: true, locale: null, eligible: false };
    const { container } = render(<AlertEmailSettings />);
    expect(container).toBeEmptyDOMElement();
  });
});
