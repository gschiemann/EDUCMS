/**
 * WHO WRITES `EmergencyMessage`, AND DO THEY SAY SO?
 *
 * `device-messages-rev.ts` lets the device poll answer "nothing changed"
 * from memory. That is only true while every write to `emergency_messages`
 * moves the tenant emergency epoch AFTER it has committed. Today five writers
 * exist, all in `emergency.controller.ts`, and all five do. This file is what
 * stops a sixth from arriving quietly: a new write anywhere in `apps/api/src`
 * fails here until it sits in an awaited statement of a handler that calls
 * `bumpTenantEmergencyEpoch` afterwards.
 *
 * It reads source, not behaviour, on purpose - the failure it guards against
 * is a line that was never written, which no behavioural test of the existing
 * writers can see. The checker is run against deliberately wrong sources
 * first, so a checker that passes everything cannot pass this file.
 *
 * THE OTHER HALF OF THE ANSWER is two columns of the screen's own `Tenant`
 * row, `emergencyStatus` and `emergencyPlaylistId`. They are written by the
 * trigger, the all-clear and the "a live alert ends a drill" path, all in the
 * same controller, and each of those moves the tenant's revision (the 2026-10-26
 * notes beside them say why, at length). The second half of this file pins
 * that no other file updates either column.
 *
 * The bound if this guard is ever wrong or bypassed (raw SQL from a console,
 * a one-off script): `DEVICE_MESSAGES_RECORD_MAX_AGE_MS`, one minute, on the
 * polling tier only.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const API_SRC = path.resolve(__dirname, '..');
const CONTROLLER = 'emergency/emergency.controller.ts';

const WRITE_CALLEE =
  /(^|\.)emergencyMessage\s*\.\s*(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)$/;
const WRITE_TEXT =
  /\bemergencyMessage\s*\.\s*(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\s*\(/;
const RAW_SQL_WRITE =
  /\b(insert\s+into|update|delete\s+from)\s+"?(public"?\.)?"?emergency_messages\b/i;

function productionSources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      productionSources(full, out);
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.world.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

const isFunctionLike = (n: ts.Node): boolean =>
  ts.isArrowFunction(n) ||
  ts.isFunctionExpression(n) ||
  ts.isFunctionDeclaration(n) ||
  ts.isMethodDeclaration(n);

/**
 * Every `emergencyMessage.<write>(...)` in `text` that is NOT provably
 * followed by a `bumpTenantEmergencyEpoch(...)` in the same class method.
 *
 * "Provably": the write sits under an `await` that belongs to the method
 * itself (not to a callback inside it), so the statement holding that await
 * has finished - the transaction has committed - before the next statement
 * runs; and a bump call starts after that statement ends.
 */
