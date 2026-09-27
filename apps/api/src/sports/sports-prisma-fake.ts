/**
 * In-memory Prisma double for the sports engine's concurrency / atomicity
 * specs (K12 launch program, lane A1 — 2026-09-26).
 *
 * The older fakes in sports.service.spec.ts roll a failed transaction back by
 * restoring a deep-cloned snapshot of EVERY table taken when the transaction
 * started. That is fine for one transaction at a time, and wrong the moment
 * two overlap: the loser's rollback restores a snapshot that predates the
 * winner's commit and silently erases it — the double hides exactly the
 * lost-update class the K12 race probes exist to catch (and the restored rows
 * are clones, so a test holding the original row object reads a detached
 * copy).
 *
 * What this double models instead, deliberately and nothing more:
 *
 *  - PER-TRANSACTION ROLLBACK. Every write made THROUGH the `tx` client of an
 *    interactive transaction records a before-image; a throw inside the
 *    callback restores those rows IN PLACE (object identity kept) and removes
 *    rows that transaction created. Writes from other transactions are never
 *    touched. Writes made through the OUTER client inside a callback are NOT
 *    rolled back — exactly like Prisma, where they run on another connection.
 *  - Filters the sports engine uses: equality (a `null` filter matches null
 *    and undefined), Date equality, `in` / `notIn` / `not` / `gt` / `gte` /
 *    `lt` / `lte` / `equals`, `AND` / `OR` / `NOT`, and compound unique keys
 *    (`gameId_commandId: { gameId, commandId }`). A version predicate in an
 *    `update` where therefore behaves like the real compare-and-swap.
 *  - Prisma's error CODES: an `update` / `delete` that matches nothing throws
 *    P2025, and a `create` that violates a declared unique key throws P2002.
 *  - Strictly increasing `createdAt`, so `orderBy: { createdAt: 'desc' }`
 *    never ties; `findFirst` / `findMany` honor `orderBy`, `take`, `skip`.
 *
 * What it does NOT model: row locks and isolation levels. Two interleaved
 * transactions both see each other's writes immediately. Race specs are
 * therefore written around what the engine's correctness actually rests on —
 * a compare-and-swap that MISSES — never around blocking. Proving the same
 * property against real Postgres is the opt-in k12-launch-acceptance.pg.spec.ts.
 */
import { AsyncLocalStorage } from 'async_hooks';

type Row = Record<string, any>;

/** Methods that change rows (these are the ones recorded for rollback). */
const WRITE_METHODS = new Set([
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);

const SCALAR_OPS = new Set([
  'equals',
  'in',
  'notIn',
  'not',
  'gt',
  'gte',
  'lt',
  'lte',
]);

export class FakePrismaError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    if (a == null || b == null) return false;
    return new Date(a as any).getTime() === new Date(b as any).getTime();
  }
  return a === b;
}

function compare(a: unknown, b: unknown): number {
  if (a instanceof Date || b instanceof Date) {
    return new Date(a as any).getTime() - new Date(b as any).getTime();
  }
  if ((a as any) < (b as any)) return -1;
  if ((a as any) > (b as any)) return 1;
  return 0;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
  );
}

function matchScalar(value: unknown, cond: unknown): boolean {
  if (cond === null) return value === null || value === undefined;
  if (!isPlainObject(cond)) return sameValue(value, cond);
  for (const [op, c] of Object.entries(cond)) {
    switch (op) {
      case 'equals':
        if (!matchScalar(value, c)) return false;
        break;
      case 'in':
        if (!Array.isArray(c) || !c.some((x) => sameValue(value, x)))
          return false;
        break;
      case 'notIn':
        if (Array.isArray(c) && c.some((x) => sameValue(value, x)))
          return false;
        break;
      case 'not':
        if (matchScalar(value, c)) return false;
        break;
      case 'gt':
        if (value == null || !(compare(value, c) > 0)) return false;
        break;
      case 'gte':
        if (value == null || !(compare(value, c) >= 0)) return false;
        break;
      case 'lt':
        if (value == null || !(compare(value, c) < 0)) return false;
        break;
      case 'lte':
        if (value == null || !(compare(value, c) <= 0)) return false;
        break;
      default:
        throw new Error(
          `sports-prisma-fake: unsupported filter operator "${op}"`,
        );
    }
  }
  return true;
}

