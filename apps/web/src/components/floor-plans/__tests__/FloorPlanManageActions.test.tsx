/**
 * Replace / delete a floor plan — the controls the operator couldn't find.
 *
 * 2026-08-25. Standing on Settings → Emergency (which mounts the floor-plan
 * drawer inline) the operator asked how to delete or change a plan, was told
 * "Screens → Floor plans", and answered "where" — the drawer had `+ Add plan`
 * and nothing else. Then: "add change so i can swap images and not just
 * delete and add".
 *
 * These tests hold the two things that make the swap safe to offer:
 *   - the operator is told what happens to their pins BEFORE they commit
 *     (and warned again after when the new drawing is a different shape);
 *   - the delete keeps the one confirmation both surfaces already shared,
 *     and tells its host so the drawer can re-select instead of blanking.
 */

import * as React from 'react';
import { render, screen as rtl, fireEvent, waitFor } from '@testing-library/react';
import { FloorPlanManageActions } from '../FloorPlanManageActions';

// RoleGate reads the auth store; every call site here is already admin-gated.
jest.mock('@/components/RoleGate', () => ({
  RoleGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));

const appConfirm = jest.fn();
const appAlert = jest.fn();
jest.mock('@/components/ui/app-dialog', () => ({
  appConfirm: (...args: unknown[]) => appConfirm(...args),
  appAlert: (...args: unknown[]) => appAlert(...args),
}));

const deleteMutate = jest.fn();
const replaceMutate = jest.fn();
const readImageDimensions = jest.fn();
jest.mock('@/hooks/use-api', () => ({
  useDeleteFloorPlan: () => ({ mutateAsync: deleteMutate, isPending: false }),
  useReplaceFloorPlanImage: () => ({ mutateAsync: replaceMutate, isPending: false }),
  readImageDimensions: (...args: unknown[]) => readImageDimensions(...args),
}));

const PLAN = {
  id: 'plan-1',
  name: 'Lincoln HS — Floor 1',
  widthPx: 1000,
  heightPx: 500,
  screens: [
    { floorX: 500, floorY: 250 },
    { floorX: 100, floorY: 100 },
    { floorX: null, floorY: null }, // paired but unplaced — not a pin
  ],
};

beforeAll(() => {
  // jsdom has no object-URL implementation; the preview <img> needs one.
  (URL as any).createObjectURL = jest.fn(() => 'blob:preview');
  (URL as any).revokeObjectURL = jest.fn();
});

beforeEach(() => {
  appConfirm.mockReset().mockResolvedValue(true);
  appAlert.mockReset().mockResolvedValue(true);
  deleteMutate.mockReset().mockResolvedValue({ ok: true });
  replaceMutate.mockReset().mockResolvedValue({ id: 'plan-1', imageReplace: null });
  readImageDimensions.mockReset().mockResolvedValue({ widthPx: 2000, heightPx: 1000 });
});

function pngFile(name = 'floor-1.png') {
  return new File(['bytes'], name, { type: 'image/png' });
}

/** Open the replace dialog and pick a file whose dimensions the mock reports. */
async function openReplaceAndPick(container: HTMLElement, widthPx: number, heightPx: number) {
  readImageDimensions.mockResolvedValue({ widthPx, heightPx });
  fireEvent.click(rtl.getByRole('button', { name: /replace image for/i }));
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [pngFile()] } });
  await waitFor(() => expect(readImageDimensions).toHaveBeenCalled());
}

// ─── The controls exist where the operator is ─────────────────────

describe('FloorPlanManageActions', () => {
  it('offers replace AND delete on the plan drawer', () => {
    render(<FloorPlanManageActions plan={PLAN} />);
    expect(rtl.getByRole('button', { name: /replace image for/i })).toBeInTheDocument();
    expect(rtl.getByRole('button', { name: /delete plan/i })).toBeInTheDocument();
  });

  it('offers the same two controls on a plan card', () => {
    render(<FloorPlanManageActions plan={PLAN} variant="card" />);
    expect(rtl.getByRole('button', { name: /replace image for/i })).toBeInTheDocument();
    expect(rtl.getByRole('button', { name: /delete plan/i })).toBeInTheDocument();
  });
});

// ─── Delete ───────────────────────────────────────────────────────

