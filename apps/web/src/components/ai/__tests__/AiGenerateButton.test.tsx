/**
 * AiGenerateButton — discoverability proof (2026-05-29 audit §3).
 *
 * Pins the "Set up AI" affordance behavior:
 *   (a) When the tenant has NO AI provider (/ai/key → source:'none'),
 *       the button does NOT vanish — it renders an unobtrusive
 *       "Set up AI" LINK pointing at /[schoolId]/settings/ai, and it
 *       NEVER calls POST /ai/generate (so it can't 503).
 *   (b) When a provider IS configured (source:'platform'|'tenant') the
 *       real sparkle generate button renders.
 *   (c) Fail-open reconciliation — a status-fetch ERROR is treated as
 *       'none' (the safe affordance), not as a fully-active generate
 *       button (which previously 503'd for a no-key tenant).
 *
 * The status is cached at module scope, so each test clears it via the
 * component's __resetAiStatusCacheForTests() escape hatch (NOT
 * jest.resetModules — that pulls a duplicate React copy with a null
 * hook dispatcher and crashes render()).
 */
import { render, screen, waitFor, act } from '@testing-library/react';

// Network layer mocked; real component logic runs (that's what proves
// it hits /ai/key and — critically — does NOT hit /ai/generate).
const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string, opts?: any) => apiFetch(path, opts),
}));

// useParams supplies the tenant-scoped schoolId for the settings link.
jest.mock('next/navigation', () => ({
  useParams: () => ({ schoolId: 'school-1' }),
}));

// useTenantCopy is only read inside the modal; stub it so nothing in the
// component tree explodes when it mounts.
jest.mock('@/hooks/use-tenant-copy', () => ({
  useTenantCopy: () => ({ vertical: 'K12' }),
}));

import { AiGenerateButton, __resetAiStatusCacheForTests } from '../AiGenerateButton';

async function renderButton(onPick = jest.fn()) {
  await act(async () => {
    render(<AiGenerateButton intent="announcement" onPick={onPick} />);
  });
  return onPick;
}

describe('AiGenerateButton — discoverability (§3)', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    __resetAiStatusCacheForTests();
  });

  it('(a) source:none → renders "Set up AI" link to /[schoolId]/settings/ai and does NOT call /ai/generate', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === '/ai/key') {
        return Promise.resolve({ usage: { source: 'none', used: 0, cap: null, resetAt: null } });
      }
      // Any /ai/generate call would be a regression.
      return Promise.resolve(null);
    });

    await renderButton();

    const link = await screen.findByTestId('ai-setup-affordance');
    expect(link).toBeInTheDocument();
    expect(link).toHaveTextContent(/Set up AI/i);
    // Tenant-scoped settings route.
    expect(link).toHaveAttribute('href', '/school-1/settings/ai');
    // It's a navigation link, not a generate trigger.
    expect(link.tagName).toBe('A');

    // The status endpoint was queried; generate was NEVER called.
    // (The apiFetch mock wrapper forwards a 2nd `opts` arg even when the
    // caller passes one — so match on the path arg only.)
    await waitFor(() =>
      expect(apiFetch.mock.calls.some(([p]) => p === '/ai/key')).toBe(true),
    );
    const calledGenerate = apiFetch.mock.calls.some(([p]) => p === '/ai/generate');
    expect(calledGenerate).toBe(false);
  });

  it('(b) source:platform → renders the real sparkle generate button (not the affordance)', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === '/ai/key') {
        return Promise.resolve({ usage: { source: 'platform', used: 3, cap: 200, resetAt: null } });
      }
      return Promise.resolve(null);
    });

    await renderButton();

    // The generate button renders…
    expect(await screen.findByRole('button', { name: /AI/i })).toBeInTheDocument();
    // …and the setup affordance does NOT.
    expect(screen.queryByTestId('ai-setup-affordance')).toBeNull();
  });

  it('(c) status-fetch error → treated as none → shows "Set up AI", never the active generate button', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === '/ai/key') return Promise.reject(new Error('network down'));
      return Promise.resolve(null);
    });

    await renderButton();

    // Fail-open reconciled: affordance, not a click→503 generate button.
    expect(await screen.findByTestId('ai-setup-affordance')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^AI$/i })).toBeNull();
    const calledGenerate = apiFetch.mock.calls.some(([p]) => p === '/ai/generate');
    expect(calledGenerate).toBe(false);
  });
});
