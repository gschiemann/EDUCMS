/**
 * A tenant-aware in-memory Prisma double for the two-tenant role matrix
 * (SEC-009, 2026-09-04).
 *
 * WHY THIS EXISTS. A hand-mocked `findFirst: jest.fn(() => row)` proves nothing
 * about tenant isolation: it hands the row back whatever the `where` said, so a
 * controller that forgot `tenantId` passes just as happily as one that didn't.
 * The assertion has to be about the QUERY.
 *
 * So this double actually EVALUATES the where clause against a two-tenant
 * dataset. A bare `{ where: { id } }` on a tenant-B row really does return
 * tenant B's row here — which is exactly the leak the matrix then fails on.
 * Every row it hands back or mutates is recorded in `touched`, tagged with the
 * tenant it belongs to.
 *
 * It is deliberately NOT a full Prisma: it supports the operators this
 * codebase's tenant-scoped reads and writes actually use, and throws on a
 * shape it does not understand rather than quietly matching everything (a
 * silently-permissive matcher would turn this whole test into theatre).
 */

export type Row = Record<string, any>;
export type Dataset = Record<string, Row[]>;

export interface TouchRecord {
  model: string;
  method: string;
  rowId: string | undefined;
  tenantId: string | null | undefined;
  /** True for update/updateMany/upsert/delete/deleteMany. */
  isWrite: boolean;
}

const WRITE_METHODS = new Set(['update', 'updateMany', 'upsert', 'delete', 'deleteMany']);

/**
 * Which tenant does this row belong to?
 *
 * Most rows say so directly. Two shapes do not, and both matter here:
 *   - a `tenant` row IS its tenant (its `id` is the tenant id);
 *   - a join row like PlaylistItem carries no tenantId at all and inherits it
 *     from its parent — the fixtures embed that parent so the ownership check
 *     the handler performs is visible to the detector too.
 */
function tenantOf(model: string, row: Row): string | null | undefined {
  if (model === 'tenant') return row.id;
  if ('tenantId' in row) return row.tenantId;
  if (row.playlist && typeof row.playlist === 'object') return row.playlist.tenantId;
  return undefined;
}

export class UnsupportedWhereError extends Error {}

/** Prisma's "record not found" for update/delete — same shape the app catches. */
export class RecordNotFoundError extends Error {
  code = 'P2025';
  constructor(model: string) {
    super(`An operation failed because it depends on one or more records that were required but not found. (${model})`);
  }
}

const SCALAR_OPS = new Set([
  'equals',
  'not',
  'in',
  'notIn',
  'lt',
  'lte',
  'gt',
  'gte',
  'contains',
  'startsWith',
  'endsWith',
  'mode',
]);

function matchScalar(value: any, cond: any): boolean {
  if (cond === null) return value === null || value === undefined;
  if (cond instanceof Date) return value instanceof Date && +value === +cond;
  if (typeof cond !== 'object' || Array.isArray(cond)) return value === cond;

  const keys = Object.keys(cond);
  if (keys.length === 0) return true;
  if (!keys.every((k) => SCALAR_OPS.has(k))) {
    // A relation filter (`{ playlist: { tenantId } }`) or an operator we do not
    // model. Refuse rather than pretend — see the header.
    throw new UnsupportedWhereError(`unsupported scalar filter: ${JSON.stringify(cond)}`);
  }
  for (const k of keys) {
    const c = (cond as any)[k];
    switch (k) {
      case 'mode':
        break;
      case 'equals':
        if (value !== c) return false;
        break;
      case 'not':
        if (typeof c === 'object' && c !== null) {
          if (matchScalar(value, c)) return false;
        } else if (value === c) return false;
        break;
      case 'in':
        if (!Array.isArray(c) || !c.includes(value)) return false;
        break;
      case 'notIn':
        if (Array.isArray(c) && c.includes(value)) return false;
        break;
      case 'lt':
        if (!(value < c)) return false;
        break;
      case 'lte':
        if (!(value <= c)) return false;
        break;
      case 'gt':
        if (!(value > c)) return false;
        break;
      case 'gte':
        if (!(value >= c)) return false;
        break;
      case 'contains':
        if (typeof value !== 'string' || !value.includes(String(c))) return false;
        break;
      case 'startsWith':
        if (typeof value !== 'string' || !value.startsWith(String(c))) return false;
        break;
      case 'endsWith':
        if (typeof value !== 'string' || !value.endsWith(String(c))) return false;
        break;
      default:
        return false;
    }
  }
  return true;
}

