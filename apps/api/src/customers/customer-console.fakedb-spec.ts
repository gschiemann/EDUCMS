/**
 * In-memory database for the customer-console specs (named `*-spec.ts` so it is neither a jest
 * suite nor part of the production build).
 *
 * It behaves like the real one where these specs depend on it:
 *   - `$transaction(fn)` snapshots state and RESTORES it if `fn` throws (a real rollback), so an
 *     audit row written inside a failed transaction does not survive;
 *   - `user.email`, `tenant.slug`, `userInvite.tokenHash`, `userInvite.userId` and
 *     `customerInvoice.number` are unique (P2002 on a clash);
 *   - `update({ where: { id, tenantId } })` refuses a row of another tenant (P2025), like Prisma's
 *     extended-where unique update.
 * It ignores `select` (rows come back whole, plus the relations the code asks for).
 */
import { randomUUID } from 'crypto';

type Row = Record<string, any>;
interface State {
  tenants: Row[];
  licenses: Row[];
  screens: Row[];
  invoices: Row[];
  users: Row[];
  invites: Row[];
  audit: Row[];
  branding: Row[];
}

const p2002 = (field: string) => Object.assign(new Error(`Unique constraint failed on ${field}`), { code: 'P2002' });
const p2025 = () => Object.assign(new Error('Record to update not found.'), { code: 'P2025' });

function cmp(value: any, cond: any): boolean {
  if (cond === null) return value === null || value === undefined;
  if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime();
  if (typeof cond !== 'object') return value === cond;
  for (const [op, arg] of Object.entries(cond)) {
    switch (op) {
      case 'not':
        if (arg === null ? value === null || value === undefined : value === arg) return false;
        break;
      case 'in':
        if (!(arg as any[]).includes(value)) return false;
        break;
      case 'endsWith':
        if (typeof value !== 'string' || !value.endsWith(arg as string)) return false;
        break;
      case 'startsWith':
        if (typeof value !== 'string' || !value.startsWith(arg as string)) return false;
        break;
      case 'gt':
        if (!(value instanceof Date) || value.getTime() <= (arg as Date).getTime()) return false;
        break;
      default:
        return false;
    }
  }
  return true;
}

export function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [k, cond] of Object.entries(where)) {
    if (k === 'OR') {
      if (!(cond as Row[]).some((c) => matches(row, c))) return false;
    } else if (k === 'NOT') {
      if (matches(row, cond)) return false;
    } else if (!cmp(row[k], cond)) return false;
  }
  return true;
}

export class FakeDb {
  s: State = { tenants: [], licenses: [], screens: [], invoices: [], users: [], invites: [], audit: [], branding: [] };
  transactions = 0;

