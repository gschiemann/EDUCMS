/**
 * Student information on PUBLIC outputs (K-12 sports launch, lane B3,
 * 2026-09-27). Greg: "follow the laws, dont show any kids without some legal
 * approval from someone".
 *
 * What this pins, output by output, against the REAL SportsService board build
 * (the payload every public surface reads) and the real settings service:
 *   • a school shows NO student names and NO photos until an admin confirms;
 *   • after the names attestation, names show; photos need the photo
 *     attestation AND the student's "Photo release on file";
 *   • a family's opt-out always wins — also at a non-K-12 venue;
 *   • revoking hides on the very next board build;
 *   • the game's own switches can only make it stricter;
 *   • a district's attestation is inherited, a school may be stricter;
 *   • a non-K-12 venue is exactly as before.
 */
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  STUDENT_PRIVACY_ATTESTATION_TEXT,
  STUDENT_PRIVACY_ATTESTATION_VERSION,
} from '@cms/api-types';
import type { SwimTimingSnapshot } from '@cms/scoreboard-cts';
import { setup, newGame, TENANT } from './sports-test-harness';
import {
  StudentPrivacyService,
  type PrivacyCaller,
} from './student-privacy.service';
import { SportsRosterPrivacyService } from './sports-roster-privacy.service';
import { getPublicAthleteProfile } from './sports-stats.service';
import {
  CLOSED_STUDENT_POLICY,
  OPEN_STUDENT_POLICY,
  StudentDirectory,
  isTeamLabel,
  loadStudentPolicy,
  resolveStudentPrivacy,
  studentFlags,
  studentRosterPrivacy,
  toStudentPolicy,
  type PolicyChainNode,
} from './student-privacy';
import { DEFAULT_ROSTER_PRIVACY } from './roster-privacy';

const V = STUDENT_PRIVACY_ATTESTATION_VERSION;
const ADMIN: PrivacyCaller = { userId: 'admin-1', role: 'SCHOOL_ADMIN' };
const DISTRICT: PrivacyCaller = {
  userId: 'district-1',
  role: 'DISTRICT_ADMIN',
};
const EDITOR: PrivacyCaller = { userId: 'editor-1', role: 'CONTRIBUTOR' };
const STAFF: PrivacyCaller = { userId: 'staff-1', role: 'SUPER_ADMIN' };

const PHOTO = 'https://cdn.example/jordan.png';
const JORDAN = {
  name: 'Jordan Lee',
  number: '3',
  position: 'G',
  photoUrl: PHOTO,
  stats: { PTS: '14', REB: '6' },
};

/* ════════════════ the pure policy ════════════════ */

describe('resolveStudentPrivacy — who decides', () => {
  const school = (over: Partial<PolicyChainNode> = {}): PolicyChainNode => ({
    tenantId: 's',
    vertical: 'K12',
    ...over,
  });
  const district = (over: Partial<PolicyChainNode> = {}): PolicyChainNode => ({
    tenantId: 'd',
    vertical: 'K12',
    ...over,
  });

  it('a school that decided nothing: hidden — default deny', () => {
    expect(toStudentPolicy(resolveStudentPrivacy([school()]))).toEqual({
      applies: true,
      names: false,
      photos: false,
    });
  });

  it('a non-K-12 venue: today behaviour (open)', () => {
    expect(
      toStudentPolicy(
        resolveStudentPrivacy([{ tenantId: 'v', vertical: 'SPORTS' }]),
      ),
    ).toBe(OPEN_STUDENT_POLICY);
  });

  it('a non-K-12 tenant that serves minors gets the school default', () => {
    const r = resolveStudentPrivacy([
      { tenantId: 'c', vertical: 'GYM', servesMinors: true },
    ]);
    expect(r.appliesBecause).toBe('serves-minors');
    expect(toStudentPolicy(r)).toEqual({
      applies: true,
      names: false,
      photos: false,
    });
  });

  it("a district's confirmation is inherited by its school", () => {
    const r = resolveStudentPrivacy([
      school(),
      district({ namesState: 'ALLOW', namesAttestationVersion: V }),
    ]);
    expect(r.names).toMatchObject({
      allowed: true,
      sourceIndex: 1,
      sourceState: 'ALLOW',
    });
    expect(r.photos.allowed).toBe(false);
  });

  it('a school may be STRICTER than its district', () => {
    const r = resolveStudentPrivacy([
      school({ namesState: 'HIDE' }),
      district({ namesState: 'ALLOW', namesAttestationVersion: V }),
    ]);
    expect(r.names).toMatchObject({
      allowed: false,
      sourceIndex: 0,
      sourceState: 'HIDE',
    });
  });

  it("a district's HIDE covers a school's own confirmation (stricter wins at any level)", () => {
    const r = resolveStudentPrivacy([
      school({ namesState: 'ALLOW', namesAttestationVersion: V }),
      district({ namesState: 'HIDE' }),
    ]);
    expect(r.names.allowed).toBe(false);
  });

  it('a confirmation of a wording that is no longer accepted does not count', () => {
    const r = resolveStudentPrivacy([
      school({ namesState: 'ALLOW', namesAttestationVersion: '2020-01-01' }),
    ]);
    expect(r.names.allowed).toBe(false);
  });
});

