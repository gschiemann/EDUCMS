/**
 * K12-F32 — a scoreboard console is bound to a game through authenticated
 * configuration, decoded only with the table for the game's OWN sport,
 * previewed and confirmed before it drives the game, and fed by the box's
 * device credential — no feed token in a URL, no football fallback.
 */
jest.mock('../screens/device-auth', () => ({
  verifyDeviceForScreen: jest.fn(),
}));

import { CONSOLE_PROFILES } from '@cms/scoreboard-cts';
import { SCORE_SOURCES } from '@cms/api-types';
import { verifyDeviceForScreen } from '../screens/device-auth';
import { ScoreboardConsoleService } from './scoreboard-console.service';
import {
  SCOREBOARD_CONSOLE_PROFILE_IDS,
  scoreboardConsoleManifestBlock,
  readScoreboardConsoleBinding,
  nextPreview,
} from './scoreboard-console';

const T = 'tenant-a';
const OTHER = 'tenant-b';
const mockedAuth = verifyDeviceForScreen as jest.MockedFunction<
  typeof verifyDeviceForScreen
>;

type Row = Record<string, any>;

function world() {
  const games: Row[] = [
    {
      id: 'g-bball',
      tenantId: T,
      sport: 'basketball',
      status: 'LIVE',
      homeTeam: 'Lions',
      awayTeam: 'Bears',
    },
    {
      id: 'g-base',
      tenantId: T,
      sport: 'baseball',
      status: 'SCHEDULED',
      homeTeam: 'Hawks',
      awayTeam: 'Owls',
    },
    {
      id: 'g-vball',
      tenantId: T,
      sport: 'volleyball',
      status: 'LIVE',
      homeTeam: 'Jets',
      awayTeam: 'Rams',
    },
    {
      id: 'g-final',
      tenantId: T,
      sport: 'football',
      status: 'FINAL',
      homeTeam: 'A',
      awayTeam: 'B',
    },
    {
      id: 'g-foreign',
      tenantId: OTHER,
      sport: 'basketball',
      status: 'LIVE',
      homeTeam: 'X',
      awayTeam: 'Y',
    },
  ];
  const screens: Row[] = [
    {
      id: 'box-1',
      tenantId: T,
      name: 'Gym box',
      status: 'ONLINE',
      config: null,
    },
    {
      id: 'box-2',
      tenantId: T,
      name: 'Field box',
      status: 'OFFLINE',
      config: { wiring: { rs232_1: 'cts' } },
    },
    {
      id: 'box-foreign',
      tenantId: OTHER,
      name: 'Their box',
      status: 'ONLINE',
      config: null,
    },
  ];
  const audits: Row[] = [];
  const matches = (row: Row, where: Row = {}) =>
    Object.entries(where).every(([k, v]) =>
      v && typeof v === 'object' && Array.isArray((v as any).in)
        ? (v as any).in.includes(row[k])
        : row[k] === v,
    );
  const pick = (row: Row, select?: Row) =>
    select
      ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]]))
      : { ...row };
  const screen = {
    findMany: jest.fn(async ({ where, select }: any) =>
      screens.filter((s) => matches(s, where)).map((s) => pick(s, select)),
    ),
    findFirst: jest.fn(async ({ where, select }: any) => {
      const s = screens.find((x) => matches(x, where));
      return s ? pick(s, select) : null;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const s = screens.find((x) => matches(x, where));
      if (!s) throw new Error(`no screen ${JSON.stringify(where)}`);
      Object.assign(s, data);
      return s;
    }),
  };
  const game = {
    findFirst: jest.fn(async ({ where, select }: any) => {
      const g = games.find((x) => matches(x, where));
      return g ? pick(g, select) : null;
    }),
    findMany: jest.fn(async ({ where, select }: any) =>
      games.filter((g) => matches(g, where)).map((g) => pick(g, select)),
    ),
  };
  const auditLog = {
    create: jest.fn(async ({ data }: any) => (audits.push(data), data)),
  };
  const tx = { screen, auditLog };
  const client = {
    screen,
    game,
    auditLog,
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  return { games, screens, audits, prisma: { client } as any };
}