export function matchWhere(row: Row, where: any): boolean {
  if (!where || typeof where !== 'object') return true;
  for (const [key, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    if (key === 'AND') {
      const list = Array.isArray(cond) ? cond : [cond];
      if (!list.every((w) => matchWhere(row, w))) return false;
      continue;
    }
    if (key === 'OR') {
      const list = Array.isArray(cond) ? cond : [cond];
      if (list.length > 0 && !list.some((w) => matchWhere(row, w))) return false;
      continue;
    }
    if (key === 'NOT') {
      const list = Array.isArray(cond) ? cond : [cond];
      if (list.some((w) => matchWhere(row, w))) return false;
      continue;
    }
    // A compound-unique key such as `connectionId_externalId`.
    if (key.includes('_') && cond && typeof cond === 'object' && !Array.isArray(cond)) {
      const parts = key.split('_');
      if (parts.every((p) => p in (cond as Row))) {
        if (!parts.every((p) => row[p] === (cond as Row)[p])) return false;
        continue;
      }
    }
    // A to-many relation filter: `{ playlistItems: { some: { … } } }`. The
    // fixture must declare the relation as an array, so an unmodelled relation
    // still raises rather than quietly matching.
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      const ck = Object.keys(cond);
      if (ck.length > 0 && ck.every((k) => k === 'some' || k === 'every' || k === 'none')) {
        const related = row[key];
        if (!Array.isArray(related)) {
          throw new UnsupportedWhereError(`relation filter on '${key}' but the fixture has no array there`);
        }
        for (const k of ck) {
          const sub = (cond as any)[k];
          const matches = related.filter((r: Row) => matchWhere(r, sub));
          if (k === 'some' && matches.length === 0) return false;
          if (k === 'none' && matches.length > 0) return false;
          if (k === 'every' && matches.length !== related.length) return false;
        }
        continue;
      }
    }

    if (!(key in row)) {
      // Filtering on a column the fixture does not carry. Treat a plain value
      // as a non-match (the row genuinely lacks it) rather than a match.
      if (cond === null) continue;
      if (typeof cond === 'object') {
        throw new UnsupportedWhereError(`filter on unmodelled column '${key}'`);
      }
      return false;
    }
    if (!matchScalar(row[key], cond)) return false;
  }
  return true;
}

function applyData(row: Row, data: Row): Row {
  const next = { ...row };
  for (const [k, v] of Object.entries(data || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      if ('increment' in v) {
        next[k] = (next[k] ?? 0) + (v as any).increment;
        continue;
      }
      if ('set' in v) {
        next[k] = (v as any).set;
        continue;
      }
      if ('create' in v || 'connect' in v || 'deleteMany' in v) continue; // nested writes: ignored
    }
    next[k] = v;
  }
  return next;
}

export interface TwoTenantPrisma {
  /** The object the app sees as `prisma.client`. */
  client: any;
  /** Every row this run handed back or mutated, in order. */
  touched: TouchRecord[];
  /** Rows touched that belong to a tenant other than `homeTenantId`. */
  foreignTouches(homeTenantId: string): TouchRecord[];
  reset(): void;
}

/**
 * Build the double over a mutable copy of `dataset`. Model accessors are
 * created lazily, so a controller reaching for a model the fixture never seeded
 * gets an empty table instead of a TypeError — which is the right default: an
 * empty table can never be the source of a cross-tenant leak.
 */
