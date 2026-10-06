import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { FleetRollup } from '../FleetRollup';
import type { FleetResponse } from '@/hooks/use-api';

jest.mock('@/hooks/use-tenant-switch', () => ({ useTenantSwitch: () => ({ switchToTenant: jest.fn(), switchingId: null }) }));
jest.mock('@/components/screens/ScreenMapClient', () => ({
  ScreenMapClient: ({ screens }: { screens: Array<{ id: string }> }) => <div data-testid="map" data-screens={screens.map((s) => s.id).join(',')} />,
}));

it('the classic location filter scopes totals, map and status filtering to multiple offices', () => {
  const locations = [{ id: 'hq', name: 'Corporate', slug: 'hq' }, { id: 'a', name: 'Austin', slug: 'a' }, { id: 'b', name: 'Boston', slug: 'b' }];
  const fleet = { root: locations[0], locations, stats: { total: 3, online: 2, offline: 1, locationCount: 3 },
    screens: locations.map((sourceTenant, index) => ({ id: `screen-${index}`, name: `Lobby ${index}`, status: index === 2 ? 'OFFLINE' : 'ONLINE', sourceTenant })) } as unknown as FleetResponse;
  render(<FleetRollup fleet={fleet} />);
  fireEvent.click(screen.getByRole('button', { name: 'Filter by location' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Austin' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Boston' }));
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(screen.getByText('Screens').nextElementSibling).toHaveTextContent('2');
  expect(screen.getByTestId('map')).toHaveAttribute('data-screens', 'screen-1,screen-2');
  fireEvent.click(screen.getByRole('button', { name: /^Offline/ }));
  expect(screen.getByTestId('map')).toHaveAttribute('data-screens', 'screen-2');
});
