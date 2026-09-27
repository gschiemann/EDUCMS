/**
 * K12-F35 — display ownership is claimed atomically.
 *
 * Acceptance (audit register): "Two simultaneous claims yield one winner and
 * a visible conflict; intentional takeover succeeds once, is audited, and
 * both consoles show the actual assignment." The simultaneous-claim probe is
 * K12-24 in k12-launch-acceptance.spec.ts; these cover take-over, the
 * all-or-nothing push, release, and the SYNC nudge.
 *
 * Simultaneity is forced with a read barrier: every claim reads the screens
 * before any claim writes (the double hands out live rows, so reads are
 * copied the way a database returns snapshots).
 */
import { TENANT, setup, newGame } from './sports-test-harness';

function freeScreen(
  id: string,
  name: string,
  owner: string | null = null,
  surface: string | null = null,
) {
  return {
    id,
    name,
    status: 'ONLINE',
    tenantId: TENANT,
    activeBoardGameId: owner,
    activeBoardSurface: surface,
  };
}

/** Make the next `n` screen reads wait until all `n` have read. */
function readBarrier(screen: any, n: number) {
  const live = screen.findMany;
  let reads = 0;
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  screen.findMany = async (args: any) => {
    const rows = (await live(args)).map((r: any) => ({ ...r }));
    if (reads < n) {
      reads += 1;
      if (reads === n) open();
      await gate;
    }
    return rows;
  };
}

const conflictOf = (r: PromiseSettledResult<unknown>) =>
  r.status === 'rejected' ? (r.reason as any).getResponse() : null;

describe('K12-F35 — explicit take-over', () => {
  it('a take-over confirmed against the current owner succeeds, is audited, and both consoles see it', async () => {
    const { service, screen, auditLog } = setup();
    const a: any = await newGame(service, 'basketball');
    const b: any = await newGame(service, 'volleyball');
    screen.rows.push(freeScreen('s1', 'Gym', a.id, 'BOARD'));

    const before = await service.listGameScreens(TENANT, b.id);
    expect(before[0]).toMatchObject({ showingOther: true, otherGameId: a.id });

    await service.showOnScreens(
      TENANT,
      b.id,
      ['s1'],
      'RIBBON',
      true,
      'admin-1',
      { s1: before[0].otherGameId },
    );

    expect(screen.rows[0]).toMatchObject({
      activeBoardGameId: b.id,
      activeBoardSurface: 'RIBBON',
    });
    const takeover = auditLog.rows.filter(
      (r: any) => r.action === 'SPORTS_SCREEN_TAKEN_OVER',
    );
    expect(takeover).toHaveLength(1);
    expect(takeover[0].userId).toBe('admin-1');
    expect(JSON.parse(takeover[0].details)).toMatchObject({
      screenId: 's1',
      fromGameId: a.id,
      toGameId: b.id,
      confirmedOwner: a.id,
    });
    expect((await service.listGameScreens(TENANT, a.id))[0]).toMatchObject({
      showing: false,
      otherGameId: b.id,
    });
    expect((await service.listGameScreens(TENANT, b.id))[0]).toMatchObject({
      showing: true,
      surface: 'RIBBON',
    });
  });

  it('a STALE confirmation is refused: the screen changed hands after the dialog opened', async () => {
    const { service, screen } = setup();
    const a: any = await newGame(service);
    const b: any = await newGame(service);
    const c: any = await newGame(service);
    screen.rows.push(freeScreen('s1', 'Gym', b.id));
    // C's operator confirmed taking it from A — but B owns it now.
    await expect(
      service.showOnScreens(TENANT, c.id, ['s1'], 'BOARD', true, 'admin-2', {
        s1: a.id,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'SCREEN_IN_USE',
        conflicts: [{ screenId: 's1', ownerGameId: b.id }],
      },
    });
    expect(screen.rows[0].activeBoardGameId).toBe(b.id);
  });

  it('two simultaneous take-overs of the same screen: exactly one succeeds, the other names the winner', async () => {
    const { service, screen, auditLog } = setup();
    const a: any = await newGame(service);
    const b: any = await newGame(service);
    const c: any = await newGame(service);
    screen.rows.push(freeScreen('s1', 'Gym', a.id));
    readBarrier(screen, 2);
    const results = await Promise.allSettled([
      service.showOnScreens(TENANT, b.id, ['s1'], 'BOARD', true, 'op-b', {
        s1: a.id,
      }),
      service.showOnScreens(TENANT, c.id, ['s1'], 'BOARD', true, 'op-c', {
        s1: a.id,
      }),
    ]);
    const winners = results.filter((r) => r.status === 'fulfilled');
    expect(winners).toHaveLength(1);
    const winner = screen.rows[0].activeBoardGameId;
    expect([b.id, c.id]).toContain(winner);
    const loser = results.find((r) => r.status === 'rejected')!;
    expect(conflictOf(loser)).toMatchObject({
      code: 'SCREEN_IN_USE',
      conflicts: [{ ownerGameId: winner }],
    });
    expect(
      auditLog.rows.filter((r: any) => r.action === 'SPORTS_SCREEN_TAKEN_OVER'),
    ).toHaveLength(1);
  });

  it('the older console form (force without a confirmed owner) takes over from whoever owns it now, audited', async () => {
    const { service, screen, auditLog } = setup();
    const a: any = await newGame(service);
    const b: any = await newGame(service);
    screen.rows.push(freeScreen('s1', 'Gym', a.id));
    await service.showOnScreens(TENANT, b.id, ['s1'], 'BOARD', true, 'admin-1');
    expect(screen.rows[0].activeBoardGameId).toBe(b.id);
    const row = auditLog.rows.find(
      (r: any) => r.action === 'SPORTS_SCREEN_TAKEN_OVER',
    );
    expect(JSON.parse(row.details)).toMatchObject({
      fromGameId: a.id,
      confirmedOwner: null,
    });
  });
});

