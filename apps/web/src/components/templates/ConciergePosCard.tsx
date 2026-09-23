'use client';

// ─────────────────────────────────────────────────────────────────────────
// ConciergePosCard — "Use your Toast menu?" / "Which POS do you use?" inside the
// Signage Concierge (2026-09-22).
//
// Greg: "our AI needs to be super tuned into our POS integrations so that when
// we ask for an integration it knows to ask what one and ensures the template
// is created with perfect integrations into those systems".
//
// Shows only when the chat looks like a MENU board. With a connected POS it
// offers that menu, sections pre-ticked from the operator's own words and never
// more than one screen holds; without one it asks which POS (the one their
// website links to first). OAuth POS open in a NEW tab and Toast opens Settings
// → POS in a new tab (Toast setup lives there — this card never duplicates the
// form), so the chat in this tab survives; the data refreshes when the operator
// comes back to the tab (useConciergePosContext) — no polling.
//
// The pick is only a REQUEST: the server re-verifies the connection and builds
// the board's item list itself. State lives in SignageConcierge; this renders.
// ─────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Store, CheckCircle2, ExternalLink, Pencil } from 'lucide-react';
import type {
  ConciergePosConnection,
  ConciergePosContext,
  ConciergePosProviderOption,
  ConciergePosSelection,
  ConciergeReference,
} from '@cms/api-types';
import {
  buildPosSelection,
  canTick,
  connectsByOAuth,
  posCardView,
  preTickSections,
  rowLimitFor,
  tickedItemCount,
} from './conciergePos';
import { openPosOAuthInNewTab, useConciergePosContext } from '@/hooks/use-concierge-pos';

/**
 * What SignageConcierge mounts: fetches the POS context (only once the chat is
 * about a menu, or a pick is in force) and renders the card. Mounted only when
 * the page turns the card on, so a Concierge without it never touches the query.
 */
export function ConciergePosPanel(props: Omit<ConciergePosCardProps, 'context'>) {
  const q = useConciergePosContext(props.isMenu || !!props.selection);
  return <ConciergePosCard {...props} context={q.data} />;
}

export interface ConciergePosCardProps {
  context: ConciergePosContext | null | undefined;
  /** Does the chat look like a menu board (conciergePos.looksLikeMenuBoard)? */
  isMenu: boolean;
  canvas: { w: number; h: number };
  /** The operator's own words — which sections they named. */
  operatorText: string;
  references: ConciergeReference[];
  /** The pick in force for this board (SignageConcierge state). */
  selection: ConciergePosSelection | undefined;
  /** The operator said they will type the menu / use no POS. */
  declined: boolean;
  onUse: (selection: ConciergePosSelection, provider: string, sectionNames: string[]) => void;
  onChange: () => void;
  onDecline: () => void;
  onUndoDecline: () => void;
  /** A chat turn is in flight. */
  busy?: boolean;
}