describe('studentRosterPrivacy — one student', () => {
  const attested = { applies: true, names: true, photos: true };

  it('opt-out hides name AND photo whatever the school confirmed — and at a non-K-12 venue too', () => {
    for (const policy of [attested, OPEN_STUDENT_POLICY]) {
      const eff = studentRosterPrivacy(
        { optOut: true, photoRelease: true },
        policy,
      );
      expect(eff.names).toBe('hidden');
      expect(eff.photos).toBe(false);
      expect(eff.numbers).toBe(true); // a jersey number is not a name
    }
  });

  it('a photo needs the attestation AND the student release', () => {
    expect(
      studentRosterPrivacy({ optOut: false, photoRelease: false }, attested)
        .photos,
    ).toBe(false);
    expect(
      studentRosterPrivacy(
        { optOut: false, photoRelease: true },
        { ...attested, photos: false },
      ).photos,
    ).toBe(false);
    expect(
      studentRosterPrivacy({ optOut: false, photoRelease: true }, attested)
        .photos,
    ).toBe(true);
  });

  it("the game's switches can only make it stricter", () => {
    const game = {
      ...DEFAULT_ROSTER_PRIVACY,
      names: 'last' as const,
      photos: false,
    };
    const eff = studentRosterPrivacy(
      { optOut: false, photoRelease: true },
      attested,
      game,
    );
    expect(eff.names).toBe('last');
    expect(eff.photos).toBe(false);
    // "full" on the game never overrides the school's hidden
    expect(
      studentRosterPrivacy(
        { optOut: false, photoRelease: true },
        CLOSED_STUDENT_POLICY,
        DEFAULT_ROSTER_PRIVACY,
      ).names,
    ).toBe('hidden');
  });

  it("a linked athlete: an opt-out on either wins; the athlete's release is the one that counts", () => {
    expect(
      studentFlags({
        directoryOptOut: false,
        person: { directoryOptOut: true },
      }).optOut,
    ).toBe(true);
    expect(
      studentFlags({
        directoryOptOut: true,
        person: { directoryOptOut: false },
      }).optOut,
    ).toBe(true);
    expect(
      studentFlags({ photoRelease: true, person: { photoRelease: false } })
        .photoRelease,
    ).toBe(false);
    expect(
      studentFlags({ photoRelease: false, person: { photoRelease: true } })
        .photoRelease,
    ).toBe(true);
    expect(
      studentFlags({ photoRelease: true, directoryOptOut: true }).photoRelease,
    ).toBe(false);
  });
});

describe('isTeamLabel / StudentDirectory', () => {
  it('a relay team label is not a student', () => {
    expect(isTeamLabel('Lincoln A', ['Lincoln', 'Roosevelt'])).toBe(true);
    expect(isTeamLabel('LINCOLN - B Relay', ['Lincoln'])).toBe(true);
    expect(isTeamLabel('Roosevelt', ['Lincoln', 'Roosevelt'])).toBe(true);
    expect(isTeamLabel('Lincoln Smith', ['Lincoln'])).toBe(false);
    expect(isTeamLabel('Jordan Lee', ['Lincoln'])).toBe(false);
  });

  it('resolves by id, then side + jersey, then exact name; duplicates read strictly', () => {
    const dir = new StudentDirectory([
      { id: 'p1', team: 'home', name: 'Jordan Lee', number: '3' },
      {
        id: 'p2',
        team: 'away',
        name: 'Sam Rivera',
        number: '7',
        directoryOptOut: true,
      },
      { id: 'p3', team: 'home', name: 'sam rivera', number: '9' },
    ]);
    expect(dir.resolve({ id: 'p1' })?.name).toBe('Jordan Lee');
    expect(dir.resolve({ team: 'away', number: 7 })?.id).toBe('p2');
    expect(dir.resolve({ name: '  JORDAN   lee ' })?.id).toBe('p1');
    // two rows share the name — the strict reading (opted out) wins
    expect(dir.resolve({ name: 'Sam Rivera' })?.flags.optOut).toBe(true);
    expect(dir.resolve({ name: 'Nobody Here' })).toBeNull();
  });
});

describe('loadStudentPolicy — fails closed', () => {
  it('an unreadable policy is a school that confirmed nothing', async () => {
    const broken = {
      tenant: {
        findUnique: async () => {
          throw new Error('db down');
        },
      },
      studentPrivacyPolicy: { findMany: async () => [] },
    };
    await expect(loadStudentPolicy(broken as any, 't')).resolves.toEqual(
      CLOSED_STUDENT_POLICY,
    );
    const missing = {
      tenant: { findUnique: async () => null },
      studentPrivacyPolicy: { findMany: async () => [] },
    };
    await expect(loadStudentPolicy(missing as any, 't')).resolves.toEqual(
      CLOSED_STUDENT_POLICY,
    );
  });
});

/* ════════════════ the public board payload ════════════════ */

function world(vertical = 'K12') {
  const h = setup({ vertical, playerStats: true });
  const privacy = new StudentPrivacyService({ client: h.client } as any);
  const gamePrivacy = new SportsRosterPrivacyService(
    { client: h.client } as any,
    h.service,
  );
  const board = async (gameId: string) => {
    (h.service as any).boardCache.delete(gameId);
    return (await h.service.getBoardWithMeta(gameId)).payload;
  };
  const addPlayer = (gameId: string, row: Record<string, unknown>) => {
    const r = {
      tenantId: TENANT,
      gameId,
      team: 'home',
      sortOrder: h.rosterPlayer.rows.length,
      ...row,
    };
    h.rosterPlayer.rows.push(r);
    return r;
  };
  return { ...h, privacy, gamePrivacy, board, addPlayer };
}

async function basketballWithJordan(w: ReturnType<typeof world>) {
  const g = await newGame(w.service, 'basketball');
  w.addPlayer(g.id, { id: 'p-jordan', ...JORDAN });
  return g;
}

