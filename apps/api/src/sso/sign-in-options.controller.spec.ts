/**
 * POST /api/v1/auth/sign-in-options — the identifier-first sign-in lookup.
 *
 * The property this file exists for: the answer is a function of the email's
 * DOMAIN and nothing else. A known and an unknown address at the same domain
 * must be indistinguishable — same bytes, same single query, no read of the
 * users table — or the endpoint is an account oracle.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  SignInOptionsController,
  SignInOptionsSchema,
  providerLabelFor,
} from './sign-in-options.controller';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { AuthController } from '../auth/auth.controller';

interface ConfigRow {
  enabled: boolean;
  provider: string;
  allowedEmailDomain: string | null;
  oidcIssuer: string | null;
  tenant: { slug: string; archivedAt: Date | null };
}

/**
 * A fake Prisma that APPLIES the where clause, so a query that forgot
 * `enabled: true` or the archived filter fails here rather than passing
 * against a stub that returns whatever it was told to.
 *
 * Every other model is a Proxy that throws: touching `user` (or anything else)
 * from this handler is the bug.
 */
function makePrisma(rows: ConfigRow[]) {
  const findMany = jest.fn(async (args: any) => {
    const w = args.where;
    const wanted = String(w.allowedEmailDomain.equals);
    const insensitive = w.allowedEmailDomain.mode === 'insensitive';
    const hits = rows.filter((r) => {
      if (w.enabled !== undefined && r.enabled !== w.enabled) return false;
      if (w.tenant && 'archivedAt' in w.tenant && w.tenant.archivedAt === null && r.tenant.archivedAt !== null) {
        return false;
      }
      if (r.allowedEmailDomain === null) return false;
      return insensitive
        ? r.allowedEmailDomain.toLowerCase() === wanted.toLowerCase()
        : r.allowedEmailDomain === wanted;
    });
    return hits.slice(0, args.take ?? hits.length);
  });
  const client = new Proxy(
    { tenantSSOConfig: { findMany } },
    {
      get(target: any, prop: string) {
        if (prop in target) return target[prop];
        throw new Error(`sign-in-options must not touch prisma.${String(prop)}`);
      },
    },
  );
  return { prisma: { client } as any, findMany };
}

const row = (over: Partial<ConfigRow> = {}): ConfigRow => ({
  enabled: true,
  provider: 'OIDC',
  allowedEmailDomain: 'northfield.example',
  oidcIssuer: 'https://accounts.google.com',
  tenant: { slug: 'northfield', archivedAt: null },
  ...over,
});

const pipe = new ZodValidationPipe(SignInOptionsSchema);
const parse = (body: unknown) => pipe.transform(body, { type: 'body' });

async function ask(rows: ConfigRow[], email: string) {
  const { prisma, findMany } = makePrisma(rows);
  const controller = new SignInOptionsController(prisma);
  const out = await controller.signInOptions(parse({ email }));
  return { out, findMany };
}

