# Test-tenant cleanup + Dodgers map — forensic + plan (2026-07-23)

## Root cause of "Dodgers shows the map"
The dashboard shows the fleet roll-up map when `isHQ = fleet.locations.length > 1`
(dashboard/page.tsx:57). Dodgers has **2 child tenants** — both test accounts I
created during the 2026-07-21 functional audit:
- `Audit QSR Cafe DELETE ME` (49a9ad7e-1bb7-44b5-a635-9b79e0a0393e)
- `Audit Gym Club DELETE ME` (4a3940dc-1355-43c2-9b7a-62dce5c6c973)

Those 2 children make Dodgers a multi-location parent → map renders. (Unrelated:
the map *moved to the dashboard* on 2026-06-02, commit 8b4522b2 "One map, not two.")

## Why we can't just DELETE them
`DELETE /tenants/children/:id` hard-deletes ONLY tenants with **zero audit history**.
Every tenant that has ever done an audited action carries `audit_logs` rows that are
FK-RESTRICT'd AND protected by the §16 immutability trigger → `P2003` →
`TENANT_DELETE_HAS_HISTORY`. Confirmed: even the 2 DELETE-ME accounts have audit rows
(4 and 2, from their own creation). **Hard-delete is architecturally impossible** for
essentially every account here. The controller comment itself says the answer is
**archive/soft-delete** (pending follow-up). My DB access is read-only, so I can't
mutate prod rows directly either.

## Classification (as of 2026-07-23)
- **KEEP — system/springfield (3):** System (security events), Springfield School
  District, Springfield Elementary.
- **KEEP — likely-real (6):** Dodgers, VisionCore Systems, Goodview, Chardon High
  School, Chardon Middle School, Fremont Elementary. (Confirm Goodview/Chardon are
  real before archiving anything near them.)
- **ARCHIVE — auto-generated test (61):** all `Beta *`, `Masonry *`, `GridV3 *`,
  `Modal *`, `A2/A3/A4/A5 *`, `AuditTenant*`, `F2 Audit*`, `B3 *`, `DimCheck *`,
  `AthTest *`, `Acme <hash> Stores`, `New company`, `Beta Test Pizzeria`.
- **ARCHIVE — dodgers DELETE-ME (2):** the two above (fixes the map).
- **AMBIGUOUS — demos, DECIDE (59):** the `Acme Coffee Co. (Corporate)` fleet (corp +
  50 city locations, 154 screens), `Dominos`, `Gym Demo`, `Greg's Fitness`, `E1 Scale
  HQ` (+ Austin/Dallas Store), `AGC Education`, `ARC Service Department`. These are
  fake/demo brands we made — per Greg's "just real customers + Springfield" they
  should go too, but the Acme fleet is a useful multi-location DEMO. Greg to confirm.

## The fix — tenant Archive feature (reversible; the safe path)
1. **Schema:** `Tenant.archivedAt DateTime? @map("archived_at")` (additive migration).
2. **Exclude archived** from: `GET /screens/fleet` children query
   (screens.controller.ts:1087 — `where:{ parentId: rootId, archivedAt: null }` →
   **this alone clears the Dodgers map**), the tenant/children listings
   (tenants.controller.ts:48/81/150), the school switcher, and super-console list
   (or show archived in a separate section).
3. **Endpoints (SUPER_ADMIN):** `POST /tenants/:id/archive` + `/unarchive` + a
   bulk-archive; audit-log each; guard against archiving a tenant with a *non-calm*
   emergency status.
4. **Apply:** bulk-archive the 63 confirmed test accounts post-deploy (archive is
   reversible — safe; keeps every real customer). Ambiguous demos pending Greg's call.

## Why not shipped in the 2026-07-23 session
It's a production schema migration touching the emergency-adjacent tenant model +
a mass state-change of live tenants — needs focused care + a deploy cycle + can't be
applied from a read-only session. Build it as its own reviewed change. NEVER weaken
the audit immutability (§16) or the emergency guards while doing it.
