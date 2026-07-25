-- Tenant.emergencyType — the INCIDENT TYPE of an active tenant-wide emergency.
-- Additive + nullable, so existing rows and older API replicas are unaffected.
-- Before this, a tenant-scope trigger stored only the SEVERITY in
-- emergency_status, so screens showed "CRITICAL PROTOCOL ACTIVE" instead of
-- LOCKDOWN / EVACUATE.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "emergency_type" TEXT;
