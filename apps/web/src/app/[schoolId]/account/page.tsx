"use client";

/**
 * Mobile-first Account page. Linked from the MobileTabBar's
 * person-icon tab. On desktop the same information is in the
 * TopToolbar's profile menu + the various Settings panels, so this
 * route is primarily a phone landing surface. Keeps it functional
 * on desktop too — operators on the larger viewport can still hit
 * it directly without a separate route.
 *
 * Contents (top → bottom):
 *   1. Profile card — name, email, role, avatar initials.
 *   2. Account actions — Edit profile, Change password, Sign out.
 *   3. Tenant info — currently-active school + (admins) link to
 *      Settings → Schools to switch.
 *   4. App info — version, build SHA (helps support).
 *
 * Phase 1 of MOBILE_APP_ROADMAP.md.
 */

import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import {
  User, Mail, Shield, LogOut, Settings, Pencil, Building2,
  ChevronRight, Info, Bell, Bug,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { useTenantStatus } from '@/hooks/use-api';
import { fullName as userFullName, firstName as userFirstName } from '@/lib/user-display';
import { ProfileEditModal } from '@/components/layout/ProfileEditModal';
import { appConfirm } from '@/components/ui/app-dialog';
import { cn } from '@/lib/utils';

export default function AccountPage() {
  const router = useRouter();
  const params = useParams<{ schoolId?: string }>();
  const schoolId = params?.schoolId || '';
  const user = useAppStore((s) => s.user);
  const logout = useAppStore((s) => s.logout);
  const { data: tenant } = useTenantStatus();
  const [editOpen, setEditOpen] = useState(false);

  const initials = (() => {
    const f = userFirstName(user);
    if (f) return f.slice(0, 1).toUpperCase();
    const e = user?.email || '';
    return (e[0] || '?').toUpperCase();
  })();

  const handleSignOut = async () => {
    const ok = await appConfirm({
      title: 'Sign out?',
      message: 'You’ll need to sign in again to manage screens and content.',
      confirmLabel: 'Sign out',
      tone: 'danger',
    });
    if (!ok) return;
    logout();
    router.push('/login');
  };

  const roleLabel = (() => {
    switch (user?.role) {
      case 'SUPER_ADMIN':       return 'Super Admin';
      case 'DISTRICT_ADMIN':    return 'District Admin';
      case 'SCHOOL_ADMIN':      return 'School Admin';
      case 'CONTRIBUTOR':       return 'Contributor';
      case 'RESTRICTED_VIEWER': return 'Viewer';
      default:                  return user?.role || 'Unknown';
    }
  })();

  const buildSha = (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
                    process.env.NEXT_PUBLIC_BUILD_SHA ||
                    '').slice(0, 7);

  return (
    <div className="space-y-4 max-w-md mx-auto">
      {/* Profile card */}
      <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5">
        <div className="flex items-center gap-4">
          <div className="shrink-0 w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-2xl font-extrabold flex items-center justify-center shadow-md">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-lg font-bold text-slate-900 truncate">
              {userFullName(user) || userFirstName(user) || 'Account'}
            </div>
            <div className="text-xs text-slate-500 truncate flex items-center gap-1">
              <Mail className="w-3 h-3" /> {user?.email || '—'}
            </div>
            <div className="text-[10px] uppercase tracking-wider font-bold text-indigo-600 mt-1 flex items-center gap-1">
              <Shield className="w-3 h-3" /> {roleLabel}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          className="mt-4 w-full py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-sm font-bold flex items-center justify-center gap-1.5 transition-colors"
        >
          <Pencil className="w-3.5 h-3.5" /> Edit profile
        </button>
      </div>

      {/* Tenant info */}
      <Section title="School">
        <Row icon={Building2} label={tenant?.name || 'Loading…'} sub="Current school" />
        {(user?.role === 'SUPER_ADMIN' ||
          user?.role === 'DISTRICT_ADMIN' ||
          user?.role === 'SCHOOL_ADMIN') && (
          <LinkRow
            icon={Settings}
            label="School settings"
            sub="Branding, emergency content, integrations"
            href={`/${schoolId}/settings`}
          />
        )}
      </Section>

      {/* Notifications */}
      <Section title="Notifications">
        <LinkRow
          icon={Bell}
          label="Notification settings"
          sub="Push, email, in-app preferences"
          href={`/${schoolId}/settings`}
        />
      </Section>

      {/* Sign out */}
      <button
        type="button"
        onClick={handleSignOut}
        className="w-full py-3 rounded-2xl bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 active:scale-[0.99] transition-all font-bold text-sm flex items-center justify-center gap-2 shadow-sm"
      >
        <LogOut className="w-4 h-4" /> Sign out
      </button>

      {/* App info — bottom, muted */}
      <div className="pt-4 pb-2 text-center">
        <div className="text-[11px] text-slate-400 flex items-center justify-center gap-1.5">
          <Info className="w-3 h-3" />
          Venue OS dashboard
          {buildSha && <span className="font-mono">· {buildSha}</span>}
        </div>
      </div>

      {/* Edit profile modal — only mount when open; ProfileEditModal
          owns its own open state once mounted. */}
      {editOpen && <ProfileEditModal onClose={() => setEditOpen(false)} />}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-100">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{title}</div>
      </div>
      <div className="divide-y divide-slate-100">{children}</div>
    </div>
  );
}

function Row({
  icon: Icon, label, sub,
}: {
  icon: typeof User;
  label: string;
  sub?: string;
}) {
  return (
    <div className="px-4 py-3 flex items-center gap-3">
      <Icon className="w-4 h-4 text-slate-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-slate-800 truncate">{label}</div>
        {sub && <div className="text-[11px] text-slate-500 truncate">{sub}</div>}
      </div>
    </div>
  );
}

function LinkRow({
  icon: Icon, label, sub, href,
}: {
  icon: typeof User;
  label: string;
  sub?: string;
  href: string;
}) {
  return (
    <Link href={href} className={cn('px-4 py-3 flex items-center gap-3 active:bg-slate-50 transition-colors')}>
      <Icon className="w-4 h-4 text-slate-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-slate-800 truncate">{label}</div>
        {sub && <div className="text-[11px] text-slate-500 truncate">{sub}</div>}
      </div>
      <ChevronRight className="w-4 h-4 text-slate-300" />
    </Link>
  );
}
