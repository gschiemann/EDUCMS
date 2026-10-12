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
  Users as UsersIcon, MailCheck, Search, AtSign, Link2, Download, Siren, MapPin,
} from 'lucide-react';
import {
  useUsers, useInviteUser, useCreateUserDirect, useDeleteUser, useUpdateUserRole,
  useSetUserMfaRequired, useSetUserDisabled, useResetUserMfa, useSetUserCanTriggerPanic,
  useContentApprovalConfig, useToggleContentApproval,
  useMfaEnforcement, useSetMfaEnforced,
  useSendEmailChangeCode, useChangeUserEmail, useCreateSetupLink,
  useSetupLinkAccounts, useBulkSetupLinks,
  type TeamUser,
} from '@/hooks/use-api';
import { setupLinksCsv, setupLinksCsvFilename } from '@/lib/setup-links-csv';
import { useUIStore } from '@/store/ui-store';
import { canAssignRole } from '@/lib/role-assignment';
import { useTenantCopy } from '@/hooks/use-tenant-copy';
import { appConfirm } from '@/components/ui/app-dialog';
import { EditorHead, EditorSection, StatusPill, ErrorSummary } from '@/components/settings/shell/primitives';
import { PersonAccessPanel } from '@/components/settings/people/PersonAccessPanel';