function unsignalledMessageWrites(fileName: string, text: string): string[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const problems: string[] = [];
  const lineOf = (n: ts.Node) =>
    sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      WRITE_CALLEE.test(node.expression.getText(sf).replace(/\s+/g, ''))
    ) {
      const where = `${fileName}:${lineOf(node)}`;

      let method: ts.MethodDeclaration | undefined;
      for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
        if (ts.isMethodDeclaration(p)) {
          method = p;
          break;
        }
      }
      if (!method) {
        problems.push(`${where} - the write is not inside a class method`);
      } else {
        // The await that belongs to the method itself: the first `await`
        // ancestor with no function boundary between it and the method.
        let awaited: ts.AwaitExpression | undefined;
        for (
          let p: ts.Node | undefined = node.parent;
          p && p !== method;
          p = p.parent
        ) {
          if (!ts.isAwaitExpression(p)) continue;
          let owned = true;
          for (
            let q: ts.Node | undefined = p.parent;
            q && q !== method;
            q = q.parent
          ) {
            if (isFunctionLike(q)) {
              owned = false;
              break;
            }
          }
          if (owned) {
            awaited = p;
            break;
          }
        }
        if (!awaited) {
          problems.push(
            `${where} - the write is not awaited by its own handler, so nothing can be said to follow its commit`,
          );
        } else {
          let statement: ts.Node = awaited;
          while (
            statement.parent &&
            !ts.isBlock(statement.parent) &&
            statement.parent !== method
          ) {
            statement = statement.parent;
          }
          const committedAt = statement.getEnd();
          let signalled = false;
          const findBump = (n: ts.Node): void => {
            if (signalled) return;
            if (
              ts.isCallExpression(n) &&
              n.expression.getText(sf) === 'bumpTenantEmergencyEpoch' &&
              n.getStart(sf) > committedAt
            ) {
              signalled = true;
              return;
            }
            ts.forEachChild(n, findBump);
          };
          findBump(method);
          if (!signalled) {
            problems.push(
              `${where} - no bumpTenantEmergencyEpoch(...) after the statement that commits the write`,
            );
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return problems;
}

// ── The two Tenant columns the poll's answer carries ─────────────────────

const POLLED_TENANT_COLUMNS = new Set([
  'emergencyStatus',
  'emergencyPlaylistId',
]);
const TENANT_UPDATE_CALLEE = /(^|\.)tenant\.(update|updateMany|upsert)$/;
const RAW_SQL_TENANT_ALERT_WRITE =
  /\bupdate\s+"?(public"?\.)?"?(tenants|Tenant)"?\s+set\b[^;`]*emergency(Status|PlaylistId|_status|_playlist_id)/i;

const unwrap = (n: ts.Expression): ts.Expression => {
  let e = n;
  while (
    ts.isAsExpression(e) ||
    ts.isParenthesizedExpression(e) ||
    ts.isSatisfiesExpression(e) ||
    ts.isNonNullExpression(e)
  ) {
    e = e.expression;
  }
  return e;
};

/**
 * Every `tenant.update / updateMany / upsert` in `text` whose written data
 * names one of the polled columns. The data is the `data` property (for an
 * upsert, `update`) of the call's argument: an object literal, or a variable
 * of this file that was initialised with one (`data: clearedState`), followed
 * through spreads. `select: { emergencyStatus: true }` and a `where` filter
 * are not writes and are not reported.
 */
function tenantAlertColumnWrites(fileName: string, text: string): string[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const lineOf = (n: ts.Node) =>
    sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const literals = new Map<string, ts.ObjectLiteralExpression[]>();
  const collect = (n: ts.Node): void => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer
    ) {
      const init = unwrap(n.initializer);
      if (ts.isObjectLiteralExpression(init)) {
        literals.set(n.name.text, [...(literals.get(n.name.text) ?? []), init]);
      }
    }
    ts.forEachChild(n, collect);
  };
  collect(sf);

  const namesPolledColumn = (root: ts.Node): boolean => {
    const followed = new Set<string>();
    let found = false;
    const walk = (n: ts.Node): void => {
      if (found) return;
      if (
        ts.isPropertyAssignment(n) &&
        POLLED_TENANT_COLUMNS.has(n.name.getText(sf).replace(/['"]/g, ''))
      ) {
        found = true;
        return;
      }
      if (
        ts.isShorthandPropertyAssignment(n) &&
        POLLED_TENANT_COLUMNS.has(n.name.text)
      ) {
        found = true;
        return;
      }
      if (ts.isIdentifier(n) && literals.has(n.text) && !followed.has(n.text)) {
        followed.add(n.text);
        for (const lit of literals.get(n.text) ?? []) walk(lit);
      }
      ts.forEachChild(n, walk);
    };
    walk(root);
    return found;
  };

  const problems: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      TENANT_UPDATE_CALLEE.test(node.expression.getText(sf).replace(/\s+/g, ''))
    ) {
      const arg = node.arguments[0] ? unwrap(node.arguments[0]) : undefined;
      const written: ts.Node[] = [];
      if (arg && ts.isObjectLiteralExpression(arg)) {
        for (const prop of arg.properties) {
          const name = prop.name ? prop.name.getText(sf) : '';
          if (name === 'data' || name === 'update') written.push(prop);
        }
      } else if (arg) {
        // The whole argument is built elsewhere: look at all of it.
        written.push(arg);
      }
      if (written.some(namesPolledColumn)) {
        problems.push(
          `${fileName}:${lineOf(node)} - updates Tenant.emergencyStatus / emergencyPlaylistId`,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return problems;
}

const klass = (body: string) => `class C {\n${body}\n}\n`;

describe('the checker itself (negative controls)', () => {
  it('accepts the shape the real writers use', () => {
    const src = klass(`
  async broadcast(ids: string[]) {
    await this.prisma.client.$transaction([
      ...ids.map((tid) => this.prisma.client.emergencyMessage.create({ data: { tenantId: tid } })),
      this.prisma.client.auditLog.create({ data: {} }),
    ]);
    for (const tid of ids) {
      bumpTenantEmergencyEpoch({ redis: this.redisService }, tid);
    }
  }`);
    expect(unsignalledMessageWrites('ok.ts', src)).toEqual([]);
  });

  it('accepts a single awaited write followed by a bump', () => {
    const src = klass(`
  async clear(id: string) {
    await this.prisma.client.emergencyMessage.updateMany({ where: { id }, data: { clearedAt: new Date() } });
    bumpTenantEmergencyEpoch({ redis: this.redisService }, 't');
  }`);
    expect(unsignalledMessageWrites('ok.ts', src)).toEqual([]);
  });

  it('refuses a write with no bump at all', () => {
    const src = klass(`
  async sos() {
    await this.prisma.client.$transaction([this.prisma.client.emergencyMessage.create({ data: {} })]);
    await this.redisService.publish('c', 'm');
  }`);
    expect(unsignalledMessageWrites('bad.ts', src)).toEqual([
      expect.stringContaining('no bumpTenantEmergencyEpoch'),
    ]);
  });

  it('refuses a bump that only happens BEFORE the commit', () => {
    const src = klass(`
  async sos() {
    bumpTenantEmergencyEpoch({ redis: this.redisService }, 't');
    await this.prisma.client.$transaction([this.prisma.client.emergencyMessage.create({ data: {} })]);
  }`);
    expect(unsignalledMessageWrites('bad.ts', src)).toEqual([
      expect.stringContaining('no bumpTenantEmergencyEpoch'),
    ]);
  });

  it('refuses a bump in a different method', () => {
    const src = klass(`
  async sos() {
    await this.prisma.client.emergencyMessage.create({ data: {} });
  }
  async other() {
    bumpTenantEmergencyEpoch({ redis: this.redisService }, 't');
  }`);
    expect(unsignalledMessageWrites('bad.ts', src)).toEqual([
      expect.stringContaining('no bumpTenantEmergencyEpoch'),
    ]);
  });

  it('refuses a fire-and-forget write', () => {
    const src = klass(`
  async sos() {
    void this.prisma.client.emergencyMessage.create({ data: {} });
    bumpTenantEmergencyEpoch({ redis: this.redisService }, 't');
  }`);
    expect(unsignalledMessageWrites('bad.ts', src)).toEqual([
      expect.stringContaining('not awaited by its own handler'),
    ]);
  });

  it('refuses a write awaited only inside a callback', () => {
    const src = klass(`
  async sos(ids: string[]) {
    ids.forEach(async (tid) => {
      await this.prisma.client.emergencyMessage.create({ data: { tenantId: tid } });
    });
    bumpTenantEmergencyEpoch({ redis: this.redisService }, 't');
  }`);
    expect(unsignalledMessageWrites('bad.ts', src)).toEqual([
      expect.stringContaining('not awaited by its own handler'),
    ]);
  });

  it('refuses a write outside any method', () => {
    const src = `async function helper(prisma: any) {\n  await prisma.emergencyMessage.deleteMany({});\n}\n`;
    expect(unsignalledMessageWrites('bad.ts', src)).toEqual([
      expect.stringContaining('not inside a class method'),
    ]);
  });

  it('sees every write verb', () => {
    for (const verb of [
      'create',
      'createMany',
      'createManyAndReturn',
      'update',
      'updateMany',
      'upsert',
      'delete',
      'deleteMany',
    ]) {
      const src = klass(`
  async w() {
    await this.prisma.client.emergencyMessage.${verb}({});
  }`);
      expect(unsignalledMessageWrites('bad.ts', src)).toHaveLength(1);
    }
  });

  it('ignores reads', () => {
    const src = klass(`
  async r() {
    return this.prisma.client.emergencyMessage.findMany({});
  }`);
    expect(unsignalledMessageWrites('ok.ts', src)).toEqual([]);
  });
});

describe('every writer of emergency_messages in apps/api/src', () => {
  const files = productionSources(API_SRC);
  const rel = (f: string) =>
    path.relative(API_SRC, f).split(path.sep).join('/');

  it('found the sources at all', () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files.map(rel)).toContain(CONTROLLER);
  });

  it('lives in the emergency controller and nowhere else', () => {
    const writers = files
      .filter((f) => WRITE_TEXT.test(fs.readFileSync(f, 'utf8')))
      .map(rel);
    // A new entry here needs the same care as the five that exist: commit,
    // then bumpTenantEmergencyEpoch for EVERY tenant a row was written under.
    expect(writers).toEqual([CONTROLLER]);
  });

  it('never goes around the ORM', () => {
    const raw = files
      .filter((f) => RAW_SQL_WRITE.test(fs.readFileSync(f, 'utf8')))
      .map(rel);
    expect(raw).toEqual([]);
  });

  it('commits first and bumps the tenant emergency epoch afterwards, every time', () => {
    const text = fs.readFileSync(path.join(API_SRC, CONTROLLER), 'utf8');
    const count = (text.match(new RegExp(WRITE_TEXT.source, 'g')) || []).length;
    // SOS, broadcast, media alert, hand-picked screens, message all-clear.
    expect(count).toBe(5);
    expect(unsignalledMessageWrites(CONTROLLER, text)).toEqual([]);
  });
});

describe('the tenant-column checker itself (negative controls)', () => {
  it('sees a direct write, a write through a variable, a spread, a shorthand and an upsert', () => {
    const direct = klass(`
  async a(id: string) {
    await this.prisma.client.tenant.update({ where: { id }, data: { emergencyStatus: 'INACTIVE' } });
  }`);
    const viaVariable = klass(`
  async b(ids: string[]) {
    const cleared = { emergencyStatus: 'INACTIVE', emergencyPlaylistId: null } as any;
    await this.prisma.client.$transaction([
      this.prisma.client.tenant.updateMany({ where: { id: { in: ids } }, data: cleared }),
    ]);
  }`);
    const viaSpread = klass(`
  async c(id: string) {
    const base = { emergencyPlaylistId: null };
    await tx.tenant.update({ where: { id }, data: { ...base, name: 'x' } });
  }`);
    const shorthand = klass(`
  async d(id: string, emergencyStatus: string) {
    await (this.prisma.client as any).tenant.update({ where: { id }, data: { emergencyStatus } });
  }`);
    const upsert = klass(`
  async e(id: string) {
    await this.prisma.client.tenant.upsert({ where: { id }, create: { name: 'n' }, update: { emergencyStatus: 'INACTIVE' } });
  }`);
    for (const src of [direct, viaVariable, viaSpread, shorthand, upsert]) {
      expect(tenantAlertColumnWrites('bad.ts', src)).toHaveLength(1);
    }
  });

  it('ignores a read, a select, a where filter and a write of other columns', () => {
    const src = klass(`
  async r(id: string) {
    await this.prisma.client.tenant.findUnique({ where: { id }, select: { emergencyStatus: true, emergencyPlaylistId: true } });
    await this.prisma.client.tenant.update({ where: { id }, data: { name: 'x' }, select: { emergencyStatus: true } });
    await this.prisma.client.tenant.updateMany({ where: { emergencyStatus: 'INACTIVE' }, data: { name: 'y' } });
    const body = { emergencyStatus: 'INACTIVE' };
    return body;
  }`);
    expect(tenantAlertColumnWrites('ok.ts', src)).toEqual([]);
  });
});

describe('every writer of the two Tenant columns the poll reads', () => {
  const files = productionSources(API_SRC);
  const rel = (f: string) =>
    path.relative(API_SRC, f).split(path.sep).join('/');

  it('lives in the emergency controller and nowhere else', () => {
    const writers = files
      .filter(
        (f) =>
          tenantAlertColumnWrites(rel(f), fs.readFileSync(f, 'utf8')).length >
          0,
      )
      .map(rel);
    // A new entry here must move the tenant's revision AFTER its commit, the
    // way the trigger and the all-clear do: invalidateTenantState(tenantId)
    // and bumpTenantEmergencyEpoch(..., tenantId) for every tenant it wrote.
    expect(writers).toEqual([CONTROLLER]);
  });

  it('is seen in the controller itself (the checker is not blind to the real writers)', () => {
    const text = fs.readFileSync(path.join(API_SRC, CONTROLLER), 'utf8');
    // A live alert ending a drill, the trigger, and the all-clear's three
    // statements (a drill's, a live one's, the descendants'). A sixth needs
    // the same care: invalidateTenantState and the epoch bump after its commit.
    expect(tenantAlertColumnWrites(CONTROLLER, text)).toHaveLength(5);
  });

  it('never goes around the ORM', () => {
    const raw = files
      .filter((f) =>
        RAW_SQL_TENANT_ALERT_WRITE.test(fs.readFileSync(f, 'utf8')),
      )
      .map(rel);
    expect(raw).toEqual([]);
  });
});
