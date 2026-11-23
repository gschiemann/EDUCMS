/** The bulk delete's one confirmation: in-use rows pre-checked, emergency kept, one button. */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { TemplateBulkDeleteDialog } from '../TemplateBulkDeleteDialog';
import type { BulkDeleteSummary, BulkDeleteTarget } from '../template-bulk-delete';

const targets: BulkDeleteTarget[] = [
  { id: 'f1', name: 'Free one', listedPlaylists: 0 },
  { id: 'f2', name: 'Free two', listedPlaylists: 0 },
  { id: 'u1', name: 'Lobby loop', listedPlaylists: 2 },
  { id: 'sos', name: 'Lockdown board', listedPlaylists: 1 },
];
const usageFor = (id: string) => (id === 'sos'
  ? { playlists: [{ id: 'pe', name: 'Emergency' }], total: 1, screensReached: 4, locations: 1, protectedEmergency: true }
  : { playlists: [{ id: 'p1', name: 'Lobby' }, { id: 'p2', name: 'Gym' }], total: 2, screensReached: 5, locations: 1, protectedEmergency: false });

function mount(over: Partial<{ deleteOne: jest.Mock; loadUsage: jest.Mock; beforeRun: jest.Mock }> = {}, list = targets) {
  const onDone = jest.fn<void, [BulkDeleteSummary]>();
  const onCancel = jest.fn();
  const loadUsage = over.loadUsage ?? jest.fn(async (id: string) => usageFor(id));
  const deleteOne = over.deleteOne ?? jest.fn(async () => undefined);
  render(<TemplateBulkDeleteDialog targets={list} loadUsage={loadUsage} deleteOne={deleteOne} beforeRun={over.beforeRun} onDone={onDone} onCancel={onCancel} />);
  return { onDone, onCancel, loadUsage, deleteOne };
}

