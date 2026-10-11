---
title: Inviting staff and assigning roles
category: Getting Started
updated: 2026-10-11
excerpt: Bring your team into VenueOS, give them the right permissions, and revoke access cleanly when someone leaves.
---

# Inviting staff and assigning roles

Every VenueOS account starts with one user — the person who created the account. To get useful, you'll want to bring in colleagues.

## Role overview

These are the names you see in the product (on **Settings → People & access**):

| Role | Can do |
|---|---|
| **Super Admin** | Organization-wide administration: locations, people, branding, billing and sign-in settings. This is the person who created the account. |
| **Admin** | Runs one location: screens, playlists, content, and the staff at that location. |
| **Editor** | Uploads and edits content, builds templates, and manages schedules. Cannot manage people or settings. |
| **Viewer** | Read-only — can look at dashboards and playlists, but not change anything. |

VenueOS support staff have a separate **Platform Admin** role. It is never assignable from your dashboard.

You can only give roles below your own. Triggering emergency alerts is a separate permission — see [panic delegation](/help/panic-delegation).

## Inviting a user

1. Go to **Settings → People & access** and click **Invite user**.
2. Enter the person's email address, optionally their first and last name, and pick a **role**.
3. Choose how they get in:
   - **Email invite link** — we generate a single-use link and email it. The recipient sets their own password from it, so you never see it. The link is valid for 7 days. If email isn't configured, the page shows the link so you can send it yourself.
   - **Set password now** — you create the account immediately with a temporary password (at least 8 characters) and hand it over in person or over chat. They can change it after first sign-in.
4. Click **Send invitation** (or **Create user**).

Invited people appear under **Pending invitations** until they first sign in.

If you have SSO enabled, invited users can sign in with their organization account directly — they don't need a separate password. See [the SSO guide](/help/sso).

## Inviting many people

The People & access page invites one person at a time; there is no CSV invite import. Two ways to onboard many people:

- **SSO** — turn on [single sign-on](/help/sso) and set the default role for new accounts; people are created the first time they sign in.
- **Many locations at once** — for a multi-location rollout, the **First sign-in links** section of People & access downloads one CSV of one-time sign-in links, one per location, for accounts still on provisioning credentials.

## Changing roles

Admins can change a person's role from the **Role** dropdown on their row in **Settings → People & access**. The change is audit-logged. A downgrade signs the person out, so the lower access applies immediately.

## Revoking access

Two ways to cut a user off:

- **Disable** — signs them out now and blocks sign-in until you enable them again. Nothing is deleted, and their history stays in the audit log. Good for short leaves.
- **Remove user** — takes the account away. You can invite the person again later. Good for people who have left.

Disabling is reversible; removing is not.

## When someone leaves

If you use SSO, de-provisioning from your identity provider (Google Workspace, Entra, Clever) blocks login. We recommend **also** disabling the user in VenueOS to end any active sessions and API tokens.
