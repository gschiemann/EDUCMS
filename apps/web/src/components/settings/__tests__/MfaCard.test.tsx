/**
 * MfaCard settings enroll flow — RTL proof (2026-05-28).
 *
 * Proves (b): the settings 2FA card walks enroll → verify → backup codes,
 * hitting the REAL backend endpoints (apps/api/src/auth/mfa.controller.ts):
 *
 *   POST /auth/mfa/enroll  → { secret, otpauthUrl, ... } (QR + manual key)
 *   POST /auth/mfa/verify  { code } → { success, backupCodes[] }
 *
 * We mock the network at `apiFetch` so the REAL use-api MFA hooks execute
 * with their REAL URLs (that's what proves the endpoints are hit), then
 * assert against the rendered DOM. `qrcode` is stubbed because jsdom has
 * no <canvas>.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the network layer, NOT the hooks — real use-api hooks run with
// their real URLs; we assert the exact paths called.
const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string, opts?: any) => apiFetch(path, opts),
}));

// jsdom has no canvas; stub the QR renderer to a deterministic data URL.
jest.mock('qrcode', () => ({
  __esModule: true,
  default: { toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,STUBQR') },
}));

import { MfaCard } from '../MfaCard';

const ENROLL = {
  secret: 'JBSWY3DPEHPK3PXP',
  otpauthUrl: 'otpauth://totp/VenueOS:admin@school.edu?secret=JBSWY3DPEHPK3PXP&issuer=VenueOS',
  qrSvg: null,
  issuer: 'VenueOS',
  label: 'admin@school.edu',
};
const BACKUP_CODES = ['AAAA-1111', 'BBBB-2222', 'CCCC-3333', 'DDDD-4444', 'EEEE-5555'];

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MfaCard />
    </QueryClientProvider>,
  );
}

describe('MfaCard — settings enroll flow', () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it('(b) Enable 2FA → enroll → shows QR + key → verify → surfaces backup codes', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === '/auth/mfa/enroll') return Promise.resolve(ENROLL);
      if (path === '/auth/mfa/verify') return Promise.resolve({ success: true, backupCodes: BACKUP_CODES });
      return Promise.resolve(null);
    });

    await act(async () => { renderCard(); });

    // Start enrollment.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Enable 2FA/i }));
    });

    // It called the REAL enroll endpoint.
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/auth/mfa/enroll', { method: 'POST' });
    });

    // QR + manual entry key are shown.
    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    expect(screen.getByAltText('Two-factor QR code')).toBeInTheDocument();

    // Enter the code and verify.
    fireEvent.change(screen.getByLabelText('Enter the 6-digit code'), { target: { value: '654321' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Verify & turn on/i }));
    });

    // It called the REAL verify endpoint with the code.
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/auth/mfa/verify', {
        method: 'POST',
        body: JSON.stringify({ code: '654321' }),
      });
    });

    // Backup codes are surfaced (shown once).
    expect(await screen.findByText('AAAA-1111')).toBeInTheDocument();
    expect(screen.getByText('EEEE-5555')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy codes/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download/i })).toBeInTheDocument();
  });

  it('an invalid verify code surfaces the backend error without losing the QR step', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === '/auth/mfa/enroll') return Promise.resolve(ENROLL);
      if (path === '/auth/mfa/verify') {
        const err: any = new Error('Code does not match. Try again from your Authenticator app.');
        err.code = 'MFA_INVALID_CODE';
        err.status = 401;
        return Promise.reject(err);
      }
      return Promise.resolve(null);
    });

    await act(async () => { renderCard(); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Enable 2FA/i })); });
    await screen.findByText('JBSWY3DPEHPK3PXP');

    fireEvent.change(screen.getByLabelText('Enter the 6-digit code'), { target: { value: '000000' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Verify & turn on/i }));
    });

    expect(await screen.findByText(/Code does not match/i)).toBeInTheDocument();
    // Still in the enrolling step — the manual key is still visible.
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
  });

  it('reflects already-enrolled state when enroll returns MFA_ALREADY_ENABLED', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === '/auth/mfa/enroll') {
        const err: any = new Error('MFA is already enabled. Disable it first to re-enroll.');
        err.code = 'MFA_ALREADY_ENABLED';
        err.status = 400;
        return Promise.reject(err);
      }
      return Promise.resolve(null);
    });

    await act(async () => { renderCard(); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Enable 2FA/i })); });

    // Flips to the manage view (Disable available) instead of a dead end.
    expect(await screen.findByRole('button', { name: /Disable 2FA/i })).toBeInTheDocument();
  });
});
