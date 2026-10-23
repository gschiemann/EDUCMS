/**
 * QA 2026-10-23 — the password-reset pages moved onto the /login card and
 * into the en/es/zh catalogue. These pin the behaviour that must not change
 * with the redesign: the request page's two answers (inbox vs. email not
 * configured), and the completion page's client checks + success hand-off.
 */
import * as React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('@/components/layout/LanguageMenu', () => ({ LanguageSwitcherInline: () => null }));
jest.mock('@/lib/api-url', () => ({ API_URL: 'http://api.test/api/v1' }));
jest.mock('@/lib/sign-in-steps', () => ({ takeEmailForReset: () => 'ops@example.com' }));

import RequestPage from '../request/page';
import CompletePage from '../[token]/page';

const ok = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) }) as unknown as Promise<Response>;
const bad = (body: unknown) => Promise.resolve({ ok: false, json: () => Promise.resolve(body) }) as unknown as Promise<Response>;

afterEach(() => { jest.useRealTimers(); push.mockClear(); });
// React's use() reads an already-settled thenable synchronously.
function settled<T>(value: T): Promise<T> {
  const p = Promise.resolve(value) as Promise<T> & { status?: string; value?: T };
  p.status = 'fulfilled'; p.value = value;
  return p;
}

it('request: prefills the handed-over email and confirms the send', async () => {
  global.fetch = jest.fn(() => ok({ ok: true })) as unknown as typeof fetch;
  render(<RequestPage />);
  expect(screen.getByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();
  expect(screen.getByLabelText('Email')).toHaveValue('ops@example.com');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send reset link' })); });
  expect(screen.getByText('Check your inbox')).toBeInTheDocument();
});

it('request: says so when this deployment cannot send email', async () => {
  global.fetch = jest.fn(() => ok({ ok: true, emailConfigured: false })) as unknown as typeof fetch;
  render(<RequestPage />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send reset link' })); });
  expect(screen.getByText('Email is not configured on this deployment')).toBeInTheDocument();
});

it('complete: refuses a mismatch before calling the server', async () => {
  global.fetch = jest.fn() as unknown as typeof fetch;
  render(<CompletePage params={settled({ token: 't' })} />);
  const pw = await screen.findByLabelText('New password');
  fireEvent.change(pw, { target: { value: 'Abcdefgh1!' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'Different1!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match.');
  expect(global.fetch).not.toHaveBeenCalled();
});

it('complete: success shows the confirmation, then goes to sign in; a used link shows the server reason', async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn(() => ok({ ok: true })) as unknown as typeof fetch;
  const { unmount } = render(<CompletePage params={settled({ token: 't' })} />);
  const pw = await screen.findByLabelText('New password');
  fireEvent.change(pw, { target: { value: 'Abcdefgh1!' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'Abcdefgh1!' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update password' })); });
  expect(screen.getByText('Password updated')).toBeInTheDocument();
  act(() => { jest.advanceTimersByTime(1600); });
  expect(push).toHaveBeenCalledWith('/login');
  unmount();

  global.fetch = jest.fn(() => bad({ message: 'This reset link has already been used.' })) as unknown as typeof fetch;
  render(<CompletePage params={settled({ token: 't' })} />);
  const pw2 = await screen.findByLabelText('New password');
  fireEvent.change(pw2, { target: { value: 'Abcdefgh1!' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'Abcdefgh1!' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update password' })); });
  expect(screen.getByRole('alert')).toHaveTextContent('This reset link has already been used.');
});