describe('K12-F35 — claims', () => {
  it('a push is all of its screens or none: one conflict leaves the free screen unclaimed', async () => {
    const { service, screen, auditLog, published } = setup();
    const a: any = await newGame(service);
    const b: any = await newGame(service);
    screen.rows.push(freeScreen('s1', 'Lobby'), freeScreen('s2', 'Gym', a.id));
    const sent = published.length;
    await expect(
      service.showOnScreens(TENANT, b.id, ['s1', 's2']),
    ).rejects.toMatchObject({
      response: {
        code: 'SCREEN_IN_USE',
        screenIds: ['s2'],
        screenNames: ['Gym'],
      },
    });
    expect(screen.rows[0].activeBoardGameId).toBeNull();
    expect(screen.rows[1].activeBoardGameId).toBe(a.id);
    expect(
      auditLog.rows.filter((r: any) => r.action === 'SPORTS_SCREENS_SHOWN'),
    ).toHaveLength(0);
    expect(published.length).toBe(sent);
  });

  it('switching the surface of a screen this game already owns is not a take-over; the SYNC nudge is sent', async () => {
    const { service, screen, auditLog, published } = setup();
    const a: any = await newGame(service);
    screen.rows.push(freeScreen('s1', 'Gym'));
    await service.showOnScreens(
      TENANT,
      a.id,
      ['s1'],
      'BOARD',
      undefined,
      'op-1',
    );
    await service.showOnScreens(
      TENANT,
      a.id,
      ['s1'],
      'SCOREBUG',
      undefined,
      'op-1',
    );
    expect(screen.rows[0]).toMatchObject({
      activeBoardGameId: a.id,
      activeBoardSurface: 'SCOREBUG',
    });
    const shown = auditLog.rows.filter(
      (r: any) => r.action === 'SPORTS_SCREENS_SHOWN',
    );
    expect(shown).toHaveLength(2);
    expect(JSON.parse(shown[1].details).screens).toEqual([
      { screenId: 's1', prevGameId: a.id, prevSurface: 'BOARD' },
    ]);
    expect(
      auditLog.rows.some((r: any) => r.action === 'SPORTS_SCREEN_TAKEN_OVER'),
    ).toBe(false);
    expect(
      published.filter((p) => p.channel === `tenant:${TENANT}`).length,
    ).toBe(2);
  });

  it('a foreign tenant screen is never claimed', async () => {
    const { service, screen } = setup();
    const a: any = await newGame(service);
    screen.rows.push({
      ...freeScreen('s-other', 'Their Gym'),
      tenantId: 'tenant-2',
    });
    await service.showOnScreens(TENANT, a.id, ['s-other']);
    expect(screen.rows[0].activeBoardGameId).toBeNull();
  });
});

describe('K12-F35 — release', () => {
  it('hide releases only screens this game owns, audited; a screen taken since is left alone', async () => {
    const { service, screen, auditLog } = setup();
    const a: any = await newGame(service);
    const b: any = await newGame(service);
    screen.rows.push(freeScreen('s1', 'Lobby'), freeScreen('s2', 'Gym'));
    await service.showOnScreens(TENANT, a.id, ['s1', 's2']);
    await service.showOnScreens(TENANT, b.id, ['s2'], 'BOARD', true, 'op-b', {
      s2: a.id,
    });

    await service.hideFromScreens(TENANT, a.id, undefined, 'op-a');
    expect(screen.rows[0].activeBoardGameId).toBeNull();
    expect(screen.rows[1].activeBoardGameId).toBe(b.id);
    const released = auditLog.rows.filter(
      (r: any) => r.action === 'SPORTS_SCREENS_RELEASED',
    );
    expect(released).toHaveLength(1);
    expect(released[0].userId).toBe('op-a');
    expect(JSON.parse(released[0].details).screenIds).toEqual(['s1']);

    // Nothing left to release: no empty audit row.
    await service.hideFromScreens(TENANT, a.id, undefined, 'op-a');
    expect(
      auditLog.rows.filter((r: any) => r.action === 'SPORTS_SCREENS_RELEASED'),
    ).toHaveLength(1);
  });
});
