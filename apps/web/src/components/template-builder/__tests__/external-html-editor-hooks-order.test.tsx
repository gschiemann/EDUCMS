/**
 * Regression guard (2026-06-01) — ExternalHtmlTextEditor (the editor for
 * EXTERNAL_HTML signage/menu templates, e.g. the Domino's pizza board) must
 * keep a STABLE hook order across the async field-discovery transition.
 *
 * The bug this guards: a useEffect (the board→panel "hot zones" listener) was
 * added AFTER the component's early-return guards (`if (!url)`,
 * `if (discoveredFields === null) return <Scanning…>`). On the first render the
 * editor is in the loading state → early-returns → that hook never runs. Once
 * the template HTML fetch resolves and the fields render, the guards pass and
 * the hook runs — so the hook COUNT changes between renders →
 * "Rendered more hooks than during the previous render" → React throws → the
 * whole builder route hit the error boundary ("This page couldn't load") the
 * moment an operator clicked Customize on a signage template.
 *
 * A naive `expect(() => render()).not.toThrow()` misses it (the crash is on the
 * POST-fetch re-render, not the sync first render). This test waits for the
 * async discovery to complete, which is exactly when the crash fired.
 */
import fs from 'fs';
import path from 'path';
import { render, waitFor } from '@testing-library/react';

// Test-noise silencer: the builder UI mounts the AI affordances
// (AiGenerateButton / ChatToEditBox / …) plus the POS panel, all of
// which call apiFetch() on mount. The global.fetch stub below returns
// the Domino's board HTML for EVERY url, so those API probes "succeed"
// with HTML and apiFetch spams console.error ("Failed to parse JSON
// response") for each. This suite only tests the EXTERNAL_HTML field
// discovery (which fetches the template HTML directly, NOT through
// apiFetch), so keep every apiFetch call permanently pending instead.
jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual('@/lib/api-client'),
  apiFetch: jest.fn(() => new Promise(() => undefined)),
}));
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PropertiesPanel } from '../PropertiesPanel';
import { useBuilderStore } from '../useBuilderStore';
import type { Zone } from '../types';

const DOMINOS_HTML = fs.readFileSync(
  path.resolve(__dirname, '../../../../public/templates/signage/qsr/11-dominos-pizza-board.html'),
  'utf8',
);

beforeAll(() => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn().mockResolvedValue({
    ok: true,
    text: () => Promise.resolve(DOMINOS_HTML),
    json: () => Promise.resolve([]),
  });
});

function mountDominosEditor() {
  const zone = {
    id: 'scene', name: 'Scene', widgetType: 'EXTERNAL_HTML',
    x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0,
    defaultConfig: { url: '/templates/signage/qsr/11-dominos-pizza-board.html', posSync: true },
  } as Zone;
  useBuilderStore.getState().init({
    id: 't1', isSystem: true, zones: [zone],
    meta: { name: 'Dominos', description: '', screenWidth: 3840, screenHeight: 2160, bgColor: '', bgGradient: '', bgImage: '' },
    isTouchEnabled: false, idleResetMs: 60000, scenes: [],
  });
  useBuilderStore.setState({ selectedIds: ['scene'] });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><PropertiesPanel /></QueryClientProvider>,
  );
}

describe('ExternalHtmlTextEditor — stable hook order across field discovery', () => {
  it('renders the editable fields after async discovery without a hooks-order crash', async () => {
    const { container } = mountDominosEditor();
    // The crash fired on the post-fetch re-render (loading → fields). Waiting
    // for the discovered inputs to appear exercises exactly that transition.
    await waitFor(() => {
      expect(container.querySelectorAll('input, textarea').length).toBeGreaterThan(5);
    }, { timeout: 4000 });
  });
});
