/**
 * M04 — Mobile Fleet Command home, proved against the real component.
 *
 * The derivation matrix itself is pinned in fleetCommand.test.ts. THIS suite
 * grades the two things a phone surface can get wrong on its own:
 *
 *   1. WHAT IT SAYS. Every claim on this screen is a claim about a fleet an
 *      operator cannot see, and half of them were retracted hours before this
 *      file existed (the 2026-09-01 truth audit). The tests below pin the
 *      exact wording against the desktop's own registry rather than against
 *      string literals typed here, so a phone that starts wording a signal
 *      differently from the laptop fails rather than ships.
 *
 *   2. WHAT IT OFFERS. §10: "Never make a user discover permissions by
 *      receiving a 403 after a high-stakes tap." Each quick action is graded
 *      against the @RequireRoles decorator on the route it calls.
 */
import * as React from 'react';
import { render, screen as rtl, within } from '@testing-library/react';
import { MobileFleetCommand } from '../MobileFleetCommand';
import { ASSURANCE_LABEL } from '@/components/dashboard/district/fleetCommand';
import type {
  FleetResponse, DistrictReadinessResponse, DistrictPendingApprovals,
} from '@/hooks/use-api';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));

// /api/build-info fails closed, so `App current` grades unknown deterministically.
// That is also the state the truth audit says the platform is actually in:
// there is no expected content revision to compare against.
beforeAll(() => {
  global.fetch = jest.fn(async () => ({ ok: false })) as any;
});

type FleetScreen = FleetResponse['screens'][number];

