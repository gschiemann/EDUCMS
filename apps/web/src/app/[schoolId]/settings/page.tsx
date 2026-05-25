"use client";

import { Settings as SettingsIcon, Key, UserPlus, Trash2, Loader2, Shield, MonitorPlay, AlertOctagon, Usb, MapPin, Plus, Building2, ShieldCheck, ShieldOff, ChevronDown, Clock, RefreshCw, FileClock, Code2 } from 'lucide-react';
import { usePathname, useParams } from 'next/navigation';
import Link from 'next/link';
import { RoleGate } from '@/components/RoleGate';
import {
  useUsers, useInviteUser, useCreateUserDirect, useDeleteUser, useUpdateUserRole, useTenant,
  useUpdateTenantPanicSettings, usePlaylists,
  useLocationBasedEmergencyConfig, useToggleLocationBasedEmergency, useFloorPlans,
  useAutoUpdatePlayerConfig, useToggleAutoUpdatePlayer, useLatestPlayerVersion,
  useOtaWindowConfig, useUpdateOtaWindow,
  useCanaryRollout, useUpdateCanaryRollout,
} from '@/hooks/use-api';
import { useState, useRef, useEffect } from 'react';
import { UsbIngestCard } from '@/components/settings/UsbIngestCard';
import { LicenseCard } from '@/components/settings/LicenseCard';
import { PanicContentEditor } from '@/components/settings/PanicContentEditor';
import { EmbeddedFloorPlanView } from '@/components/floor-plans/EmbeddedFloorPlanView';
import { BrandingSettingsCard } from '@/components/settings/BrandingSettingsCard';
import { AiKeyCard } from '@/components/settings/AiKeyCard';
import { DistrictSchoolsCard } from '@/components/settings/DistrictSchoolsCard';
import { VerticalSwitcherCard } from '@/components/settings/VerticalSwitcherCard';
import { appConfirm } from '@/components/ui/app-dialog';
import { useTenantCopy } from '@/hooks/use-tenant-copy';

const ROLES = ['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN', 'CONTRIBUTOR', 'RESTRICTED_VIEWER'] as const;

// 2026-05-03 — ROLE_LABELS removed. Use tenantCopy.roleLabel(role)
// inside the component instead — labels are vertical-aware now.
// K12 sees "District Admin" / "School Admin"; gym tenant sees
// "Region Admin" / "Gym Admin"; QSR sees "Brand Admin" / "Restaurant
// Admin"; etc. Source of truth: VERTICAL_ROLE_LABELS in
// packages/api-types/src/verticals.ts.

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  DISTRICT_ADMIN: 'bg-violet-50 text-violet-700 border-violet-200',
  SCHOOL_ADMIN: 'bg-sky-50 text-sky-700 border-sky-200',
  CONTRIBUTOR: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  RESTRICTED_VIEWER: 'bg-slate-50 text-slate-600 border-slate-200',
};