/** A Redis double: either disconnected, or a Map shared between "replicas". */
function redisDouble(shared?: Map<string, string>) {
  return {
    publisher: null,
    isConnected: () => !!shared,
    setString: jest.fn(
      async (k: string, v: string) => (shared?.set(k, v), !!shared),
    ),
    getString: jest.fn(async (k: string) => shared?.get(k) ?? null),
    delKey: jest.fn(async (k: string) => (shared?.delete(k), !!shared)),
    publish: jest.fn(async () => undefined),
  } as any;
}

let clock = 1_790_000_000_000;
function build(w = world(), redis = redisDouble()) {
  const sports = {
    serverTimeMs: () => clock,
    ingestCtsSnapshot: jest.fn(async () => ({
      ok: true as const,
      accepted: true,
    })),
  } as any;
  const signer = {
    signMessage: (type: string, payload: unknown) => ({ type, payload }),
  } as any;
  const svc = new ScoreboardConsoleService(w.prisma, redis, sports, signer);
  return { svc, sports, redis, ...w };
}

const deviceOk = (screenId: string, tenantId = T) =>
  mockedAuth.mockResolvedValue({
    ok: true,
    sub: screenId,
    tenantId,
    screen: {} as any,
    token: 't',
  } as any);
const req = {} as any;
const snap = (over: Record<string, unknown> = {}) => ({
  decoder: 'daktronics',
  decoderSport: 'basketball',
  session: 'bridge-1',
  seq: 1,
  clockMs: 412_000,
  clockRunning: true,
  segment: 2,
  homeScore: 45,
  awayScore: 38,
  link: {
    status: 'connected',
    bytes: 5120,
    goodFrames: 88,
    badFrames: 0,
    native: true,
  },
  ...over,
});

beforeEach(() => {
  clock += 60_000;
  mockedAuth.mockReset();
});

describe('one list: every console profile belongs to a score source (K12-F32)', () => {
  it('the scoreboard-cts profiles and SCORE_SOURCES agree on ids and decoders', () => {
    expect([...SCOREBOARD_CONSOLE_PROFILE_IDS].sort()).toEqual(
      Object.keys(CONSOLE_PROFILES).sort(),
    );
    for (const src of SCORE_SOURCES.filter(
      (s) => s.kind === 'experimental-hardware',
    )) {
      for (const id of src.consoleProfiles ?? []) {
        expect(
          CONSOLE_PROFILES[id as keyof typeof CONSOLE_PROFILES].decoder,
        ).toBe(src.decoder);
      }
    }
  });
});

