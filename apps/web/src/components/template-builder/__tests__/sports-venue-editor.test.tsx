/**
 * K-12 launch audit F30 (2026-09-27) — per-variant property panels for the
 * sports-venue pack, the live ribbon / scorebug and the CTS reels.
 *
 * Two halves of one contract:
 *   1. EDIT → RENDER: for every venue variant, fill every text field the
 *      panel schema offers with a unique token and render the widget: every
 *      token must be on the canvas (builder) AND on a real screen (player) —
 *      i.e. the panel writes keys the renderer actually reads, and the result
 *      survives a save / reopen (a JSON round trip) and publish.
 *   2. The real `ContentFields` switch mounts the right editor and writes the
 *      right config shape.
 */
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util';
import en from '@/i18n/messages/en.json';

(global as unknown as { TextEncoder?: unknown }).TextEncoder ??= NodeTextEncoder;
(global as unknown as { TextDecoder?: unknown }).TextDecoder ??= NodeTextDecoder;

// Each contract case renders its widget twice and may wait on a generated QR.
jest.setTimeout(30_000);

jest.mock('@/hooks/use-api', () => ({
  useAssets: () => ({ data: [] }),
  usePlaylists: () => ({ data: [] }),
  useTemplates: () => ({ data: [] }),
  useTemplateBackdrops: () => ({ data: [] }),
  useGames: () => ({ data: [{ id: 'g1', sport: 'basketball', homeTeam: 'Eastview', awayTeam: 'Westfield', status: 'LIVE', createdAt: '2026-07-02T00:00:00.000Z' }] }),
}));
jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual('@/lib/api-client'),
  apiFetch: jest.fn(() => new Promise(() => undefined)),
}));

import { ContentFields } from '../PropertiesPanel';
import { SPORTS_VENUE_EDITOR, TEAM_IDENTITY_FIELDS, TEAM_FACT_FIELDS, patchPath, type VenueFieldSpec } from '../sports-venue-editor';
import { WidgetPreview } from '@/components/widgets/WidgetRenderer';
import '@/components/widgets/variants-register';
import { warmAllWidgetFamilies } from '@/components/widgets/widget-families';
import { warmVariantRegistry } from '@/components/widgets/WidgetRenderer';

class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

const realOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
beforeAll(async () => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return 480; } });
  await warmAllWidgetFamilies();
  await warmVariantRegistry();
});
afterAll(() => {
  if (realOffsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', realOffsetHeight);
});
afterEach(() => cleanup());

/* ── 1. EDIT → RENDER contract ─────────────────────────────────────── */

/** Text the widget shows only in live mode, or that feeds a derived value. */
const NOT_DISPLAYED: Record<string, string[]> = {
  // A link: rendered as a real QR image, never as text.
  'gate-wayfinding': ['qrUrl'],
  // The comparison shows team CODES; a name only feeds the code when none is set.
  'stat-comparison': ['home.name', 'away.name', 'home.record', 'away.record'],
  // The celebration names the team; its code/record belong to the live score strip.
  'goal-celebration': ['team.code', 'team.record'],
  // The lineup names the team; code shows only as the logo chip fallback.
  'starting-lineup': ['team.record'],
  // The card shows the team name + code chip; the record has no slot on a card.
  'player-card': ['player.team.record'],
  // Home schedule: code is the logo-chip fallback, record has no slot.
  'home-schedule': ['team.record'],
  // Codes are how a standings row is matched to the highlighted team.
  'standings-board': ['team.code', 'rows[0].code'],
  // The ribbon ticker shows codes; names and records have no slot on a ribbon.
  'ribbon-ticker': ['home.name', 'away.name', 'home.record', 'away.record'],
};

interface Filled { cfg: Record<string, unknown>; tokens: { path: string; token: string }[] }

function fillVariant(variant: string, specs: VenueFieldSpec[]): Filled {
  let cfg: Record<string, unknown> = { variant, dataMode: 'manual' };
  const tokens: { path: string; token: string }[] = [];
  let n = 0;
  const tok = () => `TK${variant.replace(/[^a-z]/g, '').slice(0, 4).toUpperCase()}${++n}`;
  const skip = NOT_DISPLAYED[variant] || [];
  const put = (path: string, value: unknown) => { cfg = { ...cfg, ...patchPath(cfg, path, value) }; };
  for (const f of specs) {
    if (f.only === 'live') continue;
    if (f.kind === 'text') {
      const t = tok();
      put(f.key, t);
      if (!skip.includes(f.key)) tokens.push({ path: f.key, token: t });
    } else if (f.kind === 'team') {
      const team: Record<string, unknown> = {};
      for (const tf of TEAM_IDENTITY_FIELDS) {
        if (tf.type !== 'text') continue;
        const t = tf.key === 'code' ? `C${n++}` : tok();
        team[tf.key] = t;
        if (!skip.includes(`${f.key}.${tf.key}`)) tokens.push({ path: `${f.key}.${tf.key}`, token: t });
      }
      if (f.facts) {
        for (const ff of TEAM_FACT_FIELDS) {
          if (ff.key !== 'score') continue;
          team.score = 700 + n++;
          tokens.push({ path: `${f.key}.score`, token: String(team.score) });
        }
      }
      put(f.key, team);
    } else if (f.kind === 'rows') {
      const row: Record<string, unknown> = {};
      for (const rf of f.fields) {
        if (rf.type && rf.type !== 'text') continue;
        const t = tok();
        row[rf.key] = t;
        if (!skip.includes(`${f.key}[0].${rf.key}`)) tokens.push({ path: `${f.key}[0].${rf.key}`, token: t });
      }
      put(f.key, [f.fromRow ? f.fromRow(row) : row]);
    } else if (f.kind === 'strings') {
      const t = tok();
      put(f.key, [t]);
      tokens.push({ path: `${f.key}[0]`, token: t });
    }
  }
  return { cfg, tokens };
}

function renderZone(cfg: Record<string, unknown>, surface?: 'player') {
  return render(
    <div style={{ position: 'relative', width: 1600, height: 900 }}>
      <WidgetPreview widgetType="SCOREBOARD" config={cfg} width={100} height={100} live={surface === 'player'} renderSurface={surface} />
    </div>,
  );
}

describe('F30 — every text field the panel offers reaches the canvas and the screen', () => {
  for (const [variant, specs] of Object.entries(SPORTS_VENUE_EDITOR)) {
    it(`${variant}: edit → save/reopen → builder + real screen show every value`, async () => {
      const { cfg, tokens } = fillVariant(variant, specs);
      expect(tokens.length).toBeGreaterThan(0);
      // Save / reopen is a JSON round trip.
      const reopened = JSON.parse(JSON.stringify(cfg));
      for (const surface of [undefined, 'player'] as const) {
        const { container } = renderZone(reopened, surface);
        // (The wayfinding QR title only shows beside a code that has been
        // generated — asynchronously, on the device — so wait for it.)
        await waitFor(() => {
          const text = (container.textContent || '').toUpperCase();
          const missing = tokens.filter((t) => !text.includes(t.token.toUpperCase())).map((t) => t.path);
          expect({ variant, surface: surface ?? 'builder', missing }).toEqual({ variant, surface: surface ?? 'builder', missing: [] });
        // The QR is generated by a dynamic import on first use — generous
        // under a loaded parallel run (it flaked once at the 1 s default).
        }, { timeout: 8000 });
        // Typed content is the school's own — never stamped SAMPLE on a real screen.
        if (surface === 'player') expect(container.querySelector('[data-venue-sample]')).toBeNull();
        cleanup();
      }
    });
  }
});

describe('F30 — every schema label is translated (no raw keys in the panel)', () => {
  const venue = (en as Record<string, any>).sportsTemplates.venue as Record<string, string>;
  it('labels, row labels, items and options resolve in en.json', () => {
    const keys = new Set<string>(['liveHint', 'useSample', 'asOfHelp']);
    for (const specs of Object.values(SPORTS_VENUE_EDITOR)) {
      for (const f of specs) {
        if ('label' in f) keys.add(f.label);
        if (f.kind === 'rows') { keys.add(f.item); for (const rf of f.fields) { keys.add(rf.label); rf.options?.forEach(([, l]) => keys.add(l)); } }
        if (f.kind === 'strings') keys.add(f.item);
        if (f.kind === 'select') f.options.forEach(([, l]) => keys.add(l));
      }
    }
    for (const tf of [...TEAM_IDENTITY_FIELDS, ...TEAM_FACT_FIELDS]) keys.add(tf.label);
    const missing = [...keys].filter((k) => typeof venue[k] !== 'string' || !venue[k]);
    expect(missing).toEqual([]);
  });
});

/* ── 2. the real ContentFields switch ──────────────────────────────── */

function mountFields(defaultConfig: Record<string, unknown>, updateZone: jest.Mock) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ContentFields zone={{ id: 'z1', widgetType: 'SCOREBOARD', defaultConfig }} updateZone={updateZone} />
    </QueryClientProvider>,
  );
}
function lastCfg(updateZone: jest.Mock): Record<string, any> {
  const calls = updateZone.mock.calls;
  return calls[calls.length - 1][1].defaultConfig;
}