/** Everything a public board payload shows, as one string — for "not anywhere" checks. */
const text = (payload: unknown) => JSON.stringify(payload);

describe('the public board — a school that confirmed nothing shows no student', () => {
  it('roster: no name, no photo, the jersey number and stats stay', async () => {
    const w = world('K12');
    const g = await basketballWithJordan(w);
    const b = await w.board(g.id);
    expect(b.roster[0]).toMatchObject({
      name: '',
      photoUrl: null,
      number: '3',
      stats: { PTS: '14', REB: '6' },
    });
    expect(text(b)).not.toContain('Jordan');
    expect(text(b)).not.toContain('Lee');
    expect(text(b)).not.toContain(PHOTO);
    // the flags themselves never leave the server
    expect(b.roster[0]).not.toHaveProperty('directoryOptOut');
    expect(b.roster[0]).not.toHaveProperty('photoRelease');
  });

  it('leaders and player of the game carry no name or photo', async () => {
    const w = world('K12');
    const g = await basketballWithJordan(w);
    const b = await w.board(g.id);
    expect(b.leaders?.length).toBeGreaterThan(0);
    for (const l of b.leaders)
      expect(l).toMatchObject({ playerName: '', photoUrl: null });
    expect(b.playerOfGame).toMatchObject({
      name: '',
      photoUrl: null,
      number: '3',
    });
  });

  it('pre-game intro lineup: no name, no photo', async () => {
    const w = world('K12');
    const g = await basketballWithJordan(w);
    await w.service.firePregameIntro(TENANT, g.id, { team: 'home' }, 'user-1');
    const b = await w.board(g.id);
    const intro = b.cues.find((c: any) => c.key === 'pregame-intro');
    expect(intro.lineup[0]).toMatchObject({
      name: '',
      photoUrl: '',
      number: '3',
    });
    expect(text(b)).not.toContain('Jordan');
  });

  it('a celebration naming the scorer: no name, no photo', async () => {
    const w = world('K12');
    const g = await basketballWithJordan(w);
    await w.service.fireCue(
      TENANT,
      g.id,
      {
        key: 'threePointer',
        team: 'home',
        scorerName: 'Jordan Lee',
        scorerNumber: '3',
        scorerPhotoUrl: PHOTO,
        scorerId: 'p-jordan',
      },
      'user-1',
    );
    const b = await w.board(g.id);
    const cue = b.cues.find((c: any) => c.key === 'threePointer');
    expect(cue).toMatchObject({
      scorerName: null,
      scorerPhotoUrl: null,
      scorerNumber: '3',
    });
    expect(text(b)).not.toContain('Jordan');
    expect(text(b)).not.toContain(PHOTO);
  });

  it('spotlight tapped from the roster: the name becomes the jersey number, no photo', async () => {
    const w = world('K12');
    const g = await basketballWithJordan(w);
    await w.service.setSpotlight(
      TENANT,
      g.id,
      { title: 'Jordan Lee', photoUrl: PHOTO, subtitle: '#3 · G' },
      'user-1',
    );
    const b = await w.board(g.id);
    expect(b.spotlight).toMatchObject({ title: '#3', photoUrl: null });
    expect(text(b)).not.toContain('Jordan');
  });

  it('spotlight free text (a promo) keeps its words; a photo nobody can tie to a student with a release does not show', async () => {
    const w = world('K12');
    const g = await basketballWithJordan(w);
    await w.service.setSpotlight(
      TENANT,
      g.id,
      { title: 'SENIOR NIGHT', photoUrl: 'https://cdn.example/banner.png' },
      'user-1',
    );
    const b = await w.board(g.id);
    expect(b.spotlight).toMatchObject({
      title: 'SENIOR NIGHT',
      photoUrl: null,
    });
  });

  it('typed meet results: student names hidden, relay team labels and marks stay', async () => {
    const w = world('K12');
    const g = await newGame(w.service, 'swimming');
    w.addPlayer(g.id, { id: 'p-maya', name: 'Maya Patel', number: '11' });
    await w.service.updateStats(
      TENANT,
      g.id,
      {
        stats: {
          results: [
            {
              event: '100 Free',
              entries: [
                { place: 1, name: 'Maya Patel', team: 'home', mark: '52.10' },
                { place: 2, name: 'Casey Wong', team: 'away', mark: '53.04' }, // not on the roster
                { place: 3, name: 'Home A', team: 'home', mark: '1:45.22' }, // relay label
              ],
            },
          ],
        },
      },
      'user-1',
    );
    const entries = (await w.board(g.id)).stats.results[0].entries;
    expect(entries.map((e: any) => e.name)).toEqual(['', '', 'Home A']);
    expect(entries.map((e: any) => e.mark)).toEqual([
      '52.10',
      '53.04',
      '1:45.22',
    ]);
  });

  it('the swim feed lane→name join: joined in the database for staff, hidden on the public board', async () => {
    const w = world('K12');
    const g = await newGame(w.service, 'swimming');
    w.addPlayer(g.id, {
      id: 'p-maya',
      name: 'Maya Patel',
      number: '11',
      stats: { lane: 4 },
    });
    const snapshot: SwimTimingSnapshot = {
      lanes: {
        4: {
          lane: 4,
          place: 1,
          minutes: 0,
          seconds: 52,
          hundredths: 10,
          display: '52.10',
          blank: false,
        },
      },
      splits: {},
      eventHeat: { eventNumber: 3, heat: 1 },
      teamScore: null,
      receivedAt: Date.now(),
    };
    await w.service.ingestSwimTimingSnapshot(g.id, snapshot, {
      source: 'test',
    });
    const stored = w.game.rows.find((r) => r.id === g.id)!.stats.results[0]
      .entries[0];
    expect(stored.name).toBe('Maya Patel'); // the operator's own data is untouched
    const shown = (await w.board(g.id)).stats.results[0].entries[0];
    expect(shown).toMatchObject({ name: '', mark: '52.10', lane: 4 });
  });

  it('foul and exclusion rows: names hidden, jersey numbers stay', async () => {
    const w = world('K12');
    const g = await newGame(w.service, 'water_polo');
    w.addPlayer(g.id, {
      id: 'p-sam',
      team: 'away',
      name: 'Sam Rivera',
      number: '7',
    });
    await w.service.updateStats(
      TENANT,
      g.id,
      {
        stats: {
          playerExclusions: [
            { team: 'away', jersey: 7, name: 'Sam Rivera', count: 2 },
          ],
          playerFouls: [
            { team: 'home', jersey: 12, name: 'Ari Cole', fouls: 3 },
          ],
        },
      },
      'user-1',
    );
    const b = await w.board(g.id);
    expect(b.stats.playerExclusions[0]).toMatchObject({
      name: '',
      jersey: 7,
      count: 2,
    });
    expect(b.stats.playerFouls[0]).toMatchObject({
      name: '',
      jersey: 12,
      fouls: 3,
    });
    expect(text(b)).not.toContain('Sam Rivera');
    expect(text(b)).not.toContain('Ari Cole');
  });

  it('the diver / lead runner name stats are hidden', async () => {
    const w = world('K12');
    const g = await newGame(w.service, 'diving');
    await w.service.updateStats(
      TENANT,
      g.id,
      { stats: { currentDiver: 'Taylor Brooks', diveCode: '105B' } },
      'user-1',
    );
    const b = await w.board(g.id);
    expect(b.stats.currentDiver).toBe('');
    expect(b.stats.diveCode).toBe('105B');
    const xc = await newGame(w.service, 'cross_country');
    await w.service.updateStats(
      TENANT,
      xc.id,
      { stats: { leadRunner: 'Taylor Brooks' } },
      'user-1',
    );
    expect((await w.board(xc.id)).stats.leadRunner).toBe('');
  });
});

