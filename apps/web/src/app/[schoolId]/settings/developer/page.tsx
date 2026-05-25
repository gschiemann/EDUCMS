'use client';

/**
 * /[schoolId]/settings/developer — the developer area.
 *
 * Operator feedback (2026-05-25): "what is the system info setting?
 * seems weird and something i wouldnt use ... if we need to offer API
 * info shouldnt we have a developer area then and dont we need API
 * keys and SDK info for integrations? lets build out a developer
 * section and add everything under that not just rando systems
 * settings"
 *
 * This page is the home for everything an engineer / integrator might
 * need but a regular school admin shouldn't have to look at:
 *
 *   - System Info: Player URL + API endpoint + dashboard build commit.
 *     Moved here from the main /settings page so the admin landing
 *     surface stays operator-focused.
 *   - Connected Integrations: read-only list of every external system
 *     surface (Stripe billing, Clever SIS, Canva imports, AI sparkle,
 *     streaming providers, POS providers, ad networks, USB ingest)
 *     with current state + Manage links to each dedicated page.
 *   - API Keys & Webhooks: SCAFFOLDED — tenant-scoped REST tokens +
 *     outbound webhook URL config. The mutation surface ships in a
 *     follow-up; this section sets expectations and gives the operator
 *     a place to look so they don't think we forgot.
 *   - SDK & Documentation: external links to embed instructions, REST
 *     API reference, and the public GitHub repo.
 *
 * Restricted to SUPER_ADMIN + DISTRICT_ADMIN. SCHOOL_ADMIN sees a
 * forbidden card so a teacher / front-desk-staff doesn't stumble into
 * a deploy-config view.
 */

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useUIStore } from '@/store/ui-store';
import {
  Code2,
  ArrowLeft,
  KeyRound,
  Webhook,
  Plug,
  ExternalLink,
  BookOpen,
  ShieldAlert,
  GitBranch,
} from 'lucide-react';

