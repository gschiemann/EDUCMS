"use client";

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Lock } from 'lucide-react';
import { MfaCard } from '@/components/settings/MfaCard';

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

  return (
    <div className="max-w-4xl space-y-8">
      <Link
        href={`/${schoolId}/settings`}
        className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-indigo-600"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Settings
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-800 flex items-center gap-2">
          <Lock className="w-7 h-7 text-indigo-500" />
          Security
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Protect your account. Two-factor authentication adds a second step to
          sign-in using a code from your phone.
        </p>
      </div>

      <MfaCard />
    </div>
  );
}
