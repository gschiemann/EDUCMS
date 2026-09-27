/**
 * The post-commit manifest bump fires only for transactions that wrote a
 * manifest-fed model (2026-09-27). A fake client stands in for Prisma: its
 * interactive transaction runs the callback, and "queries" call the same
 * noteManifestQuery the real middleware calls, inside the callback's async
 * context — exactly where Prisma runs middleware for `tx.*` queries.
 */
import { noteManifestQuery, wrapTransactionForManifestRev } from './prisma.service';

function fakeClient() {
  const client: any = {
    async $transaction(arg: any) {
      if (typeof arg === 'function') return arg({ query: async (manifest: boolean) => { await Promise.resolve(); noteManifestQuery(manifest); } });
      return Promise.all(arg);
    },
  };
  const bump = jest.fn();
  wrapTransactionForManifestRev(client, bump);
  return { client, bump };
}

describe('transaction manifest scope', () => {
  it('a transaction that writes only non-manifest models (a scorekeeper tap) does NOT bump', async () => {
    const { client, bump } = fakeClient();
    await client.$transaction(async (tx: any) => { await tx.query(false); await tx.query(false); });
    expect(bump).not.toHaveBeenCalled();
  });

  it('a transaction that writes a manifest-fed model bumps once after commit', async () => {
    const { client, bump } = fakeClient();
    await client.$transaction(async (tx: any) => { await tx.query(false); await tx.query(true); });
    expect(bump).toHaveBeenCalledTimes(1);
  });

  it('fail-safe: a transaction whose scope saw no queries still bumps', async () => {
    const { client, bump } = fakeClient();
    await client.$transaction(async () => undefined);
    expect(bump).toHaveBeenCalledTimes(1);
  });

  it('the batch form keeps the unconditional bump', async () => {
    const { client, bump } = fakeClient();
    await client.$transaction([Promise.resolve(1), Promise.resolve(2)]);
    expect(bump).toHaveBeenCalledTimes(1);
  });

  it('a rolled-back transaction does not bump after the fact', async () => {
    const { client, bump } = fakeClient();
    await expect(client.$transaction(async (tx: any) => { await tx.query(true); throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect(bump).not.toHaveBeenCalled();
  });

  it('concurrent transactions keep separate scopes', async () => {
    const { client, bump } = fakeClient();
    await Promise.all([
      client.$transaction(async (tx: any) => { await tx.query(false); await new Promise((r) => setTimeout(r, 5)); await tx.query(false); }),
      client.$transaction(async (tx: any) => { await tx.query(true); }),
    ]);
    expect(bump).toHaveBeenCalledTimes(1);
  });

  it('outside any transaction, noteManifestQuery is a no-op', () => {
    expect(() => noteManifestQuery(true)).not.toThrow();
  });
});
