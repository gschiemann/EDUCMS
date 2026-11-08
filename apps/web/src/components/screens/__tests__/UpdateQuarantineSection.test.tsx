/**
 * "Clear update quarantine" (Manager wave 3, #8): only for a screen with a
 * companion and a role that can control it; confirm first; one POST to the
 * exact route; says "sent" (never "cleared"); says plainly it is not a
 * rollback; a refusal is shown in words.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const calls: Array<{ path: string; init?: any }> = [];
let fail = false;
const apiFetch = jest.fn(async (path: string, init?: any) => {
  calls.push({ path, init });
  if (fail) throw new Error('Not found');
  return { ok: true, published: true };
});
jest.mock('@/lib/api-client', () => ({ apiFetch: (p: string, i?: any) => apiFetch(p, i) }));
let confirmAnswer = true;
const appConfirm = jest.fn(async () => confirmAnswer);
jest.mock('@/components/ui/app-dialog', () => ({ appConfirm: (o: any) => appConfirm(o) }));

import { UpdateQuarantineSection } from '../v3/UpdateQuarantineSection';

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}
afterEach(() => { cleanup(); calls.length = 0; fail = false; confirmAnswer = true; appConfirm.mockClear(); });

it('renders nothing without a companion or without control', () => {
  wrap(<UpdateQuarantineSection screenId="s1" managerVersion={null} canControl />);
  expect(screen.queryByTestId('update-quarantine-section')).toBeNull();
  cleanup();
  wrap(<UpdateQuarantineSection screenId="s1" managerVersion="1.1.29" canControl={false} />);
  expect(screen.queryByTestId('update-quarantine-section')).toBeNull();
});

it('states plainly that this is not a rollback', () => {
  wrap(<UpdateQuarantineSection screenId="s1" managerVersion="1.1.29" canControl />);
  expect(screen.getByTestId('update-quarantine-no-rollback').textContent).toMatch(/does not roll anything back/);
  expect(screen.getByTestId('update-quarantine-no-rollback').textContent).toMatch(/device owner/);
});

it('confirms, posts once to the screen route, and reports "sent"', async () => {
  const onSent = jest.fn();
  wrap(<UpdateQuarantineSection screenId="s1" managerVersion="1.1.29" canControl onSent={onSent} />);
  fireEvent.click(screen.getByRole('button', { name: /Clear update quarantine/ }));
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(appConfirm).toHaveBeenCalledTimes(1);
  expect(calls[0].path).toBe('/screens/s1/clear-update-quarantine');
  expect(calls[0].init).toEqual({ method: 'POST' });
  await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/nothing here confirms it/));
  expect(screen.getByRole('button', { name: /Command sent/ })).toBeDisabled();
  expect(onSent).toHaveBeenCalled();
});

it('does nothing when the confirmation is declined', async () => {
  confirmAnswer = false;
  wrap(<UpdateQuarantineSection screenId="s1" managerVersion="1.1.29" canControl />);
  fireEvent.click(screen.getByRole('button', { name: /Clear update quarantine/ }));
  await waitFor(() => expect(appConfirm).toHaveBeenCalled());
  expect(calls).toHaveLength(0);
});

it('shows a refusal in words', async () => {
  fail = true;
  wrap(<UpdateQuarantineSection screenId="s1" managerVersion="1.1.29" canControl />);
  fireEvent.click(screen.getByRole('button', { name: /Clear update quarantine/ }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Couldn’t send the command: Not found/));
});
