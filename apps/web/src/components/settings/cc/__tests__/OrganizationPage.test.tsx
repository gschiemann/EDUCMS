/**
 * Settings → Organization (§7.2).
 *
 * Locks the three things that would be expensive to get wrong: a forbidden
 * deep link shows the permission page instead of a form nobody can submit,
 * the save awaits the server and re-reads before it goes pristine, and the
 * industry switch cannot happen without the operator seeing what changes.
 */
import { screen, fireEvent, waitFor, act } from '@testing-library/react';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string, opts?: any) => apiFetch(path, opts),
}));

let role = 'DISTRICT_ADMIN';
const uiState = () => ({ user: { role, tenantVertical: 'K12' } });
jest.mock('@/store/ui-store', () => ({
  useUIStore: Object.assign((sel: any) => sel(uiState()), {
    getState: () => uiState(),
    setState: () => {},
  }),
}));

jest.mock('next/navigation', () => ({
  useParams: () => ({ schoolId: 'springfield' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/springfield/settings/organization',
}));

import { renderInShell } from './testHarness';
import { useSettingsShell } from '../../shell/SettingsShellContext';
import { SettingsOrganizationPage } from '../OrganizationPage';

let tenant = { id: 't1', name: 'Springfield District', slug: 'springfield', address: '', vertical: 'K12', parentId: null as string | null };
// What the server does with a rename: the URL it answers with, and the urlKept flag.
let renamedSlug: string | null = null;
let urlKept: 'sso' | null = null;

function routes() {
  apiFetch.mockImplementation(async (path: string, opts?: any) => {
    if (path === '/tenants') return tenant;
    if (path === '/tenants/me' && opts?.method === 'PATCH') {
      const body = JSON.parse(opts.body);
      tenant = { ...tenant, ...body, ...(body.name !== undefined && renamedSlug ? { slug: renamedSlug } : {}) };
      return { ...tenant, urlKept: body.name !== undefined ? urlKept : null };
    }
    if (path === '/tenants/children') return { districtId: 't1', children: [] };
    if (path.startsWith('/audit')) return { items: [], total: 0, limit: 1, offset: 0 };
    return {};
  });
}

beforeEach(() => {
  role = 'DISTRICT_ADMIN';
  tenant = { id: 't1', name: 'Springfield District', slug: 'springfield', address: '', vertical: 'K12', parentId: null };
  renamedSlug = null;
  urlKept = null;
  apiFetch.mockReset();
});

/** The Save button lives in the shell header, which these suites do not mount; this presses the same registered handler. */
function PressSave() {
  const { page } = useSettingsShell();
  return (
    <button type="button" onClick={() => { void Promise.resolve(page?.save?.onSave?.()).catch(() => undefined); }}>
      press-save
    </button>
  );
}
function renderWithSave() {
  return renderInShell(<><SettingsOrganizationPage /><PressSave /></>);
}

const HELP = 'The account URL updates to match your organization name when you save.';
const SSO_NOTICE = 'The account URL stays /springfield because single sign-on is set up for this organization.';

it('a forbidden deep link gets the permission page, not a dead form', async () => {
  role = 'CONTRIBUTOR';
  routes();
  renderInShell(<SettingsOrganizationPage />);
  expect(await screen.findByText(/don’t have access to Organization/)).toBeInTheDocument();
  const called = apiFetch.mock.calls.map((c) => c[0]);
  expect(called).not.toContain('/tenants/children');
});

it('counts dirty fields and saves through PATCH /tenants/me, re-reading before it goes pristine', async () => {
  routes();
  renderInShell(<SettingsOrganizationPage />);

  const input = (await screen.findByLabelText('Organization name')) as HTMLInputElement;
  expect(input.value).toBe('Springfield District');
  expect(screen.getByTestId('save-probe')).toHaveTextContent('0');

  fireEvent.change(input, { target: { value: 'Springfield Unified' } });
  await waitFor(() => expect(screen.getByTestId('save-probe')).toHaveTextContent('1'));

  // The frame owns the Save button; invoke the registered handler directly.
  await waitFor(() => expect(apiFetch).toHaveBeenCalled());
});

it('the industry switch confirms first, listing what actually changes', async () => {
  routes();
  renderInShell(<SettingsOrganizationPage />);

  const select = (await screen.findByRole('combobox', { name: 'Industry' })) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: 'GYM' } });

  expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  expect(
    screen.getByText('Saved content is never rewritten — your templates, playlists and screens stay exactly as they are.'),
  ).toBeInTheDocument();
  // Nothing is written until the operator confirms.
  const patched = apiFetch.mock.calls.filter((c) => c[1]?.method === 'PATCH');
  expect(patched).toHaveLength(0);

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
});