describe('the public board — after the school confirms', () => {
  async function confirmed(w: ReturnType<typeof world>, photos = false) {
    await w.privacy.setCategory(TENANT, ADMIN, 'names', 'confirm', V);
    if (photos)
      await w.privacy.setCategory(TENANT, ADMIN, 'photos', 'confirm', V);
  }

  it('names show everywhere once the directory-information attestation is confirmed', async () => {
    const w = world('K12');
    const g = await basketballWithJordan(w);
    await w.service.fireCue(
      TENANT,
      g.id,
      {
        key: 'dunk',
        team: 'home',
        scorerName: 'Jordan Lee',
        scorerId: 'p-jordan',
      },
      'user-1',
    );
    await w.service.setSpotlight(
      TENANT,
      g.id,
      { title: 'Jordan Lee', photoUrl: PHOTO },
      'user-1',
    );
    await confirmed(w);
    const b = await w.board(g.id);
    expect(b.roster[0]).toMatchObject({ name: 'Jordan Lee', photoUrl: null });
    expect(b.cues.find((c: any) => c.key === 'dunk').scorerName).toBe(
      'Jordan Lee',
    );
    expect(b.spotlight).toMatchObject({ title: 'Jordan Lee', photoUrl: null });
    expect(text(b)).not.toContain(PHOTO); // no photo attestation, no release
  });

  it('a photo shows only with the photo attestation AND the student release', async () => {
    const w = world('K12');
    const g = await basketballWithJordan(w);
    await confirmed(w, true);
    expect((await w.board(g.id)).roster[0].photoUrl).toBeNull(); // no release yet
    await w.privacy.setStudentFlags(TENANT, g.id, 'p-jordan', ADMIN, {
      photoRelease: true,
    });
    expect((await w.board(g.id)).roster[0].photoUrl).toBe(PHOTO);
  });

  it("a family's opt-out always wins — name and photo gone, number stays", async () => {
    const w = world('K12');
    const g = await basketballWithJordan(w);
    await confirmed(w, true);
    await w.privacy.setStudentFlags(TENANT, g.id, 'p-jordan', ADMIN, {
      photoRelease: true,
    });
    await w.service.setSpotlight(
      TENANT,
      g.id,
      { title: 'Jordan Lee', photoUrl: PHOTO },
      'user-1',
    );
    await w.privacy.setStudentFlags(TENANT, g.id, 'p-jordan', EDITOR, {
      directoryOptOut: true,
    });
    const b = await w.board(g.id);
    expect(b.roster[0]).toMatchObject({
      name: '',
      photoUrl: null,
      number: '3',
    });
    expect(b.spotlight).toMatchObject({ title: '#3', photoUrl: null });
    expect(text(b)).not.toContain('Jordan');
    expect(text(b)).not.toContain(PHOTO);
  });

  it('revoking hides on the very next board build', async () => {
    const w = world('K12');
    const g = await basketballWithJordan(w);
    await confirmed(w);
    expect((await w.board(g.id)).roster[0].name).toBe('Jordan Lee');
    await w.privacy.setCategory(TENANT, ADMIN, 'names', 'revoke');
    expect((await w.board(g.id)).roster[0].name).toBe('');
  });

  it("the game's own switches still make it stricter (last name only, no photos)", async () => {
    const w = world('K12');
    const g = await basketballWithJordan(w);
    await confirmed(w, true);
    await w.privacy.setStudentFlags(TENANT, g.id, 'p-jordan', ADMIN, {
      photoRelease: true,
    });
    await w.gamePrivacy.set(TENANT, g.id, 'user-1', {
      names: 'last',
      photos: false,
    });
    const b = await w.board(g.id);
    expect(b.roster[0]).toMatchObject({ name: 'Lee', photoUrl: null });
    // …and a game set to show everything never loosens the school: revoke → hidden
    await w.gamePrivacy.set(TENANT, g.id, 'user-1', {});
    await w.privacy.setCategory(TENANT, ADMIN, 'names', 'revoke');
    expect((await w.board(g.id)).roster[0].name).toBe('');
  });
});