describe('binding a console to a game (SBC-1..3)', () => {
  it('SBC-1: refuses a model that cannot read the sport, an unknown model, a foreign screen and a final game', async () => {
    const { svc, screens } = build();
    await expect(
      svc.bind(
        T,
        'g-vball',
        { screenId: 'box-1', consoleProfile: 'daktronics-allsport' },
        'u1',
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'CONSOLE_SPORT_UNSUPPORTED',
        supportedSports: ['football', 'basketball', 'baseball', 'softball'],
      },
    });
    await expect(
      svc.bind(
        T,
        'g-bball',
        { screenId: 'box-1', consoleProfile: 'oes-isc9000' },
        'u1',
      ),
    ).rejects.toMatchObject({ response: { code: 'CONSOLE_UNKNOWN' } });
    await expect(
      svc.bind(
        T,
        'g-bball',
        { screenId: 'box-foreign', consoleProfile: 'daktronics-allsport' },
        'u1',
      ),
    ).rejects.toThrow('Screen not found');
    await expect(
      svc.bind(
        T,
        'g-final',
        { screenId: 'box-1', consoleProfile: 'daktronics-allsport' },
        'u1',
      ),
    ).rejects.toMatchObject({
      response: { code: 'SCOREBOARD_CONSOLE_GAME_FINAL' },
    });
    await expect(
      svc.bind(
        T,
        'g-foreign',
        { screenId: 'box-1', consoleProfile: 'daktronics-allsport' },
        'u1',
      ),
    ).rejects.toThrow('Game not found');
    // Nothing was written anywhere.
    expect(screens.every((s) => !readScoreboardConsoleBinding(s.config))).toBe(
      true,
    );
  });

  it('SBC-2: binds the box with the model, audits it, and nudges only that box', async () => {
    const { svc, screens, audits, redis } = build();
    const view = await svc.bind(
      T,
      'g-bball',
      { screenId: 'box-1', consoleProfile: 'daktronics-allsport' },
      'u1',
    );
    const box = screens.find((s) => s.id === 'box-1')!;
    expect(box.config.consoleProfile).toBe('daktronics-allsport');
    expect(readScoreboardConsoleBinding(box.config)).toMatchObject({
      gameId: 'g-bball',
      sport: 'basketball',
      boundBy: 'u1',
      confirmedAt: null,
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'SPORTS_SCOREBOARD_CONSOLE_BOUND',
      targetId: 'g-bball',
      userId: 'u1',
    });
    expect(JSON.parse(audits[0].details)).toMatchObject({
      decoder: 'daktronics',
      decoderSport: 'basketball',
    });
    expect(redis.publish).toHaveBeenCalledTimes(1);
    expect(redis.publish.mock.calls[0][0]).toBe('device:box-1');
    expect(view.binding).toMatchObject({
      screenId: 'box-1',
      decoderSport: 'basketball',
      confirmedAt: null,
    });
    expect(view.supported).toBe(true);
    // The models the card offers for basketball: Daktronics only.
    expect(view.models.filter((m) => m.supported).map((m) => m.id)).toEqual([
      'daktronics-allsport',
    ]);
  });

  it('SBC-3: re-binding moves the box to the new game (baseball decodes with its own table); one box per game', async () => {
    const { svc, screens, audits } = build();
    await svc.bind(
      T,
      'g-bball',
      { screenId: 'box-1', consoleProfile: 'daktronics-allsport' },
      'u1',
    );
    // A second box for the same game releases the first.
    await svc.bind(
      T,
      'g-bball',
      { screenId: 'box-2', consoleProfile: 'daktronics-allsport' },
      'u1',
    );
    expect(readScoreboardConsoleBinding(screens[0].config)).toBeNull();
    expect(readScoreboardConsoleBinding(screens[1].config)?.gameId).toBe(
      'g-bball',
    );
    expect(screens[1].config.wiring).toEqual({ rs232_1: 'cts' }); // other config kept
    // Change sport: the same box now reads the baseball game.
    const view = await svc.bind(
      T,
      'g-base',
      { screenId: 'box-2', consoleProfile: 'daktronics-allsport' },
      'u2',
    );
    expect(view.binding?.decoderSport).toBe('baseball');
    expect(scoreboardConsoleManifestBlock(screens[1].config)).toMatchObject({
      gameId: 'g-base',
      decoder: 'daktronics',
      decoderSport: 'baseball',
      confirmed: false,
    });
    expect(JSON.parse(audits[2].details)).toMatchObject({
      previousGameId: 'g-bball',
    });
  });
});

describe('the manifest block is a pure function of the screen row (SBC-4)', () => {
  const bound = (
    profile: string | undefined,
    sport: string,
    confirmedAt: string | null = null,
  ) => ({
    ...(profile ? { consoleProfile: profile } : {}),
    scoreboardConsole: {
      gameId: 'g1',
      sport,
      boundAt: '2026-09-27T10:00:00.000Z',
      boundBy: 'u',
      confirmedAt,
      confirmedBy: null,
    },
  });

  it('decodes each sport with its own table — softball reads the baseball insert — and never defaults to football', () => {
    expect(
      scoreboardConsoleManifestBlock(
        bound('daktronics-allsport', 'basketball'),
      ),
    ).toMatchObject({
      decoder: 'daktronics',
      decoderSport: 'basketball',
      sportName: 'Basketball',
    });
    expect(
      scoreboardConsoleManifestBlock(bound('daktronics-allsport', 'softball'))
        ?.decoderSport,
    ).toBe('baseball');
    expect(
      scoreboardConsoleManifestBlock(
        bound('cts-wttc', 'water_polo', '2026-09-27T10:01:00.000Z'),
      ),
    ).toMatchObject({
      decoder: 'cts',
      decoderSport: 'water-polo',
      confirmed: true,
    });
  });

  it('a model that cannot read the sport says so (decoderSport null + what it CAN read)', () => {
    expect(
      scoreboardConsoleManifestBlock(bound('cts-gen6', 'basketball')),
    ).toMatchObject({
      decoder: 'cts',
      decoderSport: null,
      supportedSports: ['water_polo'],
      supportedSportNames: ['Water Polo'],
    });
    expect(
      scoreboardConsoleManifestBlock(bound(undefined, 'basketball')),
    ).toMatchObject({
      consoleProfile: null,
      decoder: null,
      decoderSport: null,
    });
  });

  it('an unbound or malformed config emits nothing', () => {
    expect(scoreboardConsoleManifestBlock(null)).toBeNull();
    expect(
      scoreboardConsoleManifestBlock({ consoleProfile: 'cts-gen6' }),
    ).toBeNull();
    expect(
      scoreboardConsoleManifestBlock({ scoreboardConsole: { gameId: 'g1' } }),
    ).toBeNull();
    expect(
      scoreboardConsoleManifestBlock({
        scoreboardConsole: {
          gameId: '../x',
          sport: 'basketball',
          boundAt: '2026-09-27T10:00:00Z',
        },
      }),
    ).toBeNull();
  });
});

