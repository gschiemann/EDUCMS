/**
 * M6-1 — the Apps tab's green "Add" button used to accept broken sources.
 *
 * Two reproduced defects, both of which looked like success to the operator:
 *
 *   1. `not a valid url` typed into the Website app produced a zone whose
 *      URL was `https://not a valid url` — `canConfirm` only checked that
 *      required strings were non-empty, and the real URL check gated the
 *      live PREVIEW only, never Add.
 *   2. A Google Calendar link with malformed percent-encoding threw inside
 *      `toGoogleCalendarEmbedUrl` (decodeURIComponent), and the config
 *      form's catch turned that parse ERROR into a "successful" EMPTY
 *      WEBPAGE config, which it then wrote to the canvas.
 *
 * These tests are written against BOTH halves of the fix: the pure
 * `buildApp` gate, and the form that has to show its reason and refuse to
 * write a zone. The table-driven pass over the whole registry is there so
 * tightening one app can't silently break another.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { AppConfigForm } from '../AppConfigForm';
import { APP_REGISTRY, getApp, type AppDefinition } from '../app-registry';
import { buildApp } from '../build-app';
import { toGoogleCalendarEmbedUrl } from '../url-transforms';
import { useBuilderStore } from '@/components/template-builder/useBuilderStore';

// The form mounts the whole widget world for its live preview, probes the
// AI status, and reads the tenant — none of which this suite is about.
// `next/dynamic` resolves its import AFTER the test body, which React 19
// reports as an un-acted update, so stub the loader out entirely.
jest.mock('next/dynamic', () => () => function DynamicPreviewStub() { return null; });
jest.mock('@/components/widgets/WidgetRenderer', () => ({
  WidgetPreview: () => null,
}));
jest.mock('@/hooks/use-api', () => ({
  useTenant: () => ({ data: undefined }),
  useGenerateDesignerCandidates: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock('@/hooks/use-tenant-copy', () => ({
  useTenantCopy: () => ({ vertical: 'VENUE' }),
}));
// Never resolves ⇒ aiStatus stays 'loading' ⇒ no setState after the test
// (the "not wrapped in act(...)" class of noise).
jest.mock('@/components/ai/AiGenerateButton', () => ({
  getAiStatusSource: () => new Promise(() => undefined),
}));

function app(id: string): AppDefinition {
  const found = getApp(id);
  if (!found) throw new Error(`registry has no app "${id}"`);
  return found;
}

function mount(id: string) {
  const onDone = jest.fn();
  render(<AppConfigForm app={app(id)} onBack={jest.fn()} onDone={onDone} />);
  return { onDone };
}

const addButton = () => screen.getByRole('button', { name: /Add to canvas|to continue/i });
const zones = () => useBuilderStore.getState().zones;

beforeEach(() => {
  useBuilderStore.setState({ zones: [], past: [], future: [], selectedIds: [] });
});

// ── 1. A sentence is not a URL ────────────────────────────────────────────
describe('Website app — "not a valid url"', () => {
  it('buildApp refuses it instead of returning https://not a valid url', () => {
    const out = buildApp(app('web-url'), { url: 'not a valid url' });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.code).toBe('invalid');
    expect(out.reason).toMatch(/doesn’t look like a web address/i);
    expect(out.reason).toMatch(/example\.com/);
  });

  it('disables Add, says why, and writes no zone', () => {
    mount('web-url');
    fireEvent.change(screen.getByLabelText(/Web page link/i), { target: { value: 'not a valid url' } });

    expect(addButton()).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/doesn’t look like a web address/i);

    fireEvent.click(addButton());
    expect(zones()).toHaveLength(0);
  });

  it('re-validates in the confirm handler — the disabled attribute is not the gate', () => {
    mount('web-url');
    fireEvent.change(screen.getByLabelText(/Web page link/i), { target: { value: 'not a valid url' } });

    // Strip the UI's own guard and click anyway: the handler itself must
    // refuse. UI state is not enforcement.
    const btn = addButton();
    btn.removeAttribute('disabled');
    fireEvent.click(btn);

    expect(zones()).toHaveLength(0);
  });

  it('still accepts the bare domain an operator actually types', () => {
    const out = buildApp(app('web-url'), { url: 'example.com' });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('unreachable');
    expect(out.defaultConfig.url).toBe('https://example.com');
  });
});

// ── 2. A transform that THROWS is an error, not an empty config ───────────
describe('Calendar app — a link with malformed percent-encoding', () => {
  // `%E0%A4%A` is a truncated escape: decodeURIComponent throws URIError on
  // it, which is what used to become `{ widgetType:'WEBPAGE', config:{} }`.
  const MALFORMED = 'https://calendar.google.com/calendar/ical/%E0%A4%A/public/basic.ics';

  it('the transform really does throw (the premise of this test)', () => {
    expect(() => toGoogleCalendarEmbedUrl(MALFORMED)).toThrow();
  });

  it('buildApp reports it in the operator’s words, with no config', () => {
    const out = buildApp(app('calendar'), { url: MALFORMED });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.code).toBe('invalid');
    expect(out.reason).toMatch(/doesn’t look like a Google Calendar link/i);
  });

  it('shows the reason and writes no zone', () => {
    mount('calendar');
    fireEvent.change(screen.getByLabelText(/Your Google Calendar link/i), { target: { value: MALFORMED } });

    expect(addButton()).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/doesn’t look like a Google Calendar link/i);

    const btn = addButton();
    btn.removeAttribute('disabled');
    fireEvent.click(btn);
    expect(zones()).toHaveLength(0);
  });

  it('a perfectly valid link to the WRONG service is an error, not a fallback', () => {
    const out = buildApp(app('calendar'), { url: 'https://www.instagram.com/venueos/' });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.reason).toMatch(/doesn’t look like a Google Calendar link/i);
  });

  it('accepts a real public calendar link and builds the embed view', () => {
    const out = buildApp(app('calendar'), {
      url: 'https://calendar.google.com/calendar/ical/team%40example.com/public/basic.ics',
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('unreachable');
    expect(out.defaultConfig.url).toContain('https://calendar.google.com/calendar/embed?src=');
  });
});

// ── 3. The happy path still works ─────────────────────────────────────────
describe('YouTube app — a real watch URL', () => {
  const WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

  it('enables Add and lands one STREAMING zone with the canonical embed URL', () => {
    const { onDone } = mount('youtube');
    fireEvent.change(screen.getByLabelText(/YouTube link/i), { target: { value: WATCH } });

    expect(addButton()).toBeEnabled();
    expect(screen.queryByRole('status')).toBeNull();

    fireEvent.click(addButton());

    expect(zones()).toHaveLength(1);
    expect(zones()[0].widgetType).toBe('STREAMING');
    expect(zones()[0].defaultConfig).toMatchObject({
      embedUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      channelTitle: 'YouTube',
      playbackType: 'iframe',
    });
    expect(onDone).toHaveBeenCalled();
  });

  it('refuses a link on a host the player would never frame', () => {
    const out = buildApp(app('youtube'), { url: 'https://example.com/some-video.mp4' });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.reason).toMatch(/doesn’t look like a YouTube link/i);
  });
});

// ── 4. No app silently breaks ─────────────────────────────────────────────
// One valid sample per registered app. If someone adds an app, this table
// fails until they say what a good input for it looks like.
const VALID_SAMPLE: Record<string, Record<string, string>> = {
  youtube: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
  vimeo: { url: 'https://vimeo.com/123456789' },
  twitch: { channel: 'venueos' },
  'google-slides': { url: 'https://docs.google.com/presentation/d/1AbC_dEf-123/edit#slide=id.p' },
  'powerpoint-onedrive': { url: '<iframe src="https://onedrive.live.com/embed?cid=ABC&resid=1"></iframe>' },
  canva: { url: 'https://www.canva.com/design/DAF12345/view' },
  'google-sheets': { url: 'https://docs.google.com/spreadsheets/d/1XyZ-9/edit#gid=0' },
  'web-url': { url: 'https://example.com/lobby' },
  'google-maps': { query: '123 Main St, Springfield, IL' },
  'qr-code': { text: 'https://example.com/menu' },
  clock: { timezone: 'America/Chicago', format: '12h' },
  countdown: { label: 'Days Until Break', targetDate: '2027-01-04' },
  weather: { location: '62704', units: 'imperial' },
  'news-rss': { feedUrl: 'https://example.com/feed.xml', maxItems: '5' },
  calendar: { url: 'https://calendar.google.com/calendar/embed?src=team%40example.com&ctz=local' },
  // 2026-09-12 — these two stopped being `comingSoon` stubs. Their "valid
  // input" is a CONNECTION the operator picked, not a pasted URL: a public
  // profile URL cannot authorise reading posts, so the app's only required
  // field is the id of an OAuth connection the API already holds. The sample
  // is therefore a plausible uuid.
  'facebook-page': { connectionId: '8f2b4c1e-5d6a-47b8-9c0d-1e2f3a4b5c6d', maxItems: '6', layout: 'grid' },
  instagram: { connectionId: '3a1c9e77-2b44-4f10-8d55-66e7c8a9b012', maxItems: '6', layout: 'grid' },
  'social-wall': { url: 'https://my.walls.io/venueos' },
  // Real as of 2026-09-12 (it was a `comingSoon` stub building an empty
  // SOCIAL_FEED). `placeName` is not in the configSchema — the google-place
  // picker writes it alongside the id — so it is supplied here the same way
  // the picker would. Fixture values only: not a real business or place id.
  'google-reviews': {
    placeId: 'ChIJ_fixture_place_id_0000000000',
    placeName: 'Springfield Elementary',
    maxItems: '3',
    minRating: '4',
    layout: 'carousel',
  },
};

// ── 5. The social apps take a CONNECTION, not a URL ───────────────────────
//
// 2026-09-12. Instagram and Facebook Page were `comingSoon` stubs; they are
// real now, and their one required field is the id of an OAuth connection the
// API holds. The failure mode to prevent is the one the connector replaced:
// an operator pastes their public profile URL (the obvious thing to try),
// gets a green Add button, and ships a zone that can never show a post —
// because a public URL authorises nothing.
describe('social apps refuse anything that is not a real connection', () => {
  it.each(['instagram', 'facebook-page'])(
    '%s refuses a pasted profile URL',
    (id) => {
      const out = buildApp(app(id), { connectionId: 'https://www.instagram.com/sunnyside_elem/' });
      expect(out.ok).toBe(false);
      if (out.ok) throw new Error('unreachable');
      expect(out.code).toBe('invalid');
      expect(out.reason).toMatch(/doesn’t look like a connected/i);
    },
  );

  it.each(['instagram', 'facebook-page'])('%s refuses an @handle', (id) => {
    const out = buildApp(app(id), { connectionId: '@sunnyside_elem' });
    expect(out.ok).toBe(false);
  });

  it.each(['instagram', 'facebook-page'])(
    '%s treats a BLANK account as unfinished, not as broken',
    (id) => {
      const out = buildApp(app(id), {});
      expect(out.ok).toBe(false);
      if (out.ok) throw new Error('unreachable');
      // `missing` gets the form's own "pick an account" copy; `invalid`
      // would wrongly tell the operator their input was wrong.
      expect(out.code).toBe('missing');
    },
  );

  it('builds a real zone from a picked connection, and never a URL config', () => {
    const out = buildApp(app('instagram'), {
      connectionId: '3a1c9e77-2b44-4f10-8d55-66e7c8a9b012',
      accountLabel: '@sunnyside',
      maxItems: '4',
      layout: 'single',
    });
    if (!out.ok) throw new Error(`expected ok, got ${out.code}: ${out.reason}`);
    expect(out.widgetType).toBe('SOCIAL_FEED');
    expect(out.defaultConfig).toEqual({
      provider: 'instagram',
      connectionId: '3a1c9e77-2b44-4f10-8d55-66e7c8a9b012',
      accountLabel: '@sunnyside',
      maxItems: 4,
      layout: 'single',
    });
    // The dead `embedUrl` / `url` field the old editor wrote must not return.
    expect(out.defaultConfig).not.toHaveProperty('embedUrl');
    expect(out.defaultConfig).not.toHaveProperty('url');
  });

  it('clamps an absurd post count instead of putting 400 tiles on a wall', () => {
    const out = buildApp(app('facebook-page'), {
      connectionId: '8f2b4c1e-5d6a-47b8-9c0d-1e2f3a4b5c6d',
      maxItems: '400',
    });
    if (!out.ok) throw new Error('expected ok');
    expect(out.defaultConfig.maxItems).toBe(12);
  });

  it('neither app is comingSoon any more', () => {
    expect(app('instagram').comingSoon).toBeFalsy();
    expect(app('facebook-page').comingSoon).toBeFalsy();
  });
});

describe('every registered app', () => {
  it('has a sample in this table (a new app cannot skip the sweep)', () => {
    expect(Object.keys(VALID_SAMPLE).sort()).toEqual(APP_REGISTRY.map((a) => a.id).sort());
  });

  it.each(APP_REGISTRY.filter((a) => !a.comingSoon).map((a) => [a.id, a] as const))(
    '%s builds ok from its own valid input',
    (id, definition) => {
      const out = buildApp(definition, VALID_SAMPLE[id]);
      if (!out.ok) throw new Error(`${id} regressed: ${out.code} — ${out.reason}`);
      expect(out.widgetType).toBeTruthy();
      expect(out.defaultConfig).toBeTruthy();
    },
  );

  // 2026-09-12 — this used to be an `it.each` over the comingSoon apps. The
  // four stubs (Instagram, Facebook Page, Social Wall, Google Reviews) are
  // real now, so that table is EMPTY and jest refuses an empty `each`. Keep
  // the rule (a stub must be refused, never add an empty zone) and say the
  // current truth out loud instead of running zero cases silently.
  it('every comingSoon app is refused honestly rather than adding an empty zone (today: none are stubs)', () => {
    const stubs = APP_REGISTRY.filter((a) => a.comingSoon);
    for (const definition of stubs) {
      const out = buildApp(definition, {});
      expect(out.ok).toBe(false);
      if (out.ok) throw new Error('unreachable');
      expect(out.code).toBe('coming-soon');
    }
    expect(stubs.map((a) => a.id)).toEqual([]);
  });

  it('never returns a successful EMPTY config for garbage input', () => {
    for (const definition of APP_REGISTRY) {
      const garbage: Record<string, string> = {};
      for (const f of definition.configSchema) garbage[f.key] = 'not a valid url';
      const out = buildApp(definition, garbage);
      if (!out.ok) continue;
      // The apps that legitimately accept free text (QR, Maps, Weather,
      // Clock, Countdown) may build from that string — but never into the
      // empty WEBPAGE config the old catch produced.
      expect(out.defaultConfig).not.toEqual({});
    }
  });
});
