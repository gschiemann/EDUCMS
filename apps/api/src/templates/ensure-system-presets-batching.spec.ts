import { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { ALL_PRESETS, ensureSystemPresets } from './ensure-system-presets';

/**
 * The boot seed's round-trip budget (2026-09-22).
 *
 * Production spent 152 s in this seed on every boot (deploy 7009eccd: "All 459
 * system presets present." 18:52:46 → "Pinned 4 …" 18:55:19), holding a pool
 * connection for its advisory lock the whole time, while writing nothing. The
 * zone widget-type sync made two to four queries PER single-zone preset: 2,156
 * of the 2,182 SQL statements a no-change boot sent, at ~70 ms a round trip.
 * It now reads what it needs in two queries, diffs in memory, and writes only
 * real differences.
 *
 * These specs run the REAL ensureSystemPresets against an in-memory Prisma fake
 * that keeps real rows and records every model call. Each call is at least one
 * round trip (a write is three: Prisma wraps it in BEGIN … COMMIT). The fake is
 * filled by the seeder itself, starting from an empty database, so "converged"
 * means exactly what the seeder leaves behind. Its lock transaction answers
 * only the lock statements, so a query moved INTO that transaction fails loudly.
 */

type Row = Record<string, unknown>;
type Direction = 'asc' | 'desc';
type OrderBy = Record<string, Direction> | Record<string, Direction>[];
type Args = {
  where?: Row;
  select?: Record<string, boolean>;
  orderBy?: OrderBy;
  data?: Row;
};
type Call = { model: 'template' | 'templateZone'; op: string; args: Args };

const READ_OPS = new Set(['findMany', 'findFirst', 'findUnique']);
const isRead = (c: Call) => READ_OPS.has(c.op);
const isWrite = (c: Call) => !isRead(c);

function prismaError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** Prisma `where` for the subset the seeder uses: equality, `in`, `not`. */
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond !== null && typeof cond === 'object') {
      const filter = cond as { in?: unknown[]; not?: unknown };
      if (filter.in) return filter.in.includes(row[key]);
      if ('not' in filter) return row[key] !== filter.not;
      throw new Error(
        `FAKE: unmodelled filter ${key}: ${JSON.stringify(cond)}`,
      );
    }
    return row[key] === cond;
  });
}

/**
 * Array.prototype.sort is stable, so with no orderBy the rows keep the order
 * they were stored in — the "physical" order, which is all an unordered query
 * promises too.
 */
function ordered(rows: Row[], orderBy?: OrderBy): Row[] {
  const keys = (
    Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []
  ).flatMap((o) => Object.entries(o));
  return [...rows].sort((a, b) => {
    for (const [key, dir] of keys) {
      const x = a[key] as string | number;
      const y = b[key] as string | number;
      if (x !== y) return (x < y ? -1 : 1) * (dir === 'desc' ? -1 : 1);
    }
    return 0;
  });
}

function project(row: Row, select?: Record<string, boolean>): Row {
  if (!select) return { ...row };
  return Object.fromEntries(
    Object.keys(select)
      .filter((k) => select[k])
      .map((k) => [k, row[k]]),
  );
}

class FakeDb {
  readonly templates: Row[] = [];
  readonly zones: Row[] = [];
  calls: Call[] = [];
  failZoneRead = false;
  private zoneSeq = 0;
  private clock = Date.UTC(2026, 8, 22);

  /** A template's zones, first zone first: (sortOrder, id). Live rows. */
  zonesOf(templateId: string): Row[] {
    return ordered(
      this.zones.filter((z) => z.templateId === templateId),
      [{ sortOrder: 'asc' }, { id: 'asc' }],
    );
  }

  template(id: string): Row {
    const row = this.templates.find((t) => t.id === id);
    if (!row) throw new Error(`FAKE: no template ${id}`);
    return row;
  }

