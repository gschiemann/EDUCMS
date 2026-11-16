/**
 * Panic phones (2026-11-14) — the admin's "Emergency phones" panel on the
 * People page: lists a person's phones once (no polling), turns one off after
 * a confirmation, and says when the person cannot send at all.
 */
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));
const appConfirm = jest.fn();
jest.mock('@/components/ui/app-dialog', () => ({ appConfirm: (...a: unknown[]) => appConfirm(...a) }));

import { PanicPhonesPanel } from '../PanicPhonesPanel';

const PHONE = { id: 'pd-1', label: 'iPhone · Safari', createdAt: '2026-11-01T00:00:00Z', lastUsedAt: null, revokedAt: null, revokedReason: null, state: 'active' };

beforeEach(() => {
  apiFetch.mockReset();
  appConfirm.mockReset();
});

it('lists the phones, and turning one off posts the revoke and re-reads', async () => {
  apiFetch
    .mockResolvedValueOnce({ personCanSend: true, devices: [PHONE] })
    .mockResolvedValueOnce({ revoked: true })
    .mockResolvedValueOnce({ personCanSend: true, devices: [{ ...PHONE, state: 'revoked', revokedAt: '2026-11-14T00:00:00Z' }] });
  appConfirm.mockResolvedValue(true);
  await act(async () => {
    render(<PanicPhonesPanel userId="u-1" email="t@school.test" />);
  });
  expect(apiFetch).toHaveBeenCalledWith('/users/u-1/panic-devices');
  expect(screen.getByText('iPhone · Safari')).toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByTestId('people-panic-phone-off-pd-1'));
  });
  await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(3));
  expect(apiFetch.mock.calls[1]).toEqual(['/users/u-1/panic-devices/pd-1/revoke', { method: 'POST', body: '{}' }]);
  expect(screen.queryByTestId('people-panic-phone-off-pd-1')).toBeNull();
});

it('a cancelled confirmation changes nothing', async () => {
  apiFetch.mockResolvedValueOnce({ personCanSend: true, devices: [PHONE] });
  appConfirm.mockResolvedValue(false);
  await act(async () => {
    render(<PanicPhonesPanel userId="u-1" email="t@school.test" />);
  });
  await act(async () => {
    fireEvent.click(screen.getByTestId('people-panic-phone-off-pd-1'));
  });
  expect(apiFetch).toHaveBeenCalledTimes(1);
});

it('says so when the person cannot send alerts now', async () => {
  apiFetch.mockResolvedValueOnce({ personCanSend: false, devices: [] });
  await act(async () => {
    render(<PanicPhonesPanel userId="u-1" email="t@school.test" />);
  });
  expect(screen.getByText(/can’t send alerts now/)).toBeInTheDocument();
  expect(screen.getByText('No phones kept ready.')).toBeInTheDocument();
});