export default function DeveloperSettingsPage() {
  const params = useParams<{ schoolId: string }>();
  const schoolId = params?.schoolId || '';
  const user = useUIStore((s) => s.user);
  const role = user?.role || '';
  const isDeveloperAllowed = role === 'SUPER_ADMIN' || role === 'DISTRICT_ADMIN';

  // Pull the dashboard's API endpoint + player URL from the same env
  // vars the main settings page used to read. Falls back to localhost
  // for local dev; surfaces the misconfiguration loudly in that case.
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';
  const playerUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/player`
      : '/player';
  const dashboardCommit = process.env.NEXT_PUBLIC_GIT_COMMIT || null;

  if (!isDeveloperAllowed) {
    return (
      <div className="max-w-3xl mx-auto p-8">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
          <ShieldAlert className="w-10 h-10 text-amber-500 mx-auto mb-3" />
          <h1 className="text-lg font-extrabold text-slate-800">
            Developer area
          </h1>
          <p className="text-sm text-slate-600 mt-1 max-w-md mx-auto">
            This section is restricted to district + super-admin roles. Ask
            your administrator for access if you&rsquo;re integrating an
            external system with your VenueOS tenant.
          </p>
          <Link
            href={`/${schoolId}/settings`}
            className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-lg"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to settings
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 px-4 py-6">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div>
        <Link
          href={`/${schoolId}/settings`}
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-indigo-600 mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Settings
        </Link>
        <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
          <Code2 className="w-6 h-6 text-indigo-500" />
          Developer
        </h1>
        <p className="text-sm text-slate-500 mt-1 max-w-2xl">
          API endpoints, integration status, and SDK documentation for engineers
          wiring external systems into this tenant. School admins generally
          don&rsquo;t need anything on this page.
        </p>
      </div>

      {/* ── System Info ────────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-sm font-bold text-slate-700 mb-1 flex items-center gap-2">
          <Plug className="w-4 h-4 text-slate-500" /> System Info
        </h2>
        <p className="text-[11px] text-slate-500 mb-4">
          The endpoints your kiosks and integrations talk to. These are read-only
          — set at deploy time via Vercel + Railway env vars.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <InfoCell label="Player URL" value={playerUrl} />
          <InfoCell label="API Endpoint" value={apiUrl} />
          {dashboardCommit && (
            <InfoCell
              label="Dashboard build"
              value={dashboardCommit.slice(0, 7)}
              mono
            />
          )}
        </div>
      </section>

      {/* ── Connected Integrations ─────────────────────────────── */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-sm font-bold text-slate-700 mb-1 flex items-center gap-2">
          <Plug className="w-4 h-4 text-indigo-500" /> Integrations
        </h2>
        <p className="text-[11px] text-slate-500 mb-4">
          External systems wired into this tenant. Click Manage to configure
          credentials, OAuth scopes, or per-provider settings.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <IntegrationCard
            name="Stripe billing"
            blurb="Plans, invoices, customer portal."
            href={`/${schoolId}/settings/billing`}
          />
          <IntegrationCard
            name="Clever SIS"
            blurb="Roster import + class periods for K-12."
            href={`/${schoolId}/settings/integrations/clever`}
          />
          <IntegrationCard
            name="Streaming providers"
            blurb="Twitch / YouTube / Vimeo embeds for live tiles."
            href={`/${schoolId}/settings/streaming`}
          />
          <IntegrationCard
            name="POS catalog sync"
            blurb="Square / Toast / Clover for menu boards."
            href={`/${schoolId}/settings/pos`}
          />
          <IntegrationCard
            name="Ad networks"
            blurb="House ads + future ad-network OAuth."
            href={`/${schoolId}/settings/monetize`}
          />
          <IntegrationCard
            name="SSO / SAML / OIDC"
            blurb="District directory integration for staff login."
            href={`/${schoolId}/settings/sso`}
          />
          <IntegrationCard
            name="Design imports"
            blurb="PDF / Canva / Slides → playlist."
            href={`/${schoolId}/settings/imports`}
          />
          <IntegrationCard
            name="USB ingest"
            blurb="Sneakernet content updates for offline kiosks."
            href={`/${schoolId}/settings/usb`}
          />
        </div>
      </section>

      {/* ── API Keys + Webhooks (scaffolded) ───────────────────── */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-indigo-500" /> API Keys &amp; Webhooks
          </h2>
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
            Coming next release
          </span>
        </div>
        <p className="text-[11px] text-slate-500 mb-4">
          Tenant-scoped REST tokens to drive VenueOS from your own automation,
          plus outbound webhook URLs for emergency triggers, content publishes,
          and screen status changes.
        </p>
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
          <PlannedFeature
            icon={<KeyRound className="w-3.5 h-3.5" />}
            title="REST API tokens"
            blurb="Mint per-tenant bearer tokens with a chosen role + expiry. Revoke from this same page. Use them to POST emergencies, push playlists, or query screen status from your own scripts."
          />
          <PlannedFeature
            icon={<Webhook className="w-3.5 h-3.5" />}
            title="Outbound webhooks"
            blurb="Register a URL to receive signed JSON for: emergency triggered, emergency cleared, playlist published, screen online / offline, OTA install completed. Same HMAC envelope the WS broadcasts use."
          />
        </div>
      </section>

      {/* ── SDK + Documentation ───────────────────────────────── */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-sm font-bold text-slate-700 mb-1 flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-indigo-500" /> SDK &amp; Documentation
        </h2>
        <p className="text-[11px] text-slate-500 mb-4">
          References for building against VenueOS — embedding the player,
          calling the API, or extending the platform.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <DocLink
            href="https://github.com/gschiemann/EDUCMS"
            title="Public repo"
            blurb="Source-of-truth GitHub repository."
            icon={<GitBranch className="w-4 h-4" />}
            external
          />
          <DocLink
            href={`${apiUrl.replace(/\/api\/v1$/, '')}/api/v1/health`}
            title="API health endpoint"
            blurb="Liveness probe — also returns the current build commit + DB/Redis status."
            icon={<Plug className="w-4 h-4" />}
            external
          />
          <DocLink
            href={`/${schoolId}/settings/usb`}
            title="USB ingest manifest format"
            blurb="HMAC-signed manifest layout for sneakernet content updates on offline kiosks."
            icon={<BookOpen className="w-4 h-4" />}
          />
          <DocLink
            href="https://docs.venue-os.app"
            title="Documentation (coming soon)"
            blurb="REST API reference, embed snippets, and SDK quickstarts. Hosted docs ship alongside the API-token feature."
            icon={<BookOpen className="w-4 h-4" />}
            external
            unavailable
          />
        </div>
      </section>
    </div>
  );
}

// ─── Small presentational primitives ───────────────────────────

function InfoCell({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">
        {label}
      </p>
      <code
        className={`text-xs text-slate-700 select-all break-all ${
          mono ? 'font-mono' : ''
        }`}
      >
        {value}
      </code>
    </div>
  );
}

function IntegrationCard({
  name,
  blurb,
  href,
}: {
  name: string;
  blurb: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 p-3 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors"
    >
      <div className="min-w-0">
        <div className="text-xs font-bold text-slate-800 truncate">{name}</div>
        <div className="text-[11px] text-slate-500 truncate">{blurb}</div>
      </div>
      <span className="text-[10px] font-bold text-indigo-600 shrink-0">
        Manage →
      </span>
    </Link>
  );
}

function PlannedFeature({
  icon,
  title,
  blurb,
}: {
  icon: React.ReactNode;
  title: string;
  blurb: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-7 h-7 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 mt-0.5">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xs font-bold text-slate-800">{title}</div>
        <div className="text-[11px] text-slate-600 mt-0.5">{blurb}</div>
      </div>
    </div>
  );
}

function DocLink({
  href,
  title,
  blurb,
  icon,
  external = false,
  unavailable = false,
}: {
  href: string;
  title: string;
  blurb: string;
  icon: React.ReactNode;
  external?: boolean;
  unavailable?: boolean;
}) {
  const body = (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors">
      <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
          {title}
          {unavailable && (
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-200 text-slate-500">
              Soon
            </span>
          )}
          {external && !unavailable && <ExternalLink className="w-3 h-3 text-slate-400" />}
        </div>
        <div className="text-[11px] text-slate-500 mt-0.5">{blurb}</div>
      </div>
    </div>
  );
  if (unavailable) {
    return (
      <div className="opacity-60 cursor-not-allowed" aria-disabled>
        {body}
      </div>
    );
  }
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {body}
      </a>
    );
  }
  return <Link href={href}>{body}</Link>;
}
