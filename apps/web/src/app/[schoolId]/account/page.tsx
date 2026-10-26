"use client";

/**
 * My account — everything a person changes about THEMSELVES (2026-10-26,
 * Settings simplification Phase 1).
 *
 * Owner decision 1: Editors and Viewers no longer see Settings; this page is
 * theirs, and every admin's too. It is also where "My security" moved
 * (`/settings/security` redirects here, keeping `?add=passkey` and the
 * `#sec-passkeys` anchor) — the owner's 2026-05-11 rule that per-user
 * settings do not belong in Settings.
 *
 *   Profile ............ name, email, role, Edit profile
 *   Sign-in & security . password (#sec-password), passkeys (#sec-passkeys,
 *                        `?add=passkey` opens the add panel), two-step
 *                        sign-in (#sec-mfa)
 *   Language ........... #account-language
 *   Notifications ...... alert emails (#alert-emails — every alert email
 *                        links here), only for people who receive them
 *   Your organization .. the location you are in; admins get Settings
 *
 * Nothing here is tenant-scoped except the organization row: these are the
 * person's own sign-in and preferences.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Building2, Check, ChevronRight, Globe, Info, KeyRound, LogOut, Mail, Pencil, Shield, Bell,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { useAlertEmailPrefs, useTenantStatus } from '@/hooks/use-api';
import { fullName as userFullName, firstName as userFirstName } from '@/lib/user-display';
import { ProfileEditModal } from '@/components/layout/ProfileEditModal';
import { AlertEmailSettings } from '@/components/notifications/AlertEmailSettings';
import { ChangePasswordCard } from '@/components/settings/ChangePasswordCard';
import { PasskeyCard } from '@/components/settings/PasskeyCard';
import { MfaCard } from '@/components/settings/MfaCard';
import { HelpText } from '@/components/settings/shell/primitives';
import { canSeeSettings } from '@/components/settings/shell/registry';
import { appConfirm } from '@/components/ui/app-dialog';
import { LOCALES, LOCALE_LABELS } from '@/i18n/config';
import { useLocaleSwitch } from '@/i18n/I18nProvider';
import { cn } from '@/lib/utils';

export default function AccountPage() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams<{ schoolId?: string }>();
  const schoolId = params?.schoolId || '';
  const user = useAppStore((s) => s.user);
  const logout = useAppStore((s) => s.logout);
  const { data: tenant } = useTenantStatus();
  const { data: alertPrefs } = useAlertEmailPrefs();
  const [editOpen, setEditOpen] = useState(false);
  const isAdmin = canSeeSettings(user?.role);

  // `?add=passkey` — "Set up a passkey" (avatar menu, sign-in prompts, the old
  // /settings/security link) lands here with the add panel open; `#sec-passkeys`
  // ("Manage passkeys") only scrolls. Read after mount, so the page needs no
  // useSearchParams Suspense boundary.
  const [addPasskeyRequested, setAddPasskeyRequested] = useState(false);
  useEffect(() => {
    let target: string | null = null;
    try {
      if (new URLSearchParams(window.location.search).get('add') === 'passkey') {
        setAddPasskeyRequested(true);
        target = 'sec-passkeys';
      }
      const hash = window.location.hash.replace(/^#/, '');
      if (!target && hash) target = hash;
    } catch { /* nothing to read */ }
    if (!target) return;
    // Most sections render on the first paint; the alert-email row waits for
    // its own read. A few one-off tries on mount — never a running timer.
    const timers: number[] = [];
    const tryScroll = (left: number) => {
      const el = document.getElementById(target!);
      if (el) { el.scrollIntoView?.({ block: 'start' }); return; }
      if (left > 0) timers.push(window.setTimeout(() => tryScroll(left - 1), 400));
    };
    timers.push(window.setTimeout(() => tryScroll(4), 0));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, []);

  const initials = (() => {
    const f = userFirstName(user);
    if (f) return f.slice(0, 1).toUpperCase();
    const e = user?.email || '';
    return (e[0] || '?').toUpperCase();
  })();

  const handleSignOut = async () => {
    const ok = await appConfirm({
      title: t('account.signOutTitle'),
      message: t('account.signOutMessage'),
      confirmLabel: t('account.signOut'),
      tone: 'danger',
    });
    if (!ok) return;
    logout();
    router.push('/login');
  };

  const roleLabel = (() => {
    switch (user?.role) {
      case 'SUPER_ADMIN':       return t('account.roleSuperAdmin');
      case 'DISTRICT_ADMIN':    return t('account.roleDistrictAdmin');
      case 'SCHOOL_ADMIN':      return t('account.roleSchoolAdmin');
      case 'CONTRIBUTOR':       return t('account.roleContributor');
      case 'RESTRICTED_VIEWER': return t('account.roleViewer');
      default:                  return user?.role || t('account.roleUnknown');
    }
  })();

  const buildSha = (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
                    process.env.NEXT_PUBLIC_BUILD_SHA ||
                    '').slice(0, 7);

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 py-5 md:px-6 md:py-8 space-y-5" data-testid="my-account">
      <header>
        <h1 className="text-[26px] leading-[32px] md:text-[30px] md:leading-[36px] font-semibold tracking-[-.03em] text-slate-900">
          {t('account.title')}
        </h1>
        <p className="mt-1 text-[13px] leading-[18px] text-slate-500">{t('account.subtitle')}</p>
      </header>

      {/* Profile */}
      <div className="rounded-2xl bg-white border border-slate-200 p-5">
        <div className="flex items-center gap-4">
          <div
            className="shrink-0 w-14 h-14 rounded-2xl text-white text-xl font-bold flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, var(--brand-primary, #4f46e5), color-mix(in srgb, var(--brand-primary, #4f46e5) 60%, #8b5cf6))' }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[17px] font-semibold text-slate-900 truncate">
              {userFullName(user) || userFirstName(user) || t('account.title')}
            </div>
            <div className="text-[13px] text-slate-500 truncate flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 shrink-0" aria-hidden /> {user?.email || '—'}
            </div>
            <div className="mt-1 text-[12px] font-medium text-slate-600 flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 shrink-0" aria-hidden /> {roleLabel}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="hidden sm:inline-flex shrink-0 items-center gap-1.5 min-h-[44px] px-3.5 rounded-[10px] border border-slate-200 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
          >
            <Pencil className="w-3.5 h-3.5" aria-hidden /> {t('account.editProfile')}
          </button>
        </div>
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          className="sm:hidden mt-4 w-full min-h-[44px] rounded-[10px] border border-slate-200 text-[13px] font-medium text-slate-700 flex items-center justify-center gap-1.5"
        >
          <Pencil className="w-3.5 h-3.5" aria-hidden /> {t('account.editProfile')}
        </button>
      </div>

      {/* Sign-in and security */}
      {/* Each card carries its own heading; the wrappers hold the anchors
          old links and sign-in prompts land on. */}
      <Card icon={KeyRound} title={t('account.securityTitle')} description={t('account.securityDesc')}>
        <div className="space-y-3">
          <div id="sec-password" className="scroll-mt-20">
            <ChangePasswordCard />
          </div>
          {/* Passkeys sit ABOVE two-step on purpose (2026-09-21): the
              authenticator app is the part people hate; a passkey replaces it. */}
          <div id="sec-passkeys" className="scroll-mt-20">
            <PasskeyCard autoOpenAdd={addPasskeyRequested} />
          </div>
          <div id="sec-mfa" className="scroll-mt-20">
            <MfaCard />
          </div>
        </div>
      </Card>

      {/* Language */}
      <Card id="account-language" icon={Globe} title={t('account.languageTitle')} description={t('account.languageDesc')}>
        <LanguagePicker />
      </Card>

      {/* Notifications — alert emails, for the people who receive them */}
      {alertPrefs?.eligible && (
        <Card icon={Bell} title={t('account.sectionNotifications')} flush>
          <AlertEmailSettings />
        </Card>
      )}

      {/* Your organization */}
      <Card icon={Building2} title={t('account.organizationTitle')} flush>
        <div className="px-5 py-3.5 text-[14px] font-medium text-slate-800">
          {tenant?.name || t('settings.common.loadingEllipsis')}
        </div>
        {isAdmin && (
          <Link
            href={`/${schoolId}/settings`}
            className="flex items-center gap-3 px-5 py-3.5 border-t border-slate-100 hover:bg-slate-50 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-medium text-slate-800">{t('account.openSettings')}</div>
              <div className="text-[12px] text-slate-500">{t('account.openSettingsSub')}</div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-300" aria-hidden />
          </Link>
        )}
      </Card>

      <button
        type="button"
        onClick={handleSignOut}
        className="w-full min-h-[48px] rounded-2xl bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 transition-colors font-semibold text-[14px] flex items-center justify-center gap-2"
      >
        <LogOut className="w-4 h-4" aria-hidden /> {t('account.signOut')}
      </button>

      <div className="pt-1 pb-2 text-center">
        <div className="text-[11px] text-slate-400 flex items-center justify-center gap-1.5">
          <Info className="w-3 h-3" aria-hidden />
          {t('account.appInfo')}
          {buildSha && <span className="font-mono">· {buildSha}</span>}
        </div>
      </div>

      {editOpen && <ProfileEditModal onClose={() => setEditOpen(false)} />}
    </div>
  );
}

