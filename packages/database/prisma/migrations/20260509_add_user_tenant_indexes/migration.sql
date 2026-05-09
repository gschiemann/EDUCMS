-- 2026-05-09 — Add (tenantId) and (tenantId, role, status) indexes on
-- the users table.
--
-- Why: every admin-broadcast feature in the API does
--   prisma.user.findMany({ where: { tenantId, role: ..., status: ... } })
-- on this table — asset upload notifications, submission notifications,
-- /users list, SUPER_ADMIN cross-tenant reads. Pre-fix those queries
-- ran a Sequential Scan on the users table because there was no
-- supporting index. At the current pilot scale (50ish users) that's
-- fine. At 10k+ users across a district fan-out it's the BLOCKER for
-- every notify loop.
--
-- The composite (tenant_id, role, status) is chosen because the
-- hot-path filter is "active admins of this tenant" — it covers
-- exact-match WHERE tenant_id=$1 AND role IN (...) AND status='ACTIVE'
-- with a single index seek. The simpler (tenant_id) covers the
-- broader "all users in tenant" reads (members list, role-mixed
-- broadcast).
--
-- Both are CREATE INDEX IF NOT EXISTS so applying twice is a no-op.
-- CREATE INDEX (without CONCURRENTLY) takes a brief AccessShareLock
-- that's effectively instant on the current pilot user count. If
-- this is ever applied against a tenant with millions of user rows,
-- swap to CREATE INDEX CONCURRENTLY in a separate migration.

CREATE INDEX IF NOT EXISTS "users_tenant_id_idx"
  ON "users" ("tenant_id");

CREATE INDEX IF NOT EXISTS "users_tenant_id_role_status_idx"
  ON "users" ("tenant_id", "role", "status");
