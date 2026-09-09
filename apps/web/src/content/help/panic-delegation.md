---
title: Delegating panic-button access
category: Emergency System
updated: 2026-09-08
excerpt: Give specific non-admin staff the ability to trigger emergencies without handing them the admin keys.
---

# Delegating panic-button access

Most districts want more than just the principal to be able to trigger a lockdown. Front-office staff, SROs, and trained teachers often need the same power without getting full admin access to the CMS.

VenueOS handles this through a per-user capability flag: `canTriggerPanic`.

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

Toggle `canTriggerPanic` off from the same user profile screen. This is more than hiding a button: the capability is carried inside the user's signed session, so revoking it also **revokes that user's existing sessions**. A session still holding the old permission stops working instead of keeping it until the token would have expired. The revoke is audit-logged, same as the grant.

There is no tenant-wide "revoke everyone's panic access" switch today. During a compromised-credentials incident, revoke the affected accounts individually under **Settings → Users**, or **Disable** those accounts outright — disabling also revokes their live sessions and kicks them out, while preserving their audit history.
