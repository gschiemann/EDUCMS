/**
 * ACC-06 follow-up (2026-08-03) — API-key actions must not be forensically
 * anonymous.
 *
 * The action rows an API key produced carried `userId: null` and no key
 * reference, because the writers all read `req.user.id`, which JwtAuthGuard
 * deliberately leaves null for a machine identity. With 195 `auditLog.create`
 * call sites across 63 files there is no writer to thread a parameter
 * through, so the actor rides an AsyncLocalStorage and one Prisma middleware
 * fills `AuditLog.apiKeyId`.
 *
 * The tests that matter most here are the CROSS-REQUEST ones: an ambient
 * store that leaks between requests would attribute an action to the WRONG
 * credential, which is worse than no attribution at all.
 */
import { Observable, firstValueFrom, of } from 'rxjs';
import {
  applyAuditActorToPrismaArgs,
  armAuditActorPrismaHook,
  auditActorFields,
  currentAuditActor,
  runWithAuditActor,
} from './audit-actor';
import { AuditActorInterceptor } from './audit-actor.interceptor';

const KEY_ACTOR = { userId: null, apiKeyId: 'key-1' };

function httpCtx(user: unknown) {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

describe('auditActorFields — one resolver for "who did this"', () => {
  it('resolves an api-key request to apiKeyId with a null user', () => {
    expect(
      auditActorFields({ user: { kind: 'api-key', id: null, userId: null, apiKeyId: 'key-9' } }),
    ).toEqual({ userId: null, apiKeyId: 'key-9' });
  });

  it('never emits both — an api-key request has no human principal', () => {
    // A stray `id` on an api-key identity must not re-anonymize the row under
    // a fake user.
    expect(auditActorFields({ user: { kind: 'api-key', id: 'spoof', apiKeyId: 'key-9' } })).toEqual(
      { userId: null, apiKeyId: 'key-9' },
    );
  });

  it('resolves a human request to userId', () => {
    expect(auditActorFields({ user: { id: 'u1', role: 'DISTRICT_ADMIN' } })).toEqual({
      userId: 'u1',
      apiKeyId: null,
    });
  });

  it('falls back to userId for the older controllers that only populate that', () => {
    expect(auditActorFields({ user: { userId: 'u2' } })).toEqual({ userId: 'u2', apiKeyId: null });
  });

  it('a device identity is neither — a screen id must never land in apiKeyId', () => {
    expect(auditActorFields({ user: { kind: 'device', id: 'screen-1' } })).toEqual({
      userId: null,
      apiKeyId: null,
    });
  });

  it('an unauthenticated request is both-null rather than throwing', () => {
    expect(auditActorFields(undefined)).toEqual({ userId: null, apiKeyId: null });
    expect(auditActorFields({})).toEqual({ userId: null, apiKeyId: null });
  });
});

describe('the ambient actor is scoped to its request', () => {
  it('is null outside any request', () => {
    expect(currentAuditActor()).toBeNull();
  });

  it('is visible inside, and unwound after', () => {
    runWithAuditActor(KEY_ACTOR, () => {
      expect(currentAuditActor()).toEqual(KEY_ACTOR);
    });
    expect(currentAuditActor()).toBeNull();
  });

  it('survives across await boundaries within the request', async () => {
    await runWithAuditActor(KEY_ACTOR, async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
      expect(currentAuditActor()).toEqual(KEY_ACTOR);
    });
  });

  it('does NOT leak into the next request on the same connection (the enterWith trap)', async () => {
    // `als.enterWith` would mutate the socket's async resource, so with HTTP
    // keep-alive request N's key would still be ambient during request N+1 —
    // silently attributing one credential's action to another. `als.run`
    // unwinds; this test is what proves we kept it that way.
    const seen: Array<string | null> = [];
    const interceptor = new AuditActorInterceptor();

    const handlerFor = (label: string) => ({
      handle: () =>
        new Observable((sub) => {
          // The handler body runs on subscribe — this is where an audit
          // writer would be.
          setTimeout(() => {
            seen.push(currentAuditActor()?.apiKeyId ?? null);
            sub.next(label);
            sub.complete();
          }, 0);
        }),
    });

    // Request 1: an API key. Request 2: a HUMAN on the same connection.
    await firstValueFrom(
      interceptor.intercept(
        httpCtx({ kind: 'api-key', apiKeyId: 'key-1' }),
        handlerFor('req1') as any,
      ),
    );
    await firstValueFrom(
      interceptor.intercept(httpCtx({ id: 'human-1' }), handlerFor('req2') as any),
    );

    expect(seen).toEqual(['key-1', null]);
  });

  it('two overlapping api-key requests do not see each other', async () => {
    const interceptor = new AuditActorInterceptor();
    const seen: Record<string, string | null> = {};
    const handlerFor = (label: string, delay: number) => ({
      handle: () =>
        new Observable((sub) => {
          setTimeout(() => {
            seen[label] = currentAuditActor()?.apiKeyId ?? null;
            sub.next(label);
            sub.complete();
          }, delay);
        }),
    });

    await Promise.all([
      // A finishes LAST on purpose, so a leaking store would be observable.
      firstValueFrom(
        interceptor.intercept(httpCtx({ kind: 'api-key', apiKeyId: 'A' }), handlerFor('a', 20) as any),
      ),
      firstValueFrom(
        interceptor.intercept(httpCtx({ kind: 'api-key', apiKeyId: 'B' }), handlerFor('b', 0) as any),
      ),
    ]);

    expect(seen).toEqual({ a: 'A', b: 'B' });
  });

  it('a human request pays no ALS frame at all — the handler passes straight through', () => {
    const interceptor = new AuditActorInterceptor();
    const handle = of('ok');
    const out = interceptor.intercept(httpCtx({ id: 'u1' }), { handle: () => handle } as any);
    expect(out).toBe(handle);
  });

  it('a non-http context (WS/RPC) passes straight through', () => {
    const interceptor = new AuditActorInterceptor();
    const handle = of('ok');
    const ctx = { getType: () => 'ws' } as any;
    expect(interceptor.intercept(ctx, { handle: () => handle } as any)).toBe(handle);
  });
});