/** 2026-10-11 — user scoping applies to the location roles only (server: SCOPABLE_ROLES). */
const SCOPABLE_ROLES = ['SCHOOL_ADMIN', 'CONTRIBUTOR', 'RESTRICTED_VIEWER'];

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
  const setCanTriggerPanic = useSetUserCanTriggerPanic();
  const setUserDisabled = useSetUserDisabled();
  const resetUserMfa = useResetUserMfa();

  // ── Reset two-factor (2026-09-21) ────────────────────────────────────
  // `appConfirm` cannot collect a password (it renders no input), and the
  // server requires the admin's own password as a step-up. So this follows
  // the editor's OTHER confirmation idiom — the inline invite panel — and
  // opens attached to the row it affects, where the operator can still see
  // whose account they are about to change.
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetReason, setResetReason] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetDone, setResetDone] = useState<string | null>(null);

  const closeResetPanel = () => {
    setResetFor(null);
    setResetPassword('');
    setResetReason('');
    setResetError(null);
  };

  /**
   * Which second factors a row holds. An older API build sends only the
   * boolean, so fall back to it rather than reading an absent `mfaMethods` as
   * "none" — that would hide the reset action from exactly the enrolled user
   * an admin is trying to help.
   */
  const methodsFor = (u: TeamUser): Array<'totp' | 'passkey'> =>
    Array.isArray(u.mfaMethods) ? u.mfaMethods : (u.mfaEnrolled ? ['totp'] : []);

  const methodLabel = (methods: Array<'totp' | 'passkey'>): string => {
    const hasTotp = methods.includes('totp');
    const hasPasskey = methods.includes('passkey');
    if (hasTotp && hasPasskey) return t('settings.cc.people.mfaMethodBoth');
    if (hasPasskey) return t('settings.cc.people.mfaMethodPasskey');
    if (hasTotp) return t('settings.cc.people.mfaMethodTotp');
    return t('settings.cc.people.mfaMethodNone');
  };

  const handleResetSubmit = async (user: TeamUser) => {
    setResetError(null);
    setRowError(null);
    try {
      await resetUserMfa.mutateAsync({
        id: user.id,
        password: resetPassword,
        reason: resetReason.trim() || undefined,
      });
      setResetDone(t('settings.cc.people.resetMfaDone', { email: user.email }));
      closeResetPanel();
    } catch (err) {
      // Stay OPEN on failure — a wrong password is a typo to correct, not a
      // reason to make the operator find the row and re-open the panel. Branch
      // on the STRUCTURED code, never on the message text.
      const e = err as { code?: string; status?: number; message?: string };
      if (e?.code === 'USER_MFA_RESET_BAD_PASSWORD') {
        setResetError(t('settings.cc.people.resetMfaBadPassword'));
      } else if (e?.code === 'PASSWORD_REQUIRED') {
        setResetError(t('settings.cc.people.resetMfaNoPassword'));
      } else if (e?.status === 404) {
        setResetError(t('settings.cc.people.resetMfaGone'));
      } else if (e?.status === 429) {
        setResetError(t('settings.cc.people.resetMfaTooMany'));
      } else {
        setResetError(e?.message || t('settings.cc.people.resetMfaFailed'));
      }
    }
  };

  // ── Account administration (2026-10-10) ──────────────────────────────
  // Change someone's sign-in email; one-time setup links instead of starter
  // passwords. Same inline-panel idiom as the 2FA reset above: the server
  // needs the admin's own password, which `appConfirm` cannot collect.
  const sendEmailCode = useSendEmailChangeCode();
  const changeEmail = useChangeUserEmail();
  const createLink = useCreateSetupLink();
  const bulkLinks = useBulkSetupLinks();
  const isAdminCaller = callerRole === 'SUPER_ADMIN' || callerRole === 'DISTRICT_ADMIN' || callerRole === 'SCHOOL_ADMIN';
  const setupAccounts = useSetupLinkAccounts(isAdminCaller);

  const [emailFor, setEmailFor] = useState<string | null>(null);
  const [emailNew, setEmailNew] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailCodeSentTo, setEmailCodeSentTo] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const [linkFor, setLinkFor] = useState<string | null>(null);
  const [linkPassword, setLinkPassword] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkResult, setLinkResult] = useState<{ email: string; url: string; expiresAt: string } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const [bulkPassword, setBulkPassword] = useState('');
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkDone, setBulkDone] = useState<string | null>(null);

  const closeEmailPanel = () => {
    setEmailFor(null); setEmailNew(''); setEmailPassword(''); setEmailCode('');
    setEmailCodeSentTo(null); setEmailError(null); setAccessFor(null);
  };
  const closeLinkPanel = () => {
    setLinkFor(null); setLinkPassword(''); setLinkError(null); setLinkResult(null); setLinkCopied(false); setAccessFor(null);
  };
  // 2026-10-11 — "Locations & screens" (user scoping). The panel owns its own form state.
  const [accessFor, setAccessFor] = useState<string | null>(null);

  /** One map from the server's structured codes to plain words — never the message text. */
  const adminErrorText = (err: unknown): string => {
    const e = err as { code?: string; status?: number };
    const byCode: Record<string, string> = {
      ACCOUNT_ADMIN_BAD_PASSWORD: 'adminBadPassword',
      ACCOUNT_ADMIN_PASSWORD_REQUIRED: 'adminBadPassword',
      PASSWORD_REQUIRED: 'adminNoPassword',
      USER_EMAIL_INVALID: 'emailInvalid',
      USER_EMAIL_IN_USE: 'emailInUse',
      USER_EMAIL_UNCHANGED: 'emailUnchanged',
      USER_EMAIL_CHANGE_INVITED: 'emailInvited',
      USER_EMAIL_CHANGE_SETUP_PENDING: 'emailSetupPending',
      USER_EMAIL_CODE_INVALID: 'emailCodeWrong',
      USER_EMAIL_CODE_REQUIRED: 'emailCodeWrong',
      USER_EMAIL_CODE_EXPIRED: 'emailCodeExpired',
      USER_EMAIL_CODE_LOCKED: 'emailCodeLocked',
      USER_EMAIL_CODE_NOT_SENT: 'emailCodeNotSent',
      USER_EMAIL_CODE_TOO_MANY: 'adminTooMany',
      SETUP_LINK_HAS_FACTOR: 'setupLinkHasTwoStep',
      SETUP_LINK_NOT_APPLICABLE: 'setupLinkNotApplicable',
      SETUP_LINK_ACCOUNT_INACTIVE: 'setupLinkInactive',
    };
    if (e?.code && byCode[e.code]) return t(`settings.cc.people.${byCode[e.code]}`);
    if (e?.status === 404) return t('settings.cc.people.adminGone');
    if (e?.status === 429) return t('settings.cc.people.adminTooMany');
    return t('settings.cc.people.adminFailed');
  };

  const handleEmailSubmit = async (user: TeamUser) => {
    setEmailError(null);
    setRowError(null);
    const email = emailNew.trim().toLowerCase();
    try {
      if (!emailCodeSentTo) {
        const step = await sendEmailCode.mutateAsync({ id: user.id, email, password: emailPassword });
        if (step?.required) {
          setEmailCodeSentTo(email);
          return;
        }
      }
      const out = await changeEmail.mutateAsync({
        id: user.id,
        email,
        password: emailPassword,
        code: emailCodeSentTo ? emailCode.replace(/\D/g, '') : undefined,
      });
      setResetDone(
        out.verified
          ? t('settings.cc.people.emailChangedVerified', { email: out.email })
          : t('settings.cc.people.emailChangedUnverified', { email: out.email }),
      );
      closeEmailPanel();
    } catch (err) {
      setEmailError(adminErrorText(err));
    }
  };

  const handleLinkSubmit = async (user: TeamUser) => {
    setLinkError(null);
    setRowError(null);
    try {
      const out = await createLink.mutateAsync({ id: user.id, password: linkPassword });
      setLinkPassword('');
      setLinkResult({ email: out.email, url: out.url, expiresAt: out.expiresAt });
    } catch (err) {
      setLinkError(adminErrorText(err));
    }
  };

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString();

  const handleBulkDownload = async () => {
    setBulkError(null);
    setBulkDone(null);
    try {
      const out = await bulkLinks.mutateAsync({ password: bulkPassword });
      setBulkPassword('');
      if (out.links.length > 0) {
        const csv = setupLinksCsv(
          out.links.map((l) => ({ ...l, role: tenantCopy.roleLabel(l.role) })),
          {
            location: t('settings.cc.people.csvLocation'),
            name: t('settings.cc.people.csvName'),
            currentEmail: t('settings.cc.people.csvCurrentEmail'),
            role: t('settings.cc.people.csvRole'),
            link: t('settings.cc.people.csvLink'),
            expires: t('settings.cc.people.csvExpires'),
          },
        );
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const href = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = href;
        a.download = setupLinksCsvFilename();
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
      }
      const parts = [t('settings.cc.people.downloadLinksDone', { count: out.links.length })];
      if (out.skipped.length) parts.push(t('settings.cc.people.downloadLinksSkipped', { count: out.skipped.length }));
      setBulkDone(parts.join(' '));
    } catch (err) {
      setBulkError(adminErrorText(err));
    }
  };

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

  // Per-tenant MFA enforcement (2026-09-11). `enforced` comes from the SAME
  // shared resolver the API gate uses, so the dashboard and the server can
  // never show different answers about whether this organization enforces.
  const mfa = useMfaEnforcement();
  const setMfaEnforced = useSetMfaEnforced();
  // The WRITE is SUPER_ADMIN / DISTRICT_ADMIN only (server-enforced): a
  // SCHOOL_ADMIN is inside the set of accounts the policy covers, so they must
  // not be able to repeal it. Render the control DISABLED for them rather than
  // an enabled-looking button that 403s — the mismatch the content-approval
  // toggle right below still has.
  const canSetMfaPolicy = callerRole === 'SUPER_ADMIN' || callerRole === 'DISTRICT_ADMIN';

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

      {/* A plain confirmation, in the same place the failure banner lives —
          the list itself refetches, so this is the only "it worked" signal. */}
      {resetDone && (
        <div
          role="status"
          className="mb-3 rounded-[10px] border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[12px] font-medium text-emerald-800"
        >
          {resetDone}
        </div>
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
              <ul className="divide-y divide-slate-100 border-t border-slate-100">
                {filtered.map((user) => {
                  const full = displayName(user);
                  const isSelfRow = !!callerId && user.id === callerId;
                  // Server truth = own subtree AND strictly below my rank. This
                  // mirror only decides whether to RENDER the control.
                  const manageable = !isSelfRow && canAssignRole(callerRole, user.role);
                  const isDisabled = user.status === 'DISABLED';
                  const isPending = user.status === 'INVITED';
                  const methods = methodsFor(user);
                  const resetOpen = resetFor === user.id;
                  return (
                    <li
                      key={user.id}
                      className="min-w-0 px-2 py-3"
                    >
                      {/* 2026-10-12 — stacked, never a 4-column grid: at 1325px the
                          zero-width columns let pills and buttons paint on top of
                          each other (owner screenshot). Line 1 who, line 2 role +
                          access badges, line 3 a wrapping row of actions. */}
                      <div className="min-w-0 flex items-start gap-2.5">
                        <span
                          aria-hidden
                          className={`w-8 h-8 shrink-0 rounded-[9px] grid place-items-center text-white text-[10px] font-semibold ${isDisabled ? 'opacity-40 grayscale' : ''}`}
                          style={{ background: 'linear-gradient(135deg, var(--brand-primary, #6366f1), color-mix(in srgb, var(--brand-primary, #6366f1) 60%, #8b5cf6))' }}
                        >
                          {initials(user)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={`block text-[13px] font-medium truncate ${isDisabled ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                            {full || user.email}
                          </span>
                          <span className="block text-[12px] text-slate-500 truncate">{user.email}</span>
                        </span>
                      </div>
                      <div className="mt-2 sm:pl-[42px] flex flex-wrap items-center gap-1.5 min-w-0">
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
                          className={`w-auto max-w-full min-w-[104px] min-h-[34px] px-2 rounded-[8px] border text-[12px] font-medium ${manageable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'} ${ROLE_TONE[user.role] || 'bg-slate-50 text-slate-600 border-slate-200'}`}
                        >
                          {/* SUPER_ADMIN is only ever listed when the row already IS one,
                              so the select renders its own value without ever offering
                              a promotion to platform owner from a tenant surface. */}
                          {ROLES.filter((r) => r !== 'SUPER_ADMIN' || user.role === 'SUPER_ADMIN').map((r) => (
                            <option key={r} value={r}>{tenantCopy.roleLabel(r)}</option>
                          ))}
                        </select>
                        {isDisabled ? (
                          <StatusPill kind="blocked" label={t('settings.team.disabledBadge')} />
                        ) : isPending ? (
                          <StatusPill kind="attention" label={t('settings.team.invitedBadge')} />
                        ) : (
                          <StatusPill kind="ready" label={t('settings.cc.people.statusActive')} />
                        )}
                        {/* 2026-09-21 — NAME the factors instead of a bare
                            "2FA". A passkey-only account used to read as "not
                            set up" here, which is the wrong thing to show an
                            admin who is deciding what to reset. Green once a
                            factor exists, amber when the policy wants one and
                            there is none, grey when neither applies. */}
                        <StatusPill
                          kind={methods.length > 0 ? 'ready' : (user.mfaRequired ? 'attention' : 'notConfigured')}
                          label={methodLabel(methods)}
                        />
                        {/* 2026-10-11 — user scoping, from counts on the list (absent on an older API → nothing). */}
                        {(user.extraLocationCount ?? 0) > 0 && (
                          <StatusPill kind="ready" label={t('settings.cc.people.accessPillLocations', { count: user.extraLocationCount ?? 0 })} />
                        )}
                        {user.screenLimited && <StatusPill kind="attention" label={t('settings.cc.people.accessPillLimited')} />}
                      </div>

                      <div
                        className="mt-2 sm:pl-[42px] flex flex-wrap items-center gap-1.5 min-w-0"
                        role="group"
                        aria-label={t('settings.cc.people.actionsFor', { email: user.email })}
                      >
                        {/* 2026-10-11 — "Can trigger emergency alerts" (User.canTriggerPanic).
                            Rendered only where it MEANS something and the server would
                            accept it: a CONTRIBUTOR below my rank (admins hold the
                            authority by role; a RESTRICTED_VIEWER can never receive it,
                            so for one we only offer turning a stale flag OFF). Absent
                            from an older API's payload → nothing rendered, never a guess. */}
                        {manageable && !isPending && typeof user.canTriggerPanic === 'boolean' &&
                          (user.role === 'CONTRIBUTOR' || (user.role === 'RESTRICTED_VIEWER' && user.canTriggerPanic)) && (
                          <button
                            type="button"
                            role="switch"
                            aria-checked={user.canTriggerPanic}
                            onClick={async () => {
                              const turningOn = !user.canTriggerPanic;
                              const ok = await appConfirm({
                                title: turningOn
                                  ? t('settings.cc.people.panicOnTitle', { email: user.email })
                                  : t('settings.cc.people.panicOffTitle', { email: user.email }),
                                message: turningOn
                                  ? t('settings.cc.people.panicOnMessage')
                                  : t('settings.cc.people.panicOffMessage'),
                                confirmLabel: turningOn
                                  ? t('settings.cc.people.panicOnConfirm')
                                  : t('settings.cc.people.panicOffConfirm'),
                              });
                              if (!ok) return;
                              setRowError(null);
                              setCanTriggerPanic.mutate({ id: user.id, canTriggerPanic: turningOn }, {
                                onError: (err: Error) => setRowError(err?.message || t('settings.cc.people.panicFailed')),
                              });
                            }}
                            disabled={setCanTriggerPanic.isPending}
                            aria-label={t('settings.cc.people.panicAria', { email: user.email })}
                            title={t('settings.cc.people.panicHint')}
                            data-testid={`people-panic-${user.id}`}
                            className={`inline-flex items-center gap-1.5 min-h-[34px] px-2 rounded-[8px] border text-[12px] font-medium disabled:opacity-50 ${user.canTriggerPanic ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                          >
                            <Siren className="w-3.5 h-3.5" aria-hidden />
                            {t('settings.cc.people.panicToggle')}
                            <span
                              aria-hidden
                              className={`relative inline-block w-7 h-4 rounded-full transition-colors ${user.canTriggerPanic ? 'bg-red-600' : 'bg-slate-300'}`}
                            >
                              <span
                                className="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-[left]"
                                style={{ left: user.canTriggerPanic ? 14 : 2 }}
                              />
                            </span>
                          </button>
                        )}
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
                        {/* Only offered when there is something to reset —
                            an account with no second factor has nothing to
                            remove, and the server would do nothing. */}
                        {manageable && methods.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setResetDone(null);
                              setRowError(null);
                              setResetError(null);
                              setResetPassword('');
                              setResetReason('');
                              setResetFor(resetOpen ? null : user.id);
                            }}
                            aria-expanded={resetOpen}
                            aria-controls={`people-reset-${user.id}`}
                            title={t('settings.cc.people.resetMfaHint')}
                            className="inline-flex items-center gap-1 min-h-[34px] px-2 rounded-[8px] border border-slate-200 bg-white text-[12px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                          >
                            <KeyRound className="w-3.5 h-3.5" aria-hidden />
                            {t('settings.cc.people.resetMfa')}
                          </button>
                        )}
                        {manageable && SCOPABLE_ROLES.includes(user.role) && (
                          <button
                            type="button"
                            onClick={() => {
                              setResetDone(null);
                              closeEmailPanel();
                              closeLinkPanel();
                              setResetFor(null);
                              setAccessFor(accessFor === user.id ? null : user.id);
                            }}
                            aria-expanded={accessFor === user.id}
                            aria-controls={`people-access-${user.id}`}
                            title={t('settings.cc.people.accessHint')}
                            className="inline-flex items-center gap-1 min-h-[34px] px-2 rounded-[8px] border border-slate-200 bg-white text-[12px] font-medium text-slate-600 hover:bg-slate-50"
                          >
                            <MapPin className="w-3.5 h-3.5" aria-hidden />
                            {t('settings.cc.people.accessButton')}
                          </button>
                        )}
                        {manageable && !isPending && !user.mustSetupCredentials && (
                          <button
                            type="button"
                            onClick={() => {
                              setResetDone(null);
                              closeLinkPanel();
                              const opening = emailFor !== user.id;
                              closeEmailPanel();
                              if (opening) setEmailFor(user.id);
                            }}
                            aria-expanded={emailFor === user.id}
                            aria-controls={`people-email-${user.id}`}
                            title={t('settings.cc.people.changeEmailHint')}
                            className="inline-flex items-center gap-1 min-h-[34px] px-2 rounded-[8px] border border-slate-200 bg-white text-[12px] font-medium text-slate-600 hover:bg-slate-50"
                          >
                            <AtSign className="w-3.5 h-3.5" aria-hidden />
                            {t('settings.cc.people.changeEmail')}
                          </button>
                        )}
                        {manageable && !!user.mustSetupCredentials && (
                          <button
                            type="button"
                            onClick={() => {
                              setResetDone(null);
                              closeEmailPanel();
                              const opening = linkFor !== user.id;
                              closeLinkPanel();
                              if (opening) setLinkFor(user.id);
                            }}
                            aria-expanded={linkFor === user.id}
                            aria-controls={`people-link-${user.id}`}
                            title={t('settings.cc.people.setupLinkHint')}
                            className="inline-flex items-center gap-1 min-h-[34px] px-2 rounded-[8px] border border-slate-200 bg-white text-[12px] font-medium text-slate-600 hover:bg-slate-50"
                          >
                            <Link2 className="w-3.5 h-3.5" aria-hidden />
                            {t('settings.cc.people.setupLink')}
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
                                  ? t('settings.team.disableUserMessage')
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
                                message: t('settings.cc.people.removeUserMessage', { role: tenantCopy.roleLabel(user.role) }),
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
                      </div>

                      {/* The reset panel spans the whole row so the operator
                          can still read WHOSE account is about to change
                          while they type their own password. */}
                      {resetOpen && (
                        <form
                          id={`people-reset-${user.id}`}
                          onSubmit={(e) => { e.preventDefault(); handleResetSubmit(user); }}
                          className="md:col-span-4 mt-2 rounded-[11px] border border-rose-200 bg-rose-50/70 p-3.5"
                        >
                          <p className="text-[13px] font-medium text-rose-900">
                            {t('settings.cc.people.resetMfaTitle', { email: user.email })}
                          </p>
                          <p className="mt-1 text-[12px] leading-[17px] text-rose-800">
                            {t('settings.cc.people.resetMfaExplain')}
                          </p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                            <div>
                              <label htmlFor={`people-reset-reason-${user.id}`} className="block text-[12px] font-medium text-slate-700 mb-1">
                                {t('settings.cc.people.resetMfaReason')}
                              </label>
                              <input
                                id={`people-reset-reason-${user.id}`}
                                type="text"
                                maxLength={200}
                                value={resetReason}
                                onChange={(e) => setResetReason(e.target.value)}
                                placeholder={t('settings.cc.people.resetMfaReasonPlaceholder')}
                                className="w-full min-h-[42px] px-3 rounded-[9px] border border-slate-300 bg-white text-[13px]"
                              />
                            </div>
                            <div>
                              <label htmlFor={`people-reset-password-${user.id}`} className="block text-[12px] font-medium text-slate-700 mb-1">
                                {t('settings.cc.people.resetMfaPassword')}
                              </label>
                              <input
                                id={`people-reset-password-${user.id}`}
                                type="password"
                                autoComplete="current-password"
                                value={resetPassword}
                                onChange={(e) => setResetPassword(e.target.value)}
                                aria-describedby={`people-reset-password-help-${user.id}`}
                                className="w-full min-h-[42px] px-3 rounded-[9px] border border-slate-300 bg-white text-[13px]"
                              />
                              <p id={`people-reset-password-help-${user.id}`} className="mt-1 text-[12px] text-slate-500">
                                {t('settings.cc.people.resetMfaPasswordHelp')}
                              </p>
                            </div>
                          </div>
                          {resetError && (
                            <p role="alert" className="mt-2 text-[12px] leading-[17px] text-rose-700">
                              {resetError}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-2 mt-3.5">
                            <button
                              type="submit"
                              disabled={resetUserMfa.isPending || resetPassword.length === 0}
                              className="min-h-[42px] px-4 rounded-[10px] bg-rose-600 hover:bg-rose-700 text-white text-[13px] font-medium disabled:opacity-50"
                            >
                              {resetUserMfa.isPending
                                ? t('settings.cc.people.resetMfaWorking')
                                : t('settings.cc.people.resetMfaConfirm')}
                            </button>
                            <button
                              type="button"
                              onClick={closeResetPanel}
                              className="min-h-[42px] px-4 rounded-[10px] border border-slate-200 bg-white text-[13px] font-medium text-slate-600"
                            >
                              {t('settings.common.cancel')}
                            </button>
                          </div>
                        </form>
                      )}

                      {accessFor === user.id && (
                        <PersonAccessPanel user={user} onClose={() => setAccessFor(null)} />
                      )}

                      {emailFor === user.id && (
                        <form
                          id={`people-email-${user.id}`}
                          onSubmit={(e) => { e.preventDefault(); handleEmailSubmit(user); }}
                          className="md:col-span-4 mt-2 rounded-[11px] border border-slate-200 bg-slate-50/70 p-3.5"
                        >
                          <p className="text-[13px] font-medium text-slate-900">
                            {t('settings.cc.people.changeEmailTitle', { email: user.email })}
                          </p>
                          <p className="mt-1 text-[12px] leading-[17px] text-slate-600">
                            {t('settings.cc.people.changeEmailExplain')}
                          </p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                            <div>
                              <label htmlFor={`people-email-new-${user.id}`} className="block text-[12px] font-medium text-slate-700 mb-1">
                                {t('settings.cc.people.newEmail')}
                              </label>
                              <input
                                id={`people-email-new-${user.id}`}
                                type="email"
                                autoComplete="off"
                                maxLength={254}
                                value={emailNew}
                                disabled={!!emailCodeSentTo}
                                onChange={(e) => setEmailNew(e.target.value)}
                                className="w-full min-h-[42px] px-3 rounded-[9px] border border-slate-300 bg-white text-[13px] disabled:opacity-60"
                              />
                            </div>
                            <div>
                              <label htmlFor={`people-email-password-${user.id}`} className="block text-[12px] font-medium text-slate-700 mb-1">
                                {t('settings.cc.people.yourPassword')}
                              </label>
                              <input
                                id={`people-email-password-${user.id}`}
                                type="password"
                                autoComplete="current-password"
                                value={emailPassword}
                                onChange={(e) => setEmailPassword(e.target.value)}
                                aria-describedby={`people-email-password-help-${user.id}`}
                                className="w-full min-h-[42px] px-3 rounded-[9px] border border-slate-300 bg-white text-[13px]"
                              />
                              <p id={`people-email-password-help-${user.id}`} className="mt-1 text-[12px] text-slate-500">
                                {t('settings.cc.people.yourPasswordHelp')}
                              </p>
                            </div>
                            {emailCodeSentTo && (
                              <div className="md:col-span-2">
                                <p role="status" className="text-[12px] text-slate-700 mb-2">
                                  {t('settings.cc.people.codeSentTo', { email: emailCodeSentTo })}
                                </p>
                                <label htmlFor={`people-email-code-${user.id}`} className="block text-[12px] font-medium text-slate-700 mb-1">
                                  {t('settings.cc.people.codeLabel')}
                                </label>
                                <input
                                  id={`people-email-code-${user.id}`}
                                  type="text"
                                  inputMode="numeric"
                                  autoComplete="off"
                                  maxLength={7}
                                  value={emailCode}
                                  onChange={(e) => setEmailCode(e.target.value)}
                                  className="w-full md:w-[180px] min-h-[42px] px-3 rounded-[9px] border border-slate-300 bg-white text-[13px] font-mono"
                                />
                              </div>
                            )}
                          </div>
                          {emailError && (
                            <p role="alert" className="mt-2 text-[12px] leading-[17px] text-rose-700">{emailError}</p>
                          )}
                          <div className="flex flex-wrap gap-2 mt-3.5">
                            <button
                              type="submit"
                              disabled={
                                sendEmailCode.isPending || changeEmail.isPending || !emailNew.trim() || emailPassword.length === 0 ||
                                (!!emailCodeSentTo && emailCode.replace(/\D/g, '').length !== 6)
                              }
                              className="min-h-[42px] px-4 rounded-[10px] text-[13px] font-medium text-[var(--brand-primary-ink)] disabled:opacity-50"
                              style={{ background: 'var(--brand-primary)' }}
                            >
                              {sendEmailCode.isPending || changeEmail.isPending
                                ? t('settings.cc.people.changingEmail')
                                : t('settings.cc.people.applyEmail')}
                            </button>
                            <button
                              type="button"
                              onClick={closeEmailPanel}
                              className="min-h-[42px] px-4 rounded-[10px] border border-slate-200 bg-white text-[13px] font-medium text-slate-600"
                            >
                              {t('settings.common.cancel')}
                            </button>
                          </div>
                        </form>
                      )}

                      {linkFor === user.id && (
                        <form
                          id={`people-link-${user.id}`}
                          onSubmit={(e) => { e.preventDefault(); handleLinkSubmit(user); }}
                          className="md:col-span-4 mt-2 rounded-[11px] border border-slate-200 bg-slate-50/70 p-3.5"
                        >
                          <p className="text-[13px] font-medium text-slate-900">
                            {t('settings.cc.people.setupLinkTitle', { email: user.email })}
                          </p>
                          <p className="mt-1 text-[12px] leading-[17px] text-slate-600">
                            {t('settings.cc.people.setupLinkExplain')}
                          </p>
                          {linkResult ? (
                            <div role="status" className="mt-3">
                              <p className="text-[12px] font-medium text-emerald-800">
                                {t('settings.cc.people.setupLinkReady', { email: linkResult.email, date: fmtDate(linkResult.expiresAt) })}
                              </p>
                              <div className="mt-2 flex flex-col sm:flex-row gap-2">
                                <label htmlFor={`people-link-url-${user.id}`} className="sr-only">{t('settings.cc.people.setupLinkLabel')}</label>
                                <input
                                  id={`people-link-url-${user.id}`}
                                  readOnly
                                  value={linkResult.url}
                                  onFocus={(e) => e.currentTarget.select()}
                                  className="flex-1 min-h-[38px] px-2 rounded-[8px] border border-slate-300 bg-white text-[11px] font-mono"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    navigator.clipboard?.writeText(linkResult.url);
                                    setLinkCopied(true);
                                    setTimeout(() => setLinkCopied(false), 1500);
                                  }}
                                  className="min-h-[38px] px-3 rounded-[8px] text-[12px] font-medium text-[var(--brand-primary-ink)]"
                                  style={{ background: 'var(--brand-primary)' }}
                                >
                                  {linkCopied ? t('settings.common.copied') : t('settings.cc.people.copyLink')}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="mt-3 md:max-w-[50%]">
                              <label htmlFor={`people-link-password-${user.id}`} className="block text-[12px] font-medium text-slate-700 mb-1">
                                {t('settings.cc.people.yourPassword')}
                              </label>
                              <input
                                id={`people-link-password-${user.id}`}
                                type="password"
                                autoComplete="current-password"
                                value={linkPassword}
                                onChange={(e) => setLinkPassword(e.target.value)}
                                className="w-full min-h-[42px] px-3 rounded-[9px] border border-slate-300 bg-white text-[13px]"
                              />
                            </div>
                          )}
                          {linkError && (
                            <p role="alert" className="mt-2 text-[12px] leading-[17px] text-rose-700">{linkError}</p>
                          )}
                          <div className="flex flex-wrap gap-2 mt-3.5">
                            {!linkResult && (
                              <button
                                type="submit"
                                disabled={createLink.isPending || linkPassword.length === 0}
                                className="min-h-[42px] px-4 rounded-[10px] text-[13px] font-medium text-[var(--brand-primary-ink)] disabled:opacity-50"
                                style={{ background: 'var(--brand-primary)' }}
                              >
                                {createLink.isPending ? t('settings.cc.people.setupLinkWorking') : t('settings.cc.people.setupLinkCreate')}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={closeLinkPanel}
                              className="min-h-[42px] px-4 rounded-[10px] border border-slate-200 bg-white text-[13px] font-medium text-slate-600"
                            >
                              {linkResult ? t('settings.cc.people.setupLinkDone') : t('settings.common.cancel')}
                            </button>
                          </div>
                        </form>
                      )}
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

      {/* ── First sign-in links (2026-10-10) ─────────────────────────────
          Accounts in this organisation and its locations still on their
          provisioning starter credentials. One CSV of one-time links replaces
          handing out guessable starter passwords. */}
      {isAdminCaller && (setupAccounts.data?.accounts?.length ?? 0) > 0 && (
        <EditorSection
          id="setup-links"
          title={t('settings.cc.people.setupLinksTitle')}
          description={t('settings.cc.people.setupLinksDescription')}
        >
          <p className="text-[13px] text-slate-700 mb-2">
            {t('settings.cc.people.setupLinksCount', { count: setupAccounts.data!.accounts.length })}
          </p>
          <ul className="divide-y divide-slate-100 border-t border-slate-100 mb-3">
            {setupAccounts.data!.accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 px-2 py-2.5">
                <span className="text-[13px] text-slate-900 min-w-0 truncate">{a.tenantName || a.email}</span>
                <span className="text-[12px] text-slate-500 min-w-0 truncate">{a.email}</span>
                <StatusPill
                  className="ml-auto"
                  kind={a.hasTwoStep ? 'blocked' : a.link === 'active' ? 'ready' : 'attention'}
                  label={
                    a.hasTwoStep
                      ? t('settings.cc.people.linkStatusTwoStep')
                      : a.link === 'active' && a.linkExpiresAt
                        ? t('settings.cc.people.linkStatusActive', { date: fmtDate(a.linkExpiresAt) })
                        : a.link === 'used'
                          ? t('settings.cc.people.linkStatusUsed')
                          : a.link === 'expired'
                            ? t('settings.cc.people.linkStatusExpired')
                            : t('settings.cc.people.linkStatusNone')
                  }
                />
              </li>
            ))}
          </ul>
          <form
            onSubmit={(e) => { e.preventDefault(); handleBulkDownload(); }}
            className="rounded-[11px] border border-slate-200 bg-slate-50/70 p-3.5"
          >
            <p className="text-[12px] leading-[17px] text-slate-600 mb-2">{t('settings.cc.people.downloadLinksExplain')}</p>
            <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
              <div className="flex-1 min-w-0">
                <label htmlFor="people-bulk-password" className="block text-[12px] font-medium text-slate-700 mb-1">
                  {t('settings.cc.people.yourPassword')}
                </label>
                <input
                  id="people-bulk-password"
                  type="password"
                  autoComplete="current-password"
                  value={bulkPassword}
                  onChange={(e) => setBulkPassword(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-[9px] border border-slate-300 bg-white text-[13px]"
                />
              </div>
              <button
                type="submit"
                disabled={bulkLinks.isPending || bulkPassword.length === 0}
                className="inline-flex items-center justify-center gap-1.5 min-h-[42px] px-4 rounded-[10px] text-[13px] font-medium text-[var(--brand-primary-ink)] disabled:opacity-50"
                style={{ background: 'var(--brand-primary)' }}
              >
                <Download className="w-4 h-4" aria-hidden />
                {bulkLinks.isPending ? t('settings.cc.people.downloadLinksWorking') : t('settings.cc.people.downloadLinks')}
              </button>
            </div>
            {bulkError && <p role="alert" className="mt-2 text-[12px] text-rose-700">{bulkError}</p>}
            {bulkDone && <p role="status" className="mt-2 text-[12px] text-emerald-800">{bulkDone}</p>}
          </form>
        </EditorSection>
      )}

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
        {/* ── Org-wide enforcement (2026-09-11) ───────────────────────── */}
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill
            // While the tenant is still loading we say UNKNOWN, not "optional".
            // `enforced` is false before the answer arrives, and painting that
            // as a posture would tell an operator their organization is not
            // enforcing a second factor when we have not yet asked.
            kind={mfa.isError || mfa.isLoading ? 'unknown' : mfa.enforced ? 'ready' : 'notConfigured'}
            label={mfa.isLoading
              ? t('settings.common.loadingEllipsis')
              : mfa.isError
                ? t('settings.common.unavailable')
                : mfa.enforced ? t('settings.cc.people.mfaEnforceOn') : t('settings.cc.people.mfaEnforceOff')}
          />
          <p className="text-[12px] leading-[17px] text-slate-500 flex-1 min-w-[200px]">
            {mfa.isLoading || mfa.isError
              ? ' '
              : mfa.enforced
                ? t('settings.cc.people.mfaEnforceOnNote')
                : t('settings.cc.people.mfaEnforceOffNote')}
          </p>
          <button
            type="button"
            onClick={() => setMfaEnforced.mutate(!mfa.enforced)}
            disabled={!canSetMfaPolicy || setMfaEnforced.isPending || mfa.isLoading || mfa.isError}
            aria-pressed={mfa.enforced}
            title={!canSetMfaPolicy
              ? t('settings.cc.people.mfaEnforceDistrictOnly')
              : mfa.enforced ? t('settings.cc.people.mfaEnforceTurnOff') : t('settings.cc.people.mfaEnforceTurnOn')}
            className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-[9px] border border-slate-200 bg-white text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {setMfaEnforced.isPending || mfa.isLoading
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
              : mfa.enforced ? <ShieldCheck className="w-3.5 h-3.5" aria-hidden /> : <ShieldOff className="w-3.5 h-3.5" aria-hidden />}
            {mfa.enforced ? t('settings.cc.people.mfaEnforceTurnOff') : t('settings.cc.people.mfaEnforceTurnOn')}
          </button>
        </div>
        {/* Say what the toggle does NOT do, rather than letting an operator
            infer it: nobody is signed out, and an existing authenticator keeps
            being asked for. Both are surprising if you have to discover them. */}
        <p className="mt-2 text-[12px] leading-[17px] text-slate-500">
          {t('settings.cc.people.mfaEnforceNoSignOutNote')}
        </p>
        {!canSetMfaPolicy && (
          <p className="mt-1.5 text-[12px] leading-[17px] text-slate-500">
            {t('settings.cc.people.mfaEnforceDistrictOnly')}
          </p>
        )}
        {setMfaEnforced.isError && (
          <p className="mt-1.5 text-[12px] leading-[17px] text-rose-600">
            {t('settings.cc.people.mfaEnforceFailed')}
          </p>
        )}

        <p className="mt-4 text-[13px] text-slate-700" data-testid="people-mfa-count">
          {/* DEV-013 (Muse beta): this read "0 of 0 accounts" while the roster
              was still loading (or had failed) — a number the evidence did not
              support. Say what is true until the roster arrives. */}
          {usersLoading
            ? t('settings.common.loading')
            : usersError
              ? t('settings.common.unavailable')
              : t('settings.cc.people.mfaCount', { required: mfaRequiredCount, total: rows.length })}
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
