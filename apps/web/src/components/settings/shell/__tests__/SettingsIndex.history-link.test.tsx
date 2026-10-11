/**
 * Muse beta DEV-009 / DEV-015: "Settings history" in the settings rail was a
 * plain block that went nowhere. It now links to the audit log for the roles
 * the audit API serves, and is absent for everyone else.
 */
import { render, screen } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/springfield/settings',
  useParams: () => ({ schoolId: 'springfield' }),
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
jest.mock('@/hooks/use-tenant-copy', () => ({ useTenantCopy: () => ({ vertical: 'K12' }) }));
jest.mock('@/store/ui-store', () => ({
  useUIStore: Object.assign((sel: any) => sel({ user: { role: 'SCHOOL_ADMIN' } }), { getState: () => ({}), setState: () => {} }),
}));

import { SettingsShellProvider } from '../SettingsShellContext';
import { SettingsIndex } from '../SettingsIndex';

function mount(role: string) {
  return render(
    <SettingsShellProvider>
      <SettingsIndex schoolId="springfield" role={role} activeId={null} variant="rail" />
    </SettingsShellProvider>,
  );
}

it('an admin gets a real link to the audit log', () => {
  mount('SCHOOL_ADMIN');
  const link = screen.getByTestId('settings-history-link');
  expect(link.tagName).toBe('A');
  expect(link).toHaveAttribute('href', '/springfield/audit');
  expect(link).toHaveTextContent('Settings history');
});

it('a contributor gets no dead entry', () => {
  mount('CONTRIBUTOR');
  expect(screen.queryByTestId('settings-history-link')).toBeNull();
  expect(screen.queryByText('Settings history')).toBeNull();
});
