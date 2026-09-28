/**
 * K-12 sports launch follow-up, lane B4 — "Don't type student names here".
 *
 * The API blanks a typed value on every real screen when it is a rostered
 * student the school's policy hides (apps/api/src/sports/typed-student-names
 * .ts; the field list is @cms/api-types student-name-fields.ts). The builder
 * says so ON those fields while the school's names are hidden — rendered here
 * through the real Properties panel (`ContentFields`, CLAUDE.md rule #9).
 */
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import en from '@/i18n/messages/en.json';
import es from '@/i18n/messages/es.json';
import zh from '@/i18n/messages/zh.json';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual('@/lib/api-client'),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));
jest.mock('@/hooks/use-api', () => ({
  useAssets: () => ({ data: [] }),
  usePlaylists: () => ({ data: [] }),
  useTemplates: () => ({ data: [] }),
  useTemplateBackdrops: () => ({ data: [] }),
  useGames: () => ({ data: [] }),
}));

import { ContentFields } from '../PropertiesPanel';

const WARNING = en.studentPrivacy.typedNames.warning;

function policy(p: { applies: boolean; names: boolean }) {
  apiFetch.mockImplementation((path: string) => {
    if (path === '/sports/student-privacy') {
      return Promise.resolve({ applies: p.applies, names: { allowed: p.names }, photos: { allowed: false } });
    }
    return new Promise(() => undefined);
  });
}

function mount(widgetType: string, defaultConfig: Record<string, unknown>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ContentFields zone={{ id: 'z1', widgetType, defaultConfig }} updateZone={jest.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => apiFetch.mockReset());
afterEach(cleanup);

describe('a school that has not confirmed its directory-information policy', () => {
  beforeEach(() => policy({ applies: true, names: false }));

  it('warns on the relay legs', async () => {
    mount('SWIM_RELAY_EXCHANGE', { legs: [] });
    expect(await screen.findByText(WARNING)).toBeInTheDocument();
    expect(screen.getByText(en.studentPrivacy.typedNames.detail)).toBeInTheDocument();
    expect(screen.getAllByTestId('student-name-notice')).toHaveLength(1);
  });

  it('warns on the CTS announcement lines', async () => {
    mount('SCOREBOARD', { variant: 'scoreboard-cts-announcement', dataSource: 'manual', entries: [] });
    expect(await screen.findByText(WARNING)).toBeInTheDocument();
  });

  it('warns once on a player card, right before the name fields', async () => {
    const { container } = mount('SCOREBOARD', { variant: 'player-card', dataMode: 'manual', player: {} });
    const notice = await screen.findByTestId('student-name-notice');
    expect(screen.getAllByTestId('student-name-notice')).toHaveLength(1);
    // The next field after the notice is the first-name field.
    const firstName = screen.getByLabelText(en.sportsTemplates.venue.firstName);
    expect(notice.compareDocumentPosition(firstName) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.textContent).toContain(WARNING);
  });

  it('warns on a celebration\'s scorer field', async () => {
    mount('CELEBRATION', { variant: 'cel-hockey-goal' });
    expect(await screen.findByText(WARNING)).toBeInTheDocument();
    expect(screen.getAllByTestId('student-name-notice')).toHaveLength(1);
  });

  it('says nothing on a widget with no typed-name fields', async () => {
    mount('SCOREBOARD', { variant: 'ribbon-sponsor' });
    // Let the policy query settle, then look.
    await screen.findByLabelText(en.sportsTemplates.venue.sponsorName);
    expect(screen.queryByTestId('student-name-notice')).toBeNull();
  });
});

describe('no warning where names may show', () => {
  it('after the school confirms', async () => {
    policy({ applies: true, names: true });
    mount('SWIM_RELAY_EXCHANGE', { legs: [] });
    await screen.findByText('Relay legs (exactly 4)');
    // Until the answer loads, a school warns (default deny); then it clears.
    await waitFor(() => expect(screen.queryByTestId('student-name-notice')).toBeNull());
  });

  it('at a venue the policy does not apply to', async () => {
    policy({ applies: false, names: true });
    mount('SWIM_RELAY_EXCHANGE', { legs: [] });
    await screen.findByText('Relay legs (exactly 4)');
    // Until the answer loads, a school warns (default deny); then it clears.
    await waitFor(() => expect(screen.queryByTestId('student-name-notice')).toBeNull());
  });
});

describe('the copy ships in every dashboard language', () => {
  it('en / es / zh', () => {
    for (const cat of [en, es, zh] as Array<typeof en>) {
      expect(cat.studentPrivacy.typedNames.warning.length).toBeGreaterThan(10);
      expect(cat.studentPrivacy.typedNames.detail.length).toBeGreaterThan(10);
    }
    expect(es.studentPrivacy.typedNames.warning).not.toBe(WARNING);
    expect(zh.studentPrivacy.typedNames.warning).not.toBe(WARNING);
  });
});
