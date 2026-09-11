"use client";

/**
 * /[schoolId]/settings/people — People & access (§7.8).
 *
 * Wave 2: extracted out of the all-in-one landing page. Team members,
 * pending invitations, the role ladder, MFA policy, SSO and content
 * approval are one job on one URL, with anchors the ⌘K palette can jump to.
 *
 * There is no page-level save: every action here is a per-row mutation
 * (§13.1 — "save per category/editor", and this editor never becomes
 * dirty). The one real form in this section, SSO, lives on its own route
 * and registers its own dirty count.
 */
import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTenant, useUsers, useLicense, useAuditLog } from '@/hooks/use-api';
import { useUIStore } from '@/store/ui-store';
import { SettingsPageFrame } from '@/components/settings/shell/SettingsPageFrame';
import { ContextModule, ContextAction, ScopePath, PermissionDenied } from '@/components/settings/shell/primitives';
import { PeopleAccessEditor } from '@/components/settings/people/PeopleAccessEditor';
import { SSO_ROLES, useSsoSettings } from '@/components/settings/people/SsoSettingsEditor';

/** Roles the People routes are presented to (the API guards independently). */
const PEOPLE_ROLES = ['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN'];

/**
 * Audit actions that ARE an access-policy change. Used to pick the newest
 * relevant entry out of a single unfiltered `/audit` page — the endpoint's
 * `action` filter is exact-match, so one request beats six.
 */
const ACCESS_ACTIONS = new Set([
  'USER_CREATED', 'USER_CREATED_DIRECT', 'USER_INVITED', 'INVITE_ACCEPTED',
  'USER_ROLE_CHANGED', 'USER_MFA_REQUIRED_CHANGED', 'USER_CAN_TRIGGER_PANIC_CHANGED',
  'USER_DELETED', 'USER_DISABLED', 'USER_ENABLED',
  // 2026-09-11 — the ORG-WIDE MFA policy. Omitting it would mean the one
  // setting on this page that changes how everybody signs in never shows up
  // on the page's own "last access change" rail.
  'TENANT_MFA_POLICY_CHANGED',
]);