function Card({
  id,
  icon: Icon,
  title,
  description,
  flush,
  children,
}: {
  id?: string;
  icon: typeof Globe;
  title: string;
  description?: string;
  /** Children draw their own padding (rows). */
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="rounded-2xl bg-white border border-slate-200 overflow-hidden scroll-mt-20" aria-labelledby={id ? `${id}-title` : undefined}>
      <div className="flex items-start gap-3 px-5 pt-4 pb-3">
        <span className="w-9 h-9 shrink-0 grid place-items-center rounded-xl" style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary)' }}>
          <Icon className="w-[18px] h-[18px]" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 id={id ? `${id}-title` : undefined} className="text-[15px] leading-[20px] font-semibold text-slate-900">{title}</h2>
          {description && <HelpText text={description} className="mt-0.5 text-[12px] leading-[17px] text-slate-500" />}
        </div>
      </div>
      <div className={cn(!flush && 'px-5 pb-5', flush && 'border-t border-slate-100')}>{children}</div>
    </section>
  );
}

/** One button per language, each named in itself; switches in place (cookie, this device). */
function LanguagePicker() {
  const { locale, setLocale } = useLocaleSwitch();
  return (
    <div className="grid grid-cols-3 gap-2" role="group">
      {LOCALES.map((l) => {
        const on = l === locale;
        return (
          <button
            key={l}
            type="button"
            onClick={() => setLocale(l)}
            aria-pressed={on}
            className={cn(
              'min-h-[44px] px-3 rounded-[10px] border text-[13px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors',
              on ? 'text-slate-900' : 'border-slate-200 text-slate-600 hover:bg-slate-50',
            )}
            style={on ? { borderColor: 'var(--brand-primary)', background: 'var(--brand-primary-soft)' } : undefined}
          >
            {on && <Check className="w-4 h-4" aria-hidden style={{ color: 'var(--brand-primary)' }} />}
            {LOCALE_LABELS[l]}
          </button>
        );
      })}
    </div>
  );
}
