"use client";

/**
 * People & access — the editor body of /[schoolId]/settings/people (§7.8).
 *
 * EXTRACTED, not rewritten, from the all-in-one settings page
 * (`_legacy/LegacySettingsPage.tsx`): the same hooks, the same mutations,
 * the same `canAssignRole` rank mirror, the same honest invite fallback.
 * The API stays authoritative for rank — this file only decides whether a
 * control is RENDERED, so a peer/self row shows nothing instead of a
 * guaranteed 403.
 *
 * Subsections are divider `EditorSection`s with stable anchor ids so the
 * command palette can jump to them: #team #invites #roles #mfa #sso
 * #approval.
 *
 * Deliberately ABSENT, because the API does not expose the data (checked
 * 2026-09-02):
 *   - a location/scope column — `GET /users` selects id, email, role,
 *     createdAt, firstName, lastName, mfaRequired, mfaTotpVerifiedAt,
 *     status. No location, no child-tenant id.
 *   - invitation expiry / resend / revoke — `UserInvite` rows exist in the
 *     schema but no endpoint lists them; the only invite signal reaching the
 *     client is `status === 'INVITED'` on the user row. "Pending invitations"
 *     is therefore an honest view of THAT, and says so.
 */
import { useMemo, useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  UserPlus, Trash2, Loader2, ShieldCheck, ShieldOff, Ban, Lock, KeyRound,
  Users as UsersIcon, MailCheck, Search,
} from 'lucide-react';
import {
  useUsers, useInviteUser, useCreateUserDirect, useDeleteUser, useUpdateUserRole,
  useSetUserMfaRequired, useSetUserDisabled,
  useContentApprovalConfig, useToggleContentApproval,
  type TeamUser,
} from '@/hooks/use-api';
import { useUIStore } from '@/store/ui-store';
import { canAssignRole } from '@/lib/role-assignment';
import { useTenantCopy } from '@/hooks/use-tenant-copy';
import { appConfirm } from '@/components/ui/app-dialog';
import { EditorHead, EditorSection, StatusPill, ErrorSummary } from '@/components/settings/shell/primitives';

const ROLES = ['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN', 'CONTRIBUTOR', 'RESTRICTED_VIEWER'] as const;

const ROLE_TONE: Record<string, string> = {
  SUPER_ADMIN: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  DISTRICT_ADMIN: 'bg-violet-50 text-violet-700 border-violet-200',
  SCHOOL_ADMIN: 'bg-sky-50 text-sky-700 border-sky-200',
  CONTRIBUTOR: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  RESTRICTED_VIEWER: 'bg-slate-50 text-slate-600 border-slate-200',
};

export function displayName(u: Pick<TeamUser, 'firstName' | 'lastName' | 'email'>): string | null {
  const fn = (u.firstName || '').trim();
  const ln = (u.lastName || '').trim();
  return fn || ln ? `${fn} ${ln}`.trim() : null;
}

function initials(u: TeamUser): string {
  const fn = (u.firstName || '').trim();
  const ln = (u.lastName || '').trim();
  const fromName = `${fn ? fn[0] : ''}${ln ? ln[0] : ''}`.toUpperCase();
  return fromName || (u.email?.substring(0, 2).toUpperCase() || '??');
}

/** Small labelled cell: the label shows only under 768px (§14 — rows become cards). */
function Cell({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <span className="md:hidden block w-full text-[11px] font-medium tracking-[.04em] uppercase text-slate-400 mb-0.5">{label}</span>
      {children}
    </div>
  );
}

