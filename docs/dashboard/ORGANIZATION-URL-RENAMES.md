# Organization names and account URLs

Saving a new organization name in Settings → Organization also renames the
account URL (the tenant slug, the `[schoolId]` segment of every dashboard URL).
"Riverside Homes" becomes `/riverside-homes/dashboard`. The URL follows the name
directly. Screens, users, assets, schedules and playlists hang off the immutable
tenant ID and are untouched. There is **no URL history and no alias table**: the
old label is released the moment the rename commits.

## When the URL changes, and when it does not

`PATCH /api/v1/tenants/me` (SUPER_ADMIN / DISTRICT_ADMIN, acting only on
`req.user.tenantId`) re-derives the URL **only when all of these hold**:

1. **The name actually changed.** The trimmed name differs from the stored one.
   A client that posts the same name back with an address edit, an address-only
   save and an industry-only save never touch the URL.
2. **The organization has no single sign-on configuration.** If a
   `TenantSSOConfig` row exists (enabled or not) the name still changes but the
   URL is kept, the response says `urlKept: 'sso'`, and the audit row records
   it. The identity provider has the ACS URL, entity ID and OIDC redirect URI
   registered on its side, and all three embed the slug
   (`SsoService.buildServiceProviderMetadata`); renaming would silently break
   sign-in. The check runs inside the same transaction as the write.

The name must be a string, trimmed, 1–120 characters (`400`
`TENANT_NAME_REQUIRED` / `TENANT_NAME_TOO_LONG` otherwise, before any read or
write). The Settings field stops typing at 120.

### How the label is derived

Accents are removed (NFKD), the name is lower-cased, every run of characters
outside `a-z0-9` becomes one hyphen, the result is cut to 60 characters and
trimmed of hyphens. A name that yields fewer than two characters (for example
one with no ASCII letters) or a **reserved word** becomes
`organization-<first 8 characters of the tenant id>`.

If another organization already holds the label, this one takes
`<label>-<tenant id prefix>`, then `…-2`, `…-3` (up to 100 candidates).

### One list of reserved words

A slug shares the first path segment with every route the web origin serves, so
a tenant named `player` or `super` would be unreachable or would shadow a real
page. The list is `RESERVED_TENANT_SLUGS` in `@cms/api-types` and is read by
every path that mints or accepts a slug: the rename above, add-a-location
(`POST /tenants/children`, including an explicit `slug`) and self-signup. A
reserved word is refused exactly like a taken slug (same `409`, same code and
message). Before this change add-a-location and signup had **no** reserved-word
check at all.

`apps/api/src/tenants/reserved-tenant-slugs.spec.ts` reads the directory names
under `apps/web/src/app` and `apps/web/public` from disk and fails when one is
not reserved, so a new top-level route cannot become claimable by accident.
`public/locales/` is generated and gitignored, so the spec asserts it explicitly.

### The transaction

Per attempt, in one transaction through `tx` only: read the current name and
URL → (if renaming) check for single sign-on → (if renaming and none) pick a
free label → update the tenant → write the `TENANT_UPDATED` audit row, awaited.
The audit row records the new values, `previousName`, `previousSlug` and
`urlKept`. If the audit write fails, **the rename rolls back with it**: the old
name and URL stay, and the error reaches the caller.

The availability read is only a courtesy; the unique constraint on
`Tenant.slug` is the real guard. If another request commits the same label
between the read and the write, the update fails with `P2002`, the transaction
rolls back and the handler retries with a suffix. A write conflict (`P2034`) is
retried the same way. Three attempts, then `409 TENANT_URL_BUSY`. A uniqueness
failure on the audit insert is **not** mistaken for a URL claim. No schema
change or migration is involved.

## In the browser

Settings → Organization shows the current URL and says the URL follows the name.
After a save the page re-reads the tenant and the switcher's list. If the server
answered `urlKept: 'sso'` the promise is replaced by one sentence naming the URL
it still holds; the page never guesses.

`TenantUrlCanonicalizer`, mounted in the shared `[schoolId]` layout, re-labels
the signed-in organization's own stale URL after a rename (bookmark, email link,
another tab), keeping path, query and anchor. It never switches accounts, mints
a token or treats a URL as authorization.

**`[schoolId]` is not always the signed-in tenant**, which is why the rule is
narrow. `GET /tenants` (`useTenant()`) answers for the *token's* tenant, never
the URL's. Switching accounts re-mints the token before navigating, so after a
switch the two agree. But the launch chooser and the mobile fleet cards link a
district admin or super-admin straight to `/<location>/…` without a switch, so
there the URL names a different tenant than the token. The rule therefore
rewrites a first segment only when it is **not** the signed-in tenant's slug, **not**
a reserved word, and **not** the slug or id of any *other* tenant in
`GET /tenants/accessible`. Until that list has loaded it waits. The user's own
row in a stale list is ignored so it cannot shield the old label. The rewrite
target must itself be a `[a-z0-9-]` label, so the sentinel `__system__` tenant
is never written into a URL.

## What else carries a slug

| Carrier | After a rename |
|---|---|
| SSO identity-provider registrations, SSO sign-in by organization slug | Protected: an organization with an SSO configuration keeps its URL. |
| `GET /api/v1/branding/public/by-slug/:slug` (no auth) | The old label answers for whoever holds it now, or `null`. At this commit `getBrandingBySlug` has no caller in the web app. |
| JWT `tenantSlug` claim, used for Stripe return URLs | Stale until the user signs in again; the return lands on the old label and the canonicalizer re-labels it. |
| Emails already sent, bookmarks, open tabs | Old label; re-labelled for signed-in members only. |
| USB bundle manifests, the player's stored `tenant_slug` | Informational; nothing validates them against the slug. |
| The browser's cached user (`tenantSlug`) | Stale until the next sign-in; the canonicalizer covers it. |

## The trade-off the owner accepted

Releasing the old label has consequences that are deliberate and should be
known, not discovered:

- **Another organization can claim the released label immediately**, through
  signup, add-a-location or its own rename. Nothing reserves it.
- **The only unauthenticated consumers of a slug** are the public branding read
  above and the SSO routes. SSO is protected by the keep-the-URL rule, with one
  gap: protection starts when the SSO configuration is saved, so identity-provider
  URLs copied from the SSO settings page *before* the first save are not covered.
  The public branding read will describe the new holder of a released label.
- **Existing bookmarks to the old label re-canonicalize only for a signed-in
  member of the renamed organization.** Anyone else, including signed-out
  visitors, gets no redirect, and a link to the old label may end up on a
  different organization's URL. A super-admin who can open the organization that
  now holds the label sees *that* organization, by design.

## Verification

API: `organization-rename.spec.ts` (in-memory database whose transaction really
commits or rolls back and whose non-transaction handle throws), `tenant-slug.spec.ts`,
`reserved-tenant-slugs.spec.ts`, plus add-a-location and signup cases in
`tenants.controller.spec.ts` and `onboarding.service.spec.ts`.
Web: `tenant-url.test.ts`, `TenantUrlCanonicalizer.test.tsx`,
`OrganizationPage.test.tsx`, and `tests/e2e/organization-url.spec.ts` (rename,
failed save, SSO kept, a district admin on a location's URL).
No APK, emergency, realtime or auth-guard change is involved.
