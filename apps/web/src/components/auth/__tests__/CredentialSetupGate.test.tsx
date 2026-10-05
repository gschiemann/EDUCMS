/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { CredentialSetupGate } from '../CredentialSetupGate';

jest.mock('@/store/ui-store', () => {
  const state = { user: { email: 'riot-houston@riotcolor.com' }, token: 't', setToken: jest.fn(), setUser: jest.fn(), logout: jest.fn() };
  const useUIStore: any = (sel: (s: typeof state) => unknown) => sel(state);
  useUIStore.getState = () => state;
  return { useUIStore };
});
jest.mock('@/lib/api-url', () => ({ API_URL: 'http://api.test/api/v1' }));
jest.mock('@/lib/client-logger', () => ({ clog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/brand', () => ({ getClientBrand: () => ({ name: 'VenueOS' }) }));
jest.mock('@/lib/csrf', () => ({ ensureCsrfToken: jest.fn().mockResolvedValue('csrf') }));

const fetchMock = jest.fn();
beforeEach(() => { fetchMock.mockReset(); (global as any).fetch = fetchMock; });

const fill = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

it('refuses two different email addresses before anything is sent', async () => {
  render(<CredentialSetupGate />);
  fill(/^Your work email/i, 'manager@riotcolor.com');
  fill(/Type your email again/i, 'manger@riotcolor.com'); // the typo this field exists to catch
  fill(/^New password/i, 'a-long-new-password-1');
  fill(/Confirm (new )?password/i, 'a-long-new-password-1');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /continue|save|finish|set up|create/i })); });
  expect(screen.getByText(/two email addresses do not match/i)).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('accepts the same address typed twice (case does not matter)', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ code: 'SETUP_EMAIL_IN_USE' }) });
  render(<CredentialSetupGate />);
  fill(/^Your work email/i, 'Manager@riotcolor.com');
  fill(/Type your email again/i, 'manager@RIOTCOLOR.com');
  fill(/^New password/i, 'a-long-new-password-1');
  fill(/Confirm (new )?password/i, 'a-long-new-password-1');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /continue|save|finish|set up|create/i })); });
  expect(screen.queryByText(/two email addresses do not match/i)).toBeNull();
  expect(fetchMock).toHaveBeenCalled();
});

// ───────────────────────────────────────────────────────────────────────
// EMAIL VERIFICATION (2026-10-06) — the new address is proven with a code.
// ───────────────────────────────────────────────────────────────────────
const store = () => (jest.requireMock('@/store/ui-store') as any).useUIStore.getState();

function route(handlers: Record<string, (body: any) => { ok: boolean; status?: number; body: any }>) {
  fetchMock.mockImplementation(async (url: string, init: any) => {
    const key = Object.keys(handlers).find((k) => String(url).endsWith(k));
    if (!key) throw new Error(`unexpected fetch ${url}`);
    const out = handlers[key](init?.body ? JSON.parse(init.body) : {});
    return { ok: out.ok, status: out.status ?? (out.ok ? 200 : 400), json: async () => out.body };
  });
}

async function fillAndSubmit() {
  fill(/^Your work email/i, 'manager@riotcolor.com');
  fill(/Type your email again/i, 'manager@riotcolor.com');
  fill(/^New password/i, 'a-long-new-password-1');
  fill(/Confirm (new )?password/i, 'a-long-new-password-1');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /save and continue/i })); });
}

describe('proving the new address with an emailed code', () => {
  it('saves straight away when the server says no code is needed (mail not switched on yet)', async () => {
    route({
      '/auth/complete-setup/email-code': () => ({ ok: true, body: { required: false } }),
      '/auth/complete-setup': (b) => {
        expect(b.emailCode).toBeUndefined();
        return { ok: true, body: { access_token: 'tok', user: { id: 'u1', mustSetupCredentials: false } } };
      },
    });
    render(<CredentialSetupGate />);
    await fillAndSubmit();
    expect(store().setToken).toHaveBeenCalledWith('tok');
  });

  it('asks for the code first, then finishes setup with it', async () => {
    let finishBody: any = null;
    route({
      '/auth/complete-setup/email-code': () => ({ ok: true, body: { required: true, sent: true, expiresInSeconds: 600 } }),
      '/auth/complete-setup': (b) => {
        finishBody = b;
        return { ok: true, body: { access_token: 'tok2', user: { id: 'u1', mustSetupCredentials: false } } };
      },
    });
    render(<CredentialSetupGate />);
    await fillAndSubmit();

    expect(await screen.findByText(/We sent a 6-digit code to/i)).toBeInTheDocument();
    expect(screen.getByText('manager@riotcolor.com')).toBeInTheDocument();
    expect(finishBody).toBeNull(); // nothing saved until the code is entered

    fill(/Code from the email/i, '123 456');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /verify and finish/i })); });
    expect(finishBody).toMatchObject({ email: 'manager@riotcolor.com', emailCode: '123456' });
    expect(store().setToken).toHaveBeenCalledWith('tok2');
  });

  it('a wrong code is explained and keeps the step open', async () => {
    route({
      '/auth/complete-setup/email-code': () => ({ ok: true, body: { required: true, sent: true } }),
      '/auth/complete-setup': () => ({ ok: false, body: { code: 'SETUP_EMAIL_CODE_INVALID' } }),
    });
    render(<CredentialSetupGate />);
    await fillAndSubmit();
    fill(/Code from the email/i, '000000');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /verify and finish/i })); });
    expect(screen.getByText(/isn.t right/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Code from the email/i)).toBeInTheDocument();
  });

  it('refuses a code that is not six digits without calling the server', async () => {
    route({ '/auth/complete-setup/email-code': () => ({ ok: true, body: { required: true, sent: true } }) });
    render(<CredentialSetupGate />);
    await fillAndSubmit();
    fill(/Code from the email/i, '12');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /verify and finish/i })); });
    expect(screen.getByText(/Enter the 6-digit code/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the code request
  });

  it('"Use a different email" goes back to the form, with the password still typed', async () => {
    route({ '/auth/complete-setup/email-code': () => ({ ok: true, body: { required: true, sent: true } }) });
    render(<CredentialSetupGate />);
    await fillAndSubmit();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /use a different email/i })); });
    expect(screen.getByLabelText(/^Your work email/i)).toBeInTheDocument();
    expect((screen.getByLabelText(/^New password/i) as HTMLInputElement).value).toBe('a-long-new-password-1');
  });

  it('if the server starts requiring a code mid-way, the form sends one and shows the step', async () => {
    let asked = 0;
    route({
      '/auth/complete-setup/email-code': () => { asked += 1; return { ok: true, body: asked === 1 ? { required: false } : { required: true, sent: true } }; },
      '/auth/complete-setup': () => ({ ok: false, body: { code: 'SETUP_EMAIL_CODE_REQUIRED' } }),
    });
    render(<CredentialSetupGate />);
    await fillAndSubmit();
    expect(await screen.findByText(/We sent a 6-digit code to/i)).toBeInTheDocument();
  });
});
