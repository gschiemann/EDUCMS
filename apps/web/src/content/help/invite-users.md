---
title: Inviting staff and assigning roles
category: Getting Started
updated: 2026-04-16
excerpt: Bring your team into EduSignage, give them the right permissions, and revoke access cleanly when someone leaves.
---

# Inviting staff and assigning roles

Every EduSignage account starts with one user — the person who created the account. To get useful, you'll want to bring in colleagues.

## Role overview

| Role | Can do |
|---|---|
| **SUPER_ADMIN** | Manage every tenant in the system. Only EduSignage staff have this. |
| **DISTRICT_ADMIN** | Manage schools, users, and branding for the whole district. |
| **SCHOOL_ADMIN** | Manage screens, playlists, staff, and settings within one school. |
| **CONTRIBUTOR** | Upload assets, build templates, create schedules. Cannot manage users or settings. |
| **RESTRICTED_VIEWER** | Read-only — can preview dashboards and playlists, but not change anything. |

## Inviting a user

1. Go to **Settings → Users → Invite user**.
2. Enter the person's email address and pick a role (default: CONTRIBUTOR).
3. Optionally tick **Can trigger emergency alerts** if this person should have panic-button access. See [panic delegation](/help/panic-delegation).
4. Click **Send invite**. They'll receive a signed, single-use link valid for 7 days.

If you have SSO enabled, invited users can sign in with their district account directly — they don't need to set a separate password.

## Bulk invites

For more than about 10 users at once, use **Settings → Users → Bulk invite** and paste a CSV:

```
email,role,canTriggerPanic
alice@lincolnusd.org,SCHOOL_ADMIN,true
bob@lincolnusd.org,CONTRIBUTOR,false
```

Rows with invalid emails or unknown roles are skipped and reported after upload.

## Changing roles

Admins can change any user's role from that user's profile page. The change is audit-logged. Downgrading a user from SCHOOL_ADMIN to CONTRIBUTOR takes effect on their next page load.

## Revoking access

Two ways to remove a user:

- **Disable** — preserves their history (audit log entries still show their name) but immediately kicks them out. Good for short leaves.
- **Delete** — permanent, strips personal info from audit entries (replaced with "former user"). Good for terminations.

Disabling is reversible; deleting is not.

## When someone leaves the district

If you use SSO, de-provisioning from your IdP (Google Workspace, Entra, Clever) automatically blocks login. We recommend **also** disabling the user in EduSignage to revoke any active sessions and API tokens.
