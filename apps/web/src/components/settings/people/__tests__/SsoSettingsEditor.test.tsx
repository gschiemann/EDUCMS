/**
 * The SSO page could not load or save for ~6–7 weeks (settings audit 3.10):
 * it was the one Settings page that did its own networking, building its own
 * `Authorization` header from a storage key nothing wrote any more. The fix
 * is the class, not the symptom — every call goes through the shared
 * `apiFetch` (session refresh, CSRF, retries, structured errors). These tests
 * pin that, and that a first-time admin never opens on SAML, which cannot be
 * turned on in this build.
 */
import * as fs from 'fs';
import * as path from 'path';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));
jest.mock('next/navigation', () => ({
  useParams: () => ({ schoolId: 'lincoln' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/lincoln/settings/people/sso',
}));
jest.mock('@/store/ui-store', () => ({
  useUIStore: Object.assign((sel: any) => sel({ user: { role: 'DISTRICT_ADMIN' } }), { getState: () => ({}), setState: () => {} }),
}));
jest.mock('@/hooks/use-tenant-copy', () => ({ useTenantCopy: () => ({ vertical: 'K12', roleLabel: (r: string) => r }) }));
jest.mock('@/hooks/use-api', () => ({ useTenant: () => ({ data: { name: 'Lincoln Unified' } }) }));

import { SettingsShellProvider, useSettingsShell } from '../../shell/SettingsShellContext';
import { SsoSettingsEditor } from '../SsoSettingsEditor';

const SP = {
  entityId: 'https://api.example.test/sso/lincoln/metadata',
  acsUrl: 'https://api.example.test/sso/lincoln/acs',
  oidcRedirectUri: 'https://api.example.test/sso/lincoln/oidc/callback',
};

/** Presses the shell's Save (the page registers its save handler there). */
function SaveProbe() {
  const { page } = useSettingsShell();
  return (
    <button type="button" data-testid="probe-save" onClick={() => void Promise.resolve(page?.save?.onSave?.()).catch(() => {})}>
      probe save
    </button>
  );
}

function mount() {
  return render(
    <SettingsShellProvider>
      <SsoSettingsEditor />
      <SaveProbe />
    </SettingsShellProvider>,
  );
}

beforeEach(() => {
  apiFetch.mockReset();
});

it('loads through the shared API client — never a hand-built Authorization header', async () => {
  apiFetch.mockResolvedValue({ config: null, sp: SP });
  mount();
  await screen.findByLabelText('Provider type');
  expect(apiFetch).toHaveBeenCalledWith('/tenants/lincoln/sso');
  // The call carries no headers of its own: auth, refresh and CSRF are the client's job.
  expect(apiFetch.mock.calls[0][1]).toBeUndefined();
});

it('a first-time admin opens on OpenID Connect, with no SAML option to fall into', async () => {
  apiFetch.mockResolvedValue({ config: null, sp: SP });
  mount();
  const select = (await screen.findByLabelText('Provider type')) as HTMLSelectElement;
  expect(select.value).toBe('OIDC');
  expect(within(select).queryByRole('option', { name: /SAML/ })).toBeNull();
  // Only what an OpenID Connect setup needs is offered to copy.
  expect(screen.getByText(SP.oidcRedirectUri)).toBeInTheDocument();
  expect(screen.queryByText(SP.acsUrl)).toBeNull();
});

it('a stored SAML configuration is still shown as it is — never hidden', async () => {
  apiFetch.mockResolvedValue({
    config: { id: 'c1', tenantId: 't1', provider: 'SAML', enabled: false, defaultRole: 'RESTRICTED_VIEWER', autoProvision: false },
    sp: SP,
  });
  mount();
  const select = (await screen.findByLabelText('Provider type')) as HTMLSelectElement;
  expect(select.value).toBe('SAML');
  expect(within(select).getByRole('option', { name: /SAML/ })).toBeInTheDocument();
  expect(screen.getByText(/SAML sign-in is temporarily unavailable/)).toBeInTheDocument();
});

it('saves through the shared client, then re-reads what the server stored', async () => {
  apiFetch.mockResolvedValue({ config: null, sp: SP });
  mount();
  fireEvent.change(await screen.findByLabelText(/Issuer/i), { target: { value: 'https://accounts.google.com' } });
  apiFetch.mockClear();
  apiFetch.mockResolvedValue({ config: null, sp: SP });
  fireEvent.click(screen.getByTestId('probe-save'));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/tenants/lincoln/sso', expect.objectContaining({ method: 'POST' })));
  const post = apiFetch.mock.calls.find((c) => c[1]?.method === 'POST')!;
  const body = JSON.parse(post[1].body);
  expect(body).toMatchObject({ provider: 'OIDC', oidcIssuer: 'https://accounts.google.com' });
  expect(post[1].headers).toBeUndefined();
  // …and the stored config is read back before the form calls itself clean.
  await waitFor(() => expect(apiFetch.mock.calls.filter((c) => c[0] === '/tenants/lincoln/sso' && !c[1])).toHaveLength(1));
});

it('a refused read says it could not LOAD (never "could not save" on an untouched page)', async () => {
  apiFetch.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }));
  mount();
  expect(await screen.findByText('Could not load the SSO configuration')).toBeInTheDocument();
});

it('the editor makes no raw fetch() calls (the class of bug that broke it for weeks)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'SsoSettingsEditor.tsx'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  expect(code).not.toMatch(/(?<![A-Za-z_.])fetch\s*\(/);
  expect(code).not.toMatch(/Authorization/);
});
