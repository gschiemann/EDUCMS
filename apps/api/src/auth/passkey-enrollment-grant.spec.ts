/**
 * THE POST-SIGN-IN PASSKEY OFFER'S GRANT — the store, and who may mint it.
 *
 * Four properties, each proved on BOTH backends where a backend is involved
 * (the memory fallback is what a Redis-less deploy runs; an untested fallback
 * is one that silently accepts replays):
 *
 *   SINGLE-USE    — a grant redeems once; a second presentation, including a
 *                   concurrent one, is refused.
 *   EXPIRES       — ten minutes, then refused.
 *   USER-BOUND    — a grant minted for one account is refused for any other,
 *                   and a foreign presentation does not even BURN it.
 *   ONE PURPOSE   — only `PasskeyController.registerOptions` reads it, only
 *                   two sign-in doors mint it, and no JWT-verifying door will
 *                   take it for a credential.
 *
 * The call-site pins at the bottom are the "cannot be minted by a refresh or a
 * tenant switch" proof: they are resolved from the TypeScript AST of every
 * non-test source file, so a new caller anywhere in `src/` fails this suite
 * and has to be argued for.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { createHash } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import type { ExecutionContext } from '@nestjs/common';

import {
  __resetPasskeyEnrollmentGrantsForTests,
  grantRedisFrom,
  mintPasskeyEnrollmentGrant,
  PASSKEY_ENROLLMENT_GRANT_TTL_MS,
  redeemPasskeyEnrollmentGrant,
  withPasskeyEnrollmentOffer,
  type PasskeyOfferSubject,
} from './passkey-enrollment-grant';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { WebAuthnChallengeRedis } from './webauthn-challenge-store';

/** An HONEST ioredis model: real PX TTLs, real atomic GETDEL. */
class FakeRedis implements WebAuthnChallengeRedis {
  status = 'ready';
  readonly store = new Map<string, { value: string; expiresAt: number }>();
  now = Date.now();
  set(
    key: string,
    value: string,
    _mode: 'PX',
    ttlMs: number,
  ): Promise<unknown> {
    this.store.set(key, { value, expiresAt: this.now + ttlMs });
    return Promise.resolve('OK');
  }
  getdel(key: string): Promise<string | null> {
    const hit = this.store.get(key);
    this.store.delete(key); // atomic: leaves the store in the step it is read
    if (!hit || hit.expiresAt <= this.now) return Promise.resolve(null);
    return Promise.resolve(hit.value);
  }
}

type MultiTx = ReturnType<NonNullable<WebAuthnChallengeRedis['multi']>>;

/** A Redis server older than 6.2: no GETDEL, only MULTI GET+DEL. */
function oldServer() {
  const data = new Map<string, string>();
  const calls: string[] = [];
  const redis: WebAuthnChallengeRedis = {
    status: 'ready',
    set: (k: string, v: string) => {
      data.set(k, v);
      return Promise.resolve('OK');
    },
    getdel: () => {
      calls.push('getdel');
      return Promise.reject(
        new Error("ERR unknown command 'GETDEL', with args beginning with: "),
      );
    },
    multi: () => {
      const queued: Array<() => unknown> = [];
      const tx: MultiTx = {
        get: (k: string) => {
          queued.push(() => data.get(k) ?? null);
          return tx;
        },
        del: (k: string) => {
          queued.push(() => (data.delete(k) ? 1 : 0));
          return tx;
        },
        exec: () => {
          calls.push('multi');
          return Promise.resolve(
            queued.map((fn) => [null, fn()] as [null, unknown]),
          );
        },
      };
      return tx;
    },
  };
  return { redis, calls, data };
}

beforeEach(() => {
  __resetPasskeyEnrollmentGrantsForTests();
});
afterEach(() => {
  jest.useRealTimers();
});