export function matchWhere(row: Row, where: unknown): boolean {
  if (!where) return true;
  if (!isPlainObject(where)) return false;
  for (const [key, cond] of Object.entries(where)) {
    if (cond === undefined) continue; // Prisma: an undefined filter is no filter
    if (key === 'AND') {
      const list = Array.isArray(cond) ? cond : [cond];
      if (!list.every((w) => matchWhere(row, w))) return false;
      continue;
    }
    if (key === 'OR') {
      const list = Array.isArray(cond) ? cond : [cond];
      if (list.length > 0 && !list.some((w) => matchWhere(row, w)))
        return false;
      continue;
    }
    if (key === 'NOT') {
      const list = Array.isArray(cond) ? cond : [cond];
      if (list.some((w) => matchWhere(row, w))) return false;
      continue;
    }
    // Compound unique key (`gameId_commandId: { gameId, commandId }`): not a
    // column, and every sub-key is a plain equality.
    if (
      !(key in row) &&
      isPlainObject(cond) &&
      Object.keys(cond).length > 0 &&
      Object.keys(cond).every((k) => !SCALAR_OPS.has(k))
    ) {
      if (!matchWhere(row, cond)) return false;
      continue;
    }
    if (
      isPlainObject(cond) &&
      !Object.keys(cond).every((k) => SCALAR_OPS.has(k))
    ) {
      throw new Error(
        `sports-prisma-fake: unsupported relation filter on "${key}"`,
      );
    }
    if (!matchScalar(row[key], cond)) return false;
  }
  return true;
}

function applyData(row: Row, data: Row): void {
  for (const [k, v] of Object.entries(data || {})) {
    if (v === undefined) continue;
    if (isPlainObject(v) && 'increment' in v) {
      row[k] = (Number(row[k]) || 0) + Number((v as any).increment);
    } else if (isPlainObject(v) && 'decrement' in v) {
      row[k] = (Number(row[k]) || 0) - Number((v as any).decrement);
    } else if (isPlainObject(v) && 'set' in v && Object.keys(v).length === 1) {
      row[k] = (v as any).set;
    } else {
      row[k] = v;
    }
  }
}

type UndoEntry = () => void;
interface TxStore {
  log: UndoEntry[];
  viaTx: boolean;
}

export interface FakeTable {
  rows: Row[];
  updateCalls: Array<{ where: unknown; data: unknown }>;
  [method: string]: any;
}

export interface FakeTableOptions {
  defaults?: Row;
  /** Unique keys, each a list of columns (single-column keys included). */
  uniques?: string[][];
  /** Primary-key column (default `id`). */
  pk?: string;
}

export interface FakePrisma {
  client: any;
  tables: Record<string, FakeTable>;
}

/**
 * Build a Prisma-shaped client over the named tables. Tables not declared up
 * front are created lazily with no defaults / uniques, so an engine that
 * touches a model the test never mentions still runs.
 */