function scr(tenant: string, over: Partial<FleetScreen> = {}): FleetScreen {
  return {
    id: `${tenant}-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Screen',
    status: 'ONLINE',
    screenGroup: null,
    lastPingAt: null,
    lastCacheReport: null,
    renderHealth: 'OK',
    renderStale: false,
    renderStaleSeconds: 10,
    effectiveLatitude: null,
    effectiveLongitude: null,
    effectiveAddress: null,
    geoSource: 'none',
    sourceTenant: { id: tenant, name: tenant, slug: tenant },
    pushChannel: 'live',
    ...over,
  } as FleetScreen;
}

/**
 * Two locations that are NOT the same kind of unwell — `west` cannot display
 * an emergency alert (the worst thing in the ranking) and `hq` has a screen
 * answering with no confirmed picture. Ordering between them is the point.
 */
const fleet: FleetResponse = {
  root: { id: 'hq', name: 'Iron Peak', slug: 'hq', vertical: 'GYM' },
  locations: [
    { id: 'hq', name: 'Iron Peak HQ', slug: 'hq' },
    { id: 'west', name: 'Peak West', slug: 'west' },
  ],
  stats: { total: 3, online: 2, offline: 1, locationCount: 2 },
  screens: [
    scr('hq', { name: 'Lobby', renderHealth: 'STALE', renderStale: true }),
    scr('west', { name: 'Studio A' }),
    scr('west', { name: 'Studio B', status: 'OFFLINE' }),
  ],
} as FleetResponse;

const readiness: DistrictReadinessResponse = {
  delivery: { key: 'delivery', status: 'ok', label: '', detail: '', fixHint: '' },
  schools: [
    { tenantId: 'hq', name: 'Iron Peak HQ', slug: 'hq', isSelf: true, verdict: 'READY', contentWired: 3, contentTotal: 3, lockdownWired: false, missingTypes: [], screensTotal: 1, screensOnline: 1 },
    { tenantId: 'west', name: 'Peak West', slug: 'west', isSelf: false, verdict: 'NOT_CONFIGURED', contentWired: 0, contentTotal: 3, lockdownWired: false, missingTypes: ['Evacuate'], screensTotal: 2, screensOnline: 1 },
  ],
  notReadyCount: 1,
  computedAt: '',
} as any;

const approvals = { byTenant: [] } as unknown as DistrictPendingApprovals;

const ADMIN = { upload: true, createPlaylist: true, pairScreen: true, submitOnly: false };
const CONTRIBUTOR = { upload: true, createPlaylist: true, pairScreen: false, submitOnly: true };
const VIEWER = { upload: false, createPlaylist: false, pairScreen: false, submitOnly: false };

function draw(over: Partial<React.ComponentProps<typeof MobileFleetCommand>> = {}) {
  return render(
    <MobileFleetCommand
      schoolId="hq"
      fleet={fleet as never}
      readiness={readiness}
      approvals={approvals}
      firstName="Greg"
      orgName="Iron Peak"
      schedule={null}
      can={ADMIN}
      {...over}
    />,
  );
}

/** A calm fleet: everything online, every picture confirmed, alerts wired. */
const calmFleet: FleetResponse = {
  ...fleet,
  locations: [{ id: 'hq', name: 'Iron Peak HQ', slug: 'hq' }],
  screens: [scr('hq', { name: 'Lobby' }), scr('hq', { name: 'Studio' })],
} as FleetResponse;
const calmReadiness = {
  ...readiness,
  schools: [{ ...(readiness as any).schools[0], screensTotal: 2, screensOnline: 2 }],
  notReadyCount: 0,
} as any;

// ─────────────────────────────────────────────────────────────────────────

describe('§M04 — order of the page', () => {
  it('leads with a compact scope line, not a giant welcome card', () => {
    const { container } = draw();
    const root = container.querySelector('[data-testid="mobile-fleet-command"]')!;
    const first = root.firstElementChild!;
    expect(first.textContent).toContain('Hi, Greg');
    expect(first.textContent).toContain('Iron Peak');
    // §M04 "Do not lead with a giant welcome card": the greeting is one line
    // of text, so it must not be a card — no border, no panel background.
    expect(first.className).not.toMatch(/border|bg-white|rounded-2xl/);
  });

  it('puts Needs attention above the assurance row, and the assurance row above the locations', () => {
    const { container } = draw();
    const order = Array.from(
      container.querySelectorAll('[data-testid="needs-attention"],[data-testid="assurance-row"],[data-testid="location-card"]'),
    ).map((el) => el.getAttribute('data-testid'));
    expect(order[0]).toBe('needs-attention');
    expect(order[1]).toBe('assurance-row');
    expect(order[2]).toBe('location-card');
  });
});

describe('§5.1 — exception first', () => {
  it('the first operational card names the single highest-risk condition and counts the rest', () => {
    draw();
    const card = rtl.getByTestId('needs-attention');
    expect(card).toHaveAttribute('data-state', 'attention');
    // `west` cannot display an emergency alert, which outranks every other
    // row in the fixture. If the ranking ever silently reorders, this is the
    // assertion that notices.
    expect(card).toHaveAttribute('data-kind', 'emergency');
    expect(card.textContent).toMatch(/things need attention/);
  });

  it('offers exactly one action, and it is a real destination inside the fleet', () => {
    draw();
    const links = within(rtl.getByTestId('needs-attention')).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toMatch(/^\/hq\//);
  });

  it('a single exception is counted in the singular', () => {
    draw({
      fleet: { ...calmFleet, screens: [scr('hq', { status: 'OFFLINE' })] } as never,
      readiness: calmReadiness,
    });
    expect(rtl.getByTestId('needs-attention').textContent).toContain('1 thing needs attention');
  });
});

describe('§8.4 / §19 — unknown is labelled unknown, never green and never zero', () => {
  it('renders "Not reported" instead of a 0 / 0 that reads like a measurement', () => {
    draw();
    // The build-info fetch fails closed, so App current cannot be graded.
    const tile = rtl.getByText(ASSURANCE_LABEL.contentCurrent).closest('div')!.parentElement!;
    expect(tile.textContent).toContain('Not reported');
    expect(tile.textContent).not.toMatch(/\b0\s*\/\s*0\b/);
    expect(tile.className).toMatch(/slate/);      // gray, per §8.4
    expect(tile.className).not.toMatch(/emerald/); // never green
  });

  /**
   * NEVER CRY ALL-CLEAR. Every screen here is online and painting, so the
   * exception list is genuinely empty — but the emergency-readiness read
   * never answered. A surface that treats "no rows" as "all good" would
   * print a green all-clear built on a request that failed, which is the
   * single most dangerous thing this page could say.
   */
  it('an empty exception list is NOT an all-clear when a check never answered', () => {
    draw({ fleet: calmFleet as never, readiness: undefined, approvals: undefined });
    const card = rtl.getByTestId('needs-attention');
    expect(card).toHaveAttribute('data-state', 'unknown');
    expect(card.textContent).toContain('Nothing needs attention');
    expect(card.textContent).toMatch(/isn’t a full all-clear/);
    expect(card.textContent).not.toContain('Fleet checks passed');
    // Gray, not green — §8.4 reserves green for a proved result.
    expect(card.querySelector('.bg-slate-100')).toBeTruthy();
    expect(card.querySelector('.bg-emerald-50')).toBeNull();
  });

  /**
   * A screenless location is not a silent zero either: it earns one calm
   * setup row rather than disappearing into a healthy count.
   */
  it('a fleet with no screens at all asks for setup instead of reporting calm', () => {
    draw({ fleet: { ...calmFleet, screens: [] } as never, readiness: calmReadiness });
    const card = rtl.getByTestId('needs-attention');
    expect(card).toHaveAttribute('data-state', 'attention');
    expect(card).toHaveAttribute('data-kind', 'setup');
  });
});

describe('§M04 — the assurance row', () => {
  it('draws four labelled signals, worded by the SAME registry the desktop reads', () => {
    draw();
    const row = rtl.getByTestId('assurance-row');
    for (const key of ['online', 'showingContent', 'contentCurrent', 'emergencyReady'] as const) {
      expect(within(row).getByText(ASSURANCE_LABEL[key])).toBeInTheDocument();
    }
    expect(row.children).toHaveLength(4);
  });

  it('keeps every label visible — §M04 forbids reducing them to bare numbers', () => {
    draw();
    for (const tile of Array.from(rtl.getByTestId('assurance-row').children)) {
      expect((tile.textContent || '').replace(/[\d/\s]/g, '').length).toBeGreaterThan(3);
    }
  });

  it('names the emergency denominator in the tenant’s own noun (§M16: never hardcode school)', () => {
    draw({ fleet: { ...fleet, root: { ...fleet.root!, vertical: 'GYM' } } as never });
    const tile = rtl.getByText(ASSURANCE_LABEL.emergencyReady).closest('div')!.parentElement!;
    expect(tile.textContent).toMatch(/gyms|locations/i);
    expect(tile.textContent).not.toMatch(/school/i);
  });
});

describe('§M04 — location exceptions', () => {
  it('lists only the troubled locations and collapses the healthy ones into one line', () => {
    draw({
      fleet: {
        ...fleet,
        locations: [...fleet.locations, { id: 'east', name: 'Peak East', slug: 'east' }],
        screens: [...fleet.screens, scr('east', { name: 'Calm' })],
      } as never,
      readiness: {
        ...readiness,
        schools: [
          ...(readiness as any).schools,
          { tenantId: 'east', name: 'Peak East', slug: 'east', isSelf: false, verdict: 'READY', contentWired: 3, contentTotal: 3, lockdownWired: false, missingTypes: [], screensTotal: 1, screensOnline: 1 },
        ],
      } as any,
    });
    const names = rtl.getAllByTestId('location-card').map((c) => c.textContent);
    expect(names.join('|')).not.toContain('Peak East');
    expect(rtl.getByTestId('healthy-collapsed').textContent).toBe('1 location healthy');
  });

  it('worst location first, and each card carries a dominant condition + a destination', () => {
    draw();
    const cards = rtl.getAllByTestId('location-card');
    expect(cards[0]).toHaveAttribute('data-tone', 'bad');
    expect(cards[0].textContent).toContain('Peak West');
    expect(cards[0].textContent).toContain('Can’t display an emergency alert');
    // §M04: the action routes to where the fix lives, not a generic page.
    expect(cards[0].getAttribute('href')).toBe('/west/settings/emergency');
  });

  /**
   * THE REGRESSION THIS FILE EXISTS FOR. The first draft of the phone home
   * carried its own copy of the location ranking, and the copy graded a
   * screenless location `warn` where the desktop grades it `ok` — amber on a
   * phone and calm on a laptop, for the same venue on the same fleet. Both
   * surfaces now import `locationTone`; this pins the behaviour so a future
   * re-copy fails here.
   */
  it('a location with no screens is calm — the same verdict the desktop table gives it', () => {
    draw({
      fleet: {
        ...calmFleet,
        locations: [...calmFleet.locations, { id: 'new', name: 'Peak New', slug: 'new' }],
      } as never,
      readiness: calmReadiness,
    });
    const cards = rtl.queryAllByTestId('location-card');
    expect(cards.map((c) => c.textContent).join('|')).not.toContain('Peak New');
  });
});

describe('§10 / §5.6 — quick actions follow capability, not role name', () => {
  const labelsOf = () =>
    Array.from(rtl.getByRole('region', { name: 'Quick actions' }).querySelectorAll('a'))
      .map((a) => (a.textContent || '').trim());

  it('an admin gets Pair screen', () => {
    draw({ can: ADMIN });
    expect(labelsOf()).toContain('Pair screen');
  });

  /**
   * `POST /screens/pair` is @RequireRoles(SUPER, DISTRICT, SCHOOL) — no
   * CONTRIBUTOR. Upload and playlist-create DO list CONTRIBUTOR. So a
   * contributor keeps both of those and must never be offered pairing.
   */
  it('a contributor keeps upload and playlists, loses Pair screen, and gets their review queue', () => {
    draw({ can: CONTRIBUTOR });
    const labels = labelsOf();
    expect(labels).toContain('Upload media');
    expect(labels).toContain('New playlist');
    expect(labels).toContain('My submissions');
    expect(labels).not.toContain('Pair screen');
  });

  it('a viewer is offered nothing that mutates', () => {
    draw({ can: VIEWER });
    const labels = labelsOf();
    expect(labels).not.toContain('Upload media');
    expect(labels).not.toContain('New playlist');
    expect(labels).not.toContain('Pair screen');
    expect(labels).toContain('Screens'); // read-only navigation survives
  });

  it('never shows more than the four §M04 allows plus the always-present Screens link', () => {
    draw({ can: ADMIN, isSportsVertical: true });
    expect(labelsOf().length).toBeLessThanOrEqual(5);
  });

  it('a sports tenant leads with Game day', () => {
    draw({ can: ADMIN, isSportsVertical: true });
    expect(labelsOf()[0]).toBe('Game day');
  });
});

describe('§11.5 / §14.2 — the schedule section states intent, never delivery', () => {
  const schedule = [
    { key: 's1', name: 'Morning Loop', deviceLine: 'Lobby', timeStart: '08:00', timeEnd: '10:00' },
  ];

  it('is headed as scheduled, and never claims the content is live or playing', () => {
    draw({ schedule });
    const section = rtl.getByRole('region', { name: 'Scheduled today' });
    expect(section.textContent).toContain('Morning Loop');
    expect(section.textContent).toContain('08:00–10:00');
    expect(section.textContent).not.toMatch(/\blive\b|\bplaying\b|\bon screen\b/i);
  });

  it('is absent entirely when there is nothing scheduled — no empty promise', () => {
    draw({ schedule: [] });
    expect(rtl.queryByRole('region', { name: 'Scheduled today' })).toBeNull();
  });
});

describe('§15 — reachability', () => {
  it('every tappable row clears the 44px minimum', () => {
    const { container } = draw({ can: ADMIN, schedule: [] });
    const targets = Array.from(container.querySelectorAll('a'));
    expect(targets.length).toBeGreaterThan(3);
    for (const t of targets) {
      expect(t.className).toMatch(/min-h-\[(4[4-9]|[5-9]\d|\d{3})px\]/);
    }
  });

  it('each status carries an icon AND words — colour is never the only cue (§8.4)', () => {
    const { container } = draw();
    for (const tile of Array.from(rtl.getByTestId('assurance-row').children)) {
      expect(tile.querySelector('svg')).toBeTruthy();
    }
    // Location dots are decorative; the condition is spelled out beside them.
    for (const card of rtl.getAllByTestId('location-card')) {
      expect(card.querySelector('[aria-hidden]')).toBeTruthy();
      expect((card.textContent || '').trim().length).toBeGreaterThan(8);
    }
    expect(container).toBeTruthy();
  });
});

describe('the healthy fleet', () => {
  it('reports only the two facts it can prove, and never invents a rendered revision', () => {
    draw({ fleet: calmFleet as never, readiness: calmReadiness });
    const card = rtl.getByTestId('needs-attention');
    expect(card).toHaveAttribute('data-state', 'clear');
    expect(card.textContent).toContain('Fleet checks passed');
    expect(card.textContent).toContain('2 of 2 devices online');
    // §M04's own example says "45 expected revisions rendered". No expected
    // content revision exists (2026-09-01 audit), so this surface must not
    // borrow the phrase.
    expect(card.textContent).not.toMatch(/revision/i);
  });

  it('drops the locations section entirely when nothing is wrong', () => {
    draw({ fleet: calmFleet as never, readiness: calmReadiness });
    expect(rtl.queryAllByTestId('location-card')).toHaveLength(0);
    expect(rtl.queryByTestId('healthy-collapsed')).toBeNull();
  });
});