  prismaService(): PrismaService {
    const delegate = (model: Call['model']) =>
      new Proxy(
        {},
        {
          get:
            (_target, op) =>
            (args?: Args): Promise<unknown> =>
              // A promise, like Prisma's: a throw below becomes a rejection.
              new Promise((resolve) =>
                resolve(this.run(model, String(op), args)),
              ),
        },
      );
    const lockOnly = { $executeRaw: () => Promise.resolve(1) };
    const tx = new Proxy(lockOnly, {
      get: (target, prop) => {
        if (prop in target) return target[prop as keyof typeof target];
        throw new Error(
          `FAKE: ${String(prop)} ran inside the lock's transaction — the seed's queries belong on the pool`,
        );
      },
    });
    const client = {
      $executeRaw: () => Promise.resolve(1),
      $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
      template: delegate('template'),
      templateZone: delegate('templateZone'),
    };
    return { client } as unknown as PrismaService;
  }

  private run(model: Call['model'], op: string, args: Args = {}): unknown {
    this.calls.push({ model, op, args });
    const table = model === 'template' ? this.templates : this.zones;
    const hits = () => table.filter((r) => matches(r, args.where));
    switch (op) {
      case 'findMany':
        if (model === 'templateZone' && this.failZoneRead) {
          throw new Error('Connection reset by peer (simulated blip)');
        }
        return ordered(hits(), args.orderBy).map((r) =>
          project(r, args.select),
        );
      case 'findFirst':
      case 'findUnique': {
        const [row] = ordered(hits(), args.orderBy);
        return row ? project(row, args.select) : null;
      }
      case 'create':
        return this.create(args.data ?? {});
      case 'update': {
        const found = hits();
        if (found.length !== 1) {
          throw prismaError('P2025', 'Record to update not found.');
        }
        this.write(model, found[0], args.data ?? {});
        return { ...found[0] };
      }
      case 'updateMany': {
        const found = hits();
        for (const row of found) this.write(model, row, args.data ?? {});
        return { count: found.length };
      }
      case 'deleteMany': {
        const found = hits();
        for (const row of found) table.splice(table.indexOf(row), 1);
        return { count: found.length };
      }
      default:
        throw new Error(`FAKE: unmodelled ${model}.${op}`);
    }
  }

  /** Prisma leaves a column alone when its value is undefined. */
  private assign(row: Row, data: Row): void {
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) row[key] = value;
    }
  }

  private write(model: Call['model'], row: Row, data: Row): void {
    this.assign(row, data);
    // Template.updatedAt is @updatedAt; TemplateZone has no timestamp.
    if (model === 'template' && data.updatedAt === undefined) {
      row.updatedAt = this.tick();
    }
  }

  private create(data: Row): Row {
    if (this.templates.some((t) => t.id === data.id)) {
      throw prismaError(
        'P2002',
        'Unique constraint failed on the fields: (`id`)',
      );
    }
    const { zones, ...fields } = data as Row & { zones?: { create: Row[] } };
    const template: Row = {
      schoolLevel: 'UNIVERSAL',
      vertical: 'K12',
      status: 'ACTIVE',
      isSystem: false,
      screenWidth: 1920,
      screenHeight: 1080,
    };
    this.assign(template, fields);
    template.updatedAt = this.tick();
    this.templates.push(template);
    for (const zone of zones?.create ?? []) {
      this.zoneSeq += 1;
      this.zones.push({
        id: `zone-${String(this.zoneSeq).padStart(4, '0')}`,
        templateId: template.id,
        ...zone,
      });
    }
    return { ...template };
  }

  private tick(): Date {
    this.clock += 1_000;
    return new Date(this.clock);
  }
}

/**
 * The zone widget-type sync pass's calls: everything on templateZone, plus the
 * board canvas read (a template read by id alone) and canvas writes.
 */