// ───────────────────────────────────────────────────────────────────────
describe.each([
  ['memory (no Redis on this deploy)', () => null as FakeRedis | null],
  ['Redis', () => new FakeRedis()],
])('the grant store — %s', (_name, makeRedis) => {
  it('mints an opaque 43-char base64url secret with a ten-minute expiry', async () => {
    const before = Date.now();
    const minted = await mintPasskeyEnrollmentGrant(makeRedis(), 'user-1');
    expect(minted).not.toBeNull();
    expect(minted!.grant).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const expires = Date.parse(minted!.expiresAt);
    expect(expires - before).toBeGreaterThanOrEqual(
      PASSKEY_ENROLLMENT_GRANT_TTL_MS - 1_000,
    );
    expect(expires - before).toBeLessThanOrEqual(
      PASSKEY_ENROLLMENT_GRANT_TTL_MS + 1_000,
    );
    // NOT a JWT: no dots, nothing a token parser would even start on.
    expect(minted!.grant).not.toContain('.');
  });

  it('two mints never collide', async () => {
    const redis = makeRedis();
    const a = await mintPasskeyEnrollmentGrant(redis, 'user-1');
    const b = await mintPasskeyEnrollmentGrant(redis, 'user-1');
    expect(a!.grant).not.toBe(b!.grant);
  });

  it('IS SINGLE-USE — redeems exactly once', async () => {
    const redis = makeRedis();
    const { grant } = (await mintPasskeyEnrollmentGrant(redis, 'user-1'))!;
    expect(await redeemPasskeyEnrollmentGrant(redis, 'user-1', grant)).toBe(
      true,
    );
    expect(await redeemPasskeyEnrollmentGrant(redis, 'user-1', grant)).toBe(
      false,
    );
  });

  it('two CONCURRENT redemptions — exactly one wins', async () => {
    const redis = makeRedis();
    const { grant } = (await mintPasskeyEnrollmentGrant(redis, 'user-1'))!;
    const results = await Promise.all([
      redeemPasskeyEnrollmentGrant(redis, 'user-1', grant),
      redeemPasskeyEnrollmentGrant(redis, 'user-1', grant),
      redeemPasskeyEnrollmentGrant(redis, 'user-1', grant),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('is USER-BOUND — refused for another account, and NOT burned by the attempt', async () => {
    const redis = makeRedis();
    const { grant } = (await mintPasskeyEnrollmentGrant(redis, 'victim'))!;
    // Another signed-in principal presenting the victim's grant…
    expect(await redeemPasskeyEnrollmentGrant(redis, 'attacker', grant)).toBe(
      false,
    );
    // …looks up a key that does not exist, so the owner's grant survives.
    expect(await redeemPasskeyEnrollmentGrant(redis, 'victim', grant)).toBe(
      true,
    );
  });

  it('EXPIRES — refused after ten minutes', async () => {
    const redis = makeRedis();
    const t0 = Date.now();
    jest.useFakeTimers({ now: t0 });
    const { grant } = (await mintPasskeyEnrollmentGrant(redis, 'user-1'))!;
    const later = t0 + PASSKEY_ENROLLMENT_GRANT_TTL_MS + 1;
    jest.setSystemTime(later);
    if (redis) redis.now = later;
    expect(await redeemPasskeyEnrollmentGrant(redis, 'user-1', grant)).toBe(
      false,
    );
  });

  it('still valid a moment before expiry', async () => {
    const redis = makeRedis();
    const t0 = Date.now();
    jest.useFakeTimers({ now: t0 });
    const { grant } = (await mintPasskeyEnrollmentGrant(redis, 'user-1'))!;
    const almost = t0 + PASSKEY_ENROLLMENT_GRANT_TTL_MS - 1_000;
    jest.setSystemTime(almost);
    if (redis) redis.now = almost;
    expect(await redeemPasskeyEnrollmentGrant(redis, 'user-1', grant)).toBe(
      true,
    );
  });

  it('refuses anything that is not a grant, without touching the store', async () => {
    const redis = makeRedis();
    for (const junk of [
      '',
      'x',
      'a'.repeat(42),
      'a'.repeat(44),
      'not a grant at all, with spaces and a length of forty three!',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJlc2lnbmF0dXJl',
      null,
      undefined,
      42,
      { grant: 'x' },
    ]) {
      expect(
        await redeemPasskeyEnrollmentGrant(redis, 'user-1', junk as any),
      ).toBe(false);
    }
    // And an empty user id can never redeem, even with a real grant.
    const { grant } = (await mintPasskeyEnrollmentGrant(redis, 'user-1'))!;
    expect(await redeemPasskeyEnrollmentGrant(redis, '', grant)).toBe(false);
    expect(await redeemPasskeyEnrollmentGrant(redis, 'user-1', grant)).toBe(
      true,
    );
  });

  it('will not mint for an empty user id', async () => {
    expect(await mintPasskeyEnrollmentGrant(makeRedis(), '')).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('the grant store — Redis specifics', () => {
  it('never stores the raw grant — the key carries only its SHA-256, bound to the user', async () => {
    const redis = new FakeRedis();
    const { grant } = (await mintPasskeyEnrollmentGrant(redis, 'user-1'))!;
    const [[key, entry]] = [...redis.store.entries()];
    expect(key).toBe(
      `vos:webauthn:enroll-grant:user-1:${createHash('sha256').update(grant).digest('hex')}`,
    );
    expect(key).not.toContain(grant);
    expect(entry.value).not.toContain(grant);
    const stored = JSON.parse(entry.value) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual([
      'issuedAt',
      'purpose',
      'userId',
    ]);
    expect(stored.purpose).toBe('passkey-enrollment');
    expect(stored.userId).toBe('user-1');
    expect(typeof stored.issuedAt).toBe('number');
    // …and the TTL is the store's own, not a timestamp a reader could forget.
    expect(entry.expiresAt - redis.now).toBe(PASSKEY_ENROLLMENT_GRANT_TTL_MS);
  });

  it('spends through the SAME atomic helper the challenges use — incl. the pre-6.2 MULTI fallback', async () => {
    const { redis, calls, data } = oldServer();
    const { grant } = (await mintPasskeyEnrollmentGrant(redis, 'user-1'))!;
    expect(await redeemPasskeyEnrollmentGrant(redis, 'user-1', grant)).toBe(
      true,
    );
    expect(calls).toEqual(['getdel', 'multi']);
    expect(data.size).toBe(0);
    expect(await redeemPasskeyEnrollmentGrant(redis, 'user-1', grant)).toBe(
      false,
    );
  });

  it('a Redis error while spending FAILS CLOSED — never a second copy in memory', async () => {
    const redis = new FakeRedis();
    const { grant } = (await mintPasskeyEnrollmentGrant(redis, 'user-1'))!;
    redis.getdel = () => Promise.reject(new Error('ECONNRESET'));
    expect(await redeemPasskeyEnrollmentGrant(redis, 'user-1', grant)).toBe(
      false,
    );
  });

  it('a record whose contents disagree with its key is refused', async () => {
    const redis = new FakeRedis();
    const { grant } = (await mintPasskeyEnrollmentGrant(redis, 'user-1'))!;
    const [key] = [...redis.store.keys()];
    // Same key, but a record naming someone else / another purpose.
    redis.store.set(key, {
      value: JSON.stringify({
        purpose: 'passkey-enrollment',
        userId: 'user-2',
        issuedAt: Date.now(),
      }),
      expiresAt: redis.now + 60_000,
    });
    expect(await redeemPasskeyEnrollmentGrant(redis, 'user-1', grant)).toBe(
      false,
    );
    redis.store.set(key, {
      value: JSON.stringify({
        purpose: 'something-else',
        userId: 'user-1',
        issuedAt: Date.now(),
      }),
      expiresAt: redis.now + 60_000,
    });
    expect(await redeemPasskeyEnrollmentGrant(redis, 'user-1', grant)).toBe(
      false,
    );
  });

  it('a store that cannot be written yields NO grant (and never throws into the sign-in)', async () => {
    const redis = new FakeRedis();
    redis.set = () =>
      Promise.reject(
        new Error('READONLY You cannot write against a read only replica.'),
      );
    await expect(
      mintPasskeyEnrollmentGrant(redis, 'user-1'),
    ).resolves.toBeNull();
  });

  it('a store that HANGS yields no grant within the mint budget — the sign-in is never held up', async () => {
    jest.useFakeTimers();
    const redis = new FakeRedis();
    redis.set = () => new Promise(() => undefined); // never settles
    const pending = mintPasskeyEnrollmentGrant(redis, 'user-1');
    await jest.advanceTimersByTimeAsync(1_600);
    await expect(pending).resolves.toBeNull();
  });

  it('grantRedisFrom hands back the RedisService publisher, or null', () => {
    const publisher = new FakeRedis();
    expect(grantRedisFrom({ publisher })).toBe(publisher);
    expect(grantRedisFrom({ publisher: null })).toBeNull();
    expect(grantRedisFrom(undefined)).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('withPasskeyEnrollmentOffer — who gets an offer', () => {
  const SESSION = { access_token: 'eyJ.session.jwt', user: { id: 'user-1' } };
  const eligible = {
    id: 'user-1',
    mustSetupCredentials: false,
    _count: { passkeys: 0 },
  };

  it('a FULL session for an account with no passkey gets one grant it can redeem', async () => {
    const out = (await withPasskeyEnrollmentOffer(
      SESSION,
      eligible,
      null,
    )) as typeof SESSION & {
      passkeyEnrollment: { grant: string; expiresAt: string };
    };
    expect(out.access_token).toBe(SESSION.access_token);
    expect(out.user).toEqual(SESSION.user);
    expect(out.passkeyEnrollment.grant).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(typeof out.passkeyEnrollment.expiresAt).toBe('string');
    expect(
      await redeemPasskeyEnrollmentGrant(
        null,
        'user-1',
        out.passkeyEnrollment.grant,
      ),
    ).toBe(true);
  });

  it.each([
    [
      'an mfaRequired envelope (the sign-in has not finished)',
      { mfaRequired: true, mfaMethods: ['totp'], mfaToken: 'partial' },
      eligible,
    ],
    [
      'a forced-enrollment envelope',
      {
        mfaRequired: true,
        mfaEnrollmentRequired: true,
        mfaMethods: [],
        mfaToken: 'partial',
      },
      eligible,
    ],
    [
      'an envelope with an access token AND mfaRequired',
      { ...SESSION, mfaRequired: true },
      eligible,
    ],
    [
      'an account that already has a passkey',
      SESSION,
      { ...eligible, _count: { passkeys: 1 } },
    ],
    [
      'an account whose passkey count was not loaded',
      SESSION,
      { id: 'user-1', mustSetupCredentials: false },
    ],
    [
      'an account behind the first-login setup gate',
      SESSION,
      { ...eligible, mustSetupCredentials: true },
    ],
    [
      'an account whose setup-gate flag was not loaded',
      SESSION,
      { id: 'user-1', _count: { passkeys: 0 } },
    ],
    ['a subject with no id', SESSION, { ...eligible, id: '' }],
  ])(
    '%s gets NOTHING — the response is returned untouched',
    async (_label, response, subject) => {
      const out = await withPasskeyEnrollmentOffer(
        response as Record<string, unknown>,
        subject as PasskeyOfferSubject,
        null,
      );
      expect(out).toBe(response);
      expect('passkeyEnrollment' in out).toBe(false);
    },
  );

  it('a store failure means no offer, never a failed sign-in', async () => {
    const redis = new FakeRedis();
    redis.set = () => Promise.reject(new Error('down'));
    const out = await withPasskeyEnrollmentOffer(SESSION, eligible, redis);
    expect(out).toBe(SESSION);
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('ONE PURPOSE — no JWT-verifying door takes a grant for a credential', () => {
  const SECRET = 'dev_only_jwt_secret_CHANGE_ME';
  const prevSecret = process.env.JWT_SECRET;
  beforeAll(() => {
    process.env.JWT_SECRET = SECRET;
  });
  afterAll(() => {
    if (prevSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevSecret;
  });

  it('JwtAuthGuard refuses a grant presented as a Bearer session', async () => {
    const { grant } = (await mintPasskeyEnrollmentGrant(null, 'user-1'))!;
    const redis = {
      sismember: jest.fn(() => Promise.resolve(false)),
      getTokenInvalidBefore: jest.fn(() => Promise.resolve(null)),
    };
    const guard = new JwtAuthGuard(
      new JwtService({ secret: SECRET }),
      redis as unknown as ConstructorParameters<typeof JwtAuthGuard>[1],
    );
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: `Bearer ${grant}` },
          user: undefined,
        }),
      }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).rejects.toThrow();
  });

  it('the partial-mfaToken verifier refuses a grant', async () => {
    const { grant } = (await mintPasskeyEnrollmentGrant(null, 'user-1'))!;
    await expect(
      new JwtService({ secret: SECRET }).verifyAsync(grant, { secret: SECRET }),
    ).rejects.toThrow();
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('WHO MAY MINT OR SPEND — resolved from the AST of every source file', () => {
  const SRC = path.join(__dirname, '..');

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...sourceFiles(full));
      else if (
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.spec.ts') &&
        !entry.name.endsWith('.d.ts')
      ) {
        out.push(full);
      }
    }
    return out;
  }

  /** `relative path → number of CALLS` to `fn`, across all of src/. */
  function callSites(fn: string): Record<string, number> {
    const sites: Record<string, number> = {};
    for (const file of sourceFiles(SRC)) {
      const text = fs.readFileSync(file, 'utf8');
      if (!text.includes(fn)) continue; // cheap prefilter; the AST decides
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      let n = 0;
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          const callee = node.expression;
          const name = ts.isIdentifier(callee)
            ? callee.text
            : ts.isPropertyAccessExpression(callee)
              ? callee.name.text
              : '';
          if (name === fn) n += 1;
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
      if (n) sites[path.relative(SRC, file)] = n;
    }
    return sites;
  }

  it('the grant is attached to a sign-in response at EXACTLY two doors — password login and the TOTP/backup-code challenge', () => {
    // Not a refresh (auth.controller `refresh`, session.controller), not a
    // tenant switch (tenants.controller), not a passkey sign-in, not forced
    // enrollment, not signup / invite. A new caller has to be argued for here.
    expect(callSites('withPasskeyEnrollmentOffer')).toEqual({
      [path.join('auth', 'auth.controller.ts')]: 1,
      [path.join('auth', 'mfa.controller.ts')]: 1,
    });
  });

  it('nothing mints a grant except through that one offer function', () => {
    expect(callSites('mintPasskeyEnrollmentGrant')).toEqual({
      [path.join('auth', 'passkey-enrollment-grant.ts')]: 1,
    });
  });

  it('exactly ONE door spends a grant — passkey registration options', () => {
    expect(callSites('redeemPasskeyEnrollmentGrant')).toEqual({
      [path.join('auth', 'passkey.controller.ts')]: 1,
    });
  });

  it('the two mint sites are inside the two sign-in handlers, after the session is minted', () => {
    const at = (file: string, method: string) => {
      const text = fs.readFileSync(path.join(SRC, 'auth', file), 'utf8');
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      let body = '';
      const visit = (node: ts.Node) => {
        if (
          ts.isMethodDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.name.text === method
        ) {
          body = node.getText(sf);
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
      return body;
    };
    const login = at('auth.controller.ts', 'login');
    expect(login.indexOf('this.authService.login(')).toBeGreaterThan(-1);
    expect(login.indexOf('withPasskeyEnrollmentOffer(')).toBeGreaterThan(
      login.indexOf('this.authService.login('),
    );
    const challenge = at('mfa.controller.ts', 'challenge');
    expect(challenge.indexOf('this.auth.login(')).toBeGreaterThan(-1);
    expect(challenge.indexOf('withPasskeyEnrollmentOffer(')).toBeGreaterThan(
      challenge.indexOf('this.auth.login('),
    );
    // …and NOT in the refresh / forced-enrollment handlers that share those files.
    expect(at('auth.controller.ts', 'refresh')).not.toContain(
      'withPasskeyEnrollmentOffer',
    );
    expect(at('mfa.controller.ts', 'requiredVerify')).not.toContain(
      'withPasskeyEnrollmentOffer',
    );
  });
});