export function PeopleAccessEditor({ ssoManageable, ssoHref, securityHref }: {
  ssoManageable: boolean;
  ssoHref: string;
  securityHref: string;
}) {
  const t = useTranslations();
  const tenantCopy = useTenantCopy();
  const { data: users, isLoading: usersLoading, isError: usersError } = useUsers();

  const callerRole = useUIStore((s) => s.user?.role);
  const callerId = useUIStore((s) => s.user?.id);

  const inviteUser = useInviteUser();
  const createDirect = useCreateUserDirect();
  const deleteUser = useDeleteUser();
  const updateRole = useUpdateUserRole();
  const setMfaRequired = useSetUserMfaRequired();
  const setUserDisabled = useSetUserDisabled();

  // ── Invite form ──────────────────────────────────────────────────────
  const [showAddUser, setShowAddUser] = useState(false);
  const [inviteMode, setInviteMode] = useState<'email' | 'password'>('password');
  const [newEmail, setNewEmail] = useState('');
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newRole, setNewRole] = useState<string>('CONTRIBUTOR');
  const [newPassword, setNewPassword] = useState('');
  const [inviteStatus, setInviteStatus] = useState<{ kind: 'ok' | 'err' | 'copy'; message: string; acceptUrl?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const inviteEmailRef = useRef<HTMLInputElement>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  useEffect(() => {
    if (showAddUser) inviteEmailRef.current?.focus();
  }, [showAddUser]);

  const handleInvite = async () => {
    if (!newEmail.trim()) return;
    setInviteStatus(null);
    try {
      if (inviteMode === 'password') {
        if (newPassword.length < 8) {
          setInviteStatus({ kind: 'err', message: t('settings.cc.people.passwordTooShort') });
          return;
        }
        await createDirect.mutateAsync({
          email: newEmail.trim(),
          role: newRole,
          password: newPassword,
          firstName: newFirstName.trim() || undefined,
          lastName: newLastName.trim() || undefined,
        });
        setInviteStatus({ kind: 'ok', message: t('settings.cc.people.createdOk', { email: newEmail.trim() }) });
        setNewEmail(''); setNewPassword(''); setNewFirstName(''); setNewLastName('');
        setShowAddUser(false);
        return;
      }
      const res = await inviteUser.mutateAsync({
        email: newEmail.trim(),
        role: newRole,
        firstName: newFirstName.trim() || undefined,
        lastName: newLastName.trim() || undefined,
      }) as { acceptUrl?: string; emailDelivered?: boolean };
      // The API returns { acceptUrl, emailDelivered }. When outbound email is
      // not configured we surface the accept link instead of claiming an email
      // was sent (CLAUDE.md: EMAIL_FROM / RESEND_API_KEY are commonly unset).
      if (res?.emailDelivered === false && res?.acceptUrl) {
        setInviteStatus({
          kind: 'copy',
          message: t('settings.cc.people.inviteEmailNotConfigured', { email: newEmail.trim() }),
          acceptUrl: res.acceptUrl,
        });
      } else {
        setInviteStatus({ kind: 'ok', message: t('settings.cc.people.inviteSent', { email: newEmail.trim() }) });
        setShowAddUser(false);
      }
      setNewEmail(''); setNewFirstName(''); setNewLastName('');
    } catch (err) {
      setInviteStatus({ kind: 'err', message: (err as Error)?.message || t('settings.cc.people.inviteFailed') });
    }
  };

  // ── Filters ──────────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const rows: TeamUser[] = useMemo(() => (Array.isArray(users) ? users : []), [users]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((u) => {
      if (roleFilter !== 'ALL' && u.role !== roleFilter) return false;
      const st = u.status || 'ACTIVE';
      if (statusFilter !== 'ALL' && st !== statusFilter) return false;
      if (!q) return true;
      const name = (displayName(u) || '').toLowerCase();
      return name.includes(q) || (u.email || '').toLowerCase().includes(q);
    });
  }, [rows, query, roleFilter, statusFilter]);

  const pending = useMemo(() => rows.filter((u) => u.status === 'INVITED'), [rows]);
  const mfaRequiredCount = useMemo(() => rows.filter((u) => u.mfaRequired).length, [rows]);

  const approval = useContentApprovalConfig();
  const toggleApproval = useToggleContentApproval();
  const approvalEnabled = !!approval.data?.enabled;

  return (
    <>
      <EditorHead
        icon={UsersIcon}
        title={t('settings.cc.people.editorTitle')}
        description={t('settings.cc.people.editorDescription')}
      />

      {rowError && (
        <ErrorSummary
          title={t('settings.cc.people.actionFailed')}
          errors={[{ message: rowError }]}
        />
      )}

      {/* ── Team members ────────────────────────────────────────────── */}
      <EditorSection
        id="team"
        title={t('settings.team.teamMembers')}
        description={t('settings.cc.people.teamDescription')}
        action={
          <button
            type="button"
            onClick={() => { setShowAddUser((v) => !v); setInviteStatus(null); }}
            aria-expanded={showAddUser}
            aria-controls="people-invite-form"
            className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-[9px] text-[12px] font-medium text-[var(--brand-primary-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
            style={{ background: 'var(--brand-primary)' }}
          >
            <UserPlus className="w-3.5 h-3.5" aria-hidden /> {t('settings.cc.people.inviteUser')}
          </button>
        }
      >
        {inviteStatus && (
          <div
            role="status"
            className={`mb-3 rounded-[10px] border px-3 py-2.5 text-[12px] ${
              inviteStatus.kind === 'ok'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : inviteStatus.kind === 'copy'
                  ? 'bg-amber-50 border-amber-200 text-amber-900'
                  : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            <p className="font-medium">{inviteStatus.message}</p>
            {inviteStatus.kind === 'copy' && inviteStatus.acceptUrl && (
              <div className="mt-2 flex flex-col sm:flex-row gap-2">
                <label htmlFor="people-accept-url" className="sr-only">{t('settings.cc.people.acceptLinkLabel')}</label>
                <input
                  id="people-accept-url"
                  readOnly
                  value={inviteStatus.acceptUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 min-h-[38px] px-2 rounded-[8px] border border-amber-300 bg-white text-[11px] font-mono"
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(inviteStatus.acceptUrl || '');
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="min-h-[38px] px-3 rounded-[8px] bg-amber-600 hover:bg-amber-700 text-white text-[12px] font-medium"
                >
                  {copied ? t('settings.common.copied') : t('settings.cc.people.copyLink')}
                </button>
              </div>
            )}
          </div>
        )}

        {showAddUser && (
          <div id="people-invite-form" className="mb-4 rounded-[11px] border border-slate-200 bg-slate-50/70 p-3.5">
            <div className="inline-flex rounded-[9px] border border-slate-200 bg-white p-0.5 mb-3">
              <button
                type="button"
                onClick={() => setInviteMode('password')}
                aria-pressed={inviteMode === 'password'}
                className={`min-h-[34px] px-3 rounded-[7px] text-[12px] font-medium ${inviteMode === 'password' ? 'text-[var(--brand-primary-ink)]' : 'text-slate-600 hover:text-slate-900'}`}
                style={inviteMode === 'password' ? { background: 'var(--brand-primary)' } : undefined}
              >
                {t('settings.team.setPasswordNow')}
              </button>
              <button
                type="button"
                onClick={() => setInviteMode('email')}
                aria-pressed={inviteMode === 'email'}
                className={`min-h-[34px] px-3 rounded-[7px] text-[12px] font-medium ${inviteMode === 'email' ? 'text-[var(--brand-primary-ink)]' : 'text-slate-600 hover:text-slate-900'}`}
                style={inviteMode === 'email' ? { background: 'var(--brand-primary)' } : undefined}
              >
                {t('settings.team.emailInviteLink')}
              </button>
            </div>
            <p className="text-[12px] leading-[17px] text-slate-500 mb-3">
              {inviteMode === 'password'
                ? t('settings.cc.people.modePasswordHelp')
                : t('settings.cc.people.modeEmailHelp')}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label htmlFor="people-first" className="block text-[12px] font-medium text-slate-700 mb-1">{t('settings.cc.people.firstName')}</label>
                <input id="people-first" value={newFirstName} onChange={(e) => setNewFirstName(e.target.value)} type="text" maxLength={80}
                  className="w-full min-h-[42px] px-3 rounded-[9px] border border-slate-300 bg-white text-[13px]" />
              </div>
              <div>
                <label htmlFor="people-last" className="block text-[12px] font-medium text-slate-700 mb-1">{t('settings.cc.people.lastName')}</label>
                <input id="people-last" value={newLastName} onChange={(e) => setNewLastName(e.target.value)} type="text" maxLength={80}
                  className="w-full min-h-[42px] px-3 rounded-[9px] border border-slate-300 bg-white text-[13px]" />
              </div>
              <div>
                <label htmlFor="people-email" className="block text-[12px] font-medium text-slate-700 mb-1">{t('settings.cc.people.emailAddress')}</label>
                <input id="people-email" ref={inviteEmailRef} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} type="email"
                  placeholder={tenantCopy.vertical === 'K12' ? 'teacher@school.edu' : 'colleague@yourcompany.com'}
                  className="w-full min-h-[42px] px-3 rounded-[9px] border border-slate-300 bg-white text-[13px]" />
              </div>
              <div>
                <label htmlFor="people-role" className="block text-[12px] font-medium text-slate-700 mb-1">{t('settings.cc.people.role')}</label>
                <select id="people-role" value={newRole} onChange={(e) => setNewRole(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-[9px] border border-slate-300 bg-white text-[13px]">
                  {/* SUPER_ADMIN is never offered from a tenant-scoped surface. */}
                  {ROLES.filter((r) => r !== 'SUPER_ADMIN').map((r) => (
                    <option key={r} value={r}>{tenantCopy.roleLabel(r)}</option>
                  ))}
                </select>
              </div>
              {inviteMode === 'password' && (
                <div className="md:col-span-2">
                  <label htmlFor="people-password" className="block text-[12px] font-medium text-slate-700 mb-1">{t('settings.cc.people.temporaryPassword')}</label>
                  <input id="people-password" type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password" aria-describedby="people-password-help"
                    className="w-full min-h-[42px] px-3 rounded-[9px] border border-slate-300 bg-white text-[13px] font-mono" />
                  <p id="people-password-help" className="mt-1 text-[12px] text-slate-500">{t('settings.cc.people.passwordHelp')}</p>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2 mt-3.5">
              <button
                type="button"
                onClick={handleInvite}
                disabled={inviteUser.isPending || createDirect.isPending || !newEmail.trim() || (inviteMode === 'password' && newPassword.length < 8)}
                className="min-h-[42px] px-4 rounded-[10px] text-[13px] font-medium text-[var(--brand-primary-ink)] disabled:opacity-50"
                style={{ background: 'var(--brand-primary)' }}
              >
                {(inviteUser.isPending || createDirect.isPending)
                  ? (inviteMode === 'password' ? t('settings.team.creating') : t('settings.team.sending'))
                  : (inviteMode === 'password' ? t('settings.team.createUser') : t('settings.team.sendInvitation'))}
              </button>
              <button
                type="button"
                onClick={() => { setShowAddUser(false); setInviteStatus(null); setNewPassword(''); }}
                className="min-h-[42px] px-4 rounded-[10px] border border-slate-200 bg-white text-[13px] font-medium text-slate-600"
              >
                {t('settings.common.cancel')}
              </button>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <div className="relative flex-1 min-w-0">
            <label htmlFor="people-search" className="sr-only">{t('settings.cc.people.searchLabel')}</label>
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden />
            <input
              id="people-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('settings.cc.people.searchPlaceholder')}
              className="w-full min-h-[42px] pl-8 pr-3 rounded-[9px] border border-slate-300 bg-white text-[13px]"
            />
          </div>
          <div>
            <label htmlFor="people-filter-role" className="sr-only">{t('settings.cc.people.filterRole')}</label>
            <select id="people-filter-role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
              className="w-full sm:w-auto min-h-[42px] px-3 rounded-[9px] border border-slate-300 bg-white text-[13px]">
              <option value="ALL">{t('settings.cc.people.allRoles')}</option>
              {ROLES.map((r) => <option key={r} value={r}>{tenantCopy.roleLabel(r)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="people-filter-status" className="sr-only">{t('settings.cc.people.filterStatus')}</label>
            <select id="people-filter-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full sm:w-auto min-h-[42px] px-3 rounded-[9px] border border-slate-300 bg-white text-[13px]">
              <option value="ALL">{t('settings.cc.people.allStatuses')}</option>
              <option value="ACTIVE">{t('settings.cc.people.statusActive')}</option>
              <option value="INVITED">{t('settings.cc.people.statusInvited')}</option>
              <option value="DISABLED">{t('settings.cc.people.statusDisabled')}</option>
            </select>
          </div>
        </div>

        {usersLoading && (
          <div className="flex justify-center py-8" aria-busy="true">
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" aria-label={t('settings.common.loading')} />
          </div>
        )}
        {usersError && !usersLoading && (
          <p className="py-6 text-[13px] text-slate-500">{t('settings.cc.people.teamUnavailable')}</p>
        )}

        {!usersLoading && !usersError && (
          filtered.length === 0 ? (
            <p className="py-6 text-[13px] text-slate-500">
              {rows.length === 0 ? t('settings.cc.people.teamEmpty') : t('settings.cc.people.noMatches')}
            </p>
          ) : (
            <>
              {/* Column header — desktop only; under 768px every cell carries its own label. */}
              <div className="hidden md:grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.1fr)_minmax(0,1fr)_auto] gap-3 px-2 pb-1.5 text-[11px] font-medium tracking-[.04em] uppercase text-slate-400">
                <span>{t('settings.cc.people.colPerson')}</span>
                <span>{t('settings.cc.people.colRole')}</span>
                <span>{t('settings.cc.people.colAccess')}</span>
                <span className="text-right">{t('settings.cc.people.colActions')}</span>
              </div>
              <ul className="divide-y divide-slate-100 border-t border-slate-100">
                {filtered.map((user) => {
                  const full = displayName(user);
                  const isSelfRow = !!callerId && user.id === callerId;
                  // Server truth = own subtree AND strictly below my rank. This
                  // mirror only decides whether to RENDER the control.
                  const manageable = !isSelfRow && canAssignRole(callerRole, user.role);
                  const isDisabled = user.status === 'DISABLED';
                  const isPending = user.status === 'INVITED';
                  return (
                    <li
                      key={user.id}
                      className="grid grid-cols-1 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.1fr)_minmax(0,1fr)_auto] gap-2 md:gap-3 md:items-center px-2 py-3"
                    >
                      <Cell label={t('settings.cc.people.colPerson')} className="min-w-0 flex flex-wrap items-center gap-2.5">
                        <span
                          aria-hidden
                          className={`w-8 h-8 shrink-0 rounded-[9px] grid place-items-center text-white text-[10px] font-semibold ${isDisabled ? 'opacity-40 grayscale' : ''}`}
                          style={{ background: 'linear-gradient(135deg, var(--brand-primary, #6366f1), color-mix(in srgb, var(--brand-primary, #6366f1) 60%, #8b5cf6))' }}
                        >
                          {initials(user)}
                        </span>
                        <span className="min-w-0">
                          <span className={`block text-[13px] font-medium truncate ${isDisabled ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                            {full || user.email}
                          </span>
                          <span className="block text-[12px] text-slate-500 truncate">{user.email}</span>
                        </span>
                      </Cell>

                      <Cell label={t('settings.cc.people.colRole')}>
                        <label htmlFor={`people-role-${user.id}`} className="sr-only">
                          {t('settings.cc.people.roleForUser', { email: user.email })}
                        </label>
                        <select
                          id={`people-role-${user.id}`}
                          value={user.role}
                          onChange={(e) => {
                            setRowError(null);
                            updateRole.mutate({ id: user.id, role: e.target.value }, {
                              onError: (err: Error) => setRowError(err?.message || t('settings.cc.people.roleChangeFailed')),
                            });
                          }}
                          disabled={!manageable}
                          title={manageable ? undefined : t('settings.team.cannotManageHint')}
                          className={`w-full min-h-[36px] px-2 rounded-[8px] border text-[12px] font-medium ${manageable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'} ${ROLE_TONE[user.role] || 'bg-slate-50 text-slate-600 border-slate-200'}`}
                        >
                          {/* SUPER_ADMIN is only ever listed when the row already IS one,
                              so the select renders its own value without ever offering
                              a promotion to platform owner from a tenant surface. */}
                          {ROLES.filter((r) => r !== 'SUPER_ADMIN' || user.role === 'SUPER_ADMIN').map((r) => (
                            <option key={r} value={r}>{tenantCopy.roleLabel(r)}</option>
                          ))}
                        </select>
                      </Cell>

                      <Cell label={t('settings.cc.people.colAccess')} className="flex flex-wrap items-center gap-1.5">
                        {isDisabled ? (
                          <StatusPill kind="blocked" label={t('settings.team.disabledBadge')} />
                        ) : isPending ? (
                          <StatusPill kind="attention" label={t('settings.team.invitedBadge')} />
                        ) : (
                          <StatusPill kind="ready" label={t('settings.cc.people.statusActive')} />
                        )}
                        <StatusPill
                          kind={user.mfaRequired ? (user.mfaEnrolled ? 'ready' : 'attention') : 'notConfigured'}
                          label={user.mfaRequired
                            ? (user.mfaEnrolled ? t('settings.team.mfaOn') : t('settings.team.mfaPending'))
                            : t('settings.team.mfaOff')}
                        />
                      </Cell>

                      <Cell label={t('settings.cc.people.colActions')} className="flex flex-wrap items-center gap-1.5 md:justify-end">
                        {manageable && (
                          <button
                            type="button"
                            onClick={async () => {
                              const turningOn = !user.mfaRequired;
                              const ok = await appConfirm({
                                title: turningOn
                                  ? t('settings.team.require2faTitle', { email: user.email })
                                  : t('settings.team.release2faTitle', { email: user.email }),
                                message: turningOn
                                  ? t('settings.team.require2faMessage')
                                  : t('settings.team.release2faMessage'),
                                confirmLabel: turningOn
                                  ? t('settings.team.require2faConfirm')
                                  : t('settings.team.release2faConfirm'),
                              });
                              if (!ok) return;
                              setRowError(null);
                              setMfaRequired.mutate({ id: user.id, mfaRequired: turningOn }, {
                                onError: (err: Error) => setRowError(err?.message || t('settings.team.mfaChangeFailed')),
                              });
                            }}
                            disabled={setMfaRequired.isPending}
                            aria-label={user.mfaRequired
                              ? t('settings.team.release2faTitle', { email: user.email })
                              : t('settings.team.require2faTitle', { email: user.email })}
                            title={user.mfaRequired
                              ? (user.mfaEnrolled ? t('settings.team.mfaRequiredEnrolled') : t('settings.team.mfaRequiredPending'))
                              : t('settings.team.mfaOptional')}
                            className="inline-flex items-center gap-1 min-h-[34px] px-2 rounded-[8px] border border-slate-200 bg-white text-[12px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                          >
                            {user.mfaRequired ? <ShieldCheck className="w-3.5 h-3.5" aria-hidden /> : <ShieldOff className="w-3.5 h-3.5" aria-hidden />}
                            {user.mfaRequired ? t('settings.cc.people.mfaRelease') : t('settings.cc.people.mfaRequire')}
                          </button>
                        )}
                        {manageable && !isPending && (
                          <button
                            type="button"
                            onClick={async () => {
                              const turningOff = !isDisabled;
                              const ok = await appConfirm({
                                title: turningOff
                                  ? t('settings.team.disableUserTitle', { email: user.email })
                                  : t('settings.team.enableUserTitle', { email: user.email }),
                                message: turningOff
                                  ? `${t('settings.team.disableUserMessage')} ${t('settings.cc.people.affectedAccess', { role: tenantCopy.roleLabel(user.role) })}`
                                  : t('settings.team.enableUserMessage'),
                                tone: turningOff ? 'danger' : undefined,
                                confirmLabel: turningOff
                                  ? t('settings.team.disableUserConfirm')
                                  : t('settings.team.enableUserConfirm'),
                              });
                              if (!ok) return;
                              setRowError(null);
                              setUserDisabled.mutate({ id: user.id, disabled: turningOff }, {
                                onError: (err: Error) => setRowError(err?.message || t('settings.team.statusChangeFailed')),
                              });
                            }}
                            disabled={setUserDisabled.isPending}
                            aria-label={isDisabled
                              ? t('settings.team.enableUserTitle', { email: user.email })
                              : t('settings.team.disableUserTitle', { email: user.email })}
                            title={isDisabled ? t('settings.team.enableUserHint') : t('settings.team.disableUserHint')}
                            className="inline-flex items-center gap-1 min-h-[34px] px-2 rounded-[8px] border border-slate-200 bg-white text-[12px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                          >
                            {isDisabled ? <Lock className="w-3.5 h-3.5" aria-hidden /> : <Ban className="w-3.5 h-3.5" aria-hidden />}
                            {isDisabled ? t('settings.team.enableUser') : t('settings.team.disableUser')}
                          </button>
                        )}
                        {manageable && (
                          <button
                            type="button"
                            onClick={async () => {
                              const ok = await appConfirm({
                                title: t('settings.team.removeUserTitle', { email: user.email }),
                                message: `${t('settings.cc.people.removeUserMessage')} ${t('settings.cc.people.affectedAccess', { role: tenantCopy.roleLabel(user.role) })}`,
                                tone: 'danger',
                                confirmLabel: t('settings.team.removeUser'),
                              });
                              if (!ok) return;
                              setRowError(null);
                              deleteUser.mutate(user.id, {
                                onError: (err: Error) => setRowError(err?.message || t('settings.cc.people.removeFailed')),
                              });
                            }}
                            aria-label={t('settings.team.removeUserTitle', { email: user.email })}
                            className="inline-flex items-center justify-center w-[34px] h-[34px] ml-1.5 rounded-[8px] border border-slate-200 bg-white text-slate-400 hover:text-red-600 hover:border-red-200"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden />
                          </button>
                        )}
                      </Cell>
                    </li>
                  );
                })}
              </ul>
            </>
          )
        )}
      </EditorSection>

      {/* ── Pending invitations ─────────────────────────────────────── */}
      <EditorSection
        id="invites"
        title={t('settings.cc.people.invitesTitle')}
        description={t('settings.cc.people.invitesDescription')}
      >
        {pending.length === 0 ? (
          <p className="text-[13px] text-slate-500">{t('settings.cc.people.invitesEmpty')}</p>
        ) : (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {pending.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-2 px-2 py-2.5">
                <MailCheck className="w-4 h-4 text-amber-500 shrink-0" aria-hidden />
                <span className="text-[13px] text-slate-900 min-w-0 truncate">{u.email}</span>
                <span className="text-[12px] text-slate-500">{tenantCopy.roleLabel(u.role)}</span>
                <StatusPill kind="attention" label={t('settings.team.invitedBadge')} className="ml-auto" />
              </li>
            ))}
          </ul>
        )}
      </EditorSection>

      {/* ── Roles and capabilities (read-only explainer) ────────────── */}
      <EditorSection
        id="roles"
        title={t('settings.cc.people.rolesTitle')}
        description={t('settings.cc.people.rolesDescription')}
      >
        <ul className="space-y-2">
          {ROLES.map((r) => (
            <li key={r} className="flex flex-wrap items-baseline gap-2">
              <span className={`inline-flex items-center min-h-[24px] px-2 rounded-full border text-[12px] font-medium ${ROLE_TONE[r]}`}>
                {tenantCopy.roleLabel(r)}
              </span>
              <span className="text-[12px] leading-[17px] text-slate-500 flex-1 min-w-[220px]">
                {t(`settings.cc.people.roleBlurb.${r}`)}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12px] leading-[17px] text-slate-500">{t('settings.cc.people.rolesRankNote')}</p>
        <p className="mt-1.5 text-[12px] leading-[17px] text-slate-500">{t('settings.cc.people.panicNote')}</p>
      </EditorSection>

      {/* ── MFA policy ──────────────────────────────────────────────── */}
      <EditorSection
        id="mfa"
        title={t('settings.cc.people.mfaTitle')}
        description={t('settings.cc.people.mfaDescription')}
      >
        <p className="text-[13px] text-slate-700">
          {t('settings.cc.people.mfaCount', { required: mfaRequiredCount, total: rows.length })}
        </p>
        <p className="mt-1.5 text-[12px] leading-[17px] text-slate-500">{t('settings.cc.people.mfaPolicyNote')}</p>
        <p className="mt-2 text-[12px] leading-[17px] text-slate-500">
          {t('settings.cc.people.mfaPersonalNote')}{' '}
          <Link href={securityHref} className="underline underline-offset-2" style={{ color: 'var(--brand-primary)' }}>
            {t('settings.shell.sections.security.label')}
          </Link>
        </p>
      </EditorSection>

      {/* ── SSO ─────────────────────────────────────────────────────── */}
      {ssoManageable && (
        <EditorSection
          id="sso"
          title={t('settings.cc.people.ssoTitle')}
          description={t('settings.cc.people.ssoDescription')}
        >
          <div className="flex flex-wrap items-center gap-3">
            <KeyRound className="w-4 h-4 text-slate-400" aria-hidden />
            <p className="text-[13px] text-slate-700 flex-1 min-w-[200px]">{t('settings.cc.people.ssoSummary')}</p>
            <Link
              href={ssoHref}
              className="inline-flex items-center min-h-[36px] px-3 rounded-[9px] border text-[12px] font-medium"
              style={{ color: 'var(--brand-primary)', borderColor: 'color-mix(in srgb, var(--brand-primary) 35%, white)' }}
            >
              {t('settings.cc.people.ssoManage')}
            </Link>
          </div>
        </EditorSection>
      )}

      {/* ── Content approval ────────────────────────────────────────── */}
      <EditorSection
        id="approval"
        title={t('settings.approval.title')}
        description={t('settings.approval.description')}
      >
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill
            kind={approval.isError ? 'unknown' : approvalEnabled ? 'ready' : 'notConfigured'}
            label={approval.isError
              ? t('settings.common.unavailable')
              : approvalEnabled ? t('settings.approval.stateOn') : t('settings.approval.stateOff')}
          />
          <p className="text-[12px] leading-[17px] text-slate-500 flex-1 min-w-[200px]">
            {approvalEnabled ? t('settings.cc.people.approvalOnNote') : t('settings.cc.people.approvalOffNote')}
          </p>
          <button
            type="button"
            onClick={() => toggleApproval.mutate(!approvalEnabled)}
            disabled={toggleApproval.isPending || approval.data === undefined}
            aria-pressed={approvalEnabled}
            title={approvalEnabled ? t('settings.approval.turnOffTitle') : t('settings.approval.turnOnTitle')}
            className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-[9px] border border-slate-200 bg-white text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {toggleApproval.isPending || approval.isLoading
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
              : approvalEnabled ? <ShieldCheck className="w-3.5 h-3.5" aria-hidden /> : <ShieldOff className="w-3.5 h-3.5" aria-hidden />}
            {approvalEnabled ? t('settings.approval.turnOffTitle') : t('settings.approval.turnOnTitle')}
          </button>
        </div>
      </EditorSection>
    </>
  );
}
