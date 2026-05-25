'use client';

/**
 * /[schoolId]/settings/test-integrations — One-click integration smoke
 * test harness. Loads realistic sample data into the tenant's
 * streaming / POS / ads connections so the operator can demo every
 * feature WITHOUT registering for vendor sandbox accounts.
 *
 * 2026-05-03. Every loaded row is tagged with `[Sample]` so
 * production data stays safe. The Wipe button removes only the
 * sample rows — anything the operator added manually is left alone.
 *
 * 2026-05-05. Operator: "where do they go to? do i have a template
 * that they feed into?...if we cant show it we shouldnt have it".
 * Each Run now also surfaces an "Open demo template" CTA after a
 * successful load — one click finds-or-creates a preset template
 * that uses the right widget for the integration, drops the
 * operator into the builder, and they SEE the data render. Demo-
 * ready end-to-end. The mapping below pairs each Run key with a
 * system-preset id; null entries signal "no preset uses this widget
 * yet" (gap on the audit list, fix in a follow-up commit).
 */
import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api-client';
import { appConfirm } from '@/components/ui/app-dialog';
import {
  ArrowLeft,
  Beaker, Loader2, CheckCircle2, ExternalLink, Trash2, AlertCircle, RefreshCw,
  Tv, Utensils, ShoppingBag, DollarSign, Sparkles,
} from 'lucide-react';

interface ActionResult {
  ok: boolean;
  message: string;
  meta?: Record<string, any>;
}

/**
 * Each Run key maps to a preset-id + a friendly demo-button label.
 * The preset must already exist in apps/api/src/templates/*-presets.ts
 * AND use the widget that consumes the freshly-loaded sample data.
 *
 * GAPS (no preset yet): public-broadcasters / mux-hls (Streaming),
 * ads-house-only (Ads). These get a "View [Vertical] templates →"
 * link that takes the operator to the templates gallery filtered
 * to the right vertical, so they can pick a starting point.
 */
const DEMO_TARGETS: Record<string, { presetId?: string; label: string; verticalHint?: string }> = {
  'public-broadcasters': { label: 'Open the Live News template', verticalHint: 'BAR', presetId: undefined },
  'mux-hls':              { label: 'Open the Live News template', verticalHint: 'BAR', presetId: undefined },
  'pos-restaurant':       { label: 'Open the QSR Drive-Thru Menu demo', presetId: 'qsr-drive-thru-menu' },
  'pos-retail':           { label: 'Open the Retail Storefront demo',   presetId: 'retail-storefront-welcome' },
  'ads-house-only':       { label: 'Open templates →', verticalHint: 'RETAIL' },
};

