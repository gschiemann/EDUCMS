import { z } from 'zod';
import { AppRole } from '@cms/database';
import { TENANT_ASSIGNABLE_ROLES } from '../auth/role-assignment';

export type SsoProvider = 'SAML' | 'OIDC';

/**
 * Roles an SSO config may auto-provision users into (ACC-01, 2026-08-01).
 *
 * Mirrors `TENANT_ASSIGNABLE_ROLES` / `ApiKeysService.ALLOWED_ROLES`:
 * SUPER_ADMIN is a PLATFORM-OWNER role and is NOT reachable from a
 * tenant-scoped surface. Declared as a literal tuple (not `.map()`ed from the
 * shared array) because `z.enum` needs literal types — the `satisfies` check
 * below fails the BUILD if this tuple ever drifts from the shared list.
 */
export const SSO_ASSIGNABLE_DEFAULT_ROLES = [
  AppRole.DISTRICT_ADMIN,
  AppRole.SCHOOL_ADMIN,
  AppRole.CONTRIBUTOR,
  AppRole.RESTRICTED_VIEWER,
] as const;

// Build-time drift guard: same members, same order as the shared ceiling.
const _ssoRolesMatchTenantCeiling: readonly string[] = SSO_ASSIGNABLE_DEFAULT_ROLES;
if (
  _ssoRolesMatchTenantCeiling.length !== TENANT_ASSIGNABLE_ROLES.length ||
  _ssoRolesMatchTenantCeiling.some((r, i) => r !== TENANT_ASSIGNABLE_ROLES[i])
) {
  throw new Error(
    'SSO_ASSIGNABLE_DEFAULT_ROLES has drifted from TENANT_ASSIGNABLE_ROLES — ' +
      'the SSO auto-provisioning ceiling must stay identical to the shared one.',
  );
}

/** The role a config falls back to when none is set / a stored one is rejected. */
export const SSO_FALLBACK_DEFAULT_ROLE = AppRole.RESTRICTED_VIEWER;

/**
 * Request schema for `POST /api/v1/tenants/:tenantSlug/sso`.
 *
 * ACC-01 (2026-08-01): this route previously took a BARE `@Body() dto:
 * SsoConfigDto` with NO validation pipe — the interface was a compile-time
 * fiction and the runtime accepted any JSON. `defaultRole` in particular was
 * written to the DB verbatim, so `{"defaultRole":"SUPER_ADMIN"}` was stored
 * and later handed to `user.create()`. Every onboarding route already used a
 * ZodValidationPipe; this brings SSO in line.
 *
 * `.strict()` so an unknown key is a 400 rather than being silently dropped —
 * a typo'd field on a security config should fail loudly.
 */
export const SsoConfigSchema = z
  .object({
    provider: z.enum(['SAML', 'OIDC']),
    // Optional to preserve the pre-Zod runtime contract (`!!dto.enabled`),
    // where an omitted `enabled` meant "off".
    enabled: z.boolean().optional(),
    metadataUrl: z.string().max(2048).nullish(),
    entityId: z.string().max(512).nullish(),
    acsUrl: z.string().max(2048).nullish(),
    // Certs/secrets are length-capped so a multi-MB body can't reach the
    // AES seal (same DoS reasoning as the login password cap).
    x509Cert: z.string().max(32_768).nullish(),
    oidcIssuer: z.string().max(2048).nullish(),
    oidcClientId: z.string().max(512).nullish(),
    oidcClientSecret: z.string().max(4096).nullish(),
    defaultRole: z.enum(SSO_ASSIGNABLE_DEFAULT_ROLES).optional(),
    allowedEmailDomain: z.string().max(253).nullish(),
    autoProvision: z.boolean().optional(),
  })
  .strict();

export type SsoConfigDto = z.infer<typeof SsoConfigSchema>;

export interface SsoCallbackProfile {
  email: string;
  nameId?: string;
  displayName?: string | null;
  groups?: string[];
  raw?: unknown;
}