function zonePassCalls(calls: Call[]): Call[] {
  return calls.filter(
    (c) =>
      c.model === 'templateZone' ||
      (c.model === 'template' &&
        c.op === 'findMany' &&
        Object.keys(c.args.where ?? {}).join() === 'id') ||
      (c.model === 'template' &&
        c.op === 'update' &&
        'screenWidth' in (c.args.data ?? {})),
  );
}

type Preset = (typeof ALL_PRESETS)[number];
const singleZone = ALL_PRESETS.filter(
  (p) => p.zones.length === 1 && p.zones[0].defaultConfig,
);
const boards = singleZone.filter(
  (p) =>
    p.zones[0].widgetType === 'EXTERNAL_HTML' &&
    p.screenWidth !== undefined &&
    p.screenHeight !== undefined,
);
const widgets = singleZone.filter(
  (p) => p.zones[0].widgetType !== 'EXTERNAL_HTML',
);
const configOf = (p: Preset) => JSON.stringify(p.zones[0].defaultConfig);
/** A zone that sorts `offset` places from `zone` by sortOrder. */
const sortNear = (zone: Row, offset: number) => Number(zone.sortOrder) + offset;

describe('ensureSystemPresets — round trips', () => {
  let lines: string[];
  let warn: jest.SpyInstance;

  beforeEach(() => {
    lines = [];
    jest.spyOn(Logger.prototype, 'log').mockImplementation((message) => {
      lines.push(`log ${String(message)}`);
    });
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((message) => {
        lines.push(`warn ${String(message)}`);
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** A database the seeder itself has fully reconciled; calls and logs reset. */
  async function convergedDb(): Promise<FakeDb> {
    const db = new FakeDb();
    await ensureSystemPresets(db.prismaService()); // empty → creates every preset
    expect(warn).not.toHaveBeenCalled();
    db.calls = [];
    lines = [];
    return db;
  }

  it('picks enough presets for these specs to mean something', () => {
    // The per-preset version made 2-4 calls for each single-zone preset.
    expect(singleZone.length).toBeGreaterThan(300);
    expect(boards.length).toBeGreaterThanOrEqual(2);
    expect(widgets.length).toBeGreaterThanOrEqual(3);
  });

  it('syncs every zone of every single-zone preset with two reads, not two per preset', async () => {
    const db = await convergedDb();

    await ensureSystemPresets(db.prismaService());

    expect(warn).not.toHaveBeenCalled();
    // ONE read of every zone, ONE read of every board's canvas. The
    // per-preset version made 1,368 calls here (290 boards × 4 + 104 × 2).
    expect(zonePassCalls(db.calls).map((c) => `${c.model}.${c.op}`)).toEqual([
      'templateZone.findMany',
      'template.findMany',
    ]);
    expect(db.calls.filter((c) => c.op === 'findFirst')).toEqual([]);
    expect(db.calls.filter((c) => c.op === 'findUnique')).toEqual([]);
    // The two reads cover every single-zone preset and every board.
    const [zoneRead, canvasRead] = zonePassCalls(db.calls);
    expect(zoneRead.args.where).toEqual({
      templateId: {
        in: ALL_PRESETS.filter(
          (p) => p.zones.length === 1 && p.zones[0].widgetType,
        ).map((p) => p.id),
      },
    });
    expect(zoneRead.args.orderBy).toEqual([
      { sortOrder: 'asc' },
      { id: 'asc' },
    ]);
    expect(canvasRead.args.where).toEqual({
      id: {
        in: ALL_PRESETS.filter(
          (p) =>
            p.zones.length === 1 && p.zones[0].widgetType === 'EXTERNAL_HTML',
        ).map((p) => p.id),
      },
    });
    // With nothing to change, no zone is written at all …
    expect(
      db.calls.filter((c) => c.model === 'templateZone' && isWrite(c)),
    ).toEqual([]);
    // … and the whole seed is a fixed handful of calls: six reads, plus the
    // passes that always write (quarantine, superseded, four pin-to-top touches).
    expect(db.calls.filter(isRead)).toHaveLength(6);
    expect(db.calls.length).toBeLessThanOrEqual(12);
  });

  it('writes exactly the drift — prune, canvas, widgetType, defaultConfig — with the same log lines as before', async () => {
    const db = await convergedDb();
    const [prunedBoard, canvasBoard] = boards;
    const [retypedWidget, reconfiguredWidget] = widgets;

    // A board that drifted to three zones. The stray that sorts FIRST is kept
    // (first by sortOrder, id — the prune's rule since 2026-07-24), so the
    // original is one of the two pruned.
    const [original] = db.zonesOf(prunedBoard.id);
    db.zones.push(
      {
        id: 'zone-stray-first',
        templateId: prunedBoard.id,
        name: 'stray',
        widgetType: 'LEGACY_WIDGET',
        sortOrder: sortNear(original, -1),
        defaultConfig: '{"stale":true}',
      },
      {
        id: 'zone-stray-last',
        templateId: prunedBoard.id,
        name: 'stray',
        widgetType: 'EXTERNAL_HTML',
        sortOrder: sortNear(original, +1),
        defaultConfig: null,
      },
    );
    db.template(canvasBoard.id).screenWidth = 1111;
    for (const zone of db.zonesOf(retypedWidget.id)) {
      zone.widgetType = 'LEGACY_WIDGET';
    }
    db.zonesOf(reconfiguredWidget.id)[0].defaultConfig = '{}';

    await ensureSystemPresets(db.prismaService());

    // Still two reads for the whole pass, and one write per difference.
    const pass = zonePassCalls(db.calls);
    expect(pass.filter(isRead)).toHaveLength(2);
    const writes = pass.filter(isWrite);
    expect(writes).toHaveLength(6);
    expect(writes).toEqual(
      expect.arrayContaining([
        {
          model: 'templateZone',
          op: 'deleteMany',
          args: { where: { id: { in: [original.id, 'zone-stray-last'] } } },
        },
        {
          model: 'templateZone',
          op: 'updateMany',
          args: {
            where: {
              templateId: prunedBoard.id,
              widgetType: { not: 'EXTERNAL_HTML' },
            },
            data: { widgetType: 'EXTERNAL_HTML' },
          },
        },
        {
          model: 'templateZone',
          op: 'update',
          args: {
            where: { id: 'zone-stray-first' },
            data: { defaultConfig: configOf(prunedBoard) },
          },
        },
        {
          model: 'template',
          op: 'update',
          args: {
            where: { id: canvasBoard.id },
            data: {
              screenWidth: canvasBoard.screenWidth,
              screenHeight: canvasBoard.screenHeight,
            },
          },
        },
        {
          model: 'templateZone',
          op: 'updateMany',
          args: {
            where: {
              templateId: retypedWidget.id,
              widgetType: { not: retypedWidget.zones[0].widgetType },
            },
            data: { widgetType: retypedWidget.zones[0].widgetType },
          },
        },
        {
          model: 'templateZone',
          op: 'update',
          args: {
            where: { id: db.zonesOf(reconfiguredWidget.id)[0].id },
            data: { defaultConfig: configOf(reconfiguredWidget) },
          },
        },
      ]),
    );

    // The database now says what the source says.
    expect(
      db
        .zonesOf(prunedBoard.id)
        .map((z) => [z.id, z.widgetType, z.defaultConfig]),
    ).toEqual([['zone-stray-first', 'EXTERNAL_HTML', configOf(prunedBoard)]]);
    expect(db.template(canvasBoard.id)).toMatchObject({
      screenWidth: canvasBoard.screenWidth,
      screenHeight: canvasBoard.screenHeight,
    });
    expect(db.zonesOf(retypedWidget.id).map((z) => z.widgetType)).toEqual([
      retypedWidget.zones[0].widgetType,
    ]);
    expect(db.zonesOf(reconfiguredWidget.id)[0].defaultConfig).toBe(
      configOf(reconfiguredWidget),
    );

    // The same log lines, in source order, as the per-preset version wrote.
    const perPreset = new Map<string, string[]>([
      [
        prunedBoard.id,
        [
          `warn   ↳ ${prunedBoard.id}: pruned 2 stale zone(s) — source declares a single board zone`,
          `log   ↳ ${prunedBoard.id}: zone widgetType → EXTERNAL_HTML`,
          `log   ↳ ${prunedBoard.id}: zone defaultConfig synced`,
        ],
      ],
      [
        canvasBoard.id,
        [
          `log   ↳ ${canvasBoard.id}: canvas → ${canvasBoard.screenWidth}×${canvasBoard.screenHeight}`,
        ],
      ],
      [
        retypedWidget.id,
        [
          `log   ↳ ${retypedWidget.id}: zone widgetType → ${retypedWidget.zones[0].widgetType}`,
        ],
      ],
      [
        reconfiguredWidget.id,
        [`log   ↳ ${reconfiguredWidget.id}: zone defaultConfig synced`],
      ],
    ]);
    const zonePassLines = lines.filter((l) =>
      /^(log|warn) {3}↳ |^log (Pruned|Synced widgetType|Synced defaultConfig) /.test(
        l,
      ),
    );
    expect(zonePassLines).toEqual([
      ...ALL_PRESETS.flatMap((p) => perPreset.get(p.id) ?? []),
      'log Pruned 2 stale zone(s) from single-zone board presets.',
      'log Synced widgetType on 2 system-preset zone(s).',
      'log Synced defaultConfig on 2 system-preset zone(s).',
    ]);

    // And the next boot has nothing left to write.
    db.calls = [];
    await ensureSystemPresets(db.prismaService());
    expect(zonePassCalls(db.calls).map((c) => `${c.model}.${c.op}`)).toEqual([
      'templateZone.findMany',
      'template.findMany',
    ]);
  });

  it('gives the source defaultConfig to the first zone by (sortOrder, id), and the widgetType to every zone', async () => {
    // A non-board preset that drifted to two zones. The old per-preset read
    // was `findFirst` with NO order — `WHERE template_id = $1 LIMIT 1` — so it
    // checked whichever zone the query plan reached first: here the original,
    // stored first, leaving the stray's stale config in place forever. The
    // first zone is now the first by (sortOrder, id), the order the board
    // prune keeps by.
    const db = await convergedDb();
    const widget = widgets[2];
    const [original] = db.zonesOf(widget.id);
    db.zones.push({
      id: 'zone-stray',
      templateId: widget.id,
      name: 'stray',
      widgetType: 'LEGACY_WIDGET',
      sortOrder: sortNear(original, -1),
      defaultConfig: '{"stale":true}',
    });

    await ensureSystemPresets(db.prismaService());

    expect(
      db.zonesOf(widget.id).map((z) => [z.id, z.widgetType, z.defaultConfig]),
    ).toEqual([
      ['zone-stray', widget.zones[0].widgetType, configOf(widget)],
      [original.id, widget.zones[0].widgetType, configOf(widget)],
    ]);
    expect(lines).toContain(
      'log Synced widgetType on 1 system-preset zone(s).',
    );
    expect(lines).toContain(
      'log Synced defaultConfig on 1 system-preset zone(s).',
    );
  });

  it('a failed zone read costs only this pass: nothing is written and the passes after it still run', async () => {
    const db = await convergedDb();
    db.failZoneRead = true;

    await ensureSystemPresets(db.prismaService());

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Zone widgetType/config sync failed: Connection reset by peer (simulated blip)',
    );
    expect(
      db.calls.filter((c) => c.model === 'templateZone' && isWrite(c)),
    ).toEqual([]);
    expect(lines).toContain(
      'log Pinned 4 animated-welcome presets to top of gallery.',
    );
  });
});
