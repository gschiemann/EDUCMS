---
title: Setting up single sign-on (SSO)
category: SSO
updated: 2026-07-21
excerpt: Let staff sign in with the account they already use — Google Workspace, Microsoft Entra ID, Okta, or any OIDC identity provider.
---

# Setting up single sign-on

With SSO, staff sign in with the work account they already have — no new password to remember, and offboarding happens in your identity provider, not screen by screen.

VenueOS connects to any **OpenID Connect (OIDC)** identity provider. That covers:

- **Google Workspace**
- **Microsoft Entra ID** (Azure AD)
- **Okta, OneLogin, Auth0, Classlink**, and other OIDC-capable IdPs

> Need a different enterprise IdP protocol? It's on our roadmap — contact support and we'll walk through your identity setup together.

## Connect your identity provider

1. In your IdP, create a new **OIDC web application**. Use the **redirect URI** shown on our settings page (step 2) — it must match exactly, including `https`.
2. Open **Settings → SSO** in VenueOS. Your workspace's redirect URI and identifiers are there ready to copy.
3. Paste in from your IdP: the **Issuer URL**, **Client ID**, and **Client Secret**.
4. Optionally restrict sign-ins to your email domain (e.g. `yourschool.org`) and choose the **default role** new SSO users receive.
5. Save, then test it from the login page.

## How staff sign in

On the login page, staff click **Sign in with SSO** and enter your organization's short name once. They land in your IdP's familiar sign-in screen; after that it's one click.

## Roles and provisioning

- First-time SSO users are created automatically with the **default role** you chose. Prefer invite-only? Turn auto-provisioning off in the same settings.
- Adjust any individual any time in **Settings → Team**.

## Troubleshooting

- **"SSO is not enabled" on the login page** — the organization short name was typed differently than your workspace's, or SSO hasn't been saved yet.
- **Redirect error inside your IdP** — the redirect URI in the IdP app doesn't exactly match the one on our settings page.
- **Signed in, wrong permissions** — check the default role under **Settings → SSO**, then adjust the person under **Settings → Team**.
