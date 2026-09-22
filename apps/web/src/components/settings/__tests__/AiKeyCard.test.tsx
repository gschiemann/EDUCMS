/**
 * A location with no AI key of its own uses its organisation's (2026-09-22). Settings must say so —
 * before this, Greg's RIOT locations showed "free trial" while every AI call there quietly ran on
 * our key instead of the OpenAI key he had saved on RIOT Las Vegas - Downtown.
 */
import { render, screen, waitFor } from '@testing-library/react';

jest.mock('next-intl', () => ({
  // Render the key path itself so assertions do not depend on copy.
  useTranslations: () => (k: string, vals?: any) => (vals ? `${k}:${JSON.stringify(vals)}` : k),
}));

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (...a: any[]) => apiFetch(...a),
}));
jest.mock('@/components/ui/app-dialog', () => ({ appConfirm: jest.fn(async () => true) }));

import { AiKeyCard } from '../AiKeyCard';

const catalog = {
  providers: [
    { id: 'openai', label: 'OpenAI', description: '', getKeyUrl: '', models: [{ id: 'gpt-6-sol', label: 'GPT-6 Sol', tagline: '', inputPer1M: 2, outputPer1M: 10, estCostPerCallUsd: 0.05 }] },
  ],
};

function mockStatus(status: Record<string, unknown>) {
  apiFetch.mockImplementation(async (path: string) => {
    if (path === '/ai/key/catalog') return catalog;
    if (path === '/ai/key') return status;
    return {};
  });
}

const notConfigured = {
  configured: false, provider: null, model: null, keyMask: null, setAt: null, setByUserId: null,
  platformFallbackAvailable: true,
};

describe('AiKeyCard — a location covered by its organisation\'s key', () => {
  beforeEach(() => apiFetch.mockReset());

  it('says whose key is in use, with vendor and model — and hides the free-trial banner', async () => {
    mockStatus({ ...notConfigured, inheritedFrom: { tenantName: 'RIOT Las Vegas - Downtown', provider: 'openai', model: 'gpt-6-sol' } });
    render(<AiKeyCard />);
    await waitFor(() =>
      expect(
        screen.getByText('settings.ai.inheritedBanner:{"org":"RIOT Las Vegas - Downtown","details":"OpenAI · GPT-6 Sol"}'),
      ).toBeTruthy(),
    );
    expect(screen.queryByText('settings.ai.freeTrialBanner')).toBeNull();
    expect(screen.queryByText('settings.ai.addKeyBanner')).toBeNull();
  });

  it('a location with no key anywhere still shows the free-trial banner (unchanged)', async () => {
    mockStatus({ ...notConfigured, inheritedFrom: null });
    render(<AiKeyCard />);
    await waitFor(() => expect(screen.getByText('settings.ai.freeTrialBanner')).toBeTruthy());
    expect(screen.queryByText(/settings\.ai\.inheritedBanner/)).toBeNull();
  });
});