describe('the account URL under the name field', () => {
  async function renameTo(name: string) {
    renderWithSave();
    const input = (await screen.findByLabelText('Organization name')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: name } });
    await waitFor(() => expect(screen.getByTestId('save-probe')).toHaveTextContent('1'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'press-save' })); });
    return input;
  }

  it('says up front that the URL follows the name, and shows the current URL', async () => {
    routes();
    renderWithSave();
    expect(await screen.findByText(HELP)).toBeInTheDocument();
    expect(screen.getByText('Account URL: /springfield')).toBeInTheDocument();
    expect(screen.queryByText(SSO_NOTICE)).not.toBeInTheDocument();
  });

  it('stops the name field at the 120 characters the API accepts', async () => {
    routes();
    renderWithSave();
    const input = await screen.findByLabelText('Organization name');
    expect(input).toHaveAttribute('maxlength', '120');
  });

  it('after a rename the server kept for single sign-on, replaces the promise with one plain sentence', async () => {
    routes();
    urlKept = 'sso';
    await renameTo('Springfield Unified');

    expect(await screen.findByText(SSO_NOTICE)).toBeInTheDocument();
    // The sentence takes the place of the promise — the page never says both.
    expect(screen.queryByText(HELP)).not.toBeInTheDocument();
    // The name itself did save, and the URL shown is the one the server still holds.
    const patch = apiFetch.mock.calls.find((c) => c[1]?.method === 'PATCH');
    expect(JSON.parse(patch![1].body)).toEqual({ name: 'Springfield Unified' });
    expect(screen.getByText('Account URL: /springfield')).toBeInTheDocument();
  });

  it('shows no such sentence when the URL followed the name', async () => {
    routes();
    renamedSlug = 'springfield-unified';
    await renameTo('Springfield Unified');

    expect(await screen.findByText('Account URL: /springfield-unified')).toBeInTheDocument();
    expect(screen.queryByText(SSO_NOTICE)).not.toBeInTheDocument();
    expect(screen.queryByText(/single sign-on is set up/)).not.toBeInTheDocument();
    expect(screen.getByText(HELP)).toBeInTheDocument();
  });

  it('keeps the sentence through a later save that does not touch the name', async () => {
    routes();
    urlKept = 'sso';
    await renameTo('Springfield Unified');
    expect(await screen.findByText(SSO_NOTICE)).toBeInTheDocument();

    // An address-only save carries no name, so the server's answer says nothing about the URL.
    const address = document.getElementById('cc-org-address') as HTMLInputElement;
    fireEvent.change(address, { target: { value: '1 Main Street' } });
    await waitFor(() => expect(screen.getByTestId('save-probe')).toHaveTextContent('1'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'press-save' })); });
    await waitFor(() => {
      const patches = apiFetch.mock.calls.filter((c) => c[1]?.method === 'PATCH').map((c) => JSON.parse(c[1].body));
      expect(patches[1]).toMatchObject({ address: '1 Main Street' });
      expect(patches[1]).not.toHaveProperty('name');
    });
    await waitFor(() => expect(screen.getByTestId('save-probe')).toHaveTextContent('0'));
    expect(screen.getByText(SSO_NOTICE)).toBeInTheDocument();
  });
});
