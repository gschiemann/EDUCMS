-- 2026-09-01 — tenant standard LED poster size (single panel), additive.
-- NULL means the built-in default (320×1080, the 1.86 mm fleet standard).
ALTER TABLE "tenants" ADD COLUMN "poster_standard_w" INTEGER;
ALTER TABLE "tenants" ADD COLUMN "poster_standard_h" INTEGER;
