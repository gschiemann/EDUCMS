-- 2026-08-31 — children created via POST /tenants/children never set
-- `vertical`, so every child of a non-K12 org defaulted to 'K12' and was
-- graded against the K12 emergency set (operator screenshot: a gym told
-- "No content wired for: Lockdown, Evacuate, Hold, Secure, Weather,
-- Medical"). Data-only backfill: a default-K12 child under a non-K12
-- parent inherits the parent's vertical. A deliberately-K12 child under a
-- non-K12 parent is not a real configuration (verticals are org-level),
-- so this is safe; genuinely-K12 orgs are untouched.
UPDATE tenants c
SET vertical = p.vertical
FROM tenants p
WHERE c.parent_id = p.id
  AND p.vertical <> 'K12'
  AND c.vertical = 'K12';