export function makeSportsPrismaFake(
  spec: Record<string, FakeTableOptions> = {},
): FakePrisma {
  const txCtx = new AsyncLocalStorage<TxStore>();
  const undoLog = (): UndoEntry[] | null => {
    const s = txCtx.getStore();
    return s && s.viaTx ? s.log : null;
  };
  let clock = 0;
  const nextCreatedAt = (): Date => {
    clock = Math.max(Date.now(), clock + 1);
    return new Date(clock);
  };

  const tables: Record<string, FakeTable> = {};

  const makeTable = (name: string, opts: FakeTableOptions = {}): FakeTable => {
    const rows: Row[] = [];
    const updateCalls: Array<{ where: unknown; data: unknown }> = [];
    const pk = opts.pk ?? 'id';
    const uniques = opts.uniques ?? [];
    let seq = 0;

    const assertUnique = (candidate: Row, except?: Row) => {
      for (const key of [[pk], ...uniques]) {
        if (
          key.some((c) => candidate[c] === undefined || candidate[c] === null)
        )
          continue;
        const clash = rows.find(
          (r) =>
            r !== except && key.every((c) => sameValue(r[c], candidate[c])),
        );
        if (clash) {
          throw new FakePrismaError(
            'P2002',
            `Unique constraint failed on the fields: (${key.join(',')}) [${name}]`,
          );
        }
      }
    };

    const insert = (data: Row): Row => {
      const now = nextCreatedAt();
      const row: Row = {
        ...(pk === 'id' ? { id: `${name}-${++seq}` } : {}),
        createdAt: now,
        updatedAt: now,
        ...(opts.defaults ?? {}),
        ...data,
      };
      assertUnique(row);
      rows.push(row);
      const log = undoLog();
      if (log) {
        log.push(() => {
          const i = rows.indexOf(row);
          if (i >= 0) rows.splice(i, 1);
        });
      }
      return row;
    };

    const mutate = (row: Row, data: Row) => {
      const log = undoLog();
      if (log) {
        const before = { ...row };
        log.push(() => {
          for (const k of Object.keys(row)) delete row[k];
          Object.assign(row, before);
        });
      }
      const next = { ...row };
      applyData(next, data);
      assertUnique(next, row);
      applyData(row, data);
      row.updatedAt = new Date();
    };

    const remove = (row: Row) => {
      const i = rows.indexOf(row);
      if (i < 0) return;
      rows.splice(i, 1);
      const log = undoLog();
      if (log) log.push(() => rows.splice(Math.min(i, rows.length), 0, row));
    };

    const sortRows = (list: Row[], orderBy: unknown): Row[] => {
      if (!orderBy) return list;
      const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
      return list.slice().sort((a, b) => {
        for (const clause of clauses) {
          for (const [k, dir] of Object.entries(clause as Row)) {
            const cmp = compare(a[k], b[k]);
            if (cmp !== 0) return dir === 'desc' ? -cmp : cmp;
          }
        }
        return 0;
      });
    };

    const table: FakeTable = {
      rows,
      updateCalls,
      findFirst: async ({ where, orderBy }: any = {}) =>
        sortRows(
          rows.filter((r) => matchWhere(r, where)),
          orderBy,
        )[0] ?? null,
      findUnique: async ({ where }: any = {}) =>
        rows.find((r) => matchWhere(r, where)) ?? null,
      findMany: async ({ where, orderBy, take, skip }: any = {}) => {
        let out = sortRows(
          rows.filter((r) => matchWhere(r, where)),
          orderBy,
        );
        if (typeof skip === 'number') out = out.slice(skip);
        if (typeof take === 'number') out = out.slice(0, take);
        return out;
      },
      count: async ({ where }: any = {}) =>
        rows.filter((r) => matchWhere(r, where)).length,
      create: async ({ data }: any) => insert(data),
      createMany: async ({ data, skipDuplicates }: any) => {
        const list = Array.isArray(data) ? data : [data];
        let count = 0;
        for (const d of list) {
          try {
            insert(d);
            count++;
          } catch (e) {
            if (
              !(
                skipDuplicates &&
                e instanceof FakePrismaError &&
                e.code === 'P2002'
              )
            )
              throw e;
          }
        }
        return { count };
      },
      update: async ({ where, data }: any) => {
        const row = rows.find((r) => matchWhere(r, where));
        if (!row) {
          throw new FakePrismaError(
            'P2025',
            `An operation failed because it depends on one or more records that were required but not found. [${name}]`,
          );
        }
        updateCalls.push({ where, data });
        mutate(row, data);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        const hit = rows.filter((r) => matchWhere(r, where));
        hit.forEach((r) => mutate(r, data));
        return { count: hit.length };
      },
      upsert: async ({ where, create, update }: any) => {
        const row = rows.find((r) => matchWhere(r, where));
        if (row) {
          mutate(row, update);
          return row;
        }
        return insert(create);
      },
      delete: async ({ where }: any) => {
        const row = rows.find((r) => matchWhere(r, where));
        if (!row) {
          throw new FakePrismaError(
            'P2025',
            `Record to delete does not exist. [${name}]`,
          );
        }
        remove(row);
        return row;
      },
      deleteMany: async ({ where }: any = {}) => {
        const hit = rows.filter((r) => matchWhere(r, where));
        hit.forEach(remove);
        return { count: hit.length };
      },
    };
    return table;
  };

  for (const [name, opts] of Object.entries(spec))
    tables[name] = makeTable(name, opts);

  const tableFor = (name: string): FakeTable =>
    (tables[name] ??= makeTable(name));

  /**
   * The `tx` client handed to an interactive-transaction callback: every
   * method call is routed to the table's CURRENT method (so a test that
   * swaps `game.update` for an interceptor still intercepts in-transaction
   * writes) and runs with this transaction's undo log in scope.
   */
  const makeTxClient = (log: UndoEntry[]) => {
    const self: any = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (typeof prop !== 'string') return undefined;
          if (prop === '$transaction') {
            // A nested transaction joins the outer one (same undo log).
            return async (arg: any) =>
              typeof arg === 'function' ? arg(self) : Promise.all(arg);
          }
          if (prop.startsWith('$')) return (client as any)[prop];
          const table = tableFor(prop);
          return new Proxy(table, {
            get(target, method: string) {
              const current = (target as any)[method];
              if (typeof current !== 'function') return current;
              return (...args: any[]) =>
                txCtx.run({ log, viaTx: WRITE_METHODS.has(method) }, () =>
                  (target as any)[method](...args),
                );
            },
          });
        },
      },
    );
    return self;
  };

  const client: any = new Proxy(
    {
      $transaction: async (arg: any, _opts?: unknown) => {
        if (typeof arg !== 'function') return Promise.all(arg);
        const log: UndoEntry[] = [];
        const tx = makeTxClient(log);
        try {
          return await txCtx.run({ log, viaTx: false }, () => arg(tx));
        } catch (e) {
          for (const undo of log.slice().reverse()) undo();
          throw e;
        }
      },
      $queryRaw: async () => [],
      $executeRaw: async () => 0,
      $use: () => undefined,
    },
    {
      get(target, prop: string) {
        if (prop in target) return (target as any)[prop];
        if (typeof prop !== 'string') return undefined;
        return tableFor(prop);
      },
    },
  );

  return { client, tables };
}
