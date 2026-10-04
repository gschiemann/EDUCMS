/**
 * The owner's tenant table — the one select-all box (Greg, 2026-10-04: "select all
 * should be the same across the entire app"). Each vertical's table header carries
 * a tri-state box over THAT vertical's tenants, and every row a box named
 * "Select <tenant>". Before, the header box was a plain checkbox that could not
 * show "some".
 */
import * as React from 'react';
import { render, screen as rtl, fireEvent, within } from '@testing-library/react';
import type { SuperTenantRow } from '@/hooks/use-api';

const tenant = (id: string, name: string, vertical: string, over: Partial<SuperTenantRow> = {}): SuperTenantRow => ({
  id, name, slug: id, vertical, parentId: null, createdAt: '2026-09-01T00:00:00Z', tier: 'PRO', status: 'ACTIVE',
  billingMode: 'STRIPE', seatLimit: 10, seatsUsed: 4, atLimit: false, monthlyPriceCents: 2500, expiresAt: null, notes: null,
  screensOnline: 4, ...over,
});

const TENANTS: SuperTenantRow[] = [
  tenant('t1', 'Lincoln High', 'K12'),
  tenant('t2', 'Roosevelt Middle', 'K12'),
  tenant('t3', 'Franklin Elementary', 'K12'),
  tenant('t4', 'Iron Works Gym', 'FITNESS'),
  tenant('t5', 'Corner Cafe', 'RESTAURANT'),
];

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('@/lib/store', () => ({
  useAppStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'owner', role: 'SUPER_ADMIN' } }),
}));
jest.mock('@/hooks/use-api', () => ({
  useSuperTenants: () => ({ data: TENANTS, isLoading: false }),
  useCompSeats: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUpsertLicense: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock('@/components/ui/app-dialog', () => ({
  appConfirm: jest.fn().mockResolvedValue(true),
  appPrompt: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/api-client', () => ({ apiFetch: jest.fn().mockResolvedValue({}) }));
jest.mock('../ActivationFunnelPanel', () => ({ __esModule: true, default: () => null }));

import SuperPage from '../page';

const k12 = () => rtl.getByRole('checkbox', { name: 'Select all K12 tenants shown' }) as HTMLInputElement;
const box = (name: string) => rtl.getByRole('checkbox', { name: `Select ${name}` }) as HTMLInputElement;

describe('the Super tenant table — one tri-state select-all box per vertical', () => {
  it('names each header box for the vertical it covers, and puts it in the first column', () => {
    render(<SuperPage />);
    expect(rtl.getByRole('checkbox', { name: 'Select all FITNESS tenants shown' })).toBeInTheDocument();
    expect(rtl.getByRole('checkbox', { name: 'Select all RESTAURANT tenants shown' })).toBeInTheDocument();
    const table = k12().closest('table') as HTMLElement;
    expect(within(table).getAllByRole('columnheader')[0]).toContainElement(k12());
  });

  it('is tri-state over that vertical only: none → some → all → none', async () => {
    render(<SuperPage />);
    // The page defers its body one tick for hydration.
    expect(await rtl.findByRole('checkbox', { name: 'Select all K12 tenants shown' })).toBeInTheDocument();
    expect(k12().checked).toBe(false);
    expect(k12().indeterminate).toBe(false);

    fireEvent.click(box('Lincoln High')); // one of three
    expect(k12().indeterminate).toBe(true);
    expect(k12().checked).toBe(false);
    // the other verticals are untouched
    expect((rtl.getByRole('checkbox', { name: 'Select all FITNESS tenants shown' }) as HTMLInputElement).indeterminate).toBe(false);

    fireEvent.click(k12()); // the dash selects the rest of THIS vertical
    expect(['Lincoln High', 'Roosevelt Middle', 'Franklin Elementary'].every((n) => box(n).checked)).toBe(true);
    expect(k12().checked).toBe(true);
    expect(box('Iron Works Gym').checked).toBe(false);

    fireEvent.click(k12()); // all → clears this vertical
    expect(['Lincoln High', 'Roosevelt Middle', 'Franklin Elementary'].some((n) => box(n).checked)).toBe(false);
    expect(k12().indeterminate).toBe(false);
  });

  it('a tenant ticked elsewhere stays ticked when a vertical is cleared', () => {
    render(<SuperPage />);
    fireEvent.click(box('Corner Cafe'));
    fireEvent.click(k12());
    fireEvent.click(k12());
    expect(box('Corner Cafe').checked).toBe(true);
  });

  it('each header box explains itself on hover: "Select all <vertical> tenants shown", and "Clear selection" once all of that vertical are picked (Greg, 2026-10-04)', () => {
    render(<SuperPage />);
    const titleOf = (el: HTMLElement) => (el.closest('label') as HTMLElement).getAttribute('title');
    expect(titleOf(k12())).toBe('Select all K12 tenants shown'); // none
    fireEvent.click(box('Lincoln High')); // some
    expect(titleOf(k12())).toBe('Select all K12 tenants shown');
    fireEvent.click(k12()); // all
    expect(titleOf(k12())).toBe('Clear selection');
    // another vertical is unaffected, and a row says "Select <tenant>"
    expect(titleOf(rtl.getByRole('checkbox', { name: 'Select all FITNESS tenants shown' }))).toBe('Select all FITNESS tenants shown');
    expect(titleOf(box('Corner Cafe'))).toBe('Select Corner Cafe');
  });
});
