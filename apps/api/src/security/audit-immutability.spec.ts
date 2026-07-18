import * as fs from 'fs';
import * as path from 'path';

/**
 * §16: audit_logs is append-only at the storage layer — UPDATE/DELETE (row
 * trigger) AND TRUNCATE (statement trigger) are blocked. The behavioral proof
 * is a real-Postgres run (documented in the 20260717 migration commit); this
 * spec is the REPO-resolvable evidence lock so the migrations can't be silently
 * deleted and the capability-registry gate has a file to point at.
 */
const MIGRATIONS = path.resolve(__dirname, '..', '..', '..', '..', 'packages', 'database', 'prisma', 'migrations');

function sqlOf(dir: string): string {
  return fs.readFileSync(path.join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
}

describe('audit_logs append-only migrations (§16)', () => {
  it('row-level immutability trigger blocks UPDATE/DELETE', () => {
    const sql = sqlOf('20260531000000_audit_logs_immutable');
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON audit_logs/);
    expect(sql).toMatch(/append-only/i);
  });

  it('statement-level trigger blocks TRUNCATE', () => {
    const sql = sqlOf('20260717120000_audit_logs_block_truncate');
    expect(sql).toMatch(/BEFORE TRUNCATE ON audit_logs/);
    expect(sql).toMatch(/FOR EACH STATEMENT/);
    expect(sql).toMatch(/TRUNCATE is not permitted/);
  });
});
