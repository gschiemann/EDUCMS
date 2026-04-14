import { render, screen } from '@testing-library/react';
import { RoleGate } from './RoleGate';
import { useAppStore } from '@/lib/store';

// Mock Zustand store for tests
jest.mock('@/lib/store');

describe('RoleGate Component', () => {
  it('renders children if user role is in allowedRoles', () => {
    (useAppStore as unknown as jest.Mock).mockImplementation((selector) => {
      return selector({ userRole: 'admin' });
    });

    render(
      <RoleGate allowedRoles={['admin']}>
        <div data-testid="protected-content">Protected</div>
      </RoleGate>
    );

    expect(screen.getByTestId('protected-content')).toBeInTheDocument();
  });

  it('renders fallback if user role is NOT in allowedRoles', () => {
    (useAppStore as unknown as jest.Mock).mockImplementation((selector) => {
      return selector({ userRole: 'teacher' });
    });

    render(
      <RoleGate allowedRoles={['admin']} fallback={<div data-testid="fallback">Access Denied</div>}>
        <div data-testid="protected-content">Protected</div>
      </RoleGate>
    );

    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
    expect(screen.getByTestId('fallback')).toBeInTheDocument();
  });

  it('returns null if role is unauthorized and no fallback provided', () => {
    (useAppStore as unknown as jest.Mock).mockImplementation((selector) => {
      return selector({ userRole: 'teacher' });
    });

    const { container } = render(
      <RoleGate allowedRoles={['admin']}>
        <div>Protected</div>
      </RoleGate>
    );

    expect(container).toBeEmptyDOMElement();
  });
});
