---
title: Delegating panic-button access
category: Emergency System
updated: 2026-10-11
excerpt: Give specific non-admin staff the ability to trigger emergencies without handing them the admin keys.
---

# Delegating panic-button access

Most organizations want more than just the top administrator to be able to trigger an alert. Front-desk staff, security, a shift lead, or a trained teacher or coach often need the same power without getting admin access to the CMS.

VenueOS handles this with a per-person emergency capability, separate from roles.

## Who can trigger by default

- **Super Admins** and **Admins** can trigger and clear alerts.
- **Editors** and **Viewers** cannot, unless an administrator has granted them the emergency capability.
- **API keys can never trigger or clear an alert.** This is deliberate and cannot be changed.

## How delegation works

The capability is granted **per person**, not through a role — triggering an emergency is a separate capability from configuring one.

To turn it on:

1. Go to **Settings → People & access**.
2. Find the person's row. Each **Editor** you manage has an **Emergency alerts** switch.
3. Tap the switch and confirm. The person can trigger alerts the next time they sign in.

Only Admins and Super Admins see the switch, and only for people below their own role. Admins and Super Admins don't need the switch themselves — their role already lets them trigger alerts. Viewers can never be given it.

Each grant and each revoke is audit-logged — who made it, for whom, and when.

A person with the capability sees the Emergency button in their dashboard and can use the `/panic` page, but **does not** gain any other admin ability. They cannot:

- Invite, change or remove people
- Edit settings or alert content
- View the audit log
- Manage billing or sign-in settings

## Best practices

- **Train every delegated person** on the 3-second hold, on choosing where an alert goes (all screens, a group, or one screen), on the **LIVE | DRILL** switch, and on when to call 911 first.
- **Require two-factor** for anyone who can trigger an alert. When an organization requires two-factor, people who can trigger an emergency must set up an authenticator app before they can sign in.
- **Review delegations quarterly.** People move on. The audit log has every grant and revoke.
- **Never delegate to contractors or temporary staff.** Create a break-glass admin account if a vendor needs temporary access for a specific event.
- **Drills**: delegated people can run drills too. Flip the switch to **DRILL** and scope the drill to a test group or a single screen so you don't alarm the whole building. See the [emergency system overview](/help/emergency-system).

## Revoking access

Turn the **Emergency alerts** switch off on the same person's row under **Settings → People & access**, and confirm. Revoking is more than hiding a button: the capability is carried inside the person's signed session, so revoking it also **ends that person's existing sessions**. A session still holding the old permission stops working instead of keeping it until it would have expired. The revoke is audit-logged, same as the grant.

There is no organization-wide "revoke everyone's panic access" switch today. During a compromised-credentials incident, **Disable** the affected accounts under **Settings → People & access** — disabling signs them out immediately and preserves their audit history.
