# RBAC Matrix & Permission Boundaries

> **Status: current / living. Last verified against code: 2026-05-30.** This is
> the one 2026-04 design doc that still matches what shipped — verified, not
> assumed. Anchor cites:
> - The 5 roles are `AppRole` in `packages/database/index.ts:5-13`
>   (SUPER_ADMIN, DISTRICT_ADMIN, SCHOOL_ADMIN, CONTRIBUTOR, RESTRICTED_VIEWER).
> - Enforcement is the **app-layer `RbacGuard`** (`apps/api/src/auth/rbac.guard.ts:78`
>   — `requiredRoles.includes(role) || role === SUPER_ADMIN`), NOT Postgres
>   RLS. Tenant scoping is per-query `where: { tenantId }`. See `THREAT_MODEL.md` §1.
> - **Trigger / Clear Emergency** is gated to SUPER/DISTRICT/SCHOOL_ADMIN via
>   `@RequireRoles(...)` on the emergency controller (`apps/api/src/emergency/emergency.controller.ts`),
>   plus a per-scope ownership check ("SUPER_ADMIN may act on any tenant; everyone
>   else is strictly scoped"), plus the `@AllowPanicBypass` decorator + per-user
>   `canTriggerPanic` capability flag (CLAUDE.md emergency rules).
> - **Create/Upload Assets → approval**: CONTRIBUTOR (and RESTRICTED_VIEWER)
>   uploads land `PENDING_APPROVAL`; the three admin roles auto-`PUBLISHED`
>   (`apps/api/src/assets/assets.controller.ts:218-225`). The reviewer/approval
>   loop is the Sprint 1.5 submissions flow (`apps/api/src/submissions/`).
>
> Below the role columns is a *capability* on top of the role: `canTriggerPanic`
> is a per-user flag, so an admin role does not automatically imply panic rights
> unless the flag is set (and `@AllowPanicBypass` controls who may override it).

| Permission / Action | Super Admin | District Admin | School Admin | Contributor (Teacher) | Restricted Viewer |
|------------------|-------------|----------------|--------------|-----------------------|-------------------|
| **Scope** | Platform | Entire District | Single School | Single School | Single School |
| **Manage Districts** | Yes | No | No | No | No |
| **Manage Schools** | Yes | Yes | No | No | No |
| **Manage Users** | Yes | Yes | Yes (School only)| No | No |
| **Trigger Emergency Override**| Yes | Yes | Yes (School only)| No | No |
| **Clear Emergency Override**| Yes | Yes | Yes (School only)| No | No |
| **Manage Screen Groups** | Yes | Yes | Yes | No | No |
| **Provision Players** | Yes | Yes | Yes | No | No |
| **Create/Upload Assets** | Yes | Yes | Yes | Yes (Requires Approval)| No |
| **Approve Assets** | Yes | Yes | Yes | No | No |
| **Manage Playlists/Schedules**| Yes | Yes | Yes | Yes (Draft/Request) | No |
| **View Audit Logs** | Yes | Yes | Yes (School only)| No | No |
| **View Player Status** | Yes | Yes | Yes | Yes (Read-Only) | No |

## Role Definitions

### Super Admin
- Global platform owner. Absolute control over the infrastructure, all tenants, and global configurations. Allowed to force-clear any tenant's emergency state.

### District Admin
- Tenant owner. Full control across all schools within their district. Oversees school admins and can broadcast district-wide messages or emergencies (e.g., District-wide weather closures).

### School Admin
- Operational owner of a single school. Manages local screens, local players, local user accounts. Responsible for reviewing and approving Contributor workflows. Can trigger localized lockdowns for their school specifically.

### Contributor (Teacher/Staff)
- Content creators. Can upload assets and propose payloads for specific designated screen groups (e.g., "Ms. Smith's Classroom", "Library"). 
- **Restriction:** All general content must go through an approval workflow before becoming "Publishable". Cannot trigger emergencies.

### Restricted Viewer
- Allowed only to see system status, preview scheduled content, or view specific dashboards. Has zero mutation rights.
