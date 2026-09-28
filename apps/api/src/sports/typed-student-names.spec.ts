/**
 * Student names TYPED into templates (K-12 sports launch follow-up, lane B4,
 * 2026-09-27). B3's gate covered every name that reaches a public output from
 * the roster, the console or a feed — never a name an operator types into a
 * template field. What this pins:
 *   • the matcher is B3's decision (default deny at a school that confirmed
 *     nothing, a family's opt-out always), applied to typed values;
 *   • the REAL public board build blanks a hidden student's typed name in the
 *     layouts it bundles, shows it once the school confirms, blanks it again
 *     for an opt-out, and leaves a non-K-12 venue alone;
 *   • it fails closed: an unreadable roster blanks every typed-name field;
 *   • the per-tenant matcher is loaded once per content revision, and an
 *     output with no typed names costs no query at all.
 */
import {
  STUDENT_PRIVACY_ATTESTATION_VERSION,
  normalizeTypedName,
  type StudentNameMatcher,
} from '@cms/api-types';
import { bumpManifestContentRev } from '../screens/manifest-hot-cache';
import { setup, newGame, TENANT } from './sports-test-harness';
import {
  StudentPrivacyService,
  type PrivacyCaller,
} from './student-privacy.service';
import { CLOSED_STUDENT_POLICY, OPEN_STUDENT_POLICY } from './student-privacy';
import {
  HIDE_ALL_TYPED_NAMES,
  buildTypedNameMatcher,
  clearTypedNameMatcherCache,
  loadTypedNameMatcher,
  redactTypedStudentNames,
  redactZones,
  typedNameMatcherFor,
  zonesHaveTypedNames,
} from './typed-student-names';

const V = STUDENT_PRIVACY_ATTESTATION_VERSION;
const ADMIN: PrivacyCaller = { userId: 'admin-1', role: 'SCHOOL_ADMIN' };

beforeEach(() => clearTypedNameMatcherCache());

/* ════════════════ the matcher — B3's rule on typed values ════════════════ */

describe('buildTypedNameMatcher', () => {
  const JORDAN = { name: 'Jordan Lee' };
  const RILEY = { name: 'Riley Chen' };

  it('a school that confirmed nothing: every rostered student is hidden, by full or last name', () => {
    const m = buildTypedNameMatcher(CLOSED_STUDENT_POLICY, [
      JORDAN,
      RILEY,
    ]) as StudentNameMatcher;
    expect(m.name('Jordan Lee')).toBe(true);
    expect(m.name('  JORDAN   LEE. ')).toBe(true);
    expect(m.name('Lee')).toBe(true);
    expect(m.name('chen')).toBe(true);
    expect(m.name('Jordan')).toBe(false); // a first name alone is not "the name"
    expect(m.name('M. Okafor')).toBe(false);
    expect(m.text('PLAYER OF THE WEEK — JORDAN LEE · 4 GOALS')).toBe(true);
    expect(m.text('LEE HIGH AT HOME FRIDAY')).toBe(false); // a lone surname in a sentence
  });

  it("once names are confirmed only a family's opt-out hides — and the athlete's opt-out counts", () => {
    const confirmed = { applies: true, names: true, photos: false };
    expect(buildTypedNameMatcher(confirmed, [JORDAN, RILEY])).toBeNull();
    const m = buildTypedNameMatcher(confirmed, [
      { ...JORDAN, person: { directoryOptOut: true } },
      RILEY,
    ]) as StudentNameMatcher;
    expect(m.name('Jordan Lee')).toBe(true);
    expect(m.name('Riley Chen')).toBe(false);
  });

  it('a venue the policy does not apply to: only an opt-out hides', () => {
    expect(buildTypedNameMatcher(OPEN_STUDENT_POLICY, [JORDAN])).toBeNull();
    const m = buildTypedNameMatcher(OPEN_STUDENT_POLICY, [
      { ...JORDAN, directoryOptOut: true },
    ]) as StudentNameMatcher;
    expect(m.name('Lee')).toBe(true);
  });

  it("an athlete record's own last name is used when it has one", () => {
    const m = buildTypedNameMatcher(CLOSED_STUDENT_POLICY, [
      { name: 'Mary Anne Smith Jones', lastName: 'Smith Jones' },
    ]) as StudentNameMatcher;
    expect(m.name('smith jones')).toBe(true);
    expect(normalizeTypedName('Smith Jones')).toBe('smith jones');
  });
});

/* ════════════════ loading: fail closed, cached per revision ════════════════ */