describe('the box feeds the game with its DEVICE credential (SBC-5..9)', () => {
  async function boundWorld(redis = redisDouble()) {
    const b = build(world(), redis);
    await b.svc.bind(
      T,
      'g-bball',
      { screenId: 'box-1', consoleProfile: 'daktronics-allsport' },
      'u1',
    );
    return b;
  }

  it('SBC-5: until confirmed, snapshots are a PREVIEW — held, never written to the game', async () => {
    const { svc, sports } = await boundWorld();
    deviceOk('box-1');
    await expect(svc.ingest('box-1', snap(), req)).resolves.toMatchObject({
      accepted: false,
      preview: true,
    });
    expect(sports.ingestCtsSnapshot).not.toHaveBeenCalled();
    const view = await svc.view(T, 'g-bball');
    expect(view.preview).toMatchObject({
      screenId: 'box-1',
      homeScore: 45,
      awayScore: 38,
      segment: 2,
      clockMs: 412_000,
    });
    expect(view.link).toMatchObject({
      status: 'connected',
      bytes: 5120,
      goodFrames: 88,
      native: true,
    });
  });

  it('SBC-6: confirm needs a preview; once confirmed the box drives the game through the normal ingest', async () => {
    const { svc, sports, audits, screens } = await boundWorld();
    await expect(svc.confirm(T, 'g-bball', 'u1')).rejects.toMatchObject({
      response: { code: 'SCOREBOARD_CONSOLE_NO_PREVIEW' },
    });
    deviceOk('box-1');
    await svc.ingest('box-1', snap(), req);
    const view = await svc.confirm(T, 'g-bball', 'u1');
    expect(view.binding?.confirmedAt).toEqual(expect.any(String));
    const confirmedAudit = audits.find(
      (a) => a.action === 'SPORTS_SCOREBOARD_CONSOLE_CONFIRMED',
    )!;
    expect(JSON.parse(confirmedAudit.details).preview).toMatchObject({
      homeScore: 45,
      awayScore: 38,
    });
    expect(scoreboardConsoleManifestBlock(screens[0].config)?.confirmed).toBe(
      true,
    );

    clock += 5_000; // past the binding cache
    await expect(
      svc.ingest('box-1', snap({ seq: 2, homeScore: 47 }), req),
    ).resolves.toMatchObject({ accepted: true });
    expect(sports.ingestCtsSnapshot).toHaveBeenCalledWith(
      'g-bball',
      expect.objectContaining({ homeScore: 47, decoderSport: 'basketball' }),
      { tenantId: T, source: 'console-device' },
    );
  });

  it('SBC-7: a snapshot decoded with another sport’s table is refused — never read as football', async () => {
    const { svc, sports } = await boundWorld();
    deviceOk('box-1');
    await expect(
      svc.ingest('box-1', snap({ decoderSport: 'football' }), req),
    ).rejects.toMatchObject({
      response: {
        code: 'CONSOLE_DECODER_MISMATCH',
        expected: { decoder: 'daktronics', decoderSport: 'basketball' },
      },
    });
    await expect(
      svc.ingest(
        'box-1',
        snap({ decoder: 'cts', decoderSport: 'water-polo' }),
        req,
      ),
    ).rejects.toMatchObject({
      response: { code: 'CONSOLE_DECODER_MISMATCH' },
    });
    expect(sports.ingestCtsSnapshot).not.toHaveBeenCalled();
    expect((await svc.view(T, 'g-bball')).preview).toBeNull();
  });

  it('SBC-8: refused without a device credential, from an unbound box, or when the game is gone', async () => {
    const { svc, games } = await boundWorld();
    mockedAuth.mockResolvedValue({ ok: false, reason: 'token_invalid' } as any);
    await expect(svc.ingest('box-1', snap(), req)).rejects.toMatchObject({
      status: 401,
    });
    deviceOk('box-2');
    await expect(svc.ingest('box-2', snap(), req)).rejects.toMatchObject({
      response: { code: 'CONSOLE_NOT_BOUND' },
    });
    // A box re-paired into another tenant finds nothing there.
    clock += 5_000;
    deviceOk('box-1', OTHER);
    await expect(svc.ingest('box-1', snap(), req)).rejects.toMatchObject({
      response: { code: 'CONSOLE_NOT_BOUND' },
    });
    clock += 5_000;
    games.splice(
      games.findIndex((g) => g.id === 'g-bball'),
      1,
    );
    deviceOk('box-1');
    await expect(svc.ingest('box-1', snap(), req)).rejects.toMatchObject({
      response: { code: 'CONSOLE_GAME_GONE' },
    });
  });

  it('SBC-9: a heartbeat reports the link without touching the game or the preview', async () => {
    const { svc, sports } = await boundWorld();
    deviceOk('box-1');
    const beat = {
      decoder: 'daktronics',
      decoderSport: 'basketball',
      link: { status: 'disconnected', bytes: 0 },
    };
    await expect(svc.ingest('box-1', beat, req)).resolves.toMatchObject({
      accepted: false,
      reason: 'heartbeat',
    });
    const view = await svc.view(T, 'g-bball');
    expect(view.link).toMatchObject({
      status: 'disconnected',
      bytes: 0,
      goodFrames: null,
      native: false,
    });
    expect(view.preview).toBeNull();
    expect(sports.ingestCtsSnapshot).not.toHaveBeenCalled();
  });
});