describe('deleting a plan', () => {
  it('confirms, deletes, and tells the host which plan went away', async () => {
    const onDeleted = jest.fn();
    render(<FloorPlanManageActions plan={PLAN} onDeleted={onDeleted} />);

    fireEvent.click(rtl.getByRole('button', { name: /delete plan/i }));

    await waitFor(() => expect(deleteMutate).toHaveBeenCalledWith('plan-1'));
    expect(onDeleted).toHaveBeenCalledWith('plan-1');
    // The confirmation names the consequence the operator cares about.
    const opts = appConfirm.mock.calls[0][0];
    expect(opts.title).toContain('Lincoln HS — Floor 1');
    expect(opts.message).toMatch(/detaches every screen/i);
    expect(opts.tone).toBe('danger');
  });

  it('does nothing when the operator backs out', async () => {
    appConfirm.mockResolvedValue(false);
    const onDeleted = jest.fn();
    render(<FloorPlanManageActions plan={PLAN} onDeleted={onDeleted} />);

    fireEvent.click(rtl.getByRole('button', { name: /delete plan/i }));

    await waitFor(() => expect(appConfirm).toHaveBeenCalled());
    expect(deleteMutate).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('surfaces a failed delete and does NOT tell the host the plan is gone', async () => {
    deleteMutate.mockRejectedValue(new Error('network down'));
    const onDeleted = jest.fn();
    render(<FloorPlanManageActions plan={PLAN} onDeleted={onDeleted} />);

    fireEvent.click(rtl.getByRole('button', { name: /delete plan/i }));

    await waitFor(() => expect(appAlert).toHaveBeenCalled());
    expect(appAlert.mock.calls[0][0].message).toContain('network down');
    expect(onDeleted).not.toHaveBeenCalled();
  });
});

// ─── Replace ──────────────────────────────────────────────────────

describe('replacing the image', () => {
  it('promises the pins stay put when the new image is the same shape', async () => {
    const { container } = render(<FloorPlanManageActions plan={PLAN} />);

    // 1000×500 → 2000×1000: same 2:1 shape.
    await openReplaceAndPick(container, 2000, 1000);

    expect(rtl.getByText(/stay exactly where/i)).toBeInTheDocument();
    expect(rtl.queryByText(/different shape/i)).not.toBeInTheDocument();
  });

  it('warns BEFORE the swap when the new image is a different shape', async () => {
    const { container } = render(<FloorPlanManageActions plan={PLAN} />);

    // 2:1 landscape → 1:2 portrait.
    await openReplaceAndPick(container, 500, 1000);

    expect(rtl.getByText(/different shape/i)).toBeInTheDocument();
    expect(rtl.getByText(/may need repositioning/i)).toBeInTheDocument();
    // Counts the PLACED screens only — the unplaced row isn't a pin.
    expect(rtl.getByText('2')).toBeInTheDocument();
  });

  it('says so plainly when there are no pins to worry about', async () => {
    const { container } = render(
      <FloorPlanManageActions plan={{ ...PLAN, screens: [] }} />,
    );

    await openReplaceAndPick(container, 500, 1000);

    expect(rtl.getByText(/no screens are pinned to this plan yet/i)).toBeInTheDocument();
  });

  it('posts the swap and tells the host', async () => {
    const onReplaced = jest.fn();
    const { container } = render(<FloorPlanManageActions plan={PLAN} onReplaced={onReplaced} />);

    await openReplaceAndPick(container, 2000, 1000);
    fireEvent.click(rtl.getByRole('button', { name: /^replace image$/i }));

    await waitFor(() =>
      expect(replaceMutate).toHaveBeenCalledWith(
        expect.objectContaining({ planId: 'plan-1', file: expect.any(File) }),
      ),
    );
    expect(onReplaced).toHaveBeenCalledWith('plan-1');
  });

  it("warns AGAIN afterwards when the server says the shape changed", async () => {
    replaceMutate.mockResolvedValue({
      id: 'plan-1',
      imageReplace: { placementsKept: 2, aspectRatioChanged: true },
    });
    const { container } = render(<FloorPlanManageActions plan={PLAN} />);

    await openReplaceAndPick(container, 500, 1000);
    fireEvent.click(rtl.getByRole('button', { name: /^replace image$/i }));

    await waitFor(() => expect(appAlert).toHaveBeenCalled());
    const opts = appAlert.mock.calls[0][0];
    expect(opts.title).toMatch(/check your pins/i);
    expect(opts.message).toContain('2 pins');
    expect(opts.tone).toBe('warn');
  });

  it('stays quiet afterwards when the pins are provably fine', async () => {
    replaceMutate.mockResolvedValue({
      id: 'plan-1',
      imageReplace: { placementsKept: 2, aspectRatioChanged: false },
    });
    const { container } = render(<FloorPlanManageActions plan={PLAN} />);

    await openReplaceAndPick(container, 2000, 1000);
    fireEvent.click(rtl.getByRole('button', { name: /^replace image$/i }));

    await waitFor(() => expect(replaceMutate).toHaveBeenCalled());
    expect(appAlert).not.toHaveBeenCalled();
  });

  it('shows a failed swap inline instead of closing on a lie', async () => {
    replaceMutate.mockRejectedValue(new Error('Replace failed (413): too big'));
    const onReplaced = jest.fn();
    const { container } = render(<FloorPlanManageActions plan={PLAN} onReplaced={onReplaced} />);

    await openReplaceAndPick(container, 2000, 1000);
    fireEvent.click(rtl.getByRole('button', { name: /^replace image$/i }));

    await waitFor(() => expect(rtl.getByRole('alert')).toHaveTextContent(/413/));
    expect(onReplaced).not.toHaveBeenCalled();
  });

  it('cannot submit before a file is chosen', () => {
    render(<FloorPlanManageActions plan={PLAN} />);
    fireEvent.click(rtl.getByRole('button', { name: /replace image for/i }));
    expect(rtl.getByRole('button', { name: /^replace image$/i })).toBeDisabled();
  });
});
