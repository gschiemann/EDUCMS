/**
 * Student information on public screens — the dashboard side (K-12 sports
 * launch, lane B3, 2026-09-27). The API enforces the policy
 * (apps/api/src/sports/student-privacy.spec.ts); these prove a school can see
 * and record it:
 *   • the dashboard prompt appears exactly while a school hides students;
 *   • an administrator confirms a statement only after ticking it, and the
 *     request carries the wording version the admin was shown;
 *   • everyone else reads it without controls;
 *   • the per-student flags: protecting a student is anyone's, showing more is
 *     an administrator's;
 *   • Settings lists "Sports" for schools and venues only.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { StudentPrivacySettings } from '@cms/api-types';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { StudentPrivacyBanner } from '../StudentPrivacyBanner';
import { StudentPrivacySettingsCard } from '../StudentPrivacySettingsCard';
import { StudentFlagControls } from '../StudentFlagControls';
import { visibleSections } from '@/components/settings/shell/registry';

const V = '2026-09-27';

function settings(over: Partial<StudentPrivacySettings> = {}): StudentPrivacySettings {
  return {
    applies: true,
    appliesBecause: 'k12',
    servesMinors: null,
    names: { allowed: false, own: null, source: null, needsReconfirm: false },
    photos: { allowed: false, own: null, source: null, needsReconfirm: false },
    attestation: { version: V, text: { names: 'N', photos: 'P' } },
    canChange: true,
    ...over,
  };
}

function mount(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => apiFetch.mockReset());

describe('the dashboard prompt', () => {
  it('a school that confirmed nothing sees the exact prompt, linking to Settings → Sports', async () => {
    apiFetch.mockResolvedValue(settings());
    mount(<StudentPrivacyBanner schoolId="lincoln" />);
    const banner = await screen.findByTestId('student-privacy-banner');
    expect(banner).toHaveTextContent(
      'Student names and photos are hidden on public screens until an admin confirms your directory-information policy.',
    );
    expect(screen.getByRole('link', { name: 'Review the policy' })).toHaveAttribute('href', '/lincoln/settings/sports');
  });

  it('names confirmed, photos not: a quieter photos line', async () => {
    apiFetch.mockResolvedValue(settings({ names: { allowed: true, own: 'ALLOW', source: null, needsReconfirm: false } }));
    mount(<StudentPrivacyBanner schoolId="lincoln" />);
    expect(await screen.findByTestId('student-privacy-banner')).toHaveTextContent(
      'Student photos stay hidden on public screens until an admin confirms your photo-release policy.',
    );
  });

  it('nothing at a venue the policy does not apply to, or once everything is confirmed', async () => {
    apiFetch.mockResolvedValue(settings({ applies: false, appliesBecause: null }));
    const a = mount(<StudentPrivacyBanner schoolId="v" />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(screen.queryByTestId('student-privacy-banner')).toBeNull();
    a.unmount();
    apiFetch.mockResolvedValue(
      settings({
        names: { allowed: true, own: 'ALLOW', source: null, needsReconfirm: false },
        photos: { allowed: true, own: 'ALLOW', source: null, needsReconfirm: false },
      }),
    );
    mount(<StudentPrivacyBanner schoolId="v" />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('student-privacy-banner')).toBeNull();
  });
});

describe('Settings → Sports → Student information on public screens', () => {
  it('an administrator confirms only after ticking the statement, with the version shown', async () => {
    apiFetch.mockResolvedValueOnce(settings());
    mount(<StudentPrivacySettingsCard orgName="Lincoln High" />);
    expect(
      await screen.findByText(
        /designates athletes' names and participation in officially recognized sports as directory information/,
      ),
    ).toBeInTheDocument();
    const confirm = screen.getAllByRole('button', { name: 'Confirm' })[0];
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'I confirm this statement is true for Lincoln High.' })[0]);
    expect(confirm).toBeEnabled();
    apiFetch.mockResolvedValueOnce(settings({ names: { allowed: true, own: 'ALLOW', source: null, needsReconfirm: false } }));
    fireEvent.click(confirm);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    const [path, opts] = apiFetch.mock.calls[1];
    expect(path).toBe('/sports/student-privacy/names');
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body)).toEqual({ action: 'confirm', version: V });
  });

  it("shows where the answer comes from — a district's confirmation, and offers a stricter local hide", async () => {
    apiFetch.mockResolvedValueOnce(
      settings({
        names: {
          allowed: true,
          own: null,
          needsReconfirm: false,
          source: {
            level: 'parent',
            tenantId: 'd',
            tenantName: 'Unified District',
            state: 'ALLOW',
            setAt: '2026-09-27T12:00:00.000Z',
            setBy: { id: 'u', name: 'Pat Smith', email: null },
            version: V,
          },
        },
      }),
    );
    mount(<StudentPrivacySettingsCard orgName="Lincoln High" />);
    expect(await screen.findByTestId('sp-names-source')).toHaveTextContent('Confirmed by Unified District (Pat Smith, ');
    apiFetch.mockResolvedValueOnce(settings());
    fireEvent.click(screen.getByRole('button', { name: 'Hide at this location' }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(apiFetch.mock.calls[1][1].body)).toEqual({ action: 'hide' });
  });

  it('someone who may not change it reads it, with no controls', async () => {
    apiFetch.mockResolvedValueOnce(settings({ canChange: false }));
    mount(<StudentPrivacySettingsCard orgName="Lincoln High" />);
    expect(await screen.findByText('Only a school or district administrator can change this.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    expect(screen.getByTestId('sp-names-source')).toHaveTextContent('Nobody has confirmed this yet.');
  });

  it('a non-K-12 venue gets the "serves minors" switch instead', async () => {
    apiFetch.mockResolvedValueOnce(settings({ applies: false, appliesBecause: null, servesMinors: null }));
    mount(<StudentPrivacySettingsCard orgName="Memorial Stadium" />);
    const sw = await screen.findByRole('checkbox', { name: 'Our athletes include minors (under 18)' });
    expect(screen.queryByTestId('sp-names-source')).toBeNull();
    apiFetch.mockResolvedValueOnce(settings({ appliesBecause: 'serves-minors', servesMinors: true }));
    fireEvent.click(sw);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    expect(apiFetch.mock.calls[1][0]).toBe('/sports/student-privacy/serves-minors');
    expect(JSON.parse(apiFetch.mock.calls[1][1].body)).toEqual({ servesMinors: true });
  });
});

describe('per-student flags on the roster', () => {
  it('an editor may protect a student but not show more', () => {
    mount(<StudentFlagControls gameId="g" playerId="p" directoryOptOut={false} photoRelease={false} isAdmin={false} />);
    expect(screen.getByRole('checkbox', { name: 'Directory opt-out — never display' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'Photo release on file' })).toBeDisabled();
  });

  it('an editor cannot clear an opt-out', () => {
    mount(<StudentFlagControls gameId="g" playerId="p" directoryOptOut photoRelease={false} isAdmin={false} />);
    expect(screen.getByRole('checkbox', { name: 'Directory opt-out — never display' })).toBeDisabled();
    expect(screen.getByText('Never shown on public screens')).toBeInTheDocument();
  });

  it('an administrator records a release; the switch moves at once and PATCHes the student', async () => {
    apiFetch.mockReturnValueOnce(new Promise(() => undefined));
    mount(<StudentFlagControls gameId="g" playerId="p" directoryOptOut={false} photoRelease={false} isAdmin />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Photo release on file' }));
    expect(screen.getByRole('checkbox', { name: 'Photo release on file' })).toBeChecked();
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const [path, opts] = apiFetch.mock.calls[0];
    expect(path).toBe('/sports/games/g/roster/p/privacy');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ photoRelease: true });
  });
});

describe('Settings lists "Sports" for schools and venues only', () => {
  const ids = (vertical?: string) => visibleSections('SCHOOL_ADMIN', vertical).map((s) => s.id);
  it('a school and a venue see it; a restaurant does not', () => {
    expect(ids('K12')).toContain('sports');
    expect(ids('SPORTS')).toContain('sports');
    expect(ids('RESTAURANT')).not.toContain('sports');
    expect(ids('RESTAURANT')).toContain('player'); // everything else unchanged
  });
});
