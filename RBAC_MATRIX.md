# RBAC Matrix & Permission Boundaries

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
