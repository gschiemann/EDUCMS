"use client";

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { MfaCard } from '@/components/settings/MfaCard';
import { ChangePasswordCard } from '@/components/settings/ChangePasswordCard';

/**
 * Security settings — per-user account security.
 *
 * 2026-05-28 — first surface here is two-factor (TOTP) authentication.
 * MFA is a per-USER setting (every signed-in user secures their own
 * account), so this page is intentionally NOT role-gated — a CONTRIBUTOR
 * should be able to turn on 2FA for themselves just like an admin.
 */
export default function SecuritySettingsPage() {
  const { schoolId } = useParams<{ schoolId: string }>();
  const t = useTranslations();

  return (
    <div className="max-w-4xl space-y-8">
      <Link
        href={`/${schoolId}/settings`}
        className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-indigo-600"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> {t('settings.common.back')}
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-800 flex items-center gap-2">
          <Lock className="w-7 h-7 text-indigo-500" />
          {t('settings.security.title')}
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {t('settings.security.subtitle')}
        </p>
      </div>

      <MfaCard />
      {/* ACC-02 (2026-08-01) shipped POST /auth/change-password with no UI at
          all — the only way to rotate a password was the emailed reset link.
          Sits under MFA because it is the other half of "lock my account
          down right now": rotate the credential AND end every other session. */}
      <ChangePasswordCard />
    </div>
  );
}