export default function SettingsPage() {
  const pathname = usePathname();
  const tenantCopy = useTenantCopy();
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
  // 2026-05-11 — capture names at invite time so the new user's
  // dashboard greets them by name from their first login instead
  // of guessing from email prefix. Optional, both fields.
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
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
        await createDirect.mutateAsync({
          email: newEmail.trim(),
          role: newRole,
          password: newPassword,
          firstName: newFirstName.trim() || undefined,
          lastName: newLastName.trim() || undefined,
        });
        setInviteStatus({ kind: 'ok', message: `Added ${newEmail.trim()}. They can log in with the password you set.` });
        setNewEmail(''); setNewPassword(''); setNewFirstName(''); setNewLastName('');
        setShowAddUser(false);
        return;
      }
      const res: any = await inviteUser.mutateAsync({
        email: newEmail.trim(),
        role: newRole,
        firstName: newFirstName.trim() || undefined,
        lastName: newLastName.trim() || undefined,
      });
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
      setNewEmail(''); setNewFirstName(''); setNewLastName('');
    } catch (err: any) {
      setInviteStatus({ kind: 'err', message: err?.message || 'Could not send invitation.' });
    }
  };

  // 2026-05-25 — playerUrl previously rendered in a System Info card
  // here. That card moved to /settings/developer (operator: "what is
  // the system info setting? seems weird and something i wouldnt
  // use"). Variable removed; the developer page derives the same
  // value from window.location.origin locally.

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-800 flex items-center gap-2">
          <SettingsIcon className="w-7 h-7" style={{ color: 'var(--brand-primary, #6366f1)' }} />
          Settings
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">Manage team members, roles, and system info.</p>
      </div>

      {/* 2026-05-03 — VenueOS vertical switcher (DISTRICT_ADMIN +
          SUPER_ADMIN only). Lets a tenant admin switch industry
          post-signup if they picked the wrong vertical or pivot
          business focus. Renders nothing for non-admin roles.

          (Per-user profile editing — first/last name — moved out of
          this page on 2026-05-11. It now lives in the avatar
          dropdown at the top-right of every page. Settings is for
          TENANT-level admin config; cosmetic per-user fields
          belong with the user, not buried under tenant settings.) */}
      <RoleGate allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN']}>
        <VerticalSwitcherCard />
      </RoleGate>

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
        {/* 2026-05-25 — System Info moved to /settings/developer per
            operator feedback ("what is the system info setting? seems
            weird and something i wouldnt use ... lets build out a
            developer section"). Engineers / integrators land on the
            developer page; the main settings surface stays operator-
            focused. The link card below replaces it. */}

        {/* Panic Button Content — direct upload, can't be accidentally deleted.
            Aligned with the Standard Response Protocol (SRP) used by most US K-12
            districts: Hold, Secure, Lockdown, Evacuate, Shelter (= Weather here).
            Plus a separate Medical bucket for nurse / EMS events.

            Sprint 8b — the "Location-based emergency" toggle now lives in this
            same card's header. Operator wanted ONE menu, not two. Flipping ON
            unlocks per-screen emergency overrides via floor plans, and the
            inline section below the panic editors lets the admin jump straight
            to the floor plans editor without leaving Settings.

            2026-05-03 — multi-vertical: K12 keeps it always-on (life-safety
            critical for schools). Other verticals get an opt-in toggle —
            most gyms / restaurants / retailers don't run lockdown drills,
            so this section is hidden by default and enabled per-tenant. */}
        <RoleGate allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']}>
          <PanicContentGate />
        </RoleGate>

        {/* Auto-branding — paste URL → CMS re-skins (Sprint 9) */}
        <RoleGate allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']}>
          <BrandingSettingsCard />
        </RoleGate>

        {/* BYOK AI integration — operator pastes their own provider
            key, generations route through their account, we stop
            paying. Falls back to platform free-trial key if unset
            and one is configured on the deployment. */}
        <RoleGate allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']}>
          <AiKeyCard />
        </RoleGate>

        {/* District-level: list + create child schools (Sprint 12 — district hierarchy UI) */}
        <RoleGate allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN']}>
          <DistrictSchoolsCard />
        </RoleGate>

        {/* License & Billing (Sprint 7E) — current tier, seats used, expiry */}
        <LicenseCard />

        {/* Sprint 8c (2026-05-03) — link cards to the new full-page
            settings: Streaming providers + Billing tier picker. The
            existing LicenseCard above stays as a compact summary;
            these are the deeper drill-in screens. */}
        <RoleGate allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']}>
          <Link
            href={`${pathname}/streaming`}
            className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center justify-between mt-4 hover:border-violet-300 hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-violet-50 flex items-center justify-center">
                <MonitorPlay className="w-4 h-4 text-violet-600" />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-800">Streaming providers</div>
                <div className="text-[11px] text-slate-500">Connect Atmosphere, public broadcasters, YouTube, Twitch, custom HLS — pick channels for the streaming widget.</div>
              </div>
            </div>
            <span className="text-xs text-violet-600 font-bold">Manage →</span>
          </Link>

          {/* 2026-05-03 — operator removed the standalone "Plans &
              billing" tile here. The LicenseCard above already carries
              the upgrade CTA + "View all plans →" drill-in to
              `${pathname}/billing`. One billing surface, not two. */}

          {/* Sprint 8d (2026-05-03) — POS catalog sync + ad-network
              monetization. POS hidden for K12 (no menu boards in
              schools); monetize allowed for everyone but the page
              itself filters networks per K12-forbidden flag so K12
              tenants only see house-only. */}
          <Link
            href={`${pathname}/pos`}
            className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center justify-between mt-3 hover:border-amber-300 hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center">
                <MonitorPlay className="w-4 h-4 text-amber-600" />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-800">POS catalog sync</div>
                <div className="text-[11px] text-slate-500">Connect Square / Toast / Clover / Shopify / Stripe / MINDBODY — menu boards auto-update from your live catalog.</div>
              </div>
            </div>
            <span className="text-xs text-amber-600 font-bold">Connect →</span>
          </Link>

          <Link
            href={`${pathname}/monetize`}
            className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center justify-between mt-3 hover:border-emerald-300 hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center">
                <Building2 className="w-4 h-4 text-emerald-600" />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-800">Monetize your screens</div>
                <div className="text-[11px] text-slate-500">Programmatic DOOH — Hivestack, Vistar, Place Exchange. Earn per impression, full content controls.</div>
              </div>
            </div>
            <span className="text-xs text-emerald-600 font-bold">Earn →</span>
          </Link>

          {/* 2026-05-03 — Design imports (Canva / Slides / PowerPoint /
              Figma / Adobe Express). Stage 1 ships PDF + image upload
              today; Canva Connect OAuth lights up here once the
              partnership lands. See docs/CANVA_INTEGRATION.md. */}
          <Link
            href={`${pathname}/imports`}
            className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center justify-between mt-3 hover:border-emerald-300 hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center">
                <MonitorPlay className="w-4 h-4 text-emerald-600" />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-800">Design imports</div>
                <div className="text-[11px] text-slate-500">Drop a PDF / PPTX / image from Canva, Google Slides, PowerPoint, Figma, or Adobe Express. We turn it into a screen-ready playlist.</div>
              </div>
            </div>
            <span className="text-xs text-emerald-600 font-bold">Import →</span>
          </Link>

          {/* 2026-05-03 — One-click integration smoke-test harness.
              Loads sample data into streaming / POS / ads connections
              so the operator can demo every feature without registering
              for vendor sandbox accounts. */}
          <Link
            href={`${pathname}/test-integrations`}
            className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center justify-between mt-3 hover:border-pink-300 hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-pink-50 flex items-center justify-center">
                <MonitorPlay className="w-4 h-4 text-pink-600" />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-800">Test integrations</div>
                <div className="text-[11px] text-slate-500">One-click sample data for streaming / POS / ads — demo every feature without vendor sandbox accounts.</div>
              </div>
            </div>
            <span className="text-xs text-pink-600 font-bold">Try →</span>
          </Link>

          {/* 2026-05-19 — operator moved Audit Log out of the standalone
              sidebar tab into Settings. Route (/[schoolId]/audit) is
              unchanged; this is just the new entry point. */}
          <Link
            href={`${pathname.replace(/\/settings$/, '')}/audit`}
            className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center justify-between mt-3 hover:border-slate-300 hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
                <FileClock className="w-4 h-4 text-slate-600" />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-800">Audit log</div>
                <div className="text-[11px] text-slate-500">Immutable activity history — every emergency trigger, login, and admin action, with who and when.</div>
              </div>
            </div>
            <span className="text-xs text-slate-600 font-bold">View →</span>
          </Link>

          {/* 2026-05-25 — Developer area. Replaces the old "System Info"
              card that used to live on this page. Engineers / integrators
              land here for API endpoints, connected integrations, the
              upcoming REST tokens + webhooks surface, and SDK docs.
              Operator-facing settings stay above this card; everything
              technical lives under one umbrella. */}
          <Link
            href={`${pathname}/developer`}
            className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center justify-between mt-3 hover:border-indigo-300 hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center">
                <Code2 className="w-4 h-4 text-indigo-600" />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-800">Developer</div>
                <div className="text-[11px] text-slate-500">API endpoints, integrations, REST tokens + webhooks (coming next release), and SDK documentation.</div>
              </div>
            </div>
            <span className="text-xs text-indigo-600 font-bold">Open →</span>
          </Link>
        </RoleGate>

        <RoleGate allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']}>
          {/* Player APK — single shared card combining the manual download
              button + the auto-update toggle. Two separate cards used to
              live here; operator (2026-05-03): "the settings page is
              cluttered" — collapsed into one with a download row on top
              and an auto-update row underneath. */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mt-4">
            <div className="px-6 py-4 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                <MonitorPlay className="w-4 h-4 text-emerald-600" /> Player APK
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Download the Android kiosk build and decide whether paired screens auto-update.
              </p>
            </div>

            {/* Row 1 — manual APK download. Sideload once on Nova Taurus,
                BrightSign, or any Android 7+ kiosk. */}
            <div className="px-6 py-4 flex items-center justify-between gap-4 border-b border-slate-100">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                  <MonitorPlay className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-800">Download Player APK</div>
                  <div className="text-[11px] text-slate-500">Android kiosk build — Nova Taurus, generic Android 7+. Sideload once; updates are manual unless you opt in below.</div>
                </div>
              </div>
              <a
                href={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1'}/player/apk/latest`}
                target="_blank" rel="noopener"
                className="shrink-0 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg"
              >
                Download APK
              </a>
            </div>

            {/* Row 2 — auto-update toggle. Operator (2026-04-27): "we
                shouldnt be auto updating screens unless we check a box
                or something on that... i would hate to break a perfectly
                good working screen with an update." Default OFF. */}
            <AutoUpdatePlayerToggle />

            {/* Row 3 — OTA maintenance window. Sprint 11 Phase A.
                Operator (2026-05-12): "we cant have screens flashing
                all the time" + "find the bigger picture solution for
                uninterrupted service across all screens, all customer,
                all playlists". When set, dashboard "Push update" still
                works but only APPLIES the install during the window.
                Outside, the kiosk downloads quietly and waits. */}
            <OtaMaintenanceWindowCard />
            <div className="border-t border-slate-100" />
            <CanaryRolloutCard />
          </div>

          {/* USB Sneakernet Ingest (Sprint 7B) — collapsed by default.
              The everyday USB export is now an inline "Download" button
              on each playlist header (single-click flow, no separate
              settings page). What stays here is the security/audit
              surface: rotate the HMAC signing key, inspect the ingest
              event log, disable the feature for the tenant. Power-user
              only — hidden behind a <details> so it doesn't clutter the
              page. */}
          <details className="group bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mt-4">
            <summary className="px-6 py-4 cursor-pointer list-none flex items-center justify-between gap-3 hover:bg-slate-50/60">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-violet-50 flex items-center justify-center shrink-0">
                  <Usb className="w-4 h-4 text-violet-500" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-800">Advanced: USB sneakernet ingest</div>
                  <div className="text-[11px] text-slate-500">Manage USB security keys + offline content delivery — separate from the per-playlist download button.</div>
                </div>
              </div>
              <ChevronDown className="w-4 h-4 text-slate-400 shrink-0 transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t border-slate-100">
              <UsbIngestCard />
            </div>
          </details>
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
                {/* 2026-05-11 — name fields captured at invite time
                    so the new admin's dashboard greets them by name
                    on first login. Both optional — falls back to
                    email-prefix display when omitted. */}
                <input value={newFirstName} onChange={(e) => setNewFirstName(e.target.value)}
                  placeholder="First name (optional)" type="text" maxLength={80}
                  className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500" />
                <input value={newLastName} onChange={(e) => setNewLastName(e.target.value)}
                  placeholder="Last name (optional)" type="text" maxLength={80}
                  className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500" />
                <input ref={inviteEmailRef} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder={tenantCopy.vertical === 'K12' ? 'teacher@school.edu' : 'colleague@yourcompany.com'} type="email"
                  className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500" />
                <select value={newRole} onChange={(e) => setNewRole(e.target.value)}
                  className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500">
                  {ROLES.filter(r => r !== 'SUPER_ADMIN').map(r => <option key={r} value={r}>{tenantCopy.roleLabel(r)}</option>)}
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
              {users.map((user: any) => {
                // 2026-05-11 — prefer "First Last" when set; show
                // email as secondary line so the team list reads
                // like a roster, not a mailing list.
                const fn = (user.firstName || '').trim();
                const ln = (user.lastName || '').trim();
                const full = (fn || ln) ? `${fn} ${ln}`.trim() : null;
                const avatar = full
                  ? `${fn ? fn[0] : ''}${ln ? ln[0] : ''}`.toUpperCase() || (user.email?.substring(0, 2).toUpperCase() || '??')
                  : (user.email?.substring(0, 2).toUpperCase() || '??');
                return (
                <div key={user.id} className="flex items-center justify-between px-6 py-3 hover:bg-slate-50/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[10px] font-bold" style={{ background: 'linear-gradient(135deg, var(--brand-primary, #6366f1), color-mix(in srgb, var(--brand-primary, #6366f1) 60%, #8b5cf6))' }}>
                      {avatar}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-800">{full || user.email}</p>
                      <p className="text-[10px] text-slate-400">{full ? user.email : (user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Member')}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <select
                      value={user.role}
                      onChange={(e) => updateRole.mutate({ id: user.id, role: e.target.value })}
                      className={`px-2.5 py-1 text-[10px] font-bold border rounded-lg cursor-pointer ${ROLE_COLORS[user.role] || 'bg-slate-50 text-slate-600'}`}
                    >
                      {/* SUPER_ADMIN is never an assignable option — a
                          district/school admin must not be able to promote
                          a user to super-admin from this dropdown (the
                          invite form already filters it). It only appears
                          when the row IS already a super-admin, so the
                          select still renders that user's role correctly. */}
                      {ROLES.filter(r => r !== 'SUPER_ADMIN' || user.role === 'SUPER_ADMIN').map(r => <option key={r} value={r}>{tenantCopy.roleLabel(r)}</option>)}
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
                );
              })}
            </div>
          )}
        </div>
      </RoleGate>
    </div>
  );
}

