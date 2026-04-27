"use client";

import { Settings as SettingsIcon, Key, UserPlus, Trash2, Loader2, Shield, MonitorPlay, AlertOctagon, Usb, MapPin, Plus, ArrowRight, Building2, ShieldCheck, ShieldOff } from 'lucide-react';
import { usePathname, useParams } from 'next/navigation';
import Link from 'next/link';
import { RoleGate } from '@/components/RoleGate';
import {
  useUsers, useInviteUser, useCreateUserDirect, useDeleteUser, useUpdateUserRole, useTenant,
  useUpdateTenantPanicSettings, usePlaylists,
  useLocationBasedEmergencyConfig, useToggleLocationBasedEmergency, useFloorPlans, useScreens,
} from '@/hooks/use-api';
import { useState, useRef, useEffect } from 'react';
import { UsbIngestCard } from '@/components/settings/UsbIngestCard';
import { LicenseCard } from '@/components/settings/LicenseCard';
import { PanicContentEditor } from '@/components/settings/PanicContentEditor';
import { BrandingSettingsCard } from '@/components/settings/BrandingSettingsCard';
import { DistrictSchoolsCard } from '@/components/settings/DistrictSchoolsCard';
import { appConfirm } from '@/components/ui/app-dialog';

const ROLES = ['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN', 'CONTRIBUTOR', 'RESTRICTED_VIEWER'] as const;

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  DISTRICT_ADMIN: 'District Admin',
  SCHOOL_ADMIN: 'School Admin',
  CONTRIBUTOR: 'Contributor',
  RESTRICTED_VIEWER: 'Viewer',
};

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  DISTRICT_ADMIN: 'bg-violet-50 text-violet-700 border-violet-200',
  SCHOOL_ADMIN: 'bg-sky-50 text-sky-700 border-sky-200',
  CONTRIBUTOR: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  RESTRICTED_VIEWER: 'bg-slate-50 text-slate-600 border-slate-200',
};