function fakeDb(opts: {
  vertical?: string;
  rows?: Array<Record<string, unknown>>;
  persons?: Array<Record<string, unknown>>;
  rosterThrows?: boolean;
}) {
  const calls = { roster: 0, persons: 0 };
  const db = {
    tenant: {
      findUnique: async ({ where }: any) =>
        where.id === TENANT
          ? {
              id: TENANT,
              name: 'School',
              vertical: opts.vertical ?? 'K12',
              parentId: null,
            }
          : null,
    },
    studentPrivacyPolicy: { findMany: async () => [] },
    rosterPlayer: {
      findMany: async () => {
        calls.roster += 1;
        if (opts.rosterThrows) throw new Error('connection reset');
        return opts.rows ?? [];
      },
    },
    sportsPerson: {
      findMany: async () => {
        calls.persons += 1;
        return opts.persons ?? [];
      },
    },
  };
  return { db: db as any, calls };
}

describe('loadTypedNameMatcher / typedNameMatcherFor', () => {
  it("reads the tenant's roster AND athletes", async () => {
    const { db } = fakeDb({
      rows: [{ name: 'Jordan Lee' }],
      persons: [{ id: 'sp-1', fullName: 'Sam Rivera', lastName: 'Rivera' }],
    });
    const m = (await loadTypedNameMatcher(db, TENANT)) as StudentNameMatcher;
    expect(m.name('Jordan Lee')).toBe(true);
    expect(m.name('Rivera')).toBe(true);
  });

  it('fails closed: a roster that cannot be read blanks every typed value', async () => {
    const { db } = fakeDb({ rosterThrows: true });
    const m = await loadTypedNameMatcher(db, TENANT);
    expect(m).toBe(HIDE_ALL_TYPED_NAMES);
    expect(m!.name('anybody')).toBe(true);
    expect(m!.name('   ')).toBe(false);
  });

  it('loads once per tenant per content revision; a roster / policy write reloads; a failure is never cached', async () => {
    const { db, calls } = fakeDb({ rows: [{ name: 'Jordan Lee' }] });
    await typedNameMatcherFor(db, TENANT);
    await typedNameMatcherFor(db, TENANT);
    expect(calls.roster).toBe(1);
    bumpManifestContentRev(); // what a RosterPlayer / SportsPerson / policy write does
    await typedNameMatcherFor(db, TENANT);
    expect(calls.roster).toBe(2);

    const broken = fakeDb({ rosterThrows: true });
    await typedNameMatcherFor(broken.db, 'tenant-2');
    await typedNameMatcherFor(broken.db, 'tenant-2');
    expect(broken.calls.roster).toBe(2);
  });

  it('an output with no typed names costs no query', async () => {
    const { db, calls } = fakeDb({ rows: [{ name: 'Jordan Lee' }] });
    const tpl = {
      zones: [
        {
          widgetType: 'SWIM_RELAY_EXCHANGE',
          defaultConfig: { legs: [{ swimmer: '' }] },
        },
        { widgetType: 'CLOCK', defaultConfig: { label: 'Jordan Lee' } },
      ],
    };
    await redactTypedStudentNames(db, TENANT, [tpl, null]);
    expect(calls.roster + calls.persons).toBe(0);
    expect(zonesHaveTypedNames(tpl.zones)).toBe(false);
  });

  it('never mutates a template: a blanked one is a copy, an untouched one is returned as is', async () => {
    const { db } = fakeDb({ rows: [{ name: 'Jordan Lee' }] });
    const hit = {
      id: 't1',
      zones: [
        {
          widgetType: 'SWIM_SPLITS_PANEL',
          defaultConfig: { swimmerName: 'Jordan Lee' },
        },
      ],
    };
    const miss = {
      id: 't2',
      zones: [
        {
          widgetType: 'SWIM_SPLITS_PANEL',
          defaultConfig: { swimmerName: 'M. Okafor' },
        },
      ],
    };
    const before = JSON.stringify(hit);
    const [a, b, c] = await redactTypedStudentNames(db, TENANT, [
      hit,
      miss,
      null,
    ]);
    expect(JSON.stringify(hit)).toBe(before); // the operator's own words survive
    expect(a).not.toBe(hit);
    expect((a as typeof hit).zones[0].defaultConfig.swimmerName).toBe('');
    expect(b).toBe(miss);
    expect(c).toBeNull();
  });

  it('no tenant to ask: fail closed', async () => {
    const { db, calls } = fakeDb({});
    const [a] = await redactTypedStudentNames(db, null, [
      {
        zones: [
          {
            widgetType: 'SWIM_SPLITS_PANEL',
            defaultConfig: { swimmerName: 'Anyone' },
          },
        ],
      },
    ]);
    expect((a as any).zones[0].defaultConfig.swimmerName).toBe('');
    expect(calls.roster).toBe(0);
  });

  it('redactZones keeps the same array when nothing is hidden', () => {
    const zones = [
      {
        widgetType: 'SWIM_SPLITS_PANEL',
        defaultConfig: { swimmerName: 'M. Okafor' },
      },
    ];
    const m = buildTypedNameMatcher(CLOSED_STUDENT_POLICY, [
      { name: 'Jordan Lee' },
    ]);
    expect(redactZones(zones, m)).toBe(zones);
  });
});