describe('TemplateBulkDeleteDialog', () => {
  it('reads usage only for the templates that may be in use, then lists them with the in-use one checked', async () => {
    const h = mount();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Delete 4 templates?');
    const confirm = await screen.findByRole('button', { name: 'Delete 3 templates' });
    expect(h.loadUsage.mock.calls.map((c) => c[0]).sort()).toEqual(['sos', 'u1']);
    const box = within(dialog).getByRole('checkbox', { name: /Lobby loop/ });
    expect(box).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: /Lobby loop/ })).toHaveAccessibleName(/2 playlists · 5 screens/);
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(1); // the emergency row has none
    expect(dialog).toHaveTextContent('Lockdown board');
    expect(dialog).toHaveTextContent('Kept: used by an emergency playlist');
    await waitFor(() => expect(document.activeElement).toBe(confirm));
  });

  it('one click deletes the free ones plainly and the checked one with force; never the emergency one', async () => {
    const h = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete 3 templates' }));
    await waitFor(() => expect(h.onDone).toHaveBeenCalledTimes(1));
    expect(h.deleteOne.mock.calls.map((c) => `${c[0]}:${c[1]}`).sort()).toEqual(['f1:false', 'f2:false', 'u1:true']);
    expect(h.onDone.mock.calls[0][0]).toMatchObject({ deleted: 3, keptEmergency: 1, keptByChoice: 0, failed: 0 });
  });

  it('unticking keeps that one by choice', async () => {
    const h = mount();
    await screen.findByRole('button', { name: 'Delete 3 templates' });
    fireEvent.click(screen.getByRole('checkbox', { name: /Lobby loop/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 templates' }));
    await waitFor(() => expect(h.onDone).toHaveBeenCalledTimes(1));
    expect(h.deleteOne.mock.calls.map((c) => c[0]).sort()).toEqual(['f1', 'f2']);
    expect(h.onDone.mock.calls[0][0]).toMatchObject({ deleted: 2, keptByChoice: 1, keptEmergency: 1 });
  });

  it('a template that came into use mid-run is asked about again, never forced silently', async () => {
    const deleteOne = jest.fn(async (id: string, force: boolean) => {
      if (id === 'f2' && !force) throw Object.assign(new Error('in use'), { code: 'TEMPLATE_IN_USE' });
    });
    const h = mount({ deleteOne });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete 3 templates' }));
    const follow = await screen.findByText('1 template just came into use');
    expect(follow).toBeInTheDocument();
    expect(h.onDone).not.toHaveBeenCalled();
    expect(await screen.findByRole('checkbox', { name: /Free two/ })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Delete 1 template' }));
    await waitFor(() => expect(h.onDone).toHaveBeenCalledTimes(1));
    expect(deleteOne.mock.calls.filter((c) => c[0] === 'f2').map((c) => c[1])).toEqual([false, true]);
    expect(h.onDone.mock.calls[0][0]).toMatchObject({ deleted: 3, keptEmergency: 1, failed: 0 });
  });

  it('cancelling the follow-up still reports what the first round did', async () => {
    const deleteOne = jest.fn(async (id: string, force: boolean) => {
      if (id === 'f2' && !force) throw Object.assign(new Error('in use'), { code: 'TEMPLATE_IN_USE' });
    });
    const h = mount({ deleteOne });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete 3 templates' }));
    await screen.findByRole('checkbox', { name: /Free two/ });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(h.onCancel).not.toHaveBeenCalled();
    expect(h.onDone.mock.calls[0][0]).toMatchObject({ deleted: 2, keptByChoice: 1, keptEmergency: 1 });
  });

  it('cancelling a follow-up whose re-read says emergency or unreadable keeps those buckets (not "by choice")', async () => {
    const deleteOne = jest.fn(async (id: string, force: boolean) => {
      if ((id === 'f1' || id === 'f2') && !force) throw Object.assign(new Error('in use'), { code: 'TEMPLATE_IN_USE' });
    });
    // First read: only u1 / sos are read. Follow-up re-read: f1 is now emergency, f2 unreadable.
    const loadUsage = jest.fn(async (id: string) => {
      if (id === 'f1') return { playlists: [{ id: 'pe', name: 'Emergency' }], total: 1, protectedEmergency: true };
      if (id === 'f2') throw new Error('Usage unavailable');
      return usageFor(id);
    });
    const h = mount({ deleteOne, loadUsage });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete 3 templates' }));
    await screen.findByText('2 templates just came into use');
    await screen.findByRole('button', { name: 'Nothing to delete' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(h.onDone.mock.calls[0][0]).toMatchObject({ deleted: 1, keptEmergency: 2, keptByChoice: 0, failed: 1, firstError: 'Usage unavailable' });
  });

  it('a forced delete that meets the emergency guard (a playlist turned emergency mid-run) is kept (emergency), never retried', async () => {
    const deleteOne = jest.fn(async (id: string, force: boolean) => {
      if (id === 'u1' && force) throw Object.assign(new Error('emergency'), { code: 'TEMPLATE_EMERGENCY_IN_USE' });
    });
    const h = mount({ deleteOne });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete 3 templates' }));
    await waitFor(() => expect(h.onDone).toHaveBeenCalledTimes(1));
    expect(deleteOne.mock.calls.filter((c) => c[0] === 'u1')).toHaveLength(1);
    expect(h.onDone.mock.calls[0][0]).toMatchObject({ deleted: 2, keptEmergency: 2, keptByChoice: 0, failed: 0 });
  });

  it('any other failure is reported as failed with its message', async () => {
    const deleteOne = jest.fn(async (id: string) => { if (id === 'f1') throw new Error('Server unavailable'); });
    const h = mount({ deleteOne });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete 3 templates' }));
    await waitFor(() => expect(h.onDone).toHaveBeenCalledTimes(1));
    expect(h.onDone.mock.calls[0][0]).toMatchObject({ deleted: 2, failed: 1, firstError: 'Server unavailable' });
    expect(h.onDone.mock.calls[0][0].handled).not.toContain('f1');
  });

  it('a usage read that fails keeps that template (no checkbox) and never deletes it blind', async () => {
    const loadUsage = jest.fn(async (id: string) => { if (id === 'u1') throw new Error('Usage unavailable'); return usageFor(id); });
    const h = mount({ loadUsage });
    const confirm = await screen.findByRole('button', { name: 'Delete 2 templates' });
    expect(screen.getByRole('alertdialog')).toHaveTextContent("Kept: couldn't check where it's used");
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    fireEvent.click(confirm);
    await waitFor(() => expect(h.onDone).toHaveBeenCalledTimes(1));
    expect(h.deleteOne.mock.calls.map((c) => c[0]).sort()).toEqual(['f1', 'f2']);
    expect(h.onDone.mock.calls[0][0]).toMatchObject({ deleted: 2, failed: 1, firstError: 'Usage unavailable' });
  });

  it('an all-free selection needs no reads and Escape cancels without deleting', async () => {
    const h = mount({}, targets.slice(0, 2));
    expect(screen.getByRole('button', { name: 'Delete 2 templates' })).toBeEnabled();
    expect(h.loadUsage).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(h.onCancel).toHaveBeenCalledTimes(1);
    expect(h.deleteOne).not.toHaveBeenCalled();
  });

  it('shows progress on the button while deleting, keeps focus on it, and runs once however often it is pressed', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const deleteOne = jest.fn(() => gate);
    const beforeRun = jest.fn(async () => undefined);
    mount({ deleteOne, beforeRun }, targets.slice(0, 2));
    const confirm = screen.getByRole('button', { name: 'Delete 2 templates' });
    await waitFor(() => expect(document.activeElement).toBe(confirm));
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    const busy = await screen.findByRole('button', { name: 'Deleting 0 of 2…' });
    // aria-disabled, not disabled: focus keeps its home on the button during the run.
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(busy).not.toHaveAttribute('disabled');
    expect(document.activeElement).toBe(busy);
    fireEvent.click(busy);
    release();
    await waitFor(() => expect(deleteOne).toHaveBeenCalledTimes(2));
    expect(beforeRun).toHaveBeenCalledTimes(1);
  });
});
