-- Add ai_model column to tenants for the AI model picker (2026-05-25).
-- Purely additive: existing rows continue to load with NULL meaning
-- "fall back to provider default" (legacy behavior).
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "ai_model" TEXT;