  addTenant(t: Partial<Row> & { id: string; name: string }): Row {
    const row = { parentId: null, slug: t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), vertical: 'K12', createdAt: new Date('2026-01-01'), archivedAt: null, ...t };
    this.s.tenants.push(row);
    return row;
  }
  addLicense(l: Partial<Row> & { tenantId: string }): Row {
    const row = {
      id: randomUUID(), tier: 'ANNUAL', status: 'ACTIVE', billingMode: 'INVOICE', seatLimit: 10, monthlyPriceCents: 2000,
      stripeSubscriptionId: null, stripeCustomerId: null, currentPeriodEnd: null, expiresAt: null, renewalDate: null,
      poNumber: null, notes: null, suspendedAt: null, suspendReason: null, ...l,
    };
    this.s.licenses.push(row);
    return row;
  }
  addScreens(tenantId: string, n: number, paired = true) {
    for (let i = 0; i < n; i++) this.s.screens.push({ id: randomUUID(), tenantId, pairedAt: paired ? new Date() : null });
  }
  addInvoice(i: Partial<Row> & { tenantId: string; number: string }): Row {
    const row = { id: randomUUID(), amountCents: 10000, currency: 'usd', status: 'SENT', poNumber: null, sentAt: null, dueAt: null, paidAt: null, periodStart: null, periodEnd: null, notes: null, createdAt: new Date(), ...i };
    this.s.invoices.push(row);
    return row;
  }
  addAudit(tenantId: string, createdAt: Date, action = 'SOMETHING') {
    this.s.audit.push({ id: randomUUID(), tenantId, userId: null, action, targetType: 'X', targetId: null, details: null, createdAt });
  }

  private withLicense = (t: Row | undefined, depth = 3): Row | null => {
    if (!t) return null;
    const license = this.s.licenses.find((l) => l.tenantId === t.id) ?? null;
    const parent = depth > 0 && t.parentId ? this.withLicense(this.s.tenants.find((p) => p.id === t.parentId), depth - 1) : null;
    return { ...t, license, parent };
  };

  get client(): any {
    const db = this;
    const s = () => db.s;
    const now = () => new Date();
    const uniqueCheck = (rows: Row[], row: Row, fields: string[], selfId?: string) => {
      for (const f of fields) {
        if (row[f] == null) continue;
        if (rows.some((r) => r.id !== selfId && r[f] != null && r[f] === row[f])) throw p2002(f);
      }
    };
    const updateRow = (rows: Row[], where: Row, data: Row, uniques: string[]) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw p2025();
      const next = { ...row, ...data };
      uniqueCheck(rows, next, uniques, row.id);
      Object.assign(row, data, { updatedAt: now() });
      return { ...row };
    };
    return {
      tenant: {
        findMany: async ({ where }: any = {}) => s().tenants.filter((t) => matches(t, where)).map((t) => db.withLicense(t, 0)),
        findUnique: async ({ where }: any) => {
          const t = s().tenants.find((r) => (where.id ? r.id === where.id : r.slug === where.slug));
          return t ? db.withLicense(t) : null;
        },
        create: async ({ data }: any) => {
          const row = { id: randomUUID(), parentId: null, createdAt: now(), archivedAt: null, ...data };
          uniqueCheck(s().tenants, row, ['slug']);
          s().tenants.push(row);
          return { ...row };
        },
      },
      license: {
        findUnique: async ({ where }: any) => s().licenses.find((l) => l.tenantId === where.tenantId) ?? null,
        create: async ({ data }: any) => {
          const row = { id: randomUUID(), stripeSubscriptionId: null, renewalDate: null, poNumber: null, notes: null, suspendedAt: null, suspendReason: null, monthlyPriceCents: null, ...data };
          uniqueCheck(s().licenses, row, ['tenantId']);
          s().licenses.push(row);
          return { ...row };
        },
        update: async ({ where, data }: any) => updateRow(s().licenses, where, data, ['tenantId']),
      },
      screen: {
        groupBy: async ({ where }: any) => {
          const counts = new Map<string, number>();
          for (const sc of s().screens.filter((r) => matches(r, where))) counts.set(sc.tenantId, (counts.get(sc.tenantId) ?? 0) + 1);
          return [...counts].map(([tenantId, n]) => ({ tenantId, _count: { _all: n } }));
        },
        count: async ({ where }: any) => s().screens.filter((r) => matches(r, where)).length,
      },
      customerInvoice: {
        findMany: async ({ where }: any = {}) =>
          s().invoices.filter((r) => matches(r, where)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map((r) => ({ ...r })),
        findFirst: async ({ where }: any) => {
          const r = s().invoices.find((x) => matches(x, where));
          return r ? { ...r } : null;
        },
        create: async ({ data }: any) => {
          const row = { id: randomUUID(), currency: 'usd', createdAt: now(), updatedAt: now(), ...data };
          uniqueCheck(s().invoices, row, ['number']);
          s().invoices.push(row);
          return { ...row };
        },
        update: async ({ where, data }: any) => updateRow(s().invoices, where, data, ['number']),
      },
      user: {
        create: async ({ data }: any) => {
          const row = { id: randomUUID(), deletedAt: null, status: 'ACTIVE', mustSetupCredentials: false, mfaRequired: false, createdAt: now(), ...data };
          uniqueCheck(s().users, row, ['email']);
          s().users.push(row);
          return { ...row };
        },
        findFirst: async ({ where }: any) => s().users.filter((r) => matches(r, where)).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null,
        findMany: async ({ where }: any) => s().users.filter((r) => matches(r, where)).map((r) => ({ ...r })),
        update: async ({ where, data }: any) => updateRow(s().users, where, data, ['email']),
      },
      userInvite: {
        create: async ({ data }: any) => {
          const row = { id: randomUUID(), acceptedAt: null, createdAt: now(), ...data };
          uniqueCheck(s().invites, row, ['tokenHash', 'userId']);
          s().invites.push(row);
          return { ...row };
        },
        findMany: async ({ where }: any) =>
          s().invites
            .filter((r) => matches(r, where))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .map((r) => ({ ...r, user: s().users.find((u) => u.id === r.userId) ?? null })),
        findUnique: async ({ where }: any) => {
          const r = s().invites.find((i) => i.tokenHash === where.tokenHash);
          if (!r) return null;
          return { ...r, user: s().users.find((u) => u.id === r.userId) ?? null, tenant: s().tenants.find((t) => t.id === r.tenantId) ?? null };
        },
        updateMany: async ({ where, data }: any) => {
          const rows = s().invites.filter((r) => matches(r, where));
          rows.forEach((r) => Object.assign(r, data));
          return { count: rows.length };
        },
      },
      auditLog: {
        create: async ({ data }: any) => {
          const row = { id: randomUUID(), createdAt: now(), ...data };
          s().audit.push(row);
          return row;
        },
        findMany: async ({ where }: any) =>
          s().audit.filter((r) => matches(r, where)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map((r) => ({ ...r, user: null })),
      },
      tenantBranding: {
        create: async ({ data }: any) => {
          const row = { id: randomUUID(), ...data };
          s().branding.push(row);
          return row;
        },
        findUnique: async ({ where }: any) => s().branding.find((b) => b.tenantId === where.tenantId) ?? null,
      },
      $queryRaw: async () => {
        // The list's "newest audit row per tenant" probe.
        return s().tenants.map((t) => {
          const rows = s().audit.filter((a) => a.tenantId === t.id);
          const last = rows.length ? new Date(Math.max(...rows.map((a) => a.createdAt.getTime()))) : null;
          return { id: t.id, last };
        });
      },
      $transaction: async (fn: (tx: any) => Promise<any>) => {
        db.transactions += 1;
        const snapshot = structuredClone(db.s);
        try {
          return await fn(db.client);
        } catch (e) {
          db.s = snapshot;
          throw e;
        }
      },
    };
  }
}
