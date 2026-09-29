/**
 * ROUTE GUARD INVENTORY (2026-09-29). Any route that says who may call it must
 * be behind the guard that finds out who is calling.
 *
 * THE DEFECT. `DELETE /api/v1/screens/:id` shipped without `@UseGuards(JwtAuthGuard,
 * RbacGuard)` for ten days. The 2026-09-19 double-sided-displays commit inserted
 * a new method between the guard line and `@Delete(':id')`, so the guard stayed
 * with the comment block it sat under and the delete handler lost it. Nothing
 * failed to compile, nothing failed a test — `@RequireRoles(...)` is only
 * METADATA, read by `RbacGuard`, and with no guard on the route it was never
 * read. `req.user` was never set, so every delete died on `req.user.tenantId`
 * with a 500: no one could remove a screen, and an operator who tried ("Trying to
 * remove and add again") was left with a screen that would not go away.
 *
 * WHY THIS IS A SCAN AND NOT ONE TEST. The controller has ~150 routes and each
 * carries its own `@UseGuards`. A single regression test would pin this one
 * route; the failure is a decorator quietly separating from the method it
 * belonged to, which can happen to any of them. So every controller under
 * `apps/api/src` is parsed, and any route handler that
 *   (a) declares `@RequireRoles(...)` — the route says a role is required, or
 *   (b) reads `req.user` — the route needs an authenticated principal,
 * must have `JwtAuthGuard` in a `@UseGuards(...)` on the method or the class.
 *
 * Device-authenticated routes (`verifyDeviceForScreen`) neither declare roles nor
 * read `req.user`, so they are not caught here; they have their own inventory
 * (`screens/device-route-inventory.spec.ts`).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const API_SRC = path.resolve(__dirname, '..');
const ROUTE_DECORATORS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'All', 'Head', 'Options']);

interface Violation {
  where: string;
  why: 'declares-roles' | 'reads-req-user';
}

const decoratorOf = (d: ts.Decorator): { name: string; args: string[] } => {
  const e = d.expression;
  return ts.isCallExpression(e)
    ? { name: e.expression.getText(), args: e.arguments.map((a) => a.getText()) }
    : { name: e.getText(), args: [] };
};

/** Every route handler in one source file that needs a principal but is not behind JwtAuthGuard. */
export function findUnguardedRoutes(fileName: string, text: string): { routes: number; violations: Violation[] } {
  const src = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const violations: Violation[] = [];
  let routes = 0;
  const visit = (n: ts.Node): void => {
    if (ts.isClassDeclaration(n)) {
      const classDecorators = (ts.getDecorators(n) ?? []).map(decoratorOf);
      const classGuards = classDecorators.filter((d) => d.name === 'UseGuards').flatMap((d) => d.args).join(' ');
      const classRoles = classDecorators.some((d) => d.name === 'RequireRoles');
      for (const m of n.members) {
        if (!ts.isMethodDeclaration(m)) continue;
        const decorators = (ts.getDecorators(m) ?? []).map(decoratorOf);
        if (!decorators.some((d) => ROUTE_DECORATORS.has(d.name))) continue;
        routes += 1;
        const methodGuards = decorators.filter((d) => d.name === 'UseGuards').flatMap((d) => d.args).join(' ');
        if (/\bJwtAuthGuard\b/.test(`${classGuards} ${methodGuards}`)) continue;
        const where = `${path.basename(fileName)} :: ${n.name?.text ?? '(anonymous)'}.${m.name.getText()}`;
        if (classRoles || decorators.some((d) => d.name === 'RequireRoles')) {
          violations.push({ where, why: 'declares-roles' });
        } else if (/\b(?:req|request)\.user\b/.test(m.getText())) {
          violations.push({ where, why: 'reads-req-user' });
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return { routes, violations };
}

function controllerFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) controllerFiles(p, out);
    else if (/\.controller\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('route guard inventory', () => {
  it('the scanner catches the regression it exists for (a route with roles and no guard) and passes the guarded shape', () => {
    const broken = `
      @Controller('x')
      export class C {
        @Put(':id/a') @UseGuards(JwtAuthGuard, RbacGuard) @RequireRoles(AppRole.SUPER_ADMIN)
        async a() {}

        @Delete(':id') @RequireRoles(AppRole.SUPER_ADMIN)
        async remove(@Request() req: any) { return req.user.tenantId; }

        @Get('open') async open() { return 1; }

        @Get('who') async who(@Request() req: any) { return req.user.id; }
      }`;
    const { routes, violations } = findUnguardedRoutes('c.controller.ts', broken);
    expect(routes).toBe(4);
    expect(violations).toEqual([
      { where: 'c.controller.ts :: C.remove', why: 'declares-roles' },
      { where: 'c.controller.ts :: C.who', why: 'reads-req-user' },
    ]);
  });

  it('a class-level guard covers every method of the class', () => {
    const src = `
      @Controller('x') @UseGuards(JwtAuthGuard, RbacGuard)
      export class C {
        @Delete(':id') @RequireRoles(AppRole.SUPER_ADMIN)
        async remove(@Request() req: any) { return req.user.tenantId; }
      }`;
    expect(findUnguardedRoutes('c.controller.ts', src).violations).toEqual([]);
  });

  it('EVERY controller in the API: no route declares roles or reads req.user without JwtAuthGuard', () => {
    const files = controllerFiles(API_SRC);
    let routes = 0;
    const violations: Violation[] = [];
    for (const f of files) {
      const r = findUnguardedRoutes(f, fs.readFileSync(f, 'utf8'));
      routes += r.routes;
      violations.push(...r.violations);
    }
    // The scan must actually have looked at the API (a wrong path would pass vacuously).
    expect(files.length).toBeGreaterThan(50);
    expect(routes).toBeGreaterThan(400);
    expect(violations).toEqual([]);
  });
});