export function ConciergePosCard(props: ConciergePosCardProps) {
  const t = useTranslations('conciergePos');
  const params = useParams<{ schoolId?: string }>();
  const settingsHref = `/${params?.schoolId || ''}/settings/pos`.replace(/^\/\//, '/');
  const rowLimit = rowLimitFor(props.canvas);

  const view = posCardView({
    enabled: true,
    isMenu: props.isMenu,
    context: props.context,
    selection: props.selection,
    declined: props.declined,
    references: props.references,
  });

  // Which connection the offer is for (a location can see its own AND its
  // organisation's), and the ticked sections for it.
  const offerable = useMemo(
    () => (props.context?.connections || []).filter((c) => c.itemCount > 0),
    [props.context],
  );
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const connection: ConciergePosConnection | null =
    offerable.find((c) => c.id === connectionId) || (view.kind === 'offer' ? view.connection : null);
  const [ticked, setTicked] = useState<string[] | null>(null);
  // Pre-tick from the operator's words once per connection shown.
  useEffect(() => {
    if (connection) setTicked(preTickSections(connection.sections, props.operatorText, rowLimit));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed only when the offered menu changes, never on every keystroke
  }, [connection?.id, connection?.itemCount, rowLimit]);

  const [connectError, setConnectError] = useState<string | null>(null);

  if (view.kind === 'hidden') return null;

  const liveLine = (c: ConciergePosConnection) =>
    `${t('liveSync', { provider: c.providerName })} ${c.live.soldOut ? t('liveSoldOut') : t('liveNoSoldOut', { provider: c.providerName })}`;

  const shell = (tone: 'emerald' | 'violet' | 'slate', children: React.ReactNode) => (
    <section
      aria-label={t('cardLabel')}
      data-testid="concierge-pos-card"
      className={`rounded-xl border px-3 py-2.5 ${
        tone === 'emerald' ? 'border-emerald-200 bg-emerald-50/70' : tone === 'violet' ? 'border-violet-200 bg-violet-50/60' : 'border-slate-200 bg-slate-50'
      }`}
    >
      {children}
    </section>
  );

  if (view.kind === 'selected') {
    return shell(
      'emerald',
      <>
        <div className="flex items-start justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-bold text-emerald-900">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            {t('selectedTitle', { provider: view.connection.providerName, count: view.itemCount })}
          </p>
          <button type="button" onClick={props.onChange} disabled={props.busy} className="text-[11px] font-bold text-emerald-800 underline disabled:opacity-50">
            {t('change')}
          </button>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-emerald-800">{view.selection.sections.join(' · ')}</p>
        <p className="mt-1 text-[11px] leading-snug text-emerald-700">{liveLine(view.connection)}</p>
      </>,
    );
  }

  if (view.kind === 'declined') {
    return shell(
      'slate',
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
          <Pencil className="w-3 h-3 shrink-0" aria-hidden="true" />
          {t('declinedNote')}
        </p>
        <button type="button" onClick={props.onUndoDecline} className="text-[11px] font-bold text-violet-700 underline">
          {t('declinedUndo')}
        </button>
      </div>,
    );
  }

  if (view.kind === 'unsynced') {
    return shell(
      'slate',
      <>
        <p className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
          <Store className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          {t('unsyncedTitle', { provider: view.connection.providerName })}
        </p>
        <p className="mt-1 text-[11px] leading-snug text-slate-600">{t('unsyncedHint')}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <a href={settingsHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-lg bg-white border border-slate-300 text-slate-700 hover:border-violet-300">
            {t('openPosSettings')} <ExternalLink className="w-3 h-3" aria-hidden="true" />
          </a>
          <button type="button" onClick={props.onDecline} disabled={props.busy} className="text-[11px] font-bold text-slate-600 underline disabled:opacity-50">
            {t('typeInstead')}
          </button>
        </div>
      </>,
    );
  }

  if (view.kind === 'connect') {
    const detected = view.detected;
    const lead = view.providers.find((p) => detected.includes(p.providerId));
    const connect = async (p: ConciergePosProviderOption) => {
      setConnectError(null);
      if (connectsByOAuth(p)) {
        const ok = await openPosOAuthInNewTab(p.providerId);
        if (!ok) setConnectError(t('connectFailed', { provider: p.name }));
      }
    };
    return shell(
      'violet',
      <>
        <p className="flex items-center gap-1.5 text-xs font-bold text-violet-900">
          <Store className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          {lead ? t('connectDetectedTitle', { provider: lead.name }) : t('connectTitle')}
        </p>
        <p className="mt-1 text-[11px] leading-snug text-violet-800">{t('connectHint')}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {view.providers.map((p) => {
            const isDetected = detected.includes(p.providerId);
            const cls = `inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-lg border ${
              isDetected ? 'bg-violet-600 border-violet-600 text-white' : 'bg-white border-slate-300 text-slate-700 hover:border-violet-300'
            }`;
            const label = (
              <>
                {p.name}
                {isDetected && <span className="ml-1 rounded bg-white/20 px-1 text-[10px] font-semibold">{t('detectedBadge')}</span>}
                <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </>
            );
            return connectsByOAuth(p) ? (
              <button key={p.providerId} type="button" data-provider={p.providerId} onClick={() => void connect(p)} className={cls}>
                {label}
              </button>
            ) : (
              // Toast (and Shopify's shop domain) connect in Settings → POS — reuse it, never duplicate it.
              <a key={p.providerId} data-provider={p.providerId} href={settingsHref} target="_blank" rel="noopener noreferrer" className={cls}>
                {label}
              </a>
            );
          })}
          <button type="button" onClick={props.onDecline} disabled={props.busy} className="px-2 py-1.5 text-[11px] font-bold text-slate-600 underline disabled:opacity-50">
            {t('noPos')}
          </button>
        </div>
        <p className="mt-1.5 text-[10px] leading-snug text-violet-700">{t('connectOpensTab')}</p>
        {connectError && (
          <p role="alert" className="mt-1 text-[11px] font-semibold text-rose-700">
            {connectError}{' '}
            <a href={settingsHref} target="_blank" rel="noopener noreferrer" className="underline">{t('openPosSettings')}</a>
          </p>
        )}
      </>,
    );
  }

  // view.kind === 'offer'
  const c = connection || view.connection;
  const current = ticked || [];
  const count = tickedItemCount(c.sections, current);
  const selection = buildPosSelection(c.id, current);
  const toggle = (name: string) =>
    setTicked((prev) => {
      const list = prev || [];
      return list.includes(name) ? list.filter((n) => n !== name) : [...list, name];
    });
  return shell(
    'emerald',
    <>
      <p className="flex items-center gap-1.5 text-xs font-bold text-emerald-900">
        <Store className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        {t('useMenuTitle', { provider: c.providerName, count: c.itemCount, sections: c.sections.length })}
      </p>
      {offerable.length > 1 && (
        <label className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-900">
          {t('switchConnection')}
          <select
            value={c.id}
            onChange={(e) => setConnectionId(e.target.value)}
            className="rounded border border-emerald-200 bg-white px-1.5 py-0.5 text-[11px]"
          >
            {offerable.map((o) => (
              <option key={o.id} value={o.id}>{o.displayName || o.providerName}</option>
            ))}
          </select>
        </label>
      )}
      <p className="mt-1 text-[11px] leading-snug text-emerald-800">{t('useMenuHint', { limit: rowLimit })}</p>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {c.sections.map((s) => {
          const on = current.includes(s.name);
          const tooBig = s.itemCount > rowLimit;
          const allowed = canTick(c.sections, current, s.name, rowLimit);
          return (
            <li key={s.name}>
              <label
                title={tooBig ? t('sectionTooBig') : undefined}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-semibold ${
                  on ? 'border-emerald-400 bg-white text-emerald-900' : 'border-slate-200 bg-white/70 text-slate-600'
                } ${!allowed ? 'opacity-50' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!allowed || props.busy}
                  onChange={() => toggle(s.name)}
                  className="h-3.5 w-3.5 accent-emerald-600"
                />
                {s.name}
                <span className="text-slate-400">{s.itemCount}</span>
                {tooBig && <span className="sr-only">{t('sectionTooBig')}</span>}
              </label>
            </li>
          );
        })}
      </ul>
      <p className="mt-1.5 text-[11px] font-semibold text-emerald-800" aria-live="polite">{t('tickedCount', { count, limit: rowLimit })}</p>
      <p className="mt-1 text-[11px] leading-snug text-emerald-700">{liveLine(c)}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!selection || props.busy}
          onClick={() => selection && props.onUse(selection, c.providerName, current)}
          className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 text-white disabled:opacity-50"
        >
          {t('useButton', { count })}
        </button>
        <button type="button" onClick={props.onDecline} disabled={props.busy} className="text-[11px] font-bold text-slate-600 underline disabled:opacity-50">
          {t('typeInstead')}
        </button>
      </div>
    </>,
  );
}
