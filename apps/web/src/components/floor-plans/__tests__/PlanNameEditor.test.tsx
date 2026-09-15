import * as React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PlanNameEditor } from '../PlanNameEditor';

const mutateAsync = jest.fn(async (input: { planId: string; name: string }) => ({ id: input.planId, name: input.name }));
jest.mock('@/hooks/use-api', () => ({
  useRenameFloorPlan: () => ({ mutateAsync, isPending: false }),
}));

describe('PlanNameEditor — the floor plan can be renamed where it is shown', () => {
  beforeEach(() => mutateAsync.mockClear());

  it('shows the name as a rename button; Enter saves the trimmed name', async () => {
    render(<PlanNameEditor planId="fp1" name="ChatGPT Image Aug 25" canEdit />);
    fireEvent.click(screen.getByRole('button', { name: /Rename floor plan/ }));
    const input = screen.getByLabelText('Floor plan name');
    fireEvent.change(input, { target: { value: '  Main building — Floor 1  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ planId: 'fp1', name: 'Main building — Floor 1' }));
    await waitFor(() => expect(screen.queryByLabelText('Floor plan name')).not.toBeInTheDocument());
  });

  it('refuses a blank name and Escape cancels without saving', () => {
    render(<PlanNameEditor planId="fp1" name="Floor 1" canEdit />);
    fireEvent.click(screen.getByRole('button', { name: /Rename floor plan/ }));
    const input = screen.getByLabelText('Floor plan name');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('A plan needs a name.');
    expect(mutateAsync).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByLabelText('Floor plan name')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Rename floor plan/ })).toHaveTextContent('Floor 1');
  });

  it('read-only roles get plain text, no control', () => {
    render(<PlanNameEditor planId="fp1" name="Floor 1" canEdit={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Floor 1')).toBeInTheDocument();
  });
});
