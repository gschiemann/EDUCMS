---
title: Delegating panic-button access
category: Emergency System
updated: 2026-04-16
excerpt: Give specific non-admin staff the ability to trigger emergencies without handing them the admin keys.
---

# Delegating panic-button access

Most districts want more than just the principal to be able to trigger a lockdown. Front-office staff, SROs, and trained teachers often need the same power without getting full admin access to the CMS.

EduSignage handles this through a per-user capability flag: `canTriggerPanic`.

## How it works

1. A SCHOOL_ADMIN or higher opens the user's profile under **Settings → Users**.
2. Toggle **Can trigger emergency alerts** to on.
3. The change is audit-logged (who granted it, when).

That user now sees the panic button in their dashboard and on `/panic`, but **does not** gain any other admin capability. They cannot:

- Create or delete users
- Modify templates or schedules for screens they don't own
- View audit logs
- Access district-level settings

## The `@AllowPanicBypass()` decorator

Under the hood, the emergency controller uses a `@AllowPanicBypass()` decorator that lets users with the `canTriggerPanic` flag bypass the normal role check. The decorator is **only** applied to the trigger and all-clear endpoints — not to anything else. This keeps the delegation narrow by design.

## Best practices

- **Train every delegated user** on the 3-second hold, scoping (tenant vs. group vs. device), and when to call 911 first.
- **Review delegations quarterly.** Staff turn over. The audit log has every grant and revoke.
- **Never delegate to contractors or temporary staff.** Create a break-glass admin account if a vendor needs temporary access for a specific event.
- **Emergency drills**: delegated users can participate in drills, but always scope drills to a test screen group so you don't alarm the whole building.

## Revoking access

Toggle `canTriggerPanic` off from the same user profile screen. The change is immediate — the user loses panic UI on their next page load.

If you need to revoke emergency capability from **everyone at once** (e.g. during a compromised-credentials incident), a SUPER_ADMIN can use the tenant-wide **Lock emergency controls** kill switch under **Settings → Security**. This requires a SUPER_ADMIN to undo — a deliberate friction to prevent mistakes.