export function makeTwoTenantPrisma(dataset: Dataset): TwoTenantPrisma {
  const tables: Dataset = {};
  for (const [model, rows] of Object.entries(dataset)) tables[model] = rows.map((r) => ({ ...r }));

  const touched: TouchRecord[] = [];
  const record = (model: string, method: string, rows: Row[] | Row | null) => {
    const list = rows == null ? [] : Array.isArray(rows) ? rows : [rows];
    for (const r of list) {
      if (!r || typeof r !== 'object') continue;
      touched.push({
        model,
        method,
        rowId: r.id,
        tenantId: tenantOf(model, r),
        isWrite: WRITE_METHODS.has(method),
      });
    }
  };

  const table = (model: string): Row[] => (tables[model] ??= []);

  const modelApi = (model: string) => ({
    findUnique: async ({ where }: any = {}) => {
      const hit = table(model).find((r) => matchWhere(r, where)) ?? null;
      record(model, 'findUnique', hit);
      return hit;
    },
    findUniqueOrThrow: async ({ where }: any = {}) => {
      const hit = table(model).find((r) => matchWhere(r, where));
      if (!hit) throw new RecordNotFoundError(model);
      record(model, 'findUniqueOrThrow', hit);
      return hit;
    },
    findFirst: async ({ where }: any = {}) => {
      const hit = table(model).find((r) => matchWhere(r, where)) ?? null;
      record(model, 'findFirst', hit);
      return hit;
    },
    findMany: async ({ where, take }: any = {}) => {
      let hits = table(model).filter((r) => matchWhere(r, where));
      if (typeof take === 'number') hits = hits.slice(0, take);
      record(model, 'findMany', hits);
      return hits;
    },
    count: async ({ where }: any = {}) => table(model).filter((r) => matchWhere(r, where)).length,
    create: async ({ data }: any = {}) => {
      const row = { id: data?.id ?? `new-${model}-${table(model).length + 1}`, ...data };
      table(model).push(row);
      return row;
    },
    createMany: async ({ data }: any = {}) => {
      const list = Array.isArray(data) ? data : [data];
      for (const d of list) table(model).push({ id: `new-${model}-${table(model).length + 1}`, ...d });
      return { count: list.length };
    },
    update: async ({ where, data }: any = {}) => {
      const rows = table(model);
      const i = rows.findIndex((r) => matchWhere(r, where));
      if (i < 0) throw new RecordNotFoundError(model);
      record(model, 'update', rows[i]);
      rows[i] = applyData(rows[i], data);
      return rows[i];
    },
    updateMany: async ({ where, data }: any = {}) => {
      const rows = table(model);
      let count = 0;
      for (let i = 0; i < rows.length; i++) {
        if (!matchWhere(rows[i], where)) continue;
        record(model, 'updateMany', rows[i]);
        rows[i] = applyData(rows[i], data);
        count++;
      }
      return { count };
    },
    upsert: async ({ where, create, update }: any = {}) => {
      const rows = table(model);
      const i = rows.findIndex((r) => matchWhere(r, where));
      if (i >= 0) {
        record(model, 'upsert', rows[i]);
        rows[i] = applyData(rows[i], update);
        return rows[i];
      }
      const row = { id: `new-${model}-${rows.length + 1}`, ...create };
      rows.push(row);
      return row;
    },
    delete: async ({ where }: any = {}) => {
      const rows = table(model);
      const i = rows.findIndex((r) => matchWhere(r, where));
      if (i < 0) throw new RecordNotFoundError(model);
      record(model, 'delete', rows[i]);
      return rows.splice(i, 1)[0];
    },
    deleteMany: async ({ where }: any = {}) => {
      const rows = table(model);
      const doomed = rows.filter((r) => matchWhere(r, where));
      record(model, 'deleteMany', doomed);
      tables[model] = rows.filter((r) => !matchWhere(r, where));
      return { count: doomed.length };
    },
    aggregate: async () => ({ _count: 0, _sum: {}, _avg: {}, _min: {}, _max: {} }),
    /**
     * A REAL groupBy: it evaluates `where` against the table and buckets what
     * survives, so a handler that forgot `tenantId` genuinely counts the other
     * tenant's rows (and the touch detector sees them).
     *
     * This used to be `async () => []`, which is why analytics sat in
     * DOCUMENTED_GAPS: against a stub that always answers "no rows", an
     * "analytics never leaks" assertion passes whether or not the query is
     * scoped. An empty stub is the most dangerous kind of test double —
     * indistinguishable from a correct answer, for exactly the shape of query
     * this suite exists to interrogate.
     *
     * Supports what the app actually uses: `by` (one or more scalar fields),
     * `where`, and `_count` (both the `{ _all: true }` object form and the
     * bare-`true` form). Anything else stays unsupported ON PURPOSE — a double
     * that guesses is how a suite starts proving something other than the
     * production query.
     */
    groupBy: async ({ by, where, _count }: any = {}) => {
      const fields: string[] = Array.isArray(by) ? by : by ? [by] : [];
      if (!fields.length) throw new UnsupportedWhereError(`${model}.groupBy without \`by\``);
      const hits = table(model).filter((r) => matchWhere(r, where));
      record(model, 'groupBy', hits);

      const buckets = new Map<string, { key: Row; n: number }>();
      for (const row of hits) {
        const key: Row = {};
        for (const f of fields) key[f] = row[f];
        const k = JSON.stringify(fields.map((f) => row[f] ?? null));
        const seen = buckets.get(k);
        if (seen) seen.n += 1;
        else buckets.set(k, { key, n: 1 });
      }

      return [...buckets.values()].map(({ key, n }) => {
        const out: Row = { ...key };
        if (_count === true) out._count = n;
        else if (_count && typeof _count === 'object') {
          out._count = Object.fromEntries(Object.keys(_count).map((k) => [k, n]));
        }
        return out;
      });
    },
  });

  const modelCache = new Map<string, any>();
  const client: any = new Proxy(
    {
      $transaction: async (arg: any) => {
        if (typeof arg === 'function') return arg(client);
        return Promise.all(arg);
      },
      $queryRaw: async () => [],
      $queryRawUnsafe: async () => [],
      $executeRaw: async () => 0,
      $executeRawUnsafe: async () => 0,
      $use: () => undefined,
    },
    {
      get(target, prop: string) {
        if (prop in target) return (target as any)[prop];
        if (typeof prop !== 'string') return undefined;
        if (!modelCache.has(prop)) modelCache.set(prop, modelApi(prop));
        return modelCache.get(prop);
      },
    },
  );

  return {
    client,
    touched,
    foreignTouches(homeTenantId: string) {
      return touched.filter((t) => typeof t.tenantId === 'string' && t.tenantId !== homeTenantId);
    },
    reset() {
      touched.length = 0;
    },
  };
}