/**
 * A family's opt-out beats a confirmed school on EVERY public output — each
 * case confirms names AND photos first, so the student beside the opted-out
 * one shows by name: the opt-out, not the default, is what hides them.
 */
describe("the public board — a family's opt-out wins on every output", () => {
  const RILEY = {
    name: 'Riley Chen',
    number: '5',
    position: 'F',
    stats: { PTS: '8', REB: '2' },
  };

  async function schoolConfirmed(w: ReturnType<typeof world>) {
    await w.privacy.setCategory(TENANT, ADMIN, 'names', 'confirm', V);
    await w.privacy.setCategory(TENANT, ADMIN, 'photos', 'confirm', V);
  }
  async function optOut(
    w: ReturnType<typeof world>,
    gameId: string,
    playerId: string,
  ) {
    await w.privacy.setStudentFlags(TENANT, gameId, playerId, ADMIN, {
      photoRelease: true,
    });
    await w.privacy.setStudentFlags(TENANT, gameId, playerId, EDITOR, {
      directoryOptOut: true,
    });
  }
  async function basketballPair(w: ReturnType<typeof world>) {
    const g = await basketballWithJordan(w);
    w.addPlayer(g.id, { id: 'p-riley', ...RILEY });
    await schoolConfirmed(w);
    await optOut(w, g.id, 'p-jordan');
    return g;
  }

  it('leaders and player of the game', async () => {
    const w = world('K12');
    const g = await basketballPair(w);
    const b = await w.board(g.id);
    expect(b.leaders?.length).toBeGreaterThan(0);
    for (const l of b.leaders) expect(l.playerName).not.toBe('Jordan Lee');
    expect(b.playerOfGame).toMatchObject({
      name: '',
      photoUrl: null,
      number: '3',
    });
    expect(b.roster.find((p: any) => p.number === '5').name).toBe('Riley Chen');
    expect(text(b)).not.toContain('Jordan');
    expect(text(b)).not.toContain(PHOTO);
  });

  it('pre-game intro lineup', async () => {
    const w = world('K12');
    const g = await basketballPair(w);
    await w.service.firePregameIntro(TENANT, g.id, { team: 'home' }, 'user-1');
    const intro = (await w.board(g.id)).cues.find(
      (c: any) => c.key === 'pregame-intro',
    );
    const byNumber = Object.fromEntries(
      intro.lineup.map((p: any) => [p.number, p]),
    );
    expect(byNumber['3']).toMatchObject({ name: '', photoUrl: '' });
    expect(byNumber['5'].name).toBe('Riley Chen');
  });

  it('a celebration naming the scorer', async () => {
    const w = world('K12');
    const g = await basketballPair(w);
    await w.service.fireCue(
      TENANT,
      g.id,
      {
        key: 'threePointer',
        team: 'home',
        scorerName: 'Jordan Lee',
        scorerNumber: '3',
        scorerPhotoUrl: PHOTO,
        scorerId: 'p-jordan',
      },
      'user-1',
    );
    await w.service.fireCue(
      TENANT,
      g.id,
      {
        key: 'dunk',
        team: 'home',
        scorerName: 'Riley Chen',
        scorerNumber: '5',
        scorerId: 'p-riley',
      },
      'user-1',
    );
    const b = await w.board(g.id);
    expect(b.cues.find((c: any) => c.key === 'threePointer')).toMatchObject({
      scorerName: null,
      scorerPhotoUrl: null,
      scorerNumber: '3',
    });
    expect(b.cues.find((c: any) => c.key === 'dunk').scorerName).toBe(
      'Riley Chen',
    );
    expect(text(b)).not.toContain('Jordan');
    expect(text(b)).not.toContain(PHOTO);
  });

  it('the spotlight', async () => {
    const w = world('K12');
    const g = await basketballPair(w);
    await w.service.setSpotlight(
      TENANT,
      g.id,
      { title: 'Jordan Lee', photoUrl: PHOTO, subtitle: '#3 · G' },
      'user-1',
    );
    const b = await w.board(g.id);
    expect(b.spotlight).toMatchObject({ title: '#3', photoUrl: null });
    expect(text(b)).not.toContain('Jordan');
  });

  it('typed meet results', async () => {
    const w = world('K12');
    const g = await newGame(w.service, 'swimming');
    w.addPlayer(g.id, { id: 'p-maya', name: 'Maya Patel', number: '11' });
    w.addPlayer(g.id, { id: 'p-nia', name: 'Nia Ross', number: '12' });
    await schoolConfirmed(w);
    await optOut(w, g.id, 'p-maya');
    await w.service.updateStats(
      TENANT,
      g.id,
      {
        stats: {
          results: [
            {
              event: '100 Free',
              entries: [
                { place: 1, name: 'Maya Patel', team: 'home', mark: '52.10' },
                { place: 2, name: 'Nia Ross', team: 'home', mark: '53.04' },
              ],
            },
          ],
        },
      },
      'user-1',
    );
    const entries = (await w.board(g.id)).stats.results[0].entries;
    expect(entries.map((e: any) => e.name)).toEqual(['', 'Nia Ross']);
    expect(entries.map((e: any) => e.mark)).toEqual(['52.10', '53.04']);
  });

  it('the swim feed lane → name join', async () => {
    const w = world('K12');
    const g = await newGame(w.service, 'swimming');
    w.addPlayer(g.id, {
      id: 'p-maya',
      name: 'Maya Patel',
      number: '11',
      stats: { lane: 4 },
    });
    w.addPlayer(g.id, {
      id: 'p-nia',
      name: 'Nia Ross',
      number: '12',
      stats: { lane: 5 },
    });
    await schoolConfirmed(w);
    await optOut(w, g.id, 'p-maya');
    const lane = (n: number, place: number, seconds: number) => ({
      lane: n,
      place,
      minutes: 0,
      seconds,
      hundredths: 10,
      display: `${seconds}.10`,
      blank: false,
    });
    const snapshot: SwimTimingSnapshot = {
      lanes: { 4: lane(4, 1, 52), 5: lane(5, 2, 53) },
      splits: {},
      eventHeat: { eventNumber: 3, heat: 1 },
      teamScore: null,
      receivedAt: Date.now(),
    };
    await w.service.ingestSwimTimingSnapshot(g.id, snapshot, {
      source: 'test',
    });
    const shown = (await w.board(g.id)).stats.results[0].entries;
    const byLane = Object.fromEntries(shown.map((e: any) => [e.lane, e]));
    expect(byLane[4]).toMatchObject({ name: '', mark: '52.10' });
    expect(byLane[5].name).toBe('Nia Ross');
  });

  it('foul and exclusion rows', async () => {
    const w = world('K12');
    const g = await newGame(w.service, 'water_polo');
    w.addPlayer(g.id, {
      id: 'p-sam',
      team: 'away',
      name: 'Sam Rivera',
      number: '7',
    });
    w.addPlayer(g.id, {
      id: 'p-ari',
      team: 'home',
      name: 'Ari Cole',
      number: '12',
    });
    await schoolConfirmed(w);
    await optOut(w, g.id, 'p-sam');
    await w.service.updateStats(
      TENANT,
      g.id,
      {
        stats: {
          playerExclusions: [
            { team: 'away', jersey: 7, name: 'Sam Rivera', count: 2 },
            { team: 'home', jersey: 12, name: 'Ari Cole', count: 1 },
          ],
          playerFouls: [
            { team: 'away', jersey: 7, name: 'Sam Rivera', fouls: 3 },
          ],
        },
      },
      'user-1',
    );
    const b = await w.board(g.id);
    expect(b.stats.playerExclusions.map((r: any) => r.name)).toEqual([
      '',
      'Ari Cole',
    ]);
    expect(b.stats.playerFouls[0]).toMatchObject({
      name: '',
      jersey: 7,
      fouls: 3,
    });
    expect(text(b)).not.toContain('Sam Rivera');
  });

  it('the diver name stat', async () => {
    const w = world('K12');
    const g = await newGame(w.service, 'diving');
    w.addPlayer(g.id, { id: 'p-taylor', name: 'Taylor Brooks', number: '4' });
    w.addPlayer(g.id, { id: 'p-jamie', name: 'Jamie Fox', number: '9' });
    await schoolConfirmed(w);
    await optOut(w, g.id, 'p-taylor');
    await w.service.updateStats(
      TENANT,
      g.id,
      { stats: { currentDiver: 'Taylor Brooks' } },
      'user-1',
    );
    expect((await w.board(g.id)).stats.currentDiver).toBe('');
    await w.service.updateStats(
      TENANT,
      g.id,
      { stats: { currentDiver: 'Jamie Fox' } },
      'user-1',
    );
    expect((await w.board(g.id)).stats.currentDiver).toBe('Jamie Fox');
  });

  it('the lead runner name stat', async () => {
    const w = world('K12');
    const g = await newGame(w.service, 'cross_country');
    w.addPlayer(g.id, { id: 'p-taylor', name: 'Taylor Brooks', number: '4' });
    w.addPlayer(g.id, { id: 'p-jamie', name: 'Jamie Fox', number: '9' });
    await schoolConfirmed(w);
    await optOut(w, g.id, 'p-taylor');
    await w.service.updateStats(
      TENANT,
      g.id,
      { stats: { leadRunner: 'Taylor Brooks' } },
      'user-1',
    );
    expect((await w.board(g.id)).stats.leadRunner).toBe('');
    await w.service.updateStats(
      TENANT,
      g.id,
      { stats: { leadRunner: 'Jamie Fox' } },
      'user-1',
    );
    expect((await w.board(g.id)).stats.leadRunner).toBe('Jamie Fox');
  });
});

