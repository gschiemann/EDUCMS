/**
 * Brand & appearance editor (Settings Command Center §7.4).
 *
 * Covers the three behaviours the handoff makes load-bearing:
 *  - pristine: the shell is told there are no changes
 *  - dirty: the change COUNT is real (color + appearance = 2, §6.2)
 *  - failed save: every local edit survives and an error summary appears (§13.1)
 */
import * as React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const apiFetch = jest.fn();
const pushBrandingPreview = jest.fn();
const invalidateBranding = jest.fn();
const refetch = jest.fn().mockResolvedValue({ data: null });

let brandingRow: Record<string, unknown> | null = null;

jest.mock('@/lib/api-client', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));
jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined }) }));
jest.mock('@/store/ui-store', () => ({
  useUIStore: (sel: (s: unknown) => unknown) => sel({ user: { role: 'DISTRICT_ADMIN' } }),
}));
jest.mock('@/hooks/use-tenant-copy', () => ({
  useTenantCopy: () => ({ defaultBrandName: 'VenueOS', orgPlural: 'Locations' }),
}));
jest.mock('@/lib/brand', () => ({
  getClientBrand: () => ({ colors: { primary: '#6366F1', primaryHover: '#4F46E5', accent: '#7C3AED' } }),
}));
jest.mock('@/hooks/use-api', () => ({
  useTenant: () => ({ data: { name: 'Garlan Group', vertical: 'GYM' } }),
  useTenantBranding: () => ({ data: brandingRow, isLoading: false, refetch }),
  useInvalidateTenantBranding: () => invalidateBranding,
  useApplyBrandToTemplates: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useAuditLog: () => ({ data: { items: [] } }),
}));
jest.mock('@/components/branding/BrandingWizard', () => ({
  BrandingWizard: () => <div data-testid="branding-wizard" />,
}));
jest.mock('@/components/settings/BrandingSettingsCard', () => ({
  BrandingSettingsCard: () => <div data-testid="branding-settings-card" />,
}));
jest.mock('@/components/branding/BrandStyleInjector', () => ({
  pushBrandingPreview: (...a: unknown[]) => pushBrandingPreview(...a),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

// The shell is exercised by its own suite; here it only has to expose the
// registered save contract so the page's dirty/save behaviour is assertable.
jest.mock('@/components/settings/shell', () => {
  const actual = jest.requireActual('@/components/settings/shell');
  return {
    ...actual,
    SettingsPageFrame: ({ children, save }: { children: React.ReactNode; save?: { dirty: number | boolean; saving?: boolean; onSave?: () => void; onDiscard?: () => void } }) => (
      <div>
        <span data-testid="dirty-count">{String(save?.dirty ?? 'none')}</span>
        <button type="button" onClick={() => save?.onSave?.()}>run-save</button>
        <button type="button" onClick={() => save?.onDiscard?.()}>run-discard</button>
        {children}
      </div>
    ),
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Page = require('../page').default as React.ComponentType;

beforeEach(() => {
  jest.clearAllMocks();
  brandingRow = {
    displayName: 'Garlan Group',
    logoUrl: 'https://cdn.example.com/branding/t1/mark.png',
    palette: { primary: '#3D20DF', accent: '#7037D9' },
    appearanceMode: 'branded',
    scrapedAt: '2026-08-28T00:00:00.000Z',
  };
});

describe('Brand & appearance editor', () => {
  it('renders pristine with no changes registered', () => {
    render(<Page />);
    expect(screen.getByText('Organization brand')).toBeInTheDocument();
    expect(screen.getByTestId('dirty-count')).toHaveTextContent('0');
    // The stored primary is what the hex field shows.
    expect(screen.getByLabelText('Hex value')).toHaveValue('#3D20DF');
  });

  it('counts a color change and an appearance change as two changes', () => {
    render(<Page />);
    fireEvent.click(screen.getByLabelText('Teal'));
    expect(screen.getByTestId('dirty-count')).toHaveTextContent('1');
    expect(screen.getByLabelText('Hex value')).toHaveValue('#087B70');

    fireEvent.click(screen.getByRole('radio', { name: /Neutral operations/ }));
    expect(screen.getByTestId('dirty-count')).toHaveTextContent('2');

    // Picking the stored color again is not a change (the stored primary IS
    // the purple swatch here, so no extra "current" swatch is rendered).
    fireEvent.click(screen.getByRole('radio', { name: /Branded chrome/ }));
    fireEvent.click(screen.getByLabelText('Purple'));
    expect(screen.getByTestId('dirty-count')).toHaveTextContent('0');
  });

  it('keeps every local edit and shows an error summary when the save fails', async () => {
    apiFetch.mockRejectedValueOnce(new Error('Server said no'));
    render(<Page />);

    fireEvent.click(screen.getByLabelText('Gold'));
    fireEvent.click(screen.getByText('run-save'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('Server said no');
    // Input preserved, still dirty, nothing re-read as authoritative.
    expect(screen.getByLabelText('Hex value')).toHaveValue('#BD7C09');
    expect(screen.getByTestId('dirty-count')).toHaveTextContent('1');
    expect(refetch).not.toHaveBeenCalled();
  });

  it('discards back to the stored brand and repaints the saved state', () => {
    render(<Page />);
    fireEvent.click(screen.getByLabelText('Navy'));
    expect(screen.getByTestId('dirty-count')).toHaveTextContent('1');
    fireEvent.click(screen.getByText('run-discard'));
    expect(screen.getByTestId('dirty-count')).toHaveTextContent('0');
    expect(screen.getByLabelText('Hex value')).toHaveValue('#3D20DF');
    // The unsaved preview must not survive the discard.
    expect(pushBrandingPreview).toHaveBeenLastCalledWith(expect.objectContaining({ appearanceMode: 'branded' }));
  });
});
