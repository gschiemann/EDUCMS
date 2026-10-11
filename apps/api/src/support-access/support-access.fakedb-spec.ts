/**
 * A tiny in-memory database for the support-access specs: tenants (with a
 * parent chain and `isInternal`), users, grants, audit rows and
 * notifications. `$transaction(cb)` snapshots and rolls back on throw, like
 * the real thing. Named `*-spec.ts` (no `.spec.`) so Jest does not collect it.
 */
let seq = 0;
const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

type Row = Record<string, any>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === 'OR') {
      if (!(v as Row[]).some((w) => matches(row, w))) return false;
      continue;
    }
    if (k === 'AND') {
      if (!(v as Row[]).every((w) => matches(row, w))) return false;
      continue;
    }
    if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) {
      if ('in' in v) {
        if (!(v.in as any[]).includes(row[k])) return false;
        continue;
      }
      if ('not' in v) {
        if (row[k] === v.not) return false;
        continue;
      }
      if ('endsWith' in v) {
        if (typeof row[k] !== 'string' || !row[k].endsWith(v.endsWith)) return false;
        continue;
      }
      if ('startsWith' in v) {
        if (typeof row[k] !== 'string' || !row[k].startsWith(v.startsWith)) return false;
        continue;
      }
      throw new Error(`FakeDb: unsupported operator on ${k}: ${JSON.stringify(v)}`);
    }
    if (row[k] !== v) return false;
  }
  return true;
}

export class SupportFakeDb {
  tenants: Row[] = [];
  users: Row[] = [];
  grants: Row[] = [];
  audit: Row[] = [];
  notifications: Row[] = [];

  addTenant(t: Partial<Row> & { id: string }): Row {
    const row = { name: t.id, slug: t.id, parentId: null, archivedAt: null, isInternal: false, ...t };
    this.tenants.push(row);
    return row;
  }
  addUser(u: Partial<Row> & { id: string; tenantId: string; role: string }): Row {
    const row = { email: `${u.id}@example.com`, status: 'ACTIVE', deletedAt: null, ...u };
    this.users.push(row);
    return row;
  }
  addGrant(g: Partial<Row> & { tenantId: string }): Row {
    const row = {
      id: uid(),
      kind: 'REQUEST',
      status: 'ACTIVE',
      reason: null,
      note: null,
      scopeTenantIds: [],
      requestedDurationMinutes: 60,
      requestedByUserId: null,
      requestedByEmail: null,
      decidedByUserId: null,
      decidedByEmail: null,
      decidedAt: null,
      startsAt: null,
      expiresAt: null,
      revokedByUserId: null,
      revokedByEmail: null,
      revokedAt: null,
      createdAt: new Date('2026-10-11T00:00:00Z'),
      updatedAt: new Date('2026-10-11T00:00:00Z'),
      ...g,
    };
    this.grants.push(row);
    return row;
  }

  private snapshot() {
    return JSON.parse(JSON.stringify({ t: this.tenants, u: this.users, g: this.grants, a: this.audit, n: this.notifications }));
  }
  private restore(s: any) {
    const revive = (rows: Row[]) =>
      rows.map((r) => {
        for (const k of ['createdAt', 'updatedAt', 'decidedAt', 'startsAt', 'expiresAt', 'revokedAt', 'archivedAt']) {
          if (typeof r[k] === 'string') r[k] = new Date(r[k]);
        }
        return r;
      });
    this.tenants = revive(s.t);
    this.users = revive(s.u);
    this.grants = revive(s.g);
    this.audit = revive(s.a);
    this.notifications = revive(s.n);
  }

  get client(): any {
    const db = this;
    const table = (rows: () => Row[]) => ({
      findUnique: async ({ where }: any) => rows().find((r) => matches(r, where)) ?? null,
      findFirst: async ({ where }: any = {}) => rows().find((r) => matches(r, where)) ?? null,
      findMany: async ({ where, orderBy, take }: any = {}) => {
        let out = rows().filter((r) => matches(r, where));
        if (orderBy) {
          const [[k, dir]] = Object.entries(Array.isArray(orderBy) ? orderBy[0] : orderBy) as any;
          out = [...out].sort((a, b) => {
            const av = a[k] instanceof Date ? a[k].getTime() : a[k];
            const bv = b[k] instanceof Date ? b[k].getTime() : b[k];
            return (av > bv ? 1 : av < bv ? -1 : 0) * (dir === 'desc' ? -1 : 1);
          });
        }
        return (take ? out.slice(0, take) : out).map((r) => ({ ...r }));
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const r of rows()) if (matches(r, where)) { Object.assign(r, data); count++; }
        return { count };
      },
    });
    const grants = {
      ...table(() => db.grants),
      create: async ({ data }: any) => db.addGrant({ ...data }),
    };
    const audit = {
      ...table(() => db.audit),
      create: async ({ data }: any) => {
        const row = { id: uid(), createdAt: new Date(), ...data };
        db.audit.push(row);
        return row;
      },
    };
    const notification = {
      upsert: async ({ create }: any) => {
        db.notifications.push({ id: uid(), ...create });
        return create;
      },
      create: async ({ data }: any) => {
        db.notifications.push({ id: uid(), ...data });
        return data;
      },
    };
    const client: any = {
      tenant: table(() => db.tenants),
      user: table(() => db.users),
      supportAccessGrant: grants,
      auditLog: audit,
      notification,
      $transaction: async (cb: any) => {
        const snap = db.snapshot();
        try {
          return await cb(client);
        } catch (e) {
          db.restore(snap);
          throw e;
        }
      },
    };
    return client;
  }
}