describe('POST /auth/sign-in-options', () => {
  it('answers a non-SSO domain with password only', async () => {
    const { out } = await ask([row()], 'someone@elsewhere.example');
    expect(out).toEqual({ password: true, sso: null });
  });

  it('NOT AN ORACLE — any two addresses at one domain get identical bytes from an identical single query', async () => {
    const a = await ask([row()], 'real.person@elsewhere.example');
    const b = await ask([row()], 'nobody-at-all-000@elsewhere.example');
    expect(JSON.stringify(a.out)).toBe(JSON.stringify(b.out));
    expect(a.findMany).toHaveBeenCalledTimes(1);
    expect(b.findMany).toHaveBeenCalledTimes(1);
    // The query itself carries nothing from the local part.
    expect(JSON.stringify(a.findMany.mock.calls[0][0])).toBe(JSON.stringify(b.findMany.mock.calls[0][0]));
    expect(JSON.stringify(a.findMany.mock.calls[0][0])).not.toContain('real.person');

    // Same at an SSO domain.
    const c = await ask([row()], 'real.person@northfield.example');
    const d = await ask([row()], 'nobody-at-all-000@northfield.example');
    expect(JSON.stringify(c.out)).toBe(JSON.stringify(d.out));
    expect(JSON.stringify(c.findMany.mock.calls[0][0])).toBe(JSON.stringify(d.findMany.mock.calls[0][0]));
  });

  it('never reads the users table (source check — no model but tenantSSOConfig is named)', () => {
    const src = fs.readFileSync(path.join(__dirname, 'sign-in-options.controller.ts'), 'utf8');
    const models = [...src.matchAll(/prisma\.client\.(\w+)/g)].map((m) => m[1]);
    expect(models).toEqual(['tenantSSOConfig']);
    // The response type has exactly these keys — a new one must be argued for here.
    const { prisma } = makePrisma([row()]);
    return new SignInOptionsController(prisma)
      .signInOptions(parse({ email: 'a@northfield.example' }))
      .then((out) => {
        expect(Object.keys(out).sort()).toEqual(['password', 'sso']);
        expect(Object.keys(out.sso!).sort()).toEqual(['label', 'provider', 'tenantSlug']);
      });
  });

  it('answers a configured domain with what the page needs to start single sign-on', async () => {
    const { out } = await ask([row()], 'teacher@northfield.example');
    expect(out).toEqual({
      password: true,
      sso: { tenantSlug: 'northfield', provider: 'oidc', label: 'Google' },
    });
  });

  it('uses the login normalisation — case and surrounding space do not change the answer', async () => {
    const { out, findMany } = await ask([row({ allowedEmailDomain: 'Northfield.Example' })], '  Teacher@NORTHFIELD.example ');
    expect(out.sso?.tenantSlug).toBe('northfield');
    expect(findMany.mock.calls[0][0].where.allowedEmailDomain).toEqual({
      equals: 'northfield.example',
      mode: 'insensitive',
    });
  });

  it('ignores a config that is not enabled', async () => {
    const { out } = await ask([row({ enabled: false })], 'teacher@northfield.example');
    expect(out).toEqual({ password: true, sso: null });
  });

  it('ignores an archived organization', async () => {
    const { out } = await ask(
      [row({ tenant: { slug: 'northfield', archivedAt: new Date('2026-08-01T00:00:00Z') } })],
      'teacher@northfield.example',
    );
    expect(out).toEqual({ password: true, sso: null });
  });

  it('an AMBIGUOUS claim picks no winner — two enabled configs for one domain answer "no single sign-on"', async () => {
    const { out } = await ask(
      [row(), row({ tenant: { slug: 'squatter', archivedAt: null } })],
      'teacher@northfield.example',
    );
    expect(out).toEqual({ password: true, sso: null });
  });

  it('does not match a look-alike domain', async () => {
    for (const email of [
      'x@evil-northfield.example',
      'x@northfield.example.evil.example',
      'x@sub.northfield.example',
    ]) {
      const { out } = await ask([row()], email);
      expect(out.sso).toBeNull();
    }
  });

  it('SAML answers with no provider label; an unknown stored provider answers no SSO', async () => {
    const saml = await ask([row({ provider: 'SAML', oidcIssuer: null })], 'a@northfield.example');
    expect(saml.out.sso).toEqual({ tenantSlug: 'northfield', provider: 'saml', label: null });
    const odd = await ask([row({ provider: 'LDAP' })], 'a@northfield.example');
    expect(odd.out).toEqual({ password: true, sso: null });
  });

  it('password stays allowed even when single sign-on applies (an unverified domain claim must never remove it)', async () => {
    const { out } = await ask([row()], 'teacher@northfield.example');
    expect(out.password).toBe(true);
  });
});

describe('input validation → 400', () => {
  it.each([
    ['missing email', {}],
    ['not an email', { email: 'not an email' }],
    ['no TLD', { email: 'a@b' }],
    ['over 254 chars', { email: `${'a'.repeat(250)}@northfield.example` }],
    ['non-string', { email: 42 }],
    ['unknown extra key', { email: 'a@northfield.example', password: 'x' }],
  ])('%s', (_name, body) => {
    expect(() => parse(body)).toThrow(expect.objectContaining({ status: 400 }));
  });
});

describe('route shape', () => {
  const handler = SignInOptionsController.prototype.signInOptions;

  it('is throttled per IP: 20 a minute — twice the /auth/login cap it sits in front of', () => {
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(20);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(60_000);
    // The comparison the number is defined by. If the login cap moves, look
    // at this one again.
    expect(
      Reflect.getMetadata('THROTTLER:LIMITdefault', AuthController.prototype.login),
    ).toBe(10);
  });

  it('is POST /api/v1/auth/sign-in-options and answers 200', () => {
    expect(Reflect.getMetadata('path', SignInOptionsController)).toBe('api/v1/auth');
    expect(Reflect.getMetadata('path', handler)).toBe('sign-in-options');
    expect(Reflect.getMetadata('__httpCode__', handler)).toBe(200);
  });

  it('is public on purpose: no guard, no principal read (route-guard-inventory.spec scans this file too)', () => {
    const src = fs.readFileSync(path.join(__dirname, 'sign-in-options.controller.ts'), 'utf8');
    expect(Reflect.getMetadata('__guards__', handler)).toBeUndefined();
    expect(Reflect.getMetadata('__guards__', SignInOptionsController)).toBeUndefined();
    expect(src).not.toMatch(/\breq(uest)?\.user\b/);
    expect(src).not.toMatch(/Logger|console\./);
  });
});

describe('providerLabelFor', () => {
  it.each([
    ['https://accounts.google.com', 'Google'],
    ['https://login.microsoftonline.com/abc/v2.0', 'Microsoft'],
    ['https://northfield.okta.com', 'Okta'],
    ['https://idp.northfield.example', null],
    // Dot-boundary only: a look-alike host gets no trusted name.
    ['https://evilokta.com', null],
    ['https://okta.com.evil.example', null],
    ['not a url', null],
    [null, null],
  ])('%s -> %s', (issuer, label) => {
    expect(providerLabelFor(issuer)).toBe(label);
  });
});