export default function SettingsPage() {
  const pathname = usePathname();
  const { data: users, isLoading: usersLoading } = useUsers();
  const { data: tenant, isLoading: tenantLoading } = useTenant();
  const { data: playlists } = usePlaylists();
  
  const inviteUser = useInviteUser();
  const createDirect = useCreateUserDirect();
  const [inviteMode, setInviteMode] = useState<'email' | 'password'>('password');
  const [newPassword, setNewPassword] = useState('');
  const deleteUser = useDeleteUser();
  const updateRole = useUpdateUserRole();
  const updatePanicSettings = useUpdateTenantPanicSettings();
  const [showAddUser, setShowAddUser] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<string>('CONTRIBUTOR');
  const [inviteStatus, setInviteStatus] = useState<{ kind: 'ok' | 'err' | 'copy'; message: string; acceptUrl?: string } | null>(null);
  const inviteEmailRef = useRef<HTMLInputElement>(null);

  // Focus invite email input when the add-user form opens
  useEffect(() => {
    if (showAddUser) {
      inviteEmailRef.current?.focus();
    }
  }, [showAddUser]);

  const handleInvite = async () => {
    if (!newEmail.trim()) return;
    setInviteStatus(null);
    try {
      if (inviteMode === 'password') {
        if (newPassword.length < 8) {
          setInviteStatus({ kind: 'err', message: 'Password must be at least 8 characters.' });
          return;
        }
        await createDirect.mutateAsync({ email: newEmail.trim(), role: newRole, password: newPassword });
        setInviteStatus({ kind: 'ok', message: `Added ${newEmail.trim()}. They can log in with the password you set.` });
        setNewEmail(''); setNewPassword('');
        setShowAddUser(false);
        return;
      }
      const res: any = await inviteUser.mutateAsync({ email: newEmail.trim(), role: newRole });
      // API returns { acceptUrl, emailDelivered }. If email isn't wired up
      // we surface the accept link so the admin can paste it into their own
      // email / Slack rather than the invite disappearing into the void.
      if (res?.emailDelivered === false && res?.acceptUrl) {
        setInviteStatus({
          kind: 'copy',
          message: `Invitation created for ${newEmail.trim()}. Email isn't configured yet — copy this link and send it to them:`,
          acceptUrl: res.acceptUrl,
        });
      } else {
        setInviteStatus({ kind: 'ok', message: `Invitation sent to ${newEmail.trim()}.` });
        setShowAddUser(false);
      }
      setNewEmail('');
    } catch (err: any) {
      setInviteStatus({ kind: 'err', message: err?.message || 'Could not send invitation.' });
    }
  };

  const playerUrl = typeof window !== 'undefined' ? `${window.location.origin}/player` : 'http://localhost:3000/player';

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-800 flex items-center gap-2">
          <SettingsIcon className="w-7 h-7" style={{ color: 'var(--brand-primary, #6366f1)' }} />
          Settings
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">Manage team members, roles, and system info.</p>
      </div>

      <RoleGate
        allowedRoles={['admin']}
        fallback={
          <div className="bg-slate-50 p-8 rounded-xl border border-slate-200 text-center">
            <Key className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-sm font-bold text-slate-700">Admin Access Required</h3>
            <p className="text-xs text-slate-500 mt-2">Contact your administrator to manage settings.</p>
          </div>
        }
      >
        {/* System Info */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
            <MonitorPlay className="w-4 h-4" style={{ color: 'var(--brand-primary, #6366f1)' }} /> System Info
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Player URL</p>
              <code className="text-xs text-slate-700 select-all">{playerUrl}</code>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">API Endpoint</p>
              <code className="text-xs text-slate-700 select-all">{process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1'}</code>
            </div>
          </div>
        </div>

        {/* Panic Button Content — direct upload, can't be accidentally deleted.
            Aligned with the Standard Response Protocol (SRP) used by most US K-12
            districts: Hold, Secure, Lockdown, Evacuate, Shelter (= Weather here).
            Plus a separate Medical bucket for nurse / EMS events.

            Sprint 8b — the "Location-based emergency" toggle now lives in this
            same card's header. Operator wanted ONE menu, not two. Flipping ON
            unlocks per-screen emergency overrides via floor plans, and the
            inline section below the panic editors lets the admin jump straight
            to the floor plans editor without leaving Settings. */}
        <RoleGate allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']}>
          <PanicContentSection />
        </RoleGate>

        {/* Auto-branding — paste URL → CMS re-skins (Sprint 9) */}
        <RoleGate allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']}>
          <BrandingSettingsCard />
        </RoleGate>

        {/* District-level: list + create child schools (Sprint 12 — district hierarchy UI) */}
        <RoleGate allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN']}>
          <DistrictSchoolsCard />
        </RoleGate>

        {/* License & Billing (Sprint 7E) — current tier, seats used, expiry */}
        <LicenseCard />

        {/* USB Sneakernet Ingest (Sprint 7B) — admins enable + rotate HMAC key + see ingest events */}
        <RoleGate allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']}>
          {/* USB export was moved to an inline 'Download' button on each
              playlist header — the user wanted a single-click flow with
              no separate USB settings page. Signing key + enable flag
              are now auto-provisioned on first export, so nothing here
              to configure. The UsbIngestCard below stays for power users
              who want to rotate/revoke, but isn't required for the
              basic workflow. */}
          <UsbIngestCard />

          {/* Android Player APK download — Nova Taurus, BrightSign, any
              Android 7+ kiosk. Redirects to the latest signed release
              asset. Once sideloaded, the APK OTA-updates itself every
              6h via /api/v1/player/update-check. */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center justify-between mt-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center">
                <MonitorPlay className="w-4 h-4 text-emerald-600" />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-800">Download Player APK</div>
                <div className="text-[11px] text-slate-500">Android kiosk build — Nova Taurus, generic Android 7+. Auto-updates over-the-air after install.</div>
              </div>
            </div>
            <a
              href={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1'}/player/apk/latest`}
              target="_blank" rel="noopener"
              className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg"
            >
              Download APK
            </a>
          </div>
        </RoleGate>

        {/* Team Members */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
            <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2">
              <Shield className="w-4 h-4" style={{ color: 'var(--brand-primary, #6366f1)' }} /> Team Members
            </h2>
            <button
              onClick={() => setShowAddUser(true)}
              className="px-3 py-1.5 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5"
              style={{ background: 'var(--brand-primary, #4f46e5)' }}
            >
              <UserPlus className="w-3.5 h-3.5" /> Invite by email
            </button>
          </div>

          {inviteStatus && (
            <div className={`px-6 py-2.5 text-xs font-medium border-b ${
              inviteStatus.kind === 'ok'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                : inviteStatus.kind === 'copy'
                  ? 'bg-amber-50 text-amber-900 border-amber-200'
                  : 'bg-red-50 text-red-700 border-red-100'
            }`}>
              <div>{inviteStatus.message}</div>
              {inviteStatus.kind === 'copy' && inviteStatus.acceptUrl && (
                <div className="flex items-center gap-2 mt-2">
                  <input
                    readOnly
                    value={inviteStatus.acceptUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 px-2 py-1.5 text-[11px] font-mono bg-white border border-amber-300 rounded"
                  />
                  <button
                    type="button"
                    onClick={() => { navigator.clipboard?.writeText(inviteStatus.acceptUrl || ''); }}
                    className="px-3 py-1.5 text-[11px] font-semibold rounded bg-amber-600 hover:bg-amber-700 text-white"
                  >
                    Copy link
                  </button>
                </div>
              )}
            </div>
          )}

          {showAddUser && (
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-100">
              {/* Mode toggle */}
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 mb-3 text-xs">
                <button
                  type="button"
                  onClick={() => setInviteMode('password')}
                  className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${inviteMode === 'password' ? 'text-white' : 'text-slate-600 hover:text-slate-900'}`}
                  style={inviteMode === 'password' ? { background: 'var(--brand-primary, #4f46e5)' } : undefined}
                >
                  Set password now
                </button>
                <button
                  type="button"
                  onClick={() => setInviteMode('email')}
                  className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${inviteMode === 'email' ? 'text-white' : 'text-slate-600 hover:text-slate-900'}`}
                  style={inviteMode === 'email' ? { background: 'var(--brand-primary, #4f46e5)' } : undefined}
                >
                  Email invite link
                </button>
              </div>
              <p className="text-xs text-slate-500 mb-3">
                {inviteMode === 'password'
                  ? 'Create the user immediately with a password you set. Give it to them in person or over chat — they can change it after first login.'
                  : 'We\u2019ll generate an invite link. The recipient sets their own password via the link — you never see it.'}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input ref={inviteEmailRef} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="teacher@school.edu" type="email"
                  className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500" />
                <select value={newRole} onChange={(e) => setNewRole(e.target.value)}
                  className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500">
                  {ROLES.filter(r => r !== 'SUPER_ADMIN').map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
                {inviteMode === 'password' && (
                  <input
                    type="text"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Temporary password (min 8 chars)"
                    autoComplete="new-password"
                    className="md:col-span-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-mono outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                )}
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={handleInvite}
                  disabled={inviteUser.isPending || createDirect.isPending || !newEmail.trim() || (inviteMode === 'password' && newPassword.length < 8)}
                  className="px-4 py-2 disabled:opacity-50 text-white text-xs font-semibold rounded-lg"
                  style={{ background: 'var(--brand-primary, #4f46e5)' }}>
                  {(inviteUser.isPending || createDirect.isPending)
                    ? (inviteMode === 'password' ? 'Creating\u2026' : 'Sending\u2026')
                    : (inviteMode === 'password' ? 'Create user' : 'Send invitation')}
                </button>
                <button onClick={() => { setShowAddUser(false); setInviteStatus(null); setNewPassword(''); }}
                  className="px-4 py-2 text-slate-500 hover:text-slate-700 text-xs font-semibold">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {usersLoading && (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--brand-primary, #6366f1)' }} />
            </div>
          )}

          {users && (
            <div className="divide-y divide-slate-50">
              {users.map((user: any) => (
                <div key={user.id} className="flex items-center justify-between px-6 py-3 hover:bg-slate-50/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[10px] font-bold" style={{ background: 'linear-gradient(135deg, var(--brand-primary, #6366f1), color-mix(in srgb, var(--brand-primary, #6366f1) 60%, #8b5cf6))' }}>
                      {user.email?.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-800">{user.email}</p>
                      <p className="text-[10px] text-slate-400">{user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Member'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <select
                      value={user.role}
                      onChange={(e) => updateRole.mutate({ id: user.id, role: e.target.value })}
                      className={`px-2.5 py-1 text-[10px] font-bold border rounded-lg cursor-pointer ${ROLE_COLORS[user.role] || 'bg-slate-50 text-slate-600'}`}
                    >
                      {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </select>
                    <button
                      onClick={async () => {
                        const ok = await appConfirm({
                          title: `Remove ${user.email}?`,
                          message: 'They will lose access immediately. Their audit log entries stay intact for compliance.',
                          tone: 'danger',
                          confirmLabel: 'Remove user',
                        });
                        if (ok) deleteUser.mutate(user.id);
                      }}
                      className="text-slate-300 hover:text-red-500 transition-colors p-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </RoleGate>
    </div>
  );
}

/**
 * Panic content card — combines tenant-wide panic button uploads (the
 * 6 SRP types) AND the Sprint 8b location-based emergency toggle into
 * ONE settings card. Operator's exact ask:
 *
 *   "dont make these two separate menus, just enable location based
 *    right from the main menu... what you built me i cant even enable
 *    at all so no way to load a map or anything."
 *
 * The toggle is wired directly to the tenant flag — no confirmation
 * gate on enable (it's reversible, non-destructive). The Floor Plans
 * subsection appears underneath the panic editors only when the toggle
 * is ON, with a "Manage floor plans" deep-link straight to the editor.
 */
function PanicContentSection() {
  const params = useParams<{ schoolId: string }>();
  const schoolId = params?.schoolId ?? '';
  const { data: cfg } = useLocationBasedEmergencyConfig();
  const { data: floorPlans } = useFloorPlans();
  const toggle = useToggleLocationBasedEmergency();
  const enabled = !!cfg?.enabled;
  const planCount = floorPlans?.length ?? 0;

  // The previous version also gated on `cfgLoading` which left the
  // toggle disabled forever if the GET was racing the deploy. We rely
  // ONLY on `toggle.isPending` now — undefined cfg is treated as OFF
  // and the user can still click to flip it ON. Operator literally
  // typed "i cant even enable at all" — fix is exactly that.
  const handleToggle = async (next: boolean) => {
    if (!next) {
      const ok = await appConfirm({
        title: 'Switch back to standard emergency?',
        message:
          'Every screen will play the tenant-wide panic content. Per-screen overrides are kept on disk; flipping back ON restores them. The change is non-destructive.',
        confirmLabel: 'Switch back',
        tone: 'danger',
      });
      if (!ok) return;
    }
    toggle.mutate(next);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2">
            <AlertOctagon className="w-4 h-4 text-red-500" /> Panic Button Content
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Upload the content that plays on screens when each panic type is triggered. Aligned with the
            Standard Response Protocol (SRP) used by US K-12 districts. These assets are protected and
            cannot be deleted from the regular Playlists list, so an accidental delete can never break a
            real emergency.
          </p>
        </div>
        {/* Inline location-based toggle — one menu, two modes */}
        <button
          type="button"
          onClick={() => handleToggle(!enabled)}
          disabled={toggle.isPending}
          aria-pressed={enabled}
          className={`shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] font-bold uppercase tracking-wide transition-colors ${
            enabled
              ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
              : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-400'
          } disabled:opacity-60 disabled:cursor-not-allowed`}
          title={enabled ? 'Switch back to standard emergency' : 'Enable per-screen location-based emergency'}
        >
          {toggle.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : enabled ? (
            <ShieldCheck className="w-4 h-4" />
          ) : (
            <ShieldOff className="w-4 h-4" />
          )}
          <span>Location mode {enabled ? 'On' : 'Off'}</span>
        </button>
      </div>
      <div className="p-6 space-y-6">
        {/* Operator ask (2026-04-27): "as soon as i enable the toggle for
            location based, replace all the default emergency cards with
            the floor map or the area to upload a floor map if i dont have
            one." So the body is mode-switched: standard mode shows the 6
            tenant-default panic editors; location mode swaps in the floor-
            plan workflow. Per-screen overrides happen on the floor plan
            page (drawer), NOT here — that was the duplicate menu we
            cleaned up. */}
        {!enabled ? (
          <>
            {/* Critical / life-safety row */}
            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Critical (life-safety)</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <PanicContentEditor kind="lockdown" label="Lockdown" accent="red"
                  hint="Threat inside the building — locks, lights, out of sight." />
                <PanicContentEditor kind="evacuate" label="Evacuate" accent="orange"
                  hint="Get out and head to the rendezvous point." />
                <PanicContentEditor kind="medical" label="Medical" accent="rose"
                  hint="Nurse / EMS event. Specify location." />
              </div>
            </div>

            {/* Heightened-awareness row */}
            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Heightened awareness</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <PanicContentEditor kind="secure" label="Secure (Lockout)" accent="amber"
                  hint="Threat OUTSIDE — lock perimeter, stay inside, business as usual." />
                <PanicContentEditor kind="weather" label="Shelter (Weather / Hazmat)" accent="violet"
                  hint="Tornado, severe storm, hazmat, air-quality event." />
                <PanicContentEditor kind="hold" label="Hold" accent="sky"
                  hint="Stay in classroom — clear hallways for medical / police passing through." />
              </div>
            </div>
          </>
        ) : (
          // LOCATION MODE — the 6 panic editors are gone. Floor plan IS
          // the configuration surface; click a screen pin on the plan,
          // upload the per-screen content from the drawer.
          <div>
            <div className="flex items-start gap-2 mb-4">
              <MapPin className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-[12px] font-bold text-slate-700">Location-based emergency</h3>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                  Open a floor plan, drag unplaced screens onto the map, and
                  click a screen to upload landscape + portrait emergency content for each
                  type. Empty slots fall back to the tenant default.
                </p>
              </div>
            </div>

            {planCount === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/40 p-6 flex flex-col items-center text-center gap-2">
                <Building2 className="w-8 h-8 text-slate-400" />
                <div className="text-sm font-bold text-slate-700">No floor plans yet</div>
                <p className="text-[12px] text-slate-500 max-w-md">
                  Upload an architectural floor plan, hand-drawn sketch, or PDF for each
                  building. Multi-floor schools get one plan per floor.
                </p>
                <Link
                  href={`/${schoolId}/floor-plans`}
                  className="inline-flex items-center gap-1.5 mt-2 text-[12px] font-bold px-4 py-2 rounded-md bg-rose-600 text-white hover:bg-rose-700 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Upload your first floor plan
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Your floor plans ({planCount}) — click to open
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {floorPlans!.map((p: any) => (
                    <Link
                      key={p.id}
                      href={`/${schoolId}/floor-plans/${p.id}`}
                      className="flex items-center gap-3 px-3 py-3 rounded-lg bg-slate-50 hover:bg-rose-50 hover:border-rose-200 border border-transparent transition-colors group"
                    >
                      <Building2 className="w-5 h-5 text-slate-400 group-hover:text-rose-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-bold text-slate-700 truncate">{p.name}</div>
                        {(p.buildingLabel || p.floorLabel) && (
                          <div className="text-[10px] text-slate-400 truncate">
                            {[p.buildingLabel, p.floorLabel].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-rose-500 shrink-0" />
                    </Link>
                  ))}
                </div>
                <Link
                  href={`/${schoolId}/floor-plans`}
                  className="inline-flex items-center gap-1.5 mt-2 text-[11px] font-bold px-3 py-1.5 rounded-md border border-slate-200 hover:border-rose-300 hover:text-rose-700 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Upload another floor plan
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// PerScreenOverridesList was removed (2026-04-27). Operator: "you have
// multiple areas now to do the same setting" — the inline overrides
// list duplicated the floor-plan drawer's per-screen config. Settings
// now ONLY surfaces the floor-plan picker; per-screen upload happens in
// the drawer that opens when you click a screen pin on the plan.
