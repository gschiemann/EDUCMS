/**
 * Onboarding "Your apps, ready to go" step — RTL proof (task #265, 2026-07-01).
 *
 * Pins the cheapest-honest happy path this step must deliver:
 *   (a) With a tenant sourceUrl on file, it calls the REAL
 *       /integrations/discover endpoint (mocked at the apiFetch network
 *       layer, not the hook) and renders the resolved suggestion chips
 *       ("Add your YouTube") — proving discover → resolveConciergeSuggestions
 *       → ConciergeSuggestionRow wiring actually renders real detected
 *       links, not a mock UI.
 *   (b) Tapping a suggestion chip marks it "picked" (moves it into the
 *       "Ready for your Apps panel" list) and persists the pick to the
 *       onboarding->Apps-panel localStorage handoff so AppLibraryPanel can
 *       pre-warm its own row later — proving the handoff mechanic actually
 *       writes, not just that the UI updates.
 *   (c) "Skip for now" / "I'll do this later" always navigates to the
 *       dashboard — never a wall, at every state.
 *
 * Network mocked at `apiFetch` (real use-api hooks + resolver run) per the
 * MfaCard.test.tsx / AiGenerateButton.test.tsx convention in this repo.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string, opts?: Record<string, unknown>) => apiFetch(path, opts),
}));

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: jest.fn() }),
}));

jest.mock('@/lib/store', () => ({
  useAppStore: (selector: (s: { user: { tenantId: string }; activeTenant: string }) => unknown) =>
    selector({ user: { tenantId: 'tenant-1' }, activeTenant: 'acme-schools' }),
}));

import OnboardingAppsPage from '../page';

const BRANDING = { sourceUrl: 'https://example.com', displayName: 'Acme', tenantId: 'tenant-1' };
const DISCOVER_RESULT = {
  source: 'url',
  inputSummary: 'example.com',
  candidates: [
    { id: 'youtube', name: 'YouTube', category: 'video', confidence: 0.9, blurb: 'Video platform', matchedSignals: [], status: 'AVAILABLE', connectHref: null, detectedValue: 'https://youtube.com/@acme' },
  ],
  warnings: [],
  ownLinks: { youtube: 'https://youtube.com/@acme' },
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OnboardingAppsPage />
    </QueryClientProvider>,
  );
}

describe('Onboarding /onboarding/apps — Concierge auto-fill (task #265)', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    push.mockReset();
    window.localStorage.clear();
  });

  it('(a) fires /integrations/discover with the tenant sourceUrl and renders a real suggestion chip', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === '/branding/me') return Promise.resolve(BRANDING);
      if (path === '/integrations/discover') return Promise.resolve(DISCOVER_RESULT);
      return Promise.resolve(null);
    });

    await act(async () => { renderPage(); });

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/integrations/discover', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ url: 'https://example.com' }),
      }));
    });

    expect(await screen.findByText(/Add your YouTube/i)).toBeInTheDocument();
  });

  it('(b) tapping a suggestion marks it picked, shows it under "Ready for your Apps panel", and persists the handoff', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === '/branding/me') return Promise.resolve(BRANDING);
      if (path === '/integrations/discover') return Promise.resolve(DISCOVER_RESULT);
      return Promise.resolve(null);
    });

    await act(async () => { renderPage(); });

    const chip = await screen.findByText(/Add your YouTube/i);
    await act(async () => { fireEvent.click(chip); });

    expect(await screen.findByText('Ready for your Apps panel')).toBeInTheDocument();
    expect(screen.getByText('YouTube')).toBeInTheDocument();

    // The handoff persisted to localStorage so AppLibraryPanel can read it
    // back via readOnboardingConciergeSuggestions — proves the mechanic
    // actually wrote something, not just that the chip UI moved.
    const raw = window.localStorage.getItem('edu-cms-concierge-onboarding-v1:tenant-1');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed.sourceUrl).toBe('https://example.com');
    expect(parsed.suggestions.find((s: { appId: string; picked: boolean }) => s.appId === 'youtube')?.picked).toBe(true);
  });

  it('(c) Skip always navigates to the dashboard, even before discover resolves', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === '/branding/me') return Promise.resolve(BRANDING);
      // discover never resolves in this test — simulates a slow/failed call
      if (path === '/integrations/discover') return new Promise(() => {});
      return Promise.resolve(null);
    });

    await act(async () => { renderPage(); });

    fireEvent.click(screen.getByText(/Skip for now/i));
    expect(push).toHaveBeenCalledWith('/acme-schools/dashboard?branded=1');
  });

  it('(c) with no website on file, falls through to the describe intake instead of a dead end', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === '/branding/me') return Promise.resolve({ ...BRANDING, sourceUrl: null });
      return Promise.resolve(null);
    });

    await act(async () => { renderPage(); });

    expect(await screen.findByLabelText(/Describe your business to get app suggestions/i)).toBeInTheDocument();
    // Never called discover with an empty URL.
    expect(apiFetch).not.toHaveBeenCalledWith('/integrations/discover', expect.anything());
  });
});
