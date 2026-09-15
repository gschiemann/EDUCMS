-- 2026-09-15 — Design import: the prepare-then-commit job (ImportJob).
--
-- ADDITIVE AND NON-DESTRUCTIVE: one brand-new table. Nothing existing is
-- altered, so this cannot change the behaviour of any shipped surface. The
-- import feature has never been used in production (zero IMPORT_DESIGN audit
-- rows, zero importer-created templates), so there is also no data to carry.
--
-- Every statement is IF NOT EXISTS so a database that already took this shape
-- from a `pnpm db:push` (this repo's dev flow is a schema diff, not migrate)
-- applies it as a no-op.

CREATE TABLE IF NOT EXISTS "import_jobs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREPARED',
    "source_name" TEXT NOT NULL,
    "source_mime" TEXT NOT NULL,
    "source_bytes" INTEGER NOT NULL,
    "source_sha256" TEXT NOT NULL,
    "source_object" TEXT NOT NULL,
    "source_page_count" INTEGER,
    "manifest" TEXT,
    "warnings" TEXT,
    "converter_version" TEXT,
    "committed_at" TIMESTAMP(3),
    "result" TEXT,
    "failure_code" TEXT,
    "failure_detail" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- The operator's own list, newest first.
CREATE INDEX IF NOT EXISTS "import_jobs_tenant_id_created_at_idx"
    ON "import_jobs"("tenant_id", "created_at");

-- The retention sweep's only query.
CREATE INDEX IF NOT EXISTS "import_jobs_status_expires_at_idx"
    ON "import_jobs"("status", "expires_at");
