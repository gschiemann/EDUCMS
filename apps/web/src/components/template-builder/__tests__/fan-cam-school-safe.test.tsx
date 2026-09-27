/**
 * K-12 sports launch, lane B3, leftover (b) — the Fan Cam at a school.
 *
 * Where students are on screen (a K-12 school, or a location that says its
 * athletes include minors) the Fan Cam's title may not ask for a kiss: the
 * field refuses the words as they are typed, says why, and offers school-safe
 * titles in one tap. Everywhere else it is an ordinary text field. The API
 * refuses the same words on save (apps/api/src/templates/fan-cam-save.spec.ts);
 * the rule itself is packages/api-types/src/fan-cam.spec.ts.
 */
import { useState } from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fanCamTextIsSchoolSafe, SCHOOL_SAFE_FAN_CAM_PRESETS } from '@cms/api-types';
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

type Venue = Record<string, string>;
const venue = (catalog: unknown) => (catalog as { sportsTemplates: { venue: Venue } }).sportsTemplates.venue;
const presetTitle = (catalog: unknown, p: string) => venue(catalog)[`camPreset${p.charAt(0).toUpperCase()}${p.slice(1)}`];

function studentsOnScreen(applies: boolean | 'pending') {
  apiFetch.mockImplementation((path: string) => {
    if (path === '/sports/student-privacy') {
      return applies === 'pending' ? new Promise(() => undefined) : Promise.resolve({ applies });
    }
    return new Promise(() => undefined);
  });
}

/** The panel over a zone that really updates, the way the builder store does. */
function mountFanCam(defaultConfig: Record<string, unknown> = {}) {
  const updateZone = jest.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Harness() {
    const [cfg, setCfg] = useState<Record<string, unknown>>({ variant: 'kiss-cam', ...defaultConfig });
    return (
      <ContentFields
        zone={{ id: 'z1', widgetType: 'SCOREBOARD', defaultConfig: cfg }}
        updateZone={(id: string, patch: { defaultConfig: Record<string, unknown> }, commit?: boolean) => {
          updateZone(id, patch, commit);
          setCfg(patch.defaultConfig);
        }}
      />
    );
  }
  render(
    <QueryClientProvider client={qc}>
      <Harness />
    </QueryClientProvider>,
  );
  return updateZone;
}
const lastCfg = (updateZone: jest.Mock): Record<string, unknown> => {
  const calls = updateZone.mock.calls;
  return calls[calls.length - 1][1].defaultConfig;
};
const titleBox = () => screen.getByLabelText('Title') as HTMLInputElement;
const sponsorBox = () => screen.getByLabelText('Sponsor line') as HTMLInputElement;

beforeEach(() => apiFetch.mockReset());
afterEach(cleanup);

describe('at a school', () => {
  beforeEach(() => studentsOnScreen(true));

  it('offers the school-safe titles, and one tap sets one', async () => {
    const updateZone = mountFanCam();
    expect(await screen.findByText('School-safe titles')).toBeInTheDocument();
    for (const p of SCHOOL_SAFE_FAN_CAM_PRESETS) expect(screen.getByRole('button', { name: presetTitle(en, p) })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'SPIRIT CAM' }));
    expect(lastCfg(updateZone).kind).toBe('SPIRIT CAM');
  });

  it('refuses "KISS CAM" as it is typed, says why, and the zone keeps no title (the frame shows FAN CAM)', async () => {
    const updateZone = mountFanCam({ kind: 'SPIRIT CAM' });
    await screen.findByText('School-safe titles');
    fireEvent.change(titleBox(), { target: { value: 'KISS CAM' } });
    expect(screen.getByRole('alert')).toHaveTextContent('“KISS CAM” isn’t available when students are on screen');
    expect(titleBox()).toHaveAttribute('aria-invalid', 'true');
    expect(titleBox().value).toBe('KISS CAM');
    expect(lastCfg(updateZone).kind).toBeUndefined();
  });

  it('…and anything like it (spelled out, spaced out, in Spanish)', async () => {
    const updateZone = mountFanCam();
    await screen.findByText('School-safe titles');
    for (const words of ['Smooch Cam', 'K I S S  C A M', 'CÁMARA DE BESOS', 'LOVE CAM']) {
      fireEvent.change(titleBox(), { target: { value: words } });
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(lastCfg(updateZone).kind).toBeUndefined();
    }
  });

  it('a school-safe word clears the refusal; so does picking a preset', async () => {
    const updateZone = mountFanCam();
    await screen.findByText('School-safe titles');
    fireEvent.change(titleBox(), { target: { value: 'KISS CAM' } });
    fireEvent.change(titleBox(), { target: { value: 'EAGLES FAN CAM' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(lastCfg(updateZone).kind).toBe('EAGLES FAN CAM');
    fireEvent.change(titleBox(), { target: { value: 'KISS CAM' } });
    fireEvent.click(screen.getByRole('button', { name: 'DANCE CAM' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(lastCfg(updateZone).kind).toBe('DANCE CAM');
    expect(titleBox().value).toBe('DANCE CAM');
  });

  it('the sponsor line cannot carry it either (it has no presets)', async () => {
    const updateZone = mountFanCam({ kind: 'FAN CAM' });
    await screen.findByText('School-safe titles');
    fireEvent.change(sponsorBox(), { target: { value: 'KISS CAM BROUGHT TO YOU BY…' } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(lastCfg(updateZone).sponsor).toBeUndefined();
    fireEvent.change(sponsorBox(), { target: { value: 'PRESENTED BY THE PTA' } });
    expect(lastCfg(updateZone).sponsor).toBe('PRESENTED BY THE PTA');
  });
});

describe('everywhere else', () => {
  it('a pro venue types whatever it likes — no refusal, no presets', async () => {
    studentsOnScreen(false);
    const updateZone = mountFanCam();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/sports/student-privacy'));
    await waitFor(() => expect(screen.queryByText('School-safe titles')).toBeNull());
    fireEvent.change(titleBox(), { target: { value: 'KISS CAM' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(lastCfg(updateZone).kind).toBe('KISS CAM');
  });

  it('while the location is still loading and its industry is unknown, it is treated as a school', () => {
    studentsOnScreen('pending');
    const updateZone = mountFanCam();
    expect(screen.getByText('School-safe titles')).toBeInTheDocument();
    fireEvent.change(titleBox(), { target: { value: 'KISS CAM' } });
    expect(lastCfg(updateZone).kind).toBeUndefined();
  });
});

describe('the presets themselves', () => {
  it('every school-safe title, in every language, passes the rule it stands for', () => {
    for (const catalog of [en, es, zh]) {
      for (const p of SCHOOL_SAFE_FAN_CAM_PRESETS) {
        const title = presetTitle(catalog, p);
        expect(typeof title).toBe('string');
        expect({ title, safe: fanCamTextIsSchoolSafe(title) }).toEqual({ title, safe: true });
      }
    }
  });
});