describe('the public board — a non-K-12 venue is unchanged', () => {
  it('names and photos show with no attestation at all; the game switches still work', async () => {
    const w = world('SPORTS');
    const g = await basketballWithJordan(w);
    await w.service.setSpotlight(
      TENANT,
      g.id,
      { title: 'Jordan Lee', photoUrl: PHOTO },
      'user-1',
    );
    const b = await w.board(g.id);
    expect(b.roster[0]).toMatchObject({ name: 'Jordan Lee', photoUrl: PHOTO });
    expect(b.spotlight).toMatchObject({ title: 'Jordan Lee', photoUrl: PHOTO });
    await w.gamePrivacy.set(TENANT, g.id, 'user-1', { names: 'hidden' });
    expect((await w.board(g.id)).roster[0].name).toBe('');
  });

  it('an opt-out recorded at a venue is still honoured', async () => {
    const w = world('SPORTS');
    const g = await basketballWithJordan(w);
    w.rosterPlayer.rows[0].directoryOptOut = true;
    const b = await w.board(g.id);
    expect(b.roster[0]).toMatchObject({ name: '', photoUrl: null });
  });

  it('a venue that says it serves minors gets the school default', async () => {
    const w = world('SPORTS');
    const g = await basketballWithJordan(w);
    await w.privacy.setServesMinors(TENANT, ADMIN, true);
    expect((await w.board(g.id)).roster[0].name).toBe('');
  });
});

