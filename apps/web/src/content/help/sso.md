---
title: Setting up SSO (Google, Microsoft, SAML)
category: SSO
updated: 2026-04-16
excerpt: Configure district-wide single sign-on so staff never have to remember another password.
---

# Setting up SSO

EduSignage supports three SSO paths on District and Enterprise plans:

- **Google Workspace** (OIDC)
- **Microsoft Entra ID / Azure AD** (OIDC)
- **Generic SAML 2.0 or OIDC** IdPs (Okta, OneLogin, Clever, Classlink)

## Why SSO

- Staff use existing credentials — fewer passwords to leak or reset
- When someone leaves the district, de-provisioning from your IdP removes their access everywhere
- Enforces MFA at the district level without each vendor building their own

## Google Workspace (OIDC)

1. Go to **Settings → Authentication → Add identity provider**.
2. Pick **Google**.
3. In your Google Admin console, add EduSignage as an OAuth client. The redirect URI we require is:
   `https://your-domain.edusignage.app/api/v1/auth/oidc/callback`
4. Paste the client ID and secret back into the EduSignage dashboard.
5. Restrict sign-in to users whose email ends in your district domain (e.g. `@lincolnusd.org`).
6. Click **Test connection**, then **Enable**.

## Microsoft Entra ID (OIDC)

1. In the Azure portal, register a new **App** with the redirect URI above.
2. Under **API Permissions**, add `openid`, `profile`, `email`.
3. Copy the tenant ID, client ID, and generate a client secret.
4. In EduSignage: **Settings → Authentication → Add identity provider → Microsoft**, and paste the three values.
5. Test, then enable.

## Generic SAML 2.0

Harder but fully supported. From **Settings → Authentication → Add identity provider → SAML**, we provide:

- **Entity ID** (unique per tenant)
- **ACS URL** (the reply URL you paste into your IdP)
- **Metadata URL** (your IdP can auto-import our config)

On your IdP, create a new SAML app with those values. Required attributes:

- `email` (NameID format)
- `firstName`
- `lastName`
- *(Optional)* `role` — if you send this, we map it to EduSignage roles; otherwise everyone comes in as CONTRIBUTOR and admins promote from there.

## Just-In-Time (JIT) provisioning

By default, first-time SSO users are created automatically with the CONTRIBUTOR role. You can disable JIT (**Settings → Authentication → Allow JIT creation**) if you want to pre-provision every user through Clever rostering instead.

## Troubleshooting

- **Redirect loop**: your IdP is sending a different email domain than we expect. Check the domain restriction setting.
- **"No matching tenant"**: the user's email domain isn't registered on any tenant. Add it under **Settings → Domains**.
- **"Role not found"**: your SAML `role` attribute isn't in our allowed values. The canonical set is `SUPER_ADMIN`, `DISTRICT_ADMIN`, `SCHOOL_ADMIN`, `CONTRIBUTOR`, `RESTRICTED_VIEWER`.