/* ════════════════ the real public board build ════════════════ */

function world(vertical: string) {
  const h = setup({ vertical });
  const privacy = new StudentPrivacyService({ client: h.client } as any);
  const board = async (gameId: string) => {
    (h.service as any).boardCache.delete(gameId);
    // The fake hands back its stored row, which mapTemplate parses in place;
    // a real findFirst returns a fresh row per build. Re-seed per build.
    const tpl = h.tables.template.rows.find((t: any) => t.id === 'tmpl-board');
    tpl.zones = layoutZones();
    return (await h.service.getBoardWithMeta(gameId)).payload;
  };
  return { ...h, privacy, board };
}

/** A scoreboard layout with a relay board and a CTS announcement reel. */
function layoutZones() {
  return [
    {
      id: 'z-relay',
      name: 'Relay',
      widgetType: 'SWIM_RELAY_EXCHANGE',
      defaultConfig: JSON.stringify({
        teamName: 'HOME RELAY A',
        legs: [
          { legName: 'LEG 1', swimmer: 'Jordan Lee', split: '27.80' },
          { legName: 'LEG 2', swimmer: 'M. Okafor', split: '31.42' },
        ],
      }),
    },
    {
      id: 'z-ann',
      name: 'Announcements',
      widgetType: 'SCOREBOARD',
      defaultConfig: JSON.stringify({
        variant: 'scoreboard-cts-announcement',
        entries: [
          { text: 'SWIMMER OF THE MEET — JORDAN LEE', durationMs: 6000 },
          { text: 'CONCESSIONS OPEN AT HALFTIME', durationMs: 5000 },
        ],
      }),
    },
  ];
}

async function swimMeetWithJordan(w: ReturnType<typeof world>) {
  const g = await newGame(w.service, 'swimming');
  w.rosterPlayer.rows.push({
    id: 'p-jordan',
    tenantId: TENANT,
    gameId: g.id,
    team: 'home',
    name: 'Jordan Lee',
    number: '3',
    sortOrder: 0,
  });
  const row = w.game.rows.find((r: any) => r.id === g.id);
  row.scoreboardTemplateId = 'tmpl-board';
  return g;
}

const legsOf = (b: any) =>
  b.scoreboardTemplate.zones.find((z: any) => z.id === 'z-relay').defaultConfig
    .legs;
const entriesOf = (b: any) =>
  b.scoreboardTemplate.zones.find((z: any) => z.id === 'z-ann').defaultConfig
    .entries;

describe('the public board — typed names in the bundled layout', () => {
  it("a school that confirmed nothing: the rostered student's typed name is blank; everything else stays", async () => {
    const w = world('K12');
    const g = await swimMeetWithJordan(w);
    const b = await w.board(g.id);
    expect(legsOf(b).map((l: any) => l.swimmer)).toEqual(['', 'M. Okafor']);
    expect(legsOf(b)[0].split).toBe('27.80');
    expect(entriesOf(b).map((e: any) => e.text)).toEqual([
      '',
      'CONCESSIONS OPEN AT HALFTIME',
    ]);
    expect(JSON.stringify(b)).not.toContain('Jordan');
    expect(JSON.stringify(b)).not.toContain('JORDAN');
  });

  it('names show once the school confirms its directory-information policy', async () => {
    const w = world('K12');
    const g = await swimMeetWithJordan(w);
    await w.privacy.setCategory(TENANT, ADMIN, 'names', 'confirm', V);
    bumpManifestContentRev(); // the Prisma hook's bump on a StudentPrivacyPolicy write
    const b = await w.board(g.id);
    expect(legsOf(b)[0].swimmer).toBe('Jordan Lee');
    expect(entriesOf(b)[0].text).toBe('SWIMMER OF THE MEET — JORDAN LEE');
  });

  it("a family's opt-out blanks the typed name even after the school confirmed", async () => {
    const w = world('K12');
    const g = await swimMeetWithJordan(w);
    await w.privacy.setCategory(TENANT, ADMIN, 'names', 'confirm', V);
    await w.privacy.setStudentFlags(TENANT, g.id, 'p-jordan', ADMIN, {
      directoryOptOut: true,
    });
    bumpManifestContentRev();
    const b = await w.board(g.id);
    expect(legsOf(b)[0].swimmer).toBe('');
    expect(entriesOf(b)[0].text).toBe('');
  });

  it('a non-K-12 venue is unchanged — unless a family opted out', async () => {
    const w = world('SPORTS');
    const g = await swimMeetWithJordan(w);
    expect(legsOf(await w.board(g.id))[0].swimmer).toBe('Jordan Lee');
    w.rosterPlayer.rows[0].directoryOptOut = true;
    bumpManifestContentRev();
    expect(legsOf(await w.board(g.id))[0].swimmer).toBe('');
  });
});