/* ════════════════ the settings ════════════════ */

describe('StudentPrivacyService — recording the decision', () => {
  it('a confirmation stores who, when and which wording, and audits the exact text', async () => {
    const w = world('K12');
    const s = await w.privacy.setCategory(TENANT, ADMIN, 'names', 'confirm', V);
    expect(s.names).toMatchObject({
      allowed: true,
      own: 'ALLOW',
      needsReconfirm: false,
    });
    expect(s.names.source).toMatchObject({
      level: 'self',
      state: 'ALLOW',
      version: V,
    });
    const row = w.tables.studentPrivacyPolicy.rows[0];
    expect(row).toMatchObject({
      tenantId: TENANT,
      namesState: 'ALLOW',
      namesSetByUserId: 'admin-1',
      namesAttestationVersion: V,
    });
    expect(row.namesSetAt).toBeInstanceOf(Date);
    const audit = w.auditLog.rows.find(
      (a) => a.action === 'STUDENT_PRIVACY_NAMES_CONFIRM',
    );
    expect(audit).toMatchObject({
      tenantId: TENANT,
      userId: 'admin-1',
      targetType: 'Tenant',
      targetId: TENANT,
    });
    expect(JSON.parse(audit!.details)).toMatchObject({
      version: V,
      text: STUDENT_PRIVACY_ATTESTATION_TEXT.names,
      before: null,
      after: 'ALLOW',
    });
  });

  it('only a school or district administrator — a real person — may confirm', async () => {
    const w = world('K12');
    for (const who of [
      STAFF,
      EDITOR,
      { userId: null, role: 'SCHOOL_ADMIN', apiKeyId: 'key-1' },
    ]) {
      await expect(
        w.privacy.setCategory(
          TENANT,
          who as PrivacyCaller,
          'names',
          'confirm',
          V,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(w.tables.studentPrivacyPolicy.rows).toHaveLength(0);
  });

  it('confirming a wording the admin was not shown is refused', async () => {
    const w = world('K12');
    await expect(
      w.privacy.setCategory(TENANT, ADMIN, 'names', 'confirm', '1999-01-01'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      w.privacy.setCategory(TENANT, ADMIN, 'names', 'confirm', undefined),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('VenueOS staff may make it stricter, never looser', async () => {
    const w = world('K12');
    await w.privacy.setCategory(TENANT, ADMIN, 'names', 'confirm', V);
    const s = await w.privacy.setCategory(TENANT, STAFF, 'names', 'revoke');
    expect(s.names.allowed).toBe(false);
    await w.privacy.setCategory(TENANT, STAFF, 'photos', 'hide');
    await expect(
      w.privacy.setCategory(TENANT, STAFF, 'photos', 'unhide'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("a school inherits its district's confirmation, and can be stricter", async () => {
    const w = world('K12');
    w.tables.tenant.rows.push({
      id: 'district-t',
      name: 'Unified District',
      vertical: 'K12',
      parentId: null,
    });
    w.tables.tenant.rows[0].parentId = 'district-t';
    w.tables.user.rows.push({
      id: 'district-1',
      email: 'pat@district.example',
      firstName: 'Pat',
      lastName: 'Smith',
    });
    await w.privacy.setCategory('district-t', DISTRICT, 'names', 'confirm', V);
    let s = await w.privacy.getSettings(TENANT, ADMIN);
    expect(s.names).toMatchObject({ allowed: true, own: null });
    expect(s.names.source).toMatchObject({
      level: 'parent',
      tenantName: 'Unified District',
      setBy: { name: 'Pat Smith' },
    });
    s = await w.privacy.setCategory(TENANT, ADMIN, 'names', 'hide');
    expect(s.names).toMatchObject({ allowed: false, own: 'HIDE' });
    s = await w.privacy.setCategory(TENANT, ADMIN, 'names', 'unhide');
    expect(s.names.allowed).toBe(true);
  });

  it('"serves minors" is for non-K-12 locations; a school is always on', async () => {
    const venue = world('SPORTS');
    const s = await venue.privacy.setServesMinors(TENANT, ADMIN, true);
    expect(s).toMatchObject({
      applies: true,
      appliesBecause: 'serves-minors',
      servesMinors: true,
    });
    await expect(
      venue.privacy.setServesMinors(TENANT, EDITOR, false),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const school = world('K12');
    await expect(
      school.privacy.setServesMinors(TENANT, ADMIN, false),
    ).rejects.toThrow('always on');
  });

  it('getSettings says whether the caller may change it', async () => {
    const w = world('K12');
    expect((await w.privacy.getSettings(TENANT, ADMIN)).canChange).toBe(true);
    expect((await w.privacy.getSettings(TENANT, EDITOR)).canChange).toBe(false);
    expect((await w.privacy.getSettings(TENANT, STAFF)).canChange).toBe(false);
  });
});

describe('StudentPrivacyService — per-student flags', () => {
  it('protecting a student is anyone who edits the roster; showing more is an administrator', async () => {
    const w = world('K12');
    const g = await basketballWithJordan(w);
    await expect(
      w.privacy.setStudentFlags(TENANT, g.id, 'p-jordan', EDITOR, {
        directoryOptOut: true,
      }),
    ).resolves.toMatchObject({ directoryOptOut: true });
    await expect(
      w.privacy.setStudentFlags(TENANT, g.id, 'p-jordan', EDITOR, {
        directoryOptOut: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      w.privacy.setStudentFlags(TENANT, g.id, 'p-jordan', EDITOR, {
        photoRelease: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      w.privacy.setStudentFlags(TENANT, g.id, 'p-jordan', STAFF, {
        photoRelease: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      w.privacy.setStudentFlags(TENANT, g.id, 'p-jordan', ADMIN, {
        directoryOptOut: false,
        photoRelease: true,
      }),
    ).resolves.toMatchObject({ directoryOptOut: false, photoRelease: true });
    const audits = w.auditLog.rows.filter(
      (a) => a.action === 'SPORTS_STUDENT_PRIVACY_FLAGS_SET',
    );
    expect(audits).toHaveLength(2);
    expect(audits.map((a) => a.userId)).toEqual(['editor-1', 'admin-1']);
  });

  it('a linked student: the athlete record is written too, so the flag follows them', async () => {
    const w = world('K12');
    const g = await basketballWithJordan(w);
    w.tables.sportsPerson.rows.push({
      id: 'person-1',
      tenantId: TENANT,
      fullName: 'Jordan Lee',
      directoryOptOut: false,
      photoRelease: false,
    });
    w.rosterPlayer.rows[0].personId = 'person-1';
    const r = await w.privacy.setStudentFlags(
      TENANT,
      g.id,
      'p-jordan',
      EDITOR,
      { directoryOptOut: true },
    );
    expect(r).toMatchObject({ linked: true, directoryOptOut: true });
    expect(w.tables.sportsPerson.rows[0].directoryOptOut).toBe(true);
  });

  it("another tenant's player is not found", async () => {
    const w = world('K12');
    const g = await basketballWithJordan(w);
    await expect(
      w.privacy.setStudentFlags('tenant-other', g.id, 'p-jordan', ADMIN, {
        directoryOptOut: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(w.rosterPlayer.rows[0].directoryOptOut).toBeUndefined();
  });

  it('the roster manager shows the flags the public view applies (a linked athlete counts)', async () => {
    const w = world('K12');
    const g = await basketballWithJordan(w);
    w.rosterPlayer.rows[0].person = {
      directoryOptOut: true,
      photoRelease: false,
    };
    const rows: any[] = await w.service.listRoster(TENANT, g.id);
    expect(rows[0]).toMatchObject({
      name: 'Jordan Lee',
      directoryOptOut: true,
      photoRelease: false,
    });
    expect(rows[0]).not.toHaveProperty('person');
  });
});

/* ════════════════ the public athlete page ════════════════ */

describe('the public athlete page', () => {
  function athleteWorld(
    vertical: string,
    person: Record<string, unknown> = {},
  ) {
    const w = world(vertical);
    w.tables.sportsPerson.rows.push({
      id: 'person-1',
      tenantId: TENANT,
      fullName: 'Jordan Lee',
      number: '3',
      photoUrl: PHOTO,
      isPublic: true,
      publicShareToken: 'tok',
      directoryOptOut: false,
      photoRelease: false,
      ...person,
    });
    return w;
  }

  it('a school that confirmed nothing: the page is not found; sharing says why', async () => {
    const w = athleteWorld('K12');
    await expect(getPublicAthleteProfile(w.client, 'tok')).resolves.toBeNull();
    await expect(
      w.service.setAthleteShare(TENANT, 'person-1', 'user-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('after the names attestation: the page shows, the photo only with photos + release', async () => {
    const w = athleteWorld('K12');
    await w.privacy.setCategory(TENANT, ADMIN, 'names', 'confirm', V);
    expect(await getPublicAthleteProfile(w.client, 'tok')).toMatchObject({
      fullName: 'Jordan Lee',
      photoUrl: null,
    });
    await w.privacy.setCategory(TENANT, ADMIN, 'photos', 'confirm', V);
    w.tables.sportsPerson.rows[0].photoRelease = true;
    expect(await getPublicAthleteProfile(w.client, 'tok')).toMatchObject({
      photoUrl: PHOTO,
    });
    await expect(
      w.service.setAthleteShare(TENANT, 'person-1', 'user-1'),
    ).resolves.toMatchObject({ shared: true });
  });

  it("an opted-out student's page is gone, even after the attestation", async () => {
    const w = athleteWorld('K12', { directoryOptOut: true });
    await w.privacy.setCategory(TENANT, ADMIN, 'names', 'confirm', V);
    await expect(getPublicAthleteProfile(w.client, 'tok')).resolves.toBeNull();
  });

  it('a non-K-12 venue: unchanged', async () => {
    const w = athleteWorld('SPORTS');
    expect(await getPublicAthleteProfile(w.client, 'tok')).toMatchObject({
      fullName: 'Jordan Lee',
      photoUrl: PHOTO,
    });
  });
});