describe('F30 — the venue editor replaces the legacy literal fields', () => {
  for (const variant of Object.keys(SPORTS_VENUE_EDITOR)) {
    it(`${variant}: mounts its own editor, never the legacy scoreboard fields`, () => {
      mountFields({ variant }, jest.fn());
      expect(screen.queryByText('Home score')).not.toBeInTheDocument();
      expect(screen.queryByText('Status')).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText('Tonight')).not.toBeInTheDocument();
    });
  }

  it('stadium scoreboard (live): team branding writes the nested team the renderer reads, badged as an override', () => {
    const updateZone = jest.fn();
    mountFields({ variant: 'stadium-scoreboard', dataMode: 'live' }, updateZone);
    expect(screen.getByRole('combobox', { name: /bind to game/i })).toBeInTheDocument();
    // Live: identity is "From the game" until overridden; no score boxes.
    expect(screen.queryByLabelText('Score')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Override Short code' })[0]);
    fireEvent.change(screen.getByLabelText('Short code'), { target: { value: 'HAWKS' } });
    expect(lastCfg(updateZone).home).toEqual({ code: 'HAWKS' });
  });

  it('stadium scoreboard (manual): scores, clock and sponsors are ordinary fields', () => {
    const updateZone = jest.fn();
    mountFields({ variant: 'stadium-scoreboard', dataMode: 'manual', home: { name: 'Blue' } }, updateZone);
    expect(screen.queryByRole('combobox', { name: /bind to game/i })).not.toBeInTheDocument();
    fireEvent.change(screen.getAllByLabelText('Score')[0], { target: { value: '12' } });
    expect(lastCfg(updateZone).home).toEqual({ name: 'Blue', score: '12' });
    fireEvent.change(screen.getByLabelText('Top sponsor bar'), { target: { value: 'THANK YOU PTA' } });
    expect(lastCfg(updateZone).topSponsor).toBe('THANK YOU PTA');
  });

  it('manual score boards: "Start from the sample rows" writes the renderer\'s nested shape and an AS OF stamp', () => {
    const updateZone = jest.fn();
    mountFields({ variant: 'out-of-town-scores' }, updateZone);
    fireEvent.click(screen.getByRole('button', { name: 'Start from the sample rows' }));
    const cfg = lastCfg(updateZone);
    expect(Array.isArray(cfg.games)).toBe(true);
    expect(cfg.games[0]).toMatchObject({ away: { code: 'CEN' }, home: { code: 'NOR' }, status: 'FINAL' });
    expect(typeof cfg.asOf).toBe('string');
    expect(Number.isNaN(Date.parse(cfg.asOf))).toBe(false);
  });

  it('lists are real add / remove / reorder editors (standings rows)', () => {
    const updateZone = jest.fn();
    mountFields({ variant: 'standings-board', rows: [{ rank: 1, name: 'Eagles', code: 'EAG' }, { rank: 2, name: 'Central', code: 'CEN' }] }, updateZone);
    fireEvent.click(screen.getByRole('button', { name: 'Move team 2 up' }));
    expect(lastCfg(updateZone).rows.map((r: any) => r.name)).toEqual(['Central', 'Eagles']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove team 1' }));
    expect(lastCfg(updateZone).rows.map((r: any) => r.name)).toEqual(['Central']);
  });
});

describe('F30 — the Live Data "Scores Board" routes to the same typed editor', () => {
  it('LIVE_DATA sports-scoreboard: typed game rows in the renderer\'s nested shape + AS OF', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const updateZone = jest.fn();
    render(
      <QueryClientProvider client={qc}>
        <ContentFields zone={{ id: 'z1', widgetType: 'LIVE_DATA', defaultConfig: { variant: 'sports-scoreboard' } }} updateZone={updateZone} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start from the sample rows' }));
    const cfg = lastCfg(updateZone);
    expect(cfg.games[0]).toMatchObject({ away: { name: 'Central', score: 51 }, home: { name: 'Northgate', score: 47 }, status: 'FINAL' });
    expect(typeof cfg.asOf).toBe('string');
  });
});

describe('F30 — Ribbon Board (live) + Scorebug expose what their renderers read', () => {
  it('ribbon-main: message reel, sponsor line, background', () => {
    const updateZone = jest.fn();
    mountFields({ variant: 'ribbon-main' }, updateZone);
    expect(screen.getByRole('combobox', { name: /bind to game/i })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Sponsor line'), { target: { value: 'THANK YOU BOOSTERS' } });
    expect(lastCfg(updateZone).sponsorText).toBe('THANK YOU BOOSTERS');
    expect(screen.getByText('Ribbon messages')).toBeInTheDocument();
  });

  it('scorebug-main: team colours are live overrides; network label is a field', () => {
    const updateZone = jest.fn();
    mountFields({ variant: 'scorebug-main', homeColor: '#123456' }, updateZone);
    expect(screen.getByText('Overrides the live value')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Network / stream label'), { target: { value: 'EAGLES TV' } });
    expect(lastCfg(updateZone).networkLabel).toBe('EAGLES TV');
  });
});

describe('F30 — CTS sponsor + announcement reels are typed rows, not pipe-delimited text', () => {
  it('sponsor slots: image picker + text + seconds, stored in the renderer\'s shape', () => {
    const updateZone = jest.fn();
    mountFields({ variant: 'scoreboard-cts-sponsor', dataSource: 'manual', slots: [{ text: 'POOL SUPPLY CO', durationMs: 4500 }] }, updateZone);
    expect(screen.queryByText(/one per line/i)).not.toBeInTheDocument();
    const secs = screen.getByDisplayValue('4.5');
    fireEvent.change(secs, { target: { value: '8' } });
    expect(lastCfg(updateZone).slots).toEqual([{ text: 'POOL SUPPLY CO', durationMs: 8000 }]);
    fireEvent.click(screen.getByRole('button', { name: '+ Add slot' }));
    expect(lastCfg(updateZone).slots).toHaveLength(2);
  });

  it('announcements: text + seconds rows', () => {
    const updateZone = jest.fn();
    mountFields({ variant: 'scoreboard-cts-announcement', dataSource: 'manual', entries: [{ text: 'NEXT MATCH FRI', durationMs: 5000 }] }, updateZone);
    const row = screen.getByDisplayValue('NEXT MATCH FRI');
    fireEvent.change(row, { target: { value: 'NEXT MATCH SAT' } });
    expect(lastCfg(updateZone).entries).toEqual([{ text: 'NEXT MATCH SAT', durationMs: 5000 }]);
    expect(within(document.body).queryByText(/one per line/i)).not.toBeInTheDocument();
  });
});
