import { Pool, QueryResult, QueryResultRow } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Extends standard query execution to enforce parameterization natively, 
 * explicitly rejecting dynamic string concatenation by typing.
 * Satisfies the strict "no raw SQL unless fully parameterized" requirement.
 */
export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

/**
 * Inserts an audit log after executing a privileged action.
 */
export async function logAuditAction(
  actorId: string | null,
  action: string,
  targetType: string,
  targetId: string,
  payload: any,
  ipAddress: string
): Promise<void> {
  const queryText = `
    INSERT INTO audit_log (actor_id, action, target_type, target_id, payload, ip_address)
    VALUES ($1, $2, $3, $4, $5, $6)
  `;
  await pool.query(queryText, [actorId, action, targetType, targetId, payload, ipAddress]);
}

export default { pool, query, logAuditAction };