/**
 * PanicContentGate — vertical-aware opt-in shell around
 * PanicContentSection.
 *
 * K12 tenants always see the panic content editor (lockdown drills are
 * life-safety-critical). Other verticals (gym, restaurant, retail, bar,
 * corporate, ...) get an opt-in toggle. Most don't run lockdown drills,
 * so the editor is hidden by default to keep the settings page tidy.
 *
 * Persistence: stored client-side in localStorage under
 * `emergencyEnabled:${tenantId}` for now — switching to a real
 * `Tenant.emergencyEnabled` column on the API is a follow-up.
 *
 * TODO(api): persist the opt-in flag server-side via
 * `Tenant.emergencyEnabled` so it follows the user across devices and
 * survives localStorage clears. For now this is a UX-only gate.
 */
function PanicContentGate() {
  const tenantCopy = useTenantCopy();
  const { data: tenant } = useTenant();
  const pathnameForGate = usePathname() ?? '';
  const tenantId = (tenant as any)?.id ?? '';
  const isK12 = tenantCopy.vertical === 'K12';

  // Default: K12 = on, all others = off. Once mounted, hydrate from
  // localStorage if a saved preference exists for this tenant.
  const [enabled, setEnabled] = useState<boolean>(isK12);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!tenantId || typeof window === 'undefined') {
      setHydrated(true);
      return;
    }
    try {
      const raw = window.localStorage.getItem(`emergencyEnabled:${tenantId}`);
      if (raw === 'true') setEnabled(true);
      else if (raw === 'false') setEnabled(false);
      else setEnabled(isK12);
    } catch {
      // Private mode / disabled storage — fall back to vertical default.
      setEnabled(isK12);
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, isK12]);

  // handleToggle was removed 2026-05-25 — the toggle now lives on
  // /settings/emergency where it's behind a click-through + confirm
  // dialog. setEnabled is still called above (read-only hydrate from
  // localStorage) so the status pill reflects current state.

  // 2026-05-25 (full emergency UX overhaul) — the entire emergency
  // configuration (master on/off, standard-vs-location mode, the six
  // SRP editor cards, floor-plan upload, per-screen overrides) now
  // lives on the dedicated /settings/emergency page. The settings
  // surface ONLY shows a compact status row + a Configure button.
  //
  // Operator (2026-05-25): "turning it on and off should be inside
  // the initial config page not a button that can be easily hit by
  // accident." Toggling lives behind a click-through + confirm
  // dialog on the dedicated page.
  //
  // Status pill reads:
  //   - K12: always shows "On" (always-on contract)
  //   - Non-K12: localStorage-backed "On" or "Off"
  // The handleToggle / button code paths are intentionally GONE from
  // this card — the only action here is "Configure" which navigates.

  // 2026-05-25 operator: "change the configure button to a real button
  // like all the other settings buttons in the area." Card no longer
  // wraps in a Link — the rose-600 pill on the right is the only
  // clickable affordance, matching the Switch / Upload logo / Auto-
  // brand pattern used elsewhere on /settings.
  if (!hydrated && !isK12) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
            <AlertOctagon className="w-4 h-4 text-slate-500" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-800">Emergency alerts</div>
            <p className="text-[11px] text-slate-500 mt-0.5">Loading…</p>
          </div>
        </div>
        <Link
          href={`${pathnameForGate}/emergency`}
          className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 transition-colors"
        >
          Configure
        </Link>
      </div>
    );
  }

  const showOn = isK12 || enabled;
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${showOn ? 'bg-rose-50' : 'bg-slate-100'}`}>
          <AlertOctagon className={`w-4 h-4 ${showOn ? 'text-rose-600' : 'text-slate-500'}`} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-800 flex items-center gap-2 flex-wrap">
            Emergency alerts
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                showOn
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-100 text-slate-500'
              }`}
            >
              {showOn ? <ShieldCheck className="w-3 h-3" /> : <ShieldOff className="w-3 h-3" />}
              {showOn ? 'On' : 'Off'}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Trigger content + on/off + floor-plan setup live on the dedicated page.
          </p>
        </div>
      </div>
      <Link
        href={`${pathnameForGate}/emergency`}
        className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 transition-colors"
      >
        Configure
      </Link>
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
export function PanicContentSection() {
  const params = useParams<{ schoolId: string }>();
  const schoolId = params?.schoolId ?? '';
  const { data: cfg, isLoading: cfgLoading, isError: cfgError } = useLocationBasedEmergencyConfig();
  const { data: floorPlans, isLoading: plansLoading } = useFloorPlans();
  const toggle = useToggleLocationBasedEmergency();
  const enabled = !!cfg?.enabled;
  const planCount = floorPlans?.length ?? 0;
  const modeKnown = !cfgLoading && !cfgError;

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
          disabled={toggle.isPending || !modeKnown}
          aria-pressed={enabled}
          className={`shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] font-bold uppercase tracking-wide transition-colors ${
            enabled
              ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
              : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-400'
          } disabled:opacity-60 disabled:cursor-not-allowed`}
          title={enabled ? 'Switch back to standard emergency' : 'Enable per-screen location-based emergency'}
        >
          {toggle.isPending || cfgLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : enabled ? (
            <ShieldCheck className="w-4 h-4" />
          ) : (
            <ShieldOff className="w-4 h-4" />
          )}
          <span>{cfgLoading ? 'Loading mode' : cfgError ? 'Mode unavailable' : `Location mode ${enabled ? 'On' : 'Off'}`}</span>
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
        {cfgLoading ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-6 flex items-center gap-3 text-sm font-semibold text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading emergency settings...
          </div>
        ) : cfgError ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50/70 p-6 text-sm font-semibold text-rose-700">
            Could not load emergency settings. Refresh this page before changing emergency mode.
          </div>
        ) : !enabled ? (
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
          // LOCATION MODE — the floor map IS embedded right here. Click
          // a screen pin to open the right-side drawer with the upload-
          // only emergency content config. Operator: "select the screen
          // on the map thats showing in the main setting screen once you
          // enable the location mode, then the right tool drawer pops out."
          <EmbeddedLocationMode
            schoolId={schoolId}
            planCount={planCount}
            floorPlans={floorPlans || []}
            isLoading={plansLoading}
          />
        )}
      </div>
    </div>
  );
}

