-- 2026-07-02 efficiency audit #3 — ClockAdvanceService sweeps
-- `WHERE status = 'LIVE' AND clock_running = true` with no tenant
-- predicate, so the existing (tenant_id, status) index can't serve it
-- and every sweep was a sequential scan. Name matches Prisma's
-- @@index([status, clockRunning]) on model Game so `migrate deploy`
-- and the schema stay in agreement.
CREATE INDEX IF NOT EXISTS "games_status_clock_running_idx"
  ON "games"("status", "clock_running");
