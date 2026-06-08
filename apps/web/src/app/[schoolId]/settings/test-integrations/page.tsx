'use client';

/**
 * /[schoolId]/settings/test-integrations — Admin-only integration
 * test dashboard.
 *
 * 2026-05-26 — Operator: "the test integrations should be more than
 * useful, it should test, take you to the actual template it works
 * in and test their, the idea of this setting was to help me test
 * all our integrations and now its useless...."
 *
 * This page is the operator-AND-lead-agent's single click-through
 * for "does every integration in this codebase actually work end-
 * to-end on this deploy, today?" Every row carries:
 *   • A real, server-side status probe (READY / DEGRADED /
 *     NOT_CONFIGURED / COMING_SOON — no marketing-orange "fine"
 *     fakes).
 *   • Round-trip latency for the probe.
 *   • An "Open template using this" button that lands the operator
 *     inside the v2 builder on a preset that exercises this widget
 *     — so the integration data renders on a real canvas with one
 *     click.
 *   • Where applicable, a "Run test" button bound to the existing
 *     /sample-data/* loaders or other real endpoints.
 *
 * Rules baked in:
 *   - Admin-only via RoleGate. CONTRIBUTOR / RESTRICTED_VIEWER see
 *     the "admin access required" fallback.
 *   - `?admin=1` on the URL lifts the COMING_SOON filter for
 *     SUPER_ADMIN diagnostics so they can see the still-TODO list.
 *   - No `inset-*` Tailwind class or CSS `inset:` shorthand — every
 *     positioned wrapper uses physical longhand to stay safe on
 *     Chromium 83 (NovaStar Taurus).
 *   - No `gap-*` on flex containers in this file (Chrome 84+ — same
 *     concern). Spacing uses `space-y-N` / per-child margins.
 *   - No `backdrop-blur-*` — Android System WebView <88 chokes.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api-client';
import { appConfirm } from '@/components/ui/app-dialog';
import { RoleGate } from '@/components/RoleGate';
import {
  ArrowLeft,
  Beaker, Loader2, CheckCircle2, AlertCircle, ExternalLink, Trash2, RefreshCw, ShieldCheck,
  PlugZap, Cable, Sparkles, Database, Radio, HardDriveDownload, Activity,
  Tv, Utensils, GraduationCap, Mail, Trophy, CreditCard, Megaphone, FileImage,
  Settings as SettingsIcon, ChevronDown, ChevronRight, Key,
} from 'lucide-react';

interface IntegrationRow {
  id: string;
  name: string;
  category: string;
  status: 'READY' | 'DEGRADED' | 'NOT_CONFIGURED' | 'COMING_SOON';
  message: string;
  latencyMs: number | null;
  checkedAt: string;
  presetId?: string | null;
  verticalHint?: string | null;
  ctaLabel?: string;
  testEndpoint?: string;
  testMethod?: 'POST' | 'DELETE' | 'GET';
  configurePath?: string;
  docsUrl?: string;
}

interface IntegrationsGrid {
  generatedAt: string;
  generatedInMs: number;
  summary: Record<string, { ready: number; degraded: number; notConfigured: number; comingSoon: number; total: number }>;
  rows: IntegrationRow[];
}

interface CategoryMeta {
  id: string;
  label: string;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
  defaultOpen: boolean;
}

const CATEGORY_META: CategoryMeta[] = [
  { id: 'core',           label: 'Core infrastructure',     description: 'Database, secrets, anything the rest of the app needs to boot.',           Icon: Database,        defaultOpen: true },
  { id: 'realtime',       label: 'Realtime',                description: 'Signed pub/sub channel that fans emergency alerts across the fleet.',     Icon: Radio,           defaultOpen: true },
  { id: 'storage',        label: 'Storage',                 description: 'Asset uploads, signed URLs, and the offline-first player cache feed.',    Icon: HardDriveDownload, defaultOpen: false },
  { id: 'observability',  label: 'Observability',           description: 'Error tracking, feature flags, runtime telemetry.',                      Icon: Activity,        defaultOpen: false },
  { id: 'ai',             label: 'AI',                      description: 'Sparkle button + touch-template generation — BYOK or platform fallback.', Icon: Sparkles,        defaultOpen: true },
  { id: 'streaming',      label: 'Streaming',               description: 'Live TV providers that drive the Live Stream widget.',                   Icon: Tv,              defaultOpen: true },
  { id: 'pos',            label: 'POS / catalog',           description: 'Live menu boards + retail price callouts. Square / Toast / Clover / etc.', Icon: Utensils,       defaultOpen: true },
  { id: 'sis',            label: 'SIS (school information system)', description: 'Clever pulls rosters + bell schedules + photos into widgets.',   Icon: GraduationCap,   defaultOpen: false },
  { id: 'auth',           label: 'Authentication / SSO',    description: 'SAML / OIDC providers — Google, Okta, Microsoft, district IdPs.',         Icon: Key,             defaultOpen: false },
  { id: 'payments',       label: 'Payments (Stripe)',       description: 'Checkout, Customer Portal, Invoices, webhook idempotency.',              Icon: CreditCard,      defaultOpen: false },
  { id: 'communications', label: 'Communications',          description: 'Email / SMS / push for invites, password resets, and emergency outputs.', Icon: Mail,           defaultOpen: false },
  { id: 'design-import',  label: 'Design imports',          description: 'Drop a PDF / image now; Canva Connect + Slides + Figma queued behind partner approval.', Icon: FileImage, defaultOpen: false },
  { id: 'sports',         label: 'Sports data',             description: 'Sport Engine (manual entry today) — Daktronics / Sportzcast / Genius queued.', Icon: Trophy,      defaultOpen: false },
  { id: 'monetize',       label: 'Monetize (ads)',          description: 'House-only ad slots today; programmatic DOOH SSPs sales-led.',          Icon: Megaphone,       defaultOpen: false },
];

const STATUS_STYLE: Record<IntegrationRow['status'], { label: string; bg: string; text: string; border: string; dot: string }> = {
  READY:          { label: 'Working',       bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  DEGRADED:       { label: 'Degraded',      bg: 'bg-amber-50',   text: 'text-amber-800',   border: 'border-amber-200',   dot: 'bg-amber-500' },
  NOT_CONFIGURED: { label: 'Not set up',    bg: 'bg-rose-50',    text: 'text-rose-700',    border: 'border-rose-200',    dot: 'bg-rose-500' },
  COMING_SOON:    { label: 'Coming soon',   bg: 'bg-slate-50',   text: 'text-slate-600',   border: 'border-slate-200',   dot: 'bg-slate-400' },
};

export default function TestIntegrationsPage() {
  return (
    <RoleGate
      allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN', 'admin']}
      fallback={<AdminOnlyFallback />}
    >
      <TestIntegrationsContent />
    </RoleGate>
  );
}

function AdminOnlyFallback() {
  const params = useParams<{ schoolId: string }>();
  const schoolId = params?.schoolId ?? '';
  return (
    <div className="space-y-6 max-w-3xl">
      <Link
        href={`/${schoolId}/settings`}
        className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> Settings
      </Link>
      <div className="rounded-2xl bg-slate-50 border border-slate-200 p-8 text-center">
        <ShieldCheck className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <h2 className="text-sm font-bold text-slate-700">Admin access required</h2>
        <p className="text-xs text-slate-500 mt-2 max-w-md mx-auto">
          The integrations test dashboard is restricted to district + school admins. Ask your admin to run a smoke test.
        </p>
      </div>
    </div>
  );
}

function TestIntegrationsContent() {
  const params = useParams<{ schoolId: string }>();
  const router = useRouter();
  const schoolId = params?.schoolId ?? '';
  // 2026-05-26 — Next 16 requires useSearchParams() to be wrapped in
  // a Suspense boundary; read from window.location.search inside an
  // effect to dodge the boundary requirement (same pattern as the
  // /[schoolId]/settings/billing page).
  const [adminGate, setAdminGate] = useState(false);
  useEffect(() => {
    setAdminGate(new URLSearchParams(window.location.search).get('admin') === '1');
  }, []);

  const [grid, setGrid] = useState<IntegrationsGrid | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<Record<string, { ok: boolean; message: string }>>({});

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const m of CATEGORY_META) init[m.id] = !m.defaultOpen;
    return init;
  });

  const loadGrid = async () => {
    setLoading(true);
    setError(null);
    try {
      const url = adminGate ? '/health/integrations?admin=1' : '/health/integrations';
      const res = await apiFetch<IntegrationsGrid>(url, { method: 'GET' });
      setGrid(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadGrid();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminGate]);

  const runTest = async (row: IntegrationRow) => {
    if (!row.testEndpoint) return;
    setRunning(row.id);
    try {
      const res: any = await apiFetch(row.testEndpoint, { method: row.testMethod || 'POST' });
      setRunResult((prev) => ({
        ...prev,
        [row.id]: { ok: !!res?.ok, message: res?.message || (res?.ok ? 'Done.' : 'Completed.') },
      }));
      // Re-probe the grid so the row flips green if the test seeded data.
      void loadGrid();
    } catch (e) {
      setRunResult((prev) => ({
        ...prev,
        [row.id]: { ok: false, message: e instanceof Error ? e.message : String(e) },
      }));
    } finally {
      setRunning(null);
    }
  };

  const openTemplate = async (row: IntegrationRow) => {
    setOpening(row.id);
    try {
      if (row.presetId) {
        const tpl: any = await apiFetch(
          `/templates/from-preset/${encodeURIComponent(row.presetId)}`,
          { method: 'POST', body: JSON.stringify({}) },
        );
        if (tpl?.id) {
          // Hard-nav (full load) — soft-nav into the builder doesn't render reliably.
          window.location.href = `/${schoolId}/templates/builder/${tpl.id}`;
          return;
        }
      }
      const qs = row.verticalHint ? `?vertical=${row.verticalHint}` : '';
      router.push(`/${schoolId}/templates${qs}`);
    } catch (e) {
      setRunResult((prev) => ({
        ...prev,
        [row.id]: { ok: false, message: e instanceof Error ? e.message : String(e) },
      }));
    } finally {
      setOpening(null);
    }
  };

  const wipeSamples = async () => {
    const ok = await appConfirm({
      title: 'Wipe sample integration rows?',
      message: 'This deletes every connection tagged [Sample] across streaming + POS. Production data is untouched.',
      confirmLabel: 'Wipe samples',
      tone: 'danger',
    });
    if (!ok) return;
    setRunning('__wipe');
    try {
      const res: any = await apiFetch('/sample-data/all', { method: 'DELETE' });
      setRunResult((prev) => ({
        ...prev,
        __wipe: { ok: !!res?.ok, message: res?.message || (res?.ok ? 'Wiped sample data.' : 'Wipe failed.') },
      }));
      void loadGrid();
    } catch (e) {
      setRunResult((prev) => ({
        ...prev,
        __wipe: { ok: false, message: e instanceof Error ? e.message : String(e) },
      }));
    } finally {
      setRunning(null);
    }
  };

  const grouped = useMemo(() => {
    const out: Record<string, IntegrationRow[]> = {};
    if (!grid) return out;
    for (const r of grid.rows) {
      if (!out[r.category]) out[r.category] = [];
      out[r.category].push(r);
    }
    return out;
  }, [grid]);

  const totalSummary = useMemo(() => {
    if (!grid) return { ready: 0, degraded: 0, notConfigured: 0, comingSoon: 0, total: 0 };
    let ready = 0, degraded = 0, notConfigured = 0, comingSoon = 0, total = 0;
    for (const r of grid.rows) {
      total += 1;
      if (r.status === 'READY') ready += 1;
      else if (r.status === 'DEGRADED') degraded += 1;
      else if (r.status === 'NOT_CONFIGURED') notConfigured += 1;
      else comingSoon += 1;
    }
    return { ready, degraded, notConfigured, comingSoon, total };
  }, [grid]);

  const toggleAdminGate = () => {
    const next = !adminGate;
    setAdminGate(next);
    const usp = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
    if (next) usp.set('admin', '1'); else usp.delete('admin');
    router.replace(`/${schoolId}/settings/test-integrations${usp.toString() ? '?' + usp.toString() : ''}`);
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <Link
        href={`/${schoolId}/settings`}
        className="inline-flex items-center text-xs text-slate-500 hover:text-rose-600"
      >
        <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> Settings
      </Link>

      {/* Hero */}
      <div className="rounded-2xl bg-gradient-to-br from-pink-600 via-rose-600 to-orange-600 p-6 text-white">
        <h1 className="text-2xl font-extrabold tracking-tight flex items-center">
          <Beaker className="w-6 h-6 mr-2" /> Integrations test dashboard
        </h1>
        <p className="text-rose-50 mt-1.5 text-sm max-w-2xl">
          Single click-through for every integration in this codebase. Probes the live deploy, reports green / amber / red,
          and links straight into a template that uses the integration so you can see the data render on a real canvas.
        </p>
        <p className="text-rose-50 mt-1 text-xs opacity-90 max-w-2xl">
          Admin-only. <span className="font-bold">{adminGate ? 'Showing every integration (admin diagnostic mode).' : 'Hiding "coming soon" rows.'}</span>
        </p>
      </div>

      {/* Toolbar */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center justify-between flex-wrap">
        <div className="text-xs text-slate-600 mr-4">
          {loading
            ? <span className="inline-flex items-center"><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Running probes…</span>
            : grid
              ? (
                <span>
                  <span className="font-bold text-slate-800">{totalSummary.total}</span> integrations ·
                  <span className="text-emerald-700 font-bold ml-1.5">{totalSummary.ready} working</span> ·
                  <span className="text-amber-700 font-bold ml-1.5">{totalSummary.degraded} degraded</span> ·
                  <span className="text-rose-700 font-bold ml-1.5">{totalSummary.notConfigured} not set up</span>
                  {totalSummary.comingSoon > 0 && (
                    <span className="text-slate-500 font-bold ml-1.5">{totalSummary.comingSoon} coming soon</span>
                  )}
                  <span className="ml-2 opacity-70">· {grid.generatedInMs}ms · last run {new Date(grid.generatedAt).toLocaleTimeString()}</span>
                </span>
              )
              : <span>{error || 'No data.'}</span>
          }
        </div>
        <div className="flex items-center flex-wrap">
          <button
            type="button"
            onClick={toggleAdminGate}
            className="mr-2 mt-1 px-3 py-1.5 text-[11px] font-bold rounded-lg border border-slate-200 hover:border-slate-400 inline-flex items-center text-slate-600"
            title={adminGate ? 'Hide coming-soon rows' : 'Show every integration including coming-soon'}
          >
            <SettingsIcon className="w-3 h-3 mr-1.5" />
            {adminGate ? 'Hide coming-soon' : 'Show coming-soon'}
          </button>
          <button
            type="button"
            onClick={loadGrid}
            disabled={loading}
            className="mr-2 mt-1 px-3 py-1.5 text-[11px] font-bold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 inline-flex items-center"
          >
            {loading ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1.5" />}
            Run full audit
          </button>
          <button
            type="button"
            onClick={wipeSamples}
            disabled={running !== null}
            className="mt-1 px-3 py-1.5 text-[11px] font-bold rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-50 inline-flex items-center"
          >
            {running === '__wipe' ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Trash2 className="w-3 h-3 mr-1.5" />}
            Wipe sample data
          </button>
        </div>
      </div>
      {runResult['__wipe'] && (
        <div className={`rounded-xl border px-4 py-2 text-xs ${runResult['__wipe'].ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
          {runResult['__wipe'].message}
        </div>
      )}

      {/* Categorized rows */}
      {loading && !grid && (
        <div className="rounded-2xl bg-white border border-slate-200 p-12 text-center text-slate-500">
          <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin text-indigo-600" />
          <p className="text-sm font-bold">Probing every integration…</p>
        </div>
      )}
      {error && !grid && (
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-6 text-sm text-rose-800">
          <p className="font-bold mb-1">Could not load the integrations grid.</p>
          <p>{error}</p>
        </div>
      )}

      {grid && CATEGORY_META.map((cat) => {
        const rows = grouped[cat.id];
        if (!rows || rows.length === 0) return null;
        const summary = grid.summary[cat.id] || { ready: 0, degraded: 0, notConfigured: 0, comingSoon: 0, total: 0 };
        const open = !collapsed[cat.id];
        const Icon = cat.Icon;
        return (
          <section key={cat.id} className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setCollapsed((prev) => ({ ...prev, [cat.id]: !!open }))}
              className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-50/60 text-left"
              aria-expanded={open}
            >
              <div className="flex items-start">
                <div className="w-9 h-9 rounded-lg bg-slate-50 flex items-center justify-center mr-3 shrink-0">
                  <Icon className="w-4 h-4 text-slate-600" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-800">
                    {cat.label}
                    <span className="ml-2 text-[11px] font-normal text-slate-500">
                      ({summary.ready} working
                      {summary.degraded > 0 && ` / ${summary.degraded} degraded`}
                      {summary.notConfigured > 0 && ` / ${summary.notConfigured} not set up`}
                      {summary.comingSoon > 0 && ` / ${summary.comingSoon} coming soon`})
                    </span>
                  </h2>
                  <p className="text-[11px] text-slate-500 mt-0.5">{cat.description}</p>
                </div>
              </div>
              {open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
            </button>
            {open && (
              <div className="border-t border-slate-100 divide-y divide-slate-100">
                {rows.map((row) => (
                  <Row
                    key={row.id}
                    row={row}
                    schoolId={schoolId}
                    running={running === row.id}
                    opening={opening === row.id}
                    runResult={runResult[row.id]}
                    onRunTest={() => runTest(row)}
                    onOpenTemplate={() => openTemplate(row)}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}

      {/* Free-account legend (kept; the operator asked for this in
          the prior iteration and it's still useful while a vendor is
          dormant). */}
      <FreeAccountLegend />
    </div>
  );
}

function Row({
  row,
  schoolId,
  running,
  opening,
  runResult,
  onRunTest,
  onOpenTemplate,
}: {
  row: IntegrationRow;
  schoolId: string;
  running: boolean;
  opening: boolean;
  runResult?: { ok: boolean; message: string };
  onRunTest: () => void;
  onOpenTemplate: () => void;
}) {
  const style = STATUS_STYLE[row.status];
  return (
    <div className="px-5 py-4 flex items-start justify-between flex-wrap">
      <div className="flex-1 min-w-0 mr-3">
        <div className="flex items-center flex-wrap">
          <span className={`w-2 h-2 rounded-full mr-2 ${style.dot}`} aria-hidden />
          <span className="text-sm font-bold text-slate-800 mr-2">{row.name}</span>
          <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${style.bg} ${style.text} ${style.border} border`}>
            {style.label}
          </span>
          {typeof row.latencyMs === 'number' && (
            <span className="ml-2 text-[10px] font-mono text-slate-400">{row.latencyMs}ms</span>
          )}
        </div>
        <p className="text-[12px] text-slate-600 mt-1 leading-relaxed">{row.message}</p>
        <div className="mt-1 flex items-center flex-wrap text-[10px] text-slate-400">
          <span className="mr-3">id: <code>{row.id}</code></span>
          <span>checked: {new Date(row.checkedAt).toLocaleTimeString()}</span>
        </div>
        {runResult && (
          <div className={`mt-2 text-[11px] inline-flex items-start ${runResult.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
            {runResult.ok ? <CheckCircle2 className="w-3.5 h-3.5 mr-1 mt-0.5 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 mr-1 mt-0.5 shrink-0" />}
            <span>{runResult.message}</span>
          </div>
        )}
      </div>
      <div className="shrink-0 flex items-center flex-wrap" style={{ rowGap: '0.375rem' }}>
        {row.docsUrl && (
          <a
            href={row.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="mr-2 inline-flex items-center px-2.5 py-1.5 text-[11px] font-semibold rounded-md border border-slate-200 hover:border-slate-400 text-slate-600"
            title="Open upstream docs"
          >
            <ExternalLink className="w-3 h-3 mr-1" /> Docs
          </a>
        )}
        {row.configurePath && (
          <Link
            href={`/${schoolId}${row.configurePath}`}
            className="mr-2 inline-flex items-center px-2.5 py-1.5 text-[11px] font-semibold rounded-md border border-slate-200 hover:border-indigo-300 text-slate-600 hover:text-indigo-700"
            title="Open the configuration page"
          >
            <Cable className="w-3 h-3 mr-1" /> Configure
          </Link>
        )}
        {row.testEndpoint && row.status !== 'COMING_SOON' && (
          <button
            type="button"
            onClick={onRunTest}
            disabled={running}
            className="mr-2 inline-flex items-center px-2.5 py-1.5 text-[11px] font-bold rounded-md bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60"
          >
            {running ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <PlugZap className="w-3 h-3 mr-1" />}
            {running ? 'Testing…' : 'Run test'}
          </button>
        )}
        {(row.presetId || row.verticalHint) && row.status !== 'COMING_SOON' && (
          <button
            type="button"
            onClick={onOpenTemplate}
            disabled={opening}
            className="inline-flex items-center px-2.5 py-1.5 text-[11px] font-bold rounded-md bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700 text-white disabled:opacity-60"
            title="Open a template that uses this integration"
          >
            {opening ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}
            {opening ? 'Opening…' : (row.ctaLabel || 'Open template using this')}
          </button>
        )}
      </div>
    </div>
  );
}

function FreeAccountLegend() {
  const items = [
    { name: 'Square POS',           free: true,  url: 'https://developer.squareup.com/', notes: 'Free sandbox at developer.squareup.com — full Catalog API access, no production approval needed.' },
    { name: 'Stripe (billing + Terminal)', free: true, url: 'https://dashboard.stripe.com/test/dashboard', notes: 'Free test mode forever. Real cards rejected; test cards (4242 4242 4242 4242) work end-to-end.' },
    { name: 'Clover',               free: true,  url: 'https://docs.clover.com/dev/docs/quick-start', notes: 'Free dev account — sandbox merchant id + API token immediately.' },
    { name: 'Lightspeed Retail',    free: true,  url: 'https://developers.lightspeedhq.com/retail/', notes: 'Free sandbox. R-Series API. Apply for OAuth client.' },
    { name: 'Shopify POS / Admin',  free: true,  url: 'https://shopify.dev/docs/apps/getting-started', notes: 'Free Partner account → Development store with full Admin API.' },
    { name: 'YouTube embed',        free: true,  url: 'https://developers.google.com/youtube/iframe_api_reference', notes: 'No account needed for public-video embeds. Data API key (free, quota-limited) for channel metadata.' },
    { name: 'Twitch embed',         free: true,  url: 'https://dev.twitch.tv/docs/embed/', notes: 'Free dev account at dev.twitch.tv. Embed iframe needs the right `parent` host.' },
    { name: 'Public broadcasters',  free: true,  url: 'https://www3.nhk.or.jp/nhkworld/en/live/', notes: 'NHK / France 24 / DW / Al Jazeera English — explicitly invite venue rebroadcast. Zero auth.' },
    { name: 'Mux (test HLS)',       free: true,  url: 'https://test-streams.mux.dev/', notes: 'Open test stream bucket — public m3u8s for verifying hls.js playback.' },
    { name: 'Toast POS',            free: false, url: 'https://doc.toasttab.com/', notes: 'Toast Partner Program — application + commercial-grade vetting required.' },
    { name: 'MINDBODY (ABC Fitness)', free: false, url: 'https://developers.mindbodyonline.com/', notes: 'Partner program — application required.' },
    { name: 'Hivestack / Vistar / Place Exchange / Broadsign', free: false, url: 'https://hivestack.com/publishers', notes: 'Programmatic DOOH SSPs — sales-led publisher programs, contracts + media kit review.' },
    { name: 'Atmosphere TV',        free: false, url: 'https://atmosphere.tv/business/', notes: 'Partner integration — direct outreach to atmosphere.tv/partners.' },
  ];
  return (
    <section className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5">
      <div className="flex items-start mb-3">
        <div className="w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center mr-3 shrink-0">
          <ExternalLink className="w-5 h-5 text-slate-500" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-slate-800">Free-account paths per provider</h2>
          <p className="text-xs text-slate-500 mt-0.5">Quick reference for which providers offer free dev / sandbox access vs. which require a sales conversation.</p>
        </div>
      </div>
      <div className="space-y-1">
        {items.map((it) => (
          <div key={it.name} className="flex items-start p-2 hover:bg-slate-50 rounded">
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full mr-3 mt-0.5 shrink-0 ${
              it.free ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                      : 'bg-amber-100 text-amber-700 border border-amber-200'
            }`}>
              {it.free ? 'Free' : 'Sales-led'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-slate-800">
                <a href={it.url} target="_blank" rel="noreferrer" className="hover:underline inline-flex items-center">
                  {it.name} <ExternalLink className="w-3 h-3 ml-1" />
                </a>
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">{it.notes}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