describe('unbind, and the preview across replicas (SBC-10..11)', () => {
  it('SBC-10: disconnect clears the binding and the preview, audited', async () => {
    const { svc, screens, audits } = build();
    await svc.bind(
      T,
      'g-bball',
      { screenId: 'box-1', consoleProfile: 'daktronics-allsport' },
      'u1',
    );
    deviceOk('box-1');
    await svc.ingest('box-1', snap(), req);
    const view = await svc.unbind(T, 'g-bball', 'u1');
    expect(view.binding).toBeNull();
    expect(view.preview).toBeNull();
    expect(readScoreboardConsoleBinding(screens[0].config)).toBeNull();
    expect(screens[0].config.consoleProfile).toBe('daktronics-allsport'); // the box keeps its model
    expect(audits.map((a) => a.action)).toEqual([
      'SPORTS_SCOREBOARD_CONSOLE_BOUND',
      'SPORTS_SCOREBOARD_CONSOLE_UNBOUND',
    ]);
  });

  it('SBC-11: with Redis, one replica takes the packet and another shows the preview and link', async () => {
    const shared = new Map<string, string>();
    const w = world();
    const a = build(w, redisDouble(shared));
    const b = build(w, redisDouble(shared));
    await a.svc.bind(
      T,
      'g-bball',
      { screenId: 'box-1', consoleProfile: 'daktronics-allsport' },
      'u1',
    );
    deviceOk('box-1');
    await a.svc.ingest('box-1', snap(), req);
    const onB = await b.svc.view(T, 'g-bball');
    expect(onB.preview).toMatchObject({ homeScore: 45 });
    expect(onB.link).toMatchObject({ status: 'connected' });
    await b.svc.confirm(T, 'g-bball', 'u1');
    await b.svc.unbind(T, 'g-bball', 'u1');
    expect((await a.svc.view(T, 'g-bball')).preview).toBeNull();
  });
});

describe('the preview merges what the console sends', () => {
  it('keeps the last known value of a field a packet did not carry', () => {
    const meta = {
      receivedAt: '2026-09-27T10:00:00.000Z',
      screenId: 'box-1',
      decoderSport: 'basketball',
    };
    const first = nextPreview(
      null,
      { homeScore: 10, awayScore: 8, clockMs: 60_000, segment: 1 },
      meta,
    );
    const second = nextPreview(
      first,
      { homeScore: 12 },
      { ...meta, receivedAt: '2026-09-27T10:00:01.000Z' },
    );
    expect(second).toMatchObject({
      homeScore: 12,
      awayScore: 8,
      clockMs: 60_000,
      segment: 1,
    });
    // A different box or decoder starts over.
    expect(
      nextPreview(second, { homeScore: 1 }, { ...meta, screenId: 'box-2' })
        .awayScore,
    ).toBeNull();
  });
});
