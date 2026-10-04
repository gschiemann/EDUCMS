/**
 * HQ fleet publish — the highest-consequence publish in the product (it
 * copies the playlist down into every chosen location and schedules it live
 * there) used to show the operator nothing but a raw checkbox count.
 *
 * Mounts the REAL PublishToLocationsModal and proves the location-flavoured
 * blast-radius line renders over real fleet data.
 */

import * as React from 'react';
import { render, screen as rtl, fireEvent } from '@testing-library/react';

const FLEET = {
  root: { id: 'hq', name: 'HQ', slug: 'hq' },
  locations: [
    { id: 'loc1', name: 'Downtown', slug: 'downtown' },
    { id: 'loc2', name: 'Airport', slug: 'airport' },
  ],
  stats: { total: 3, online: 3, offline: 0, locationCount: 2 },
  screens: [
    { id: 's1', name: 'Downtown Menu A', status: 'ONLINE', sourceTenant: { id: 'loc1', name: 'Downtown', slug: 'downtown' } },
    { id: 's2', name: 'Downtown Menu B', status: 'ONLINE', sourceTenant: { id: 'loc1', name: 'Downtown', slug: 'downtown' } },
    { id: 's3', name: 'Airport Gate 4', status: 'ONLINE', sourceTenant: { id: 'loc2', name: 'Airport', slug: 'airport' } },
  ],
};

jest.mock('@/hooks/use-api', () => ({
  useFleet: () => ({ data: FLEET, isLoading: false }),
  usePlaylists: () => ({ data: [{ id: 'p1', name: 'Lunch Rotation' }] }),
  usePublishToFleet: () => ({ mutateAsync: jest.fn(), isPending: false, isError: false, reset: jest.fn() }),
}));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

// ts-jest hoists the jest.mock calls above this import.
import { PublishToLocationsModal } from '../PublishToLocationsModal';

describe('PublishToLocationsModal — blast radius', () => {
  it('counts LOCATIONS, not just screens, and lists them', () => {
    render(<PublishToLocationsModal open onClose={() => {}} initialPlaylistId="p1" />);

    // Nothing picked yet — say so rather than look confident.
    expect(rtl.getByText('Publishes to 0 screens')).toBeInTheDocument();
    expect(rtl.getByText(/no screens picked/)).toBeInTheDocument();

    // One screen in Downtown, one in Airport → 2 screens across 2 locations.
    fireEvent.click(rtl.getByRole('button', { name: /Downtown Menu A/ }));
    fireEvent.click(rtl.getByRole('button', { name: /Airport Gate 4/ }));

    expect(rtl.getByText('Publishes to 2 screens across 2 locations')).toBeInTheDocument();
    // Each name now appears twice: once as the picker chip, once in the
    // blast-radius breakdown. Two occurrences === the summary rendered it.
    expect(rtl.getAllByText('Downtown Menu A')).toHaveLength(2);
    expect(rtl.getAllByText('Airport Gate 4')).toHaveLength(2);
    expect(rtl.queryByText(/no screens picked/)).not.toBeInTheDocument();
  });

  it('a whole-location tick reports every screen it just armed', () => {
    render(<PublishToLocationsModal open onClose={() => {}} initialPlaylistId="p1" />);
    // The location's box selects all of that location's screens.
    fireEvent.click(rtl.getByRole('checkbox', { name: 'Select all screens in Downtown' }));
    expect(rtl.getByText('Publishes to 2 screens across 1 location')).toBeInTheDocument();
    expect(rtl.getByText('Downtown Menu A · Downtown Menu B')).toBeInTheDocument();
  });

  it('the location\'s box is the one select-all box: tri-state over that location\'s screens (Greg, 2026-10-04)', () => {
    render(<PublishToLocationsModal open onClose={() => {}} initialPlaylistId="p1" />);
    const downtown = () => rtl.getByRole('checkbox', { name: 'Select all screens in Downtown' }) as HTMLInputElement;
    const airport = () => rtl.getByRole('checkbox', { name: 'Select all screens in Airport' }) as HTMLInputElement;
    expect(downtown().checked).toBe(false);
    expect(downtown().indeterminate).toBe(false);

    fireEvent.click(rtl.getByRole('button', { name: /Downtown Menu A/ })); // one of its two screens
    expect(downtown().indeterminate).toBe(true); // the dash
    expect(downtown().checked).toBe(false);
    expect(airport().indeterminate).toBe(false); // other locations are untouched

    fireEvent.click(downtown()); // the dash selects the rest …
    expect(downtown().checked).toBe(true);
    expect(rtl.getByText('Publishes to 2 screens across 1 location')).toBeInTheDocument();
    fireEvent.click(downtown()); // … and all clears them
    expect(downtown().checked).toBe(false);
    expect(rtl.getByText('Publishes to 0 screens')).toBeInTheDocument();
  });

  it('the location\'s name and count still toggle it for the mouse, but are not a second control for assistive tech', () => {
    const { container } = render(<PublishToLocationsModal open onClose={() => {}} initialPlaylistId="p1" />);
    const hidden = Array.from(container.querySelectorAll('button[aria-hidden="true"]')) as HTMLElement[];
    const downtown = hidden.find((b) => /Downtown/.test(b.textContent ?? ''));
    expect(downtown).toBeDefined();
    expect(downtown).toHaveAttribute('tabindex', '-1');
    fireEvent.click(downtown as HTMLElement);
    expect((rtl.getByRole('checkbox', { name: 'Select all screens in Downtown' }) as HTMLInputElement).checked).toBe(true);
    // no inert, read-only checkbox nested in a button any more
    expect(container.querySelector('button input[type="checkbox"]')).toBeNull();
  });

  it('the location\'s box explains itself on hover: "Select all screens in <location>", and "Clear selection" once all of that location\'s screens are picked (Greg, 2026-10-04)', () => {
    render(<PublishToLocationsModal open onClose={() => {}} initialPlaylistId="p1" />);
    const downtown = () => rtl.getByRole('checkbox', { name: 'Select all screens in Downtown' }) as HTMLInputElement;
    const titleOf = () => (downtown().closest('label') as HTMLElement).getAttribute('title');
    expect(titleOf()).toBe('Select all screens in Downtown'); // none
    fireEvent.click(rtl.getByRole('button', { name: /Downtown Menu A/ })); // some
    expect(downtown().indeterminate).toBe(true);
    expect(titleOf()).toBe('Select all screens in Downtown');
    fireEvent.click(downtown()); // all
    expect(downtown().checked).toBe(true);
    expect(titleOf()).toBe('Clear selection');
    // another location is unaffected
    expect(((rtl.getByRole('checkbox', { name: 'Select all screens in Airport' }) as HTMLInputElement).closest('label') as HTMLElement).getAttribute('title')).toBe('Select all screens in Airport');
  });
});