export default function TestIntegrationsPage() {
  const params = useParams<{ schoolId: string }>();
  const router = useRouter();
  const schoolId = params?.schoolId ?? '';
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ActionResult>>({});
  const [opening, setOpening] = useState<string | null>(null);

  const run = async (key: string, path: string, method: 'POST' | 'DELETE' = 'POST') => {
    setRunning(key);
    try {
      const res: any = await apiFetch(path, { method });
      setResults((prev) => ({
        ...prev,
        [key]: { ok: !!res?.ok, message: res?.message || (res?.ok ? 'Done.' : 'Completed'), meta: res },
      }));
    } catch (e) {
      setResults((prev) => ({
        ...prev,
        [key]: { ok: false, message: e instanceof Error ? e.message : String(e) },
      }));
    } finally {
      setRunning(null);
    }
  };

  /**
   * One-click "Open demo template" handler. Calls the templates
   * controller to clone the named preset into the operator's
   * tenant, then navigates straight to the v2 builder for the
   * fresh template — operator sees the integration data render
   * with no other clicks.
   *
   * If the preset isn't set (gap in the catalog), we fall back to
   * the templates gallery filtered by vertical — operator picks
   * any matching template to drop the widget into.
   */
  const openDemo = async (key: string) => {
    const target = DEMO_TARGETS[key];
    if (!target) return;
    setOpening(key);
    try {
      if (target.presetId) {
        const tpl: any = await apiFetch(`/templates/from-preset/${encodeURIComponent(target.presetId)}`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        if (tpl?.id) {
          router.push(`/${schoolId}/templates/builder/${tpl.id}`);
          return;
        }
      }
      // Fallback — gallery filtered by vertical hint (or unfiltered).
      const qs = target.verticalHint ? `?vertical=${target.verticalHint}` : '';
      router.push(`/${schoolId}/templates${qs}`);
    } catch (e) {
      setResults((prev) => ({
        ...prev,
        [key]: { ...(prev[key] || { ok: true, message: '' }), message: `Could not open demo template: ${e instanceof Error ? e.message : String(e)}` },
      }));
    } finally {
      setOpening(null);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <Link
        href={`/${schoolId}/settings`}
        className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-rose-600"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Settings
      </Link>
      <div className="rounded-2xl bg-gradient-to-br from-pink-600 via-rose-600 to-orange-600 p-6 text-white">
        <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2">
          <Beaker className="w-6 h-6" /> Test integrations
        </h1>
        <p className="text-rose-50 mt-1.5 text-sm max-w-2xl">
          One-click smoke tests for the streaming / POS / ad-network frameworks. Loads realistic sample data without needing vendor sandbox accounts. Every sample row is tagged so production data stays safe — wipe at any time.
        </p>
      </div>

      <Section
        icon={<Tv className="w-5 h-5 text-violet-600" />}
        title="Streaming"
        description="Connect streaming providers + auto-pick channels so the Live Stream widget plays real video on the canvas."
      >
        <ActionRow
          label="Public Broadcasters (NHK / France 24 / DW / Al Jazeera / Bloomberg / Sky News / CBS)"
          subtitle="9 free, venue-friendly news channels. No auth, no cost. Pure iframe embed."
          onClick={() => run('public-broadcasters', '/sample-data/streaming/public-broadcasters')}
          running={running === 'public-broadcasters'}
          result={results['public-broadcasters']}
          docsUrl="https://www3.nhk.or.jp/nhkworld/en/live/"
          demoKey="public-broadcasters"
          onOpenDemo={openDemo}
          opening={opening === 'public-broadcasters'}
        />
        <ActionRow
          label="Custom HLS — Mux test streams"
          subtitle="Public test HLS streams from Mux's open test bucket. Useful to verify hls.js playback end-to-end."
          onClick={() => run('mux-hls', '/sample-data/streaming/custom-hls')}
          running={running === 'mux-hls'}
          result={results['mux-hls']}
          docsUrl="https://test-streams.mux.dev/"
          demoKey="mux-hls"
          onOpenDemo={openDemo}
          opening={opening === 'mux-hls'}
        />
      </Section>

      <Section
        icon={<Utensils className="w-5 h-5 text-amber-600" />}
        title="POS — Restaurant menu"
        description="Loads 24 menu items across 4 categories (Burgers / Sides / Drinks / Desserts) into a custom-webhook POS connection. The Restaurant Menu Board widget reads from these rows directly."
      >
        <ActionRow
          label="Load sample restaurant catalog (24 items)"
          subtitle="Real-looking burger menu — names, prices, descriptions, dietary chips."
          onClick={() => run('pos-restaurant', '/sample-data/pos/sample-restaurant')}
          running={running === 'pos-restaurant'}
          result={results['pos-restaurant']}
          demoKey="pos-restaurant"
          onOpenDemo={openDemo}
          opening={opening === 'pos-restaurant'}
        />
      </Section>

      <Section
        icon={<ShoppingBag className="w-5 h-5 text-pink-600" />}
        title="POS — Retail catalog"
        description="Loads 18 retail SKUs across 3 categories (Apparel / Footwear / Accessories) with sale prices on a few. Drives the Retail Product Grid + Price Callout widgets."
      >
        <ActionRow
          label="Load sample retail catalog (18 SKUs)"
          subtitle="Mix of regular + sale prices so the price-callout widget can show strike-through."
          onClick={() => run('pos-retail', '/sample-data/pos/sample-retail')}
          running={running === 'pos-retail'}
          result={results['pos-retail']}
          demoKey="pos-retail"
          onOpenDemo={openDemo}
          opening={opening === 'pos-retail'}
        />
      </Section>

      <Section
        icon={<DollarSign className="w-5 h-5 text-emerald-600" />}
        title="Ads — House-only"
        description="Connects the house-only ad network. Free + safe (no third-party creative). Operator schedules their own ads via the StreamAdSlot path."
      >
        <ActionRow
          label="Connect house-only ad network"
          subtitle="No external creds; operator uploads their own creatives in Assets."
          onClick={() => run('ads-house-only', '/sample-data/ads/house-only')}
          running={running === 'ads-house-only'}
          result={results['ads-house-only']}
          demoKey="ads-house-only"
          onOpenDemo={openDemo}
          opening={opening === 'ads-house-only'}
        />
      </Section>

      {/* Wipe + free-account helper */}
      <Section
        icon={<RefreshCw className="w-5 h-5 text-slate-500" />}
        title="Reset"
        description="Wipes every connection tagged [Sample]. Production data is left alone."
      >
        <button
          onClick={async () => {
            if (!(await appConfirm({
              title: 'Wipe sample rows?',
              message: 'This deletes every [Sample] row across streaming + POS. Production data is left alone.',
              confirmLabel: 'Wipe samples',
              tone: 'danger',
            }))) return;
            run('wipe-all', '/sample-data/all', 'DELETE');
          }}
          disabled={running !== null}
          className="px-4 py-2 text-sm font-bold rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-50 inline-flex items-center gap-2"
        >
          {running === 'wipe-all' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
          Wipe sample data
        </button>
        {results['wipe-all'] && (
          <div className={`mt-3 text-xs ${results['wipe-all'].ok ? 'text-emerald-700' : 'text-rose-700'}`}>
            {results['wipe-all'].message}
          </div>
        )}
      </Section>

      {/* Free-account hints */}
      <FreeAccountGuide />
    </div>
  );
}

function Section({ icon, title, description, children }: { icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center flex-shrink-0">{icon}</div>
        <div>
          <h2 className="text-sm font-bold text-slate-800">{title}</h2>
          <p className="text-xs text-slate-500 mt-0.5">{description}</p>
        </div>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function ActionRow({
  label, subtitle, onClick, running, result, docsUrl,
  demoKey, onOpenDemo, opening,
}: {
  label: string;
  subtitle?: string;
  onClick: () => void;
  running: boolean;
  result?: ActionResult;
  docsUrl?: string;
  /** When set, shows a "Open demo template" CTA after a successful run. */
  demoKey?: string;
  onOpenDemo?: (key: string) => void;
  opening?: boolean;
}) {
  const demoTarget = demoKey ? DEMO_TARGETS[demoKey] : undefined;
  return (
    <div className="rounded-lg border border-slate-200 p-3 flex items-start justify-between gap-3 hover:border-indigo-200 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold text-slate-800">{label}</div>
        {subtitle && <div className="text-[11px] text-slate-500 mt-0.5">{subtitle}</div>}
        {docsUrl && (
          <a href={docsUrl} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-600 hover:underline inline-flex items-center gap-1 mt-1">
            <ExternalLink className="w-2.5 h-2.5" /> Source
          </a>
        )}
        {result && (
          <div className={`mt-2 text-xs flex items-start gap-1.5 ${result.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
            {result.ok ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> : <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
            {result.message}
          </div>
        )}
        {/*
          Operator: "where do they go to? do i have a template that
          they feed into?" — once Run succeeds, surface a one-click
          path to a preset template that uses the right widget. If
          the integration has no preset using its widget yet (gap on
          the audit list), this falls back to the templates gallery
          filtered by the relevant vertical.
        */}
        {result?.ok && demoTarget && demoKey && onOpenDemo && (
          <button
            type="button"
            onClick={() => onOpenDemo(demoKey)}
            disabled={!!opening}
            className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white text-[11px] font-bold hover:from-violet-700 hover:to-fuchsia-700 disabled:opacity-60"
          >
            {opening ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            {opening ? 'Opening…' : `${demoTarget.label} →`}
          </button>
        )}
      </div>
      <button
        onClick={onClick}
        disabled={running}
        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-1.5"
      >
        {running ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
        {result?.ok ? 'Re-run' : 'Run'}
      </button>
    </div>
  );
}

function FreeAccountGuide() {
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
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center flex-shrink-0">
          <ExternalLink className="w-5 h-5 text-slate-500" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-slate-800">Free-account paths per integration</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Quick reference for which providers offer free dev / sandbox access (you can self-serve right now) vs. which require a sales conversation.
          </p>
        </div>
      </div>
      <div className="space-y-1">
        {items.map((it) => (
          <div key={it.name} className="flex items-start gap-3 p-2 hover:bg-slate-50 rounded">
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5 ${
              it.free ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                      : 'bg-amber-100 text-amber-700 border border-amber-200'
            }`}>
              {it.free ? 'Free' : 'Sales-led'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-slate-800">
                <a href={it.url} target="_blank" rel="noreferrer" className="hover:underline inline-flex items-center gap-1">
                  {it.name} <ExternalLink className="w-3 h-3" />
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