// PerScreenOverridesList was removed (2026-04-27). The duplicate
// scrolling list was replaced by an inline-embedded floor map below;
// operator clicks a pin and the right-side drawer pops out with the
// upload-only emergency content config.

/**
 * EmbeddedLocationMode — what the Panic Content card body shows when
 * the location-based toggle is ON.
 *
 * - Zero plans  → upload-prompt CTA inline
 * - One plan    → embed the editor straight into the card
 * - Many plans  → tab strip across the top (one per plan), embed the
 *                 active plan's editor underneath. State is local; no
 *                 URL changes — the operator stays on /settings.
 *
 * The drawer (right-side slide-out for screen-pin clicks) is rendered
 * by EmbeddedFloorPlanView itself, so it works the same here as on the
 * standalone /floor-plans/[id] page.
 */
function EmbeddedLocationMode({
  schoolId,
  planCount,
  floorPlans,
  isLoading = false,
}: {
  schoolId: string;
  planCount: number;
  floorPlans: any[];
  isLoading?: boolean;
}) {
  const [activePlanId, setActivePlanId] = useState<string | null>(
    floorPlans[0]?.id ?? null,
  );

  // Keep the active selection valid if the floor-plan list updates
  // (e.g. operator just uploaded a new plan in another tab).
  useEffect(() => {
    if (planCount === 0) {
      setActivePlanId(null);
      return;
    }
    if (!activePlanId || !floorPlans.some((p) => p.id === activePlanId)) {
      setActivePlanId(floorPlans[0].id);
    }
  }, [floorPlans, planCount, activePlanId]);

  if (isLoading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-6 flex items-center gap-3 text-sm font-semibold text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading floor plans...
      </div>
    );
  }

  if (planCount === 0) {
    return (
      <div>
        <div className="flex items-start gap-2 mb-4">
          <MapPin className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-[12px] font-bold text-slate-700">Location-based emergency</h3>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
              Upload a floor plan to start. Then drag your unplaced screens onto the map and
              click any pin to upload landscape + portrait emergency content.
            </p>
          </div>
        </div>
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
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <MapPin className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="text-[12px] font-bold text-slate-700">Location-based emergency</h3>
          <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
            Click any screen pin → right-side drawer opens with upload zones for each
            emergency type (landscape + portrait, independent). Empty slots fall back to
            the tenant default.
          </p>
        </div>
        <Link
          href={`/${schoolId}/floor-plans`}
          className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-md border border-slate-200 hover:border-rose-300 hover:text-rose-700 transition-colors"
          title="Manage floor plans (upload new, rename, delete)"
        >
          <Plus className="w-3.5 h-3.5" /> Add plan
        </Link>
      </div>

      {/* Plan tabs — only when there's more than one floor plan */}
      {planCount > 1 && (
        <div className="flex flex-wrap gap-1.5 border-b border-slate-100 pb-2">
          {floorPlans.map((p: any) => {
            const isActive = p.id === activePlanId;
            const sub = [p.buildingLabel, p.floorLabel].filter(Boolean).join(' · ');
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setActivePlanId(p.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-md transition-colors ${
                  isActive
                    ? 'bg-rose-50 text-rose-700 border border-rose-200'
                    : 'bg-white text-slate-600 border border-slate-200 hover:border-rose-300 hover:text-rose-700'
                }`}
              >
                <Building2 className="w-3.5 h-3.5" />
                <span>{p.name}</span>
                {sub && <span className="text-[10px] font-normal opacity-70">· {sub}</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* The actual embedded map — same component the standalone
          /floor-plans/[id] page uses. The drawer it opens when a pin
          is clicked has the upload-only emergency config. */}
      {activePlanId && (
        <EmbeddedFloorPlanView
          key={activePlanId}
          planId={activePlanId}
          schoolId={schoolId}
          mode="embedded"
        />
      )}
    </div>
  );
}

/**
 * Auto-update Player toggle row.
 *
 * OFF (default): kiosks stay pinned at their current APK version
 * even when a newer one is published. Admins push individual screens
 * manually via the gear icon on each screen card.
 *
 * ON: kiosks auto-pull updates on their 6h check-in cadence — same
 * as pre-2026-04-27. Operator turns this on when they trust the
 * release cadence and want hands-off updates.
 */
function AutoUpdatePlayerToggle() {
  const { data: cfg } = useAutoUpdatePlayerConfig();
  const { data: latest } = useLatestPlayerVersion();
  const toggle = useToggleAutoUpdatePlayer();
  const enabled = !!cfg?.enabled;

  const handleToggle = async (next: boolean) => {
    if (next) {
      const ok = await appConfirm({
        title: 'Enable auto-update?',
        message:
          'Paired Android players will start pulling new APK builds on their own 6-hour cadence. A buggy release can break working screens until rolled back. Most schools leave this OFF and push updates per-screen manually.',
        confirmLabel: 'Turn on auto-update',
        tone: 'warn',
      });
      if (!ok) return;
    }
    toggle.mutate(next);
  };

  // 2026-05-03 — formerly an outer card; now a row inside the combined
  // "Player APK" card so the page isn't cluttered with three sibling
  // tiles. Keeps all toggle logic untouched.
  return (
    <div className="px-6 py-4 flex items-start justify-between gap-4">
      <div className="flex items-start gap-3 min-w-0">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
          enabled ? 'bg-amber-50' : 'bg-slate-100'
        }`}>
          <MonitorPlay className={`w-4 h-4 ${enabled ? 'text-amber-600' : 'text-slate-500'}`} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-800 flex items-center gap-2">
            Auto-update Player APK
            {enabled ? (
              <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">On</span>
            ) : (
              <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Off (recommended)</span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
            {enabled
              ? 'Paired kiosks pull new APK builds on their 6-hour cadence — hands-off but a buggy release can break working screens.'
              : 'Kiosks stay pinned at their current APK version. Admins push updates per-screen via the gear icon on each screen card.'}
            {latest?.versionName && (
              <span className="block mt-0.5 text-slate-400">Latest published: <span className="font-semibold">v{latest.versionName}</span></span>
            )}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => handleToggle(!enabled)}
        disabled={toggle.isPending}
        aria-pressed={enabled}
        className={`shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] font-bold uppercase tracking-wide transition-colors ${
          enabled
            ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
            : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-400'
        } disabled:opacity-60 disabled:cursor-not-allowed`}
      >
        {toggle.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : enabled ? <ShieldCheck className="w-4 h-4" /> : <ShieldOff className="w-4 h-4" />}
        <span>Auto-update {enabled ? 'On' : 'Off'}</span>
      </button>
    </div>
  );
}

// Sprint 11 Phase A — OTA maintenance window.
// Three small inputs: start (HH:MM), end (HH:MM), timezone (IANA).
// Save button writes to /tenants/me/ota-window. Clear button wipes
// all three (window unconfigured = updates apply immediately, current
// behavior).
function OtaMaintenanceWindowCard() {
  const { data: cfg, isLoading } = useOtaWindowConfig();
  const update = useUpdateOtaWindow();
  // Local edit state so the user can tweak before saving
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [timezone, setTimezone] = useState('');
  const [dirty, setDirty] = useState(false);

  // Hydrate from server config on first load + after save
  useEffect(() => {
    if (!cfg) return;
    setStart(cfg.start || '');
    setEnd(cfg.end || '');
    setTimezone(cfg.timezone || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'America/Chicago'));
    setDirty(false);
  }, [cfg]);

  const configured = !!(cfg?.start && cfg?.end && cfg?.timezone);
  const canSave = dirty && (
    (start && end && timezone) || (!start && !end && !timezone) // either all set or all cleared
  );

  const save = () => {
    update.mutate({
      start: start || null,
      end: end || null,
      timezone: timezone || null,
    });
  };
  const clear = () => {
    setStart('');
    setEnd('');
    setTimezone('');
    setDirty(true);
  };

  return (
    <div className="px-6 py-4">
      <div className="flex items-start gap-3 min-w-0 mb-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
          configured ? 'bg-emerald-50' : 'bg-slate-100'
        }`}>
          <Clock className={`w-4 h-4 ${configured ? 'text-emerald-600' : 'text-slate-500'}`} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-800 flex items-center gap-2">
            Update install window
            {configured ? (
              <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                {cfg!.start}–{cfg!.end} {cfg!.timezone}
              </span>
            ) : (
              <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">Not set — installs immediately</span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
            When set, dashboard &quot;Push update&quot; still works — but the install only APPLIES during this daily window in the configured timezone. Downloads happen anytime in the background (no disruption). Use this to keep customer-facing screens uninterrupted during business hours.
          </p>
          <p className="text-[10px] text-slate-400 mt-1">
            Wraparound supported (e.g. <span className="font-mono">22:00 → 04:00</span> means &quot;10 PM to 4 AM next day&quot;). Per-push override available on the screen Push dialog.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="text-[11px] text-slate-400">Loading…</div>
      ) : (
        <div className="flex flex-wrap items-end gap-2 pl-12">
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
            Start
            <input
              type="time"
              value={start}
              onChange={(e) => { setStart(e.target.value); setDirty(true); }}
              className="block mt-1 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono"
            />
          </label>
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
            End
            <input
              type="time"
              value={end}
              onChange={(e) => { setEnd(e.target.value); setDirty(true); }}
              className="block mt-1 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono"
            />
          </label>
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide flex-1 min-w-[180px]">
            Timezone (IANA)
            <input
              type="text"
              value={timezone}
              onChange={(e) => { setTimezone(e.target.value); setDirty(true); }}
              placeholder="America/Chicago"
              className="block mt-1 w-full px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono"
            />
          </label>
          <button
            type="button"
            onClick={save}
            disabled={!canSave || update.isPending}
            className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide rounded-lg text-white disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'var(--brand-primary, #4f46e5)' }}
          >
            {update.isPending ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Save'}
          </button>
          {configured && (
            <button
              type="button"
              onClick={clear}
              disabled={update.isPending}
              className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Sprint 11 Phase B — staged canary rollout card.
// Sets the % of fleet eligible for the latest APK + the soak window
// before auto-promote fires. Default 100 = full rollout (preserves
// existing behavior). Operators dial down for risky pushes.
function CanaryRolloutCard() {
  const { data: cfg, isLoading } = useCanaryRollout();
  const update = useUpdateCanaryRollout();
  const [percent, setPercent] = useState<number>(100);
  const [autoPromote, setAutoPromote] = useState(true);
  const [soakHours, setSoakHours] = useState<number>(24);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!cfg) return;
    setPercent(cfg.percent ?? 100);
    setAutoPromote(cfg.autoPromote ?? true);
    setSoakHours(cfg.soakHours ?? 24);
    setDirty(false);
  }, [cfg]);

  const active = (cfg?.percent ?? 100) < 100;
  const setAt = cfg?.setAt ? new Date(cfg.setAt) : null;
  const elapsedMs = setAt ? Date.now() - setAt.getTime() : 0;
  const remainingMs = setAt && cfg?.soakHours
    ? Math.max(0, cfg.soakHours * 3600_000 - elapsedMs)
    : 0;
  const remainingLabel = active && remainingMs > 0
    ? `${Math.ceil(remainingMs / 3600_000)}h soak remaining`
    : active && remainingMs === 0
      ? 'Soak elapsed — auto-promote on next tick'
      : null;

  const save = () => {
    update.mutate({ percent, autoPromote, soakHours });
  };
  const promoteNow = () => {
    update.mutate({ percent: 100 });
  };

  return (
    <div className="px-6 py-4">
      <div className="flex items-start gap-3 min-w-0 mb-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
          active ? 'bg-amber-50' : 'bg-slate-100'
        }`}>
          <RefreshCw className={`w-4 h-4 ${active ? 'text-amber-600' : 'text-slate-500'}`} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-800 flex items-center gap-2 flex-wrap">
            Staged canary rollout
            {active ? (
              <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                {cfg!.percent}% cohort
              </span>
            ) : (
              <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                100% — full rollout
              </span>
            )}
            {remainingLabel && (
              <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                {remainingLabel}
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
            Lower the percentage to stage a release. Only the hashed cohort of screens
            (deterministic from screen ID, never re-rolled) receives the new APK; the
            rest stay on their current version. After the soak window elapses without
            any install errors in the cohort, auto-promote bumps back to 100%.
          </p>
          <p className="text-[10px] text-slate-400 mt-1">
            Use 5–10% for a risky release; 25–50% for routine updates. Set to 0 to
            pause OTA entirely (e.g. during finals week).
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="text-[11px] text-slate-400">Loading…</div>
      ) : (
        <div className="flex flex-wrap items-end gap-3 pl-12">
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
            Cohort %
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={percent}
              onChange={(e) => { setPercent(Math.max(0, Math.min(100, Number(e.target.value) || 0))); setDirty(true); }}
              className="block mt-1 w-20 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono"
            />
          </label>
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
            Soak (hours)
            <input
              type="number"
              min={1}
              max={720}
              step={1}
              value={soakHours}
              onChange={(e) => { setSoakHours(Math.max(1, Math.min(720, Number(e.target.value) || 24))); setDirty(true); }}
              className="block mt-1 w-20 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono"
            />
          </label>
          <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-700 mb-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={autoPromote}
              onChange={(e) => { setAutoPromote(e.target.checked); setDirty(true); }}
              className="w-3.5 h-3.5 accent-indigo-500"
            />
            Auto-promote after soak
          </label>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || update.isPending}
            className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide rounded-lg text-white disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'var(--brand-primary, #4f46e5)' }}
          >
            {update.isPending ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Save'}
          </button>
          {active && (
            <button
              type="button"
              onClick={promoteNow}
              disabled={update.isPending}
              className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200"
              title="Skip the soak window and promote to 100% now"
            >
              Promote to 100%
            </button>
          )}
        </div>
      )}
    </div>
  );
}