describe('the Prisma middleware fills AuditLog.apiKeyId', () => {
  it('stamps a create when the ambient actor is an api-key', () => {
    const params: any = { model: 'AuditLog', action: 'create', args: { data: { action: 'X' } } };
    runWithAuditActor(KEY_ACTOR, () => applyAuditActorToPrismaArgs(params));
    expect(params.args.data.apiKeyId).toBe('key-1');
  });

  it('stamps every row of a createMany', () => {
    const params: any = {
      model: 'AuditLog',
      action: 'createMany',
      args: { data: [{ action: 'X' }, { action: 'Y' }] },
    };
    runWithAuditActor(KEY_ACTOR, () => applyAuditActorToPrismaArgs(params));
    expect(params.args.data.map((d: any) => d.apiKeyId)).toEqual(['key-1', 'key-1']);
  });

  it('NEVER overwrites a value the writer set explicitly', () => {
    // `API_KEY_CREATED` is the case: the key is the SUBJECT, a human admin is
    // the actor. A writer that knows better stays authoritative.
    const params: any = {
      model: 'AuditLog',
      action: 'create',
      args: { data: { action: 'API_KEY_CREATED', apiKeyId: null } },
    };
    runWithAuditActor(KEY_ACTOR, () => applyAuditActorToPrismaArgs(params));
    expect(params.args.data.apiKeyId).toBeNull();
  });

  it('leaves a human request alone', () => {
    const params: any = { model: 'AuditLog', action: 'create', args: { data: { action: 'X' } } };
    runWithAuditActor({ userId: 'u1', apiKeyId: null }, () =>
      applyAuditActorToPrismaArgs(params),
    );
    expect(params.args.data.apiKeyId).toBeUndefined();
  });

  it('leaves every other model and action alone', () => {
    for (const params of [
      { model: 'Playlist', action: 'create', args: { data: {} as any } },
      { model: 'AuditLog', action: 'findMany', args: { data: {} as any } },
      { model: 'AuditLog', action: 'update', args: { data: {} as any } },
    ]) {
      runWithAuditActor(KEY_ACTOR, () => applyAuditActorToPrismaArgs(params as any));
      expect((params.args.data as any).apiKeyId).toBeUndefined();
    }
  });

  it('does nothing outside a request', () => {
    const params: any = { model: 'AuditLog', action: 'create', args: { data: {} } };
    applyAuditActorToPrismaArgs(params);
    expect(params.args.data.apiKeyId).toBeUndefined();
  });
});

describe('arming the hook', () => {
  it('registers once per client and reports success', () => {
    const client: any = { $use: jest.fn() };
    expect(armAuditActorPrismaHook(client)).toBe(true);
    expect(armAuditActorPrismaHook(client)).toBe(true);
    // Arming twice would double-stamp every row.
    expect(client.$use).toHaveBeenCalledTimes(1);
  });

  it('reports failure instead of throwing when $use is gone', () => {
    // Prisma 5.22 deprecates $use. If it disappears we lose forensic DETAIL,
    // never correctness — the guard's own API_KEY_REQUEST row still names the
    // key.
    expect(armAuditActorPrismaHook({})).toBe(false);
    expect(armAuditActorPrismaHook(null)).toBe(false);
  });

  it('a middleware bug can never fail the underlying query', async () => {
    const client: any = { $use: jest.fn() };
    armAuditActorPrismaHook(client);
    const middleware = client.$use.mock.calls[0][0];
    const next = jest.fn().mockResolvedValue('row');
    // Frozen args: stamping throws in strict mode, the query must still run.
    const params = Object.freeze({
      model: 'AuditLog',
      action: 'create',
      args: Object.freeze({ data: Object.freeze({}) }),
    });
    await expect(
      runWithAuditActor(KEY_ACTOR, () => middleware(params, next)),
    ).resolves.toBe('row');
    expect(next).toHaveBeenCalled();
  });
});
