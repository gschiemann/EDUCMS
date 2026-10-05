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
