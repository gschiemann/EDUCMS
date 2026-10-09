-- Generated with prisma migrate diff; additive and safe to apply after db:push.
SET lock_timeout = '5s';
ALTER TABLE "screens"
  ADD COLUMN IF NOT EXISTS "native_power_on_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "native_runtime_report" JSONB,
  ADD COLUMN IF NOT EXISTS "native_runtime_report_at" TIMESTAMP(3);