export default function PeopleSettingsPage() {
  const t = useTranslations();
  const params = useParams<{ schoolId: string }>();
  const schoolId = params?.schoolId ?? '';
  const role = useUIStore((s) => s.user?.role as string | undefined);
  const allowed = !!role && PEOPLE_ROLES.includes(role);
  const ssoManageable = !!role && SSO_ROLES.includes(role);

  const { data: tenant } = useTenant();
  const tenantName = (tenant as { name?: string } | undefined)?.name ?? '';
  const { data: users } = useUsers();
  const { data: license } = useLicense();
  const sso = useSsoSettings(schoolId, ssoManageable && allowed);
  // One page of recent activity, admin-gated. Never rendered as an empty
  // history for a role the endpoint would refuse (§10).
  const audit = useAuditLog({ limit: 50, enabled: allowed });

  const rows = useMemo(() => (Array.isArray(users) ? users : []), [users]);
  const pendingCount = rows.filter((u) => u.status === 'INVITED').length;
  const mfaRequiredCount = rows.filter((u) => u.mfaRequired).length;

  const lastAccessChange = useMemo(() => {
    const items = audit.data?.items;
    if (!Array.isArray(items)) return null;
    return items.find((i: { action?: string }) => !!i.action && ACCESS_ACTIONS.has(i.action)) ?? null;
  }, [audit.data]);

  const ssoLabel = !ssoManageable
    ? null
    : sso.isError
      ? t('settings.common.unavailable')
      : sso.data?.config
        ? (sso.data.config.enabled ? t('settings.cc.people.ssoEnabled') : t('settings.cc.people.ssoStored'))
        : t('settings.cc.people.ssoNotConfigured');

  const context = (
    <>
      <ContextModule
        label={t('settings.cc.people.railAppliesTo')}
        title={tenantName || t('settings.cc.people.railThisOrganization')}
      >
        {t('settings.cc.people.railAppliesToHelp')}
        <ScopePath from={tenantName || t('settings.cc.people.railThisOrganization')} to={t('settings.cc.people.railAllLocations')} />
      </ContextModule>

      <ContextModule
        label={t('settings.cc.people.railAccessPolicy')}
        title={t('settings.cc.people.railMembers', { count: rows.length })}
      >
        <ul className="space-y-0.5">
          <li>{t('settings.cc.people.railMfaRequired', { count: mfaRequiredCount })}</li>
          <li>{t('settings.cc.people.railPendingInvites', { count: pendingCount })}</li>
          {ssoLabel && <li>{t('settings.cc.people.railSso', { status: ssoLabel })}</li>}
        </ul>
      </ContextModule>

      {license && (
        <ContextModule
          label={t('settings.cc.people.railPlan')}
          title={t('settings.cc.people.railSeats', {
            used: license.seatsUsed,
            limit: typeof license.seatLimit === 'number' && license.seatLimit > 0
              ? String(license.seatLimit)
              : t('settings.cc.people.railUnlimited'),
          })}
        >
          {/* Honest: plan seats meter PAIRED SCREENS (LicenseService.usedSeats
              counts Screen rows), not team accounts. Saying otherwise on a
              People page would invent an impact that does not exist. */}
          {t('settings.cc.people.railSeatsHelp')}
          <ContextAction href={`/${schoolId}/settings/billing`}>{t('settings.cc.people.railViewBilling')}</ContextAction>
        </ContextModule>
      )}

      <ContextModule
        label={t('settings.cc.people.railLastChange')}
        title={lastAccessChange
          ? String(lastAccessChange.action).replace(/_/g, ' ').toLowerCase()
          : t('settings.cc.people.railNoRecentChange')}
      >
        {lastAccessChange ? (
          <>
            {lastAccessChange.user?.email ?? t('settings.cc.people.railUnknownActor')}
            {lastAccessChange.createdAt ? ` · ${new Date(lastAccessChange.createdAt).toLocaleString()}` : ''}
          </>
        ) : (
          t('settings.cc.people.railNoRecentChangeHelp')
        )}
        <ContextAction href={`/${schoolId}/audit`}>{t('settings.cc.people.railViewAudit')}</ContextAction>
      </ContextModule>
    </>
  );

  const searchItems = useMemo(() => ([
    { label: t('settings.cc.people.inviteUser'), keywords: ['invite', 'add user', 'new user', 'staff'], anchor: 'team' },
    { label: t('settings.cc.people.rolesTitle'), keywords: ['role', 'permissions', 'rank', 'admin'], anchor: 'roles' },
    { label: t('settings.cc.people.mfaTitle'), keywords: ['mfa', '2fa', 'two-factor', 'require mfa', 'authenticator'], anchor: 'mfa' },
    { label: t('settings.cc.people.ssoTitle'), keywords: ['sso', 'saml', 'oidc', 'login', 'okta', 'google workspace'], href: `/${schoolId}/settings/people/sso` },
    { label: t('settings.approval.title'), keywords: ['approval', 'review', 'publish gate'], anchor: 'approval' },
  ]), [t, schoolId]);

  return (
    <SettingsPageFrame
      section="people"
      title={t('settings.shell.sections.people.label')}
      description={t('settings.shell.sections.people.description')}
      scope={{ kind: 'organization', label: tenantName }}
      context={allowed ? context : undefined}
      searchItems={allowed ? searchItems : undefined}
    >
      {allowed ? (
        <PeopleAccessEditor
          ssoManageable={ssoManageable}
          ssoHref={`/${schoolId}/settings/people/sso`}
          securityHref={`/${schoolId}/settings/security`}
        />
      ) : (
        <PermissionDenied sectionLabel={t('settings.shell.sections.people.label')} />
      )}
    </SettingsPageFrame>
  );
}
