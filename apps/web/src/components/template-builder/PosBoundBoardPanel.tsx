'use client';

/**
 * PosBoundBoardPanel — the builder's "Live menu" section for a POS-bound AI
 * board (POS-A, 2026-09-23).
 *
 * A kept POS-bound AI board is one EXTERNAL_HTML zone with its board inline
 * (`html`) and its rows bound by POS item id (`posItemBindings`
 * `{ 'item.N': externalId }`). Before this the section showed the name-join
 * picker ("matched by item name" — false for these boards) and a report that
 * could never load. It now says what is true, from two sources:
 *   • the board's own config — which POS, how many rows;
 *   • GET /templates/concierge/pos-bound-menu — the bound connection's menu for
 *     this location, graded with the SAME rule the screen paints with
 *     (lib/menu/pos-bound-coverage.ts): live / sold out right now / not on the
 *     menu now — each with what the screens show for it.
 * Live-update claims come from the provider's facts (posLiveFactsFor): how soon
 * a change reaches the screens, and whether sold-out items update on their own.
 * No polling: one read, refreshed when the operator comes back to the tab.
 *
 * PosSlotFieldChip is the same truth for one field: a bound row's name / price /
 * description is not a text box (a typed value would never reach a screen); it
 * says what the screens show and can unbind its row. It still activates the
 * field for the style bar, like any text field does.
 */
import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ExternalLink, Link2, Loader2, Unlink } from 'lucide-react';
import { getPosProvider, type ConciergePosBoundMenu } from '@cms/api-types';
import { apiFetch } from '@/lib/api-client';
import { bindingStateOf, parseMenuBindings, slotOfField, stripBindingTokens } from '@/lib/menu/resolve-menu-bindings';
import { boardRowNames, posBoundCoverage, type CoverageRow } from '@/lib/menu/pos-bound-coverage';
import { useBuilderStore } from './useBuilderStore';

type Cfg = Record<string, unknown>;
type SetField = (patch: Record<string, unknown>) => void;

/** The row slots an INLINE (AI) board is bound by. A packaged board (url) resolves its own. */
export function inlineBoardSlots(cfg: Cfg | null | undefined): Record<string, string> {
  const html = typeof cfg?.html === 'string' ? cfg.html.trim() : '';
  const url = typeof cfg?.url === 'string' ? cfg.url.trim() : '';
  if (!html || url) return {};
  return parseMenuBindings(cfg?.posItemBindings).slots;
}

function connectionIdOf(cfg: Cfg): string {
  return typeof cfg.posConnectionId === 'string' ? cfg.posConnectionId.trim() : '';
}

/** One read per connection; the panel and every field chip share it. */
function useBoundMenu(cfg: Cfg) {
  const connectionId = connectionIdOf(cfg);
  return useQuery<ConciergePosBoundMenu>({
    queryKey: ['pos-bound-menu', connectionId],
    queryFn: () => apiFetch<ConciergePosBoundMenu>(`/templates/concierge/pos-bound-menu?connectionId=${encodeURIComponent(connectionId)}`),
    enabled: !!connectionId,
    staleTime: 60_000,
    retry: false,
    // Back from Settings → POS (or the POS itself): show the new truth.
    refetchOnWindowFocus: true,
  });
}

function providerNameOf(cfg: Cfg, menu: ConciergePosBoundMenu | undefined, fallback: string): string {
  if (menu?.connection?.providerName) return menu.connection.providerName;
  const id = typeof cfg.posProvider === 'string' ? cfg.posProvider : '';
  return (id && (getPosProvider(id)?.name || id)) || fallback;
}

/** Unbind rows; every other binding on the board stays as saved. The last row off turns POS off. */
export function unbindRowsPatch(cfg: Cfg, slots: string[]): Record<string, unknown> {
  const raw = (cfg.posItemBindings && typeof cfg.posItemBindings === 'object' && !Array.isArray(cfg.posItemBindings))
    ? { ...(cfg.posItemBindings as Record<string, unknown>) }
    : {};
  for (const s of slots) delete raw[s];
  if (Object.keys(raw).length) return { posItemBindings: raw };
  return { posItemBindings: undefined, posSync: false, dataSource: 'NONE', posProvider: undefined, posConnectionId: undefined };
}

/** "Stop live updates": every binding off (rows, fields, any legacy token). */
export function stopLivePatch(cfg: Cfg): Record<string, unknown> {
  const patch: Record<string, unknown> = { posItemBindings: undefined, posSync: false, dataSource: 'NONE', posProvider: undefined, posConnectionId: undefined };
  const text = stripBindingTokens(cfg.textOverrides);
  if (text !== cfg.textOverrides) {
    patch.textOverrides = text && typeof text === 'object' && Object.keys(text as object).length ? text : undefined;
  }
  return patch;
}

type Tone = 'live' | 'checking' | 'attention' | 'neutral';

const DOT: Record<Tone, string> = {
  live: 'bg-emerald-500',
  checking: 'bg-slate-300',
  attention: 'bg-amber-500',
  neutral: 'bg-slate-400',
};

export function PosBoundBoardPanel({ cfg, setField }: { cfg: Cfg; setField: SetField }) {
  const t = useTranslations('posLiveMenu');
  const tc = useTranslations('conciergePos');
  const params = useParams<{ schoolId?: string | string[] }>();
  const schoolId = Array.isArray(params?.schoolId) ? params.schoolId[0] : params?.schoolId;
  const settingsHref = schoolId ? `/${schoolId}/settings/pos` : '/settings/pos';

  const slots = useMemo(() => inlineBoardSlots(cfg), [cfg]);
  const count = Object.keys(slots).length;
  const connectionId = connectionIdOf(cfg);
  const q = useBoundMenu(cfg);
  const menu = q.data;
  const provider = providerNameOf(cfg, menu, t('yourPos'));
  const html = typeof cfg.html === 'string' ? cfg.html : '';
  const names = useMemo(() => boardRowNames(html), [html]);
  const coverage = useMemo(
    () => (menu?.connection && menu.readable ? posBoundCoverage(slots, menu.items) : null),
    [menu, slots],
  );
  const [confirming, setConfirming] = useState(false);

  const nameOf = (r: CoverageRow) => r.item?.name || names[r.slot] || r.slot;
  const nameList = (rows: CoverageRow[]) => {
    const shown = rows.slice(0, 4).map(nameOf).join(', ');
    return rows.length > 4 ? `${shown} ${t('more', { count: rows.length - 4 })}` : shown;
  };

  let tone: Tone = 'neutral';
  let header = provider;
  const lines: Array<{ key: string; text: string; warn?: boolean; settings?: boolean }> = [];
  if (!connectionId) {
    lines.push({ key: 'no-conn', text: t('noConnectionSaved') });
  } else if (q.isLoading) {
    tone = 'checking';
    header = t('headerChecking', { provider });
  } else if (q.isError || !menu) {
    tone = 'neutral';
    lines.push({ key: 'check-failed', text: t('checkFailed', { provider }) });
  } else if (!menu.connection) {
    tone = 'attention';
    header = t('headerDisconnected');
    lines.push({ key: 'gone', text: t('connectionGone', { provider }), warn: true, settings: true });
  } else if (menu.connection.status !== 'ACTIVE') {
    tone = 'attention';
    header = t('headerAttention', { provider });
    lines.push({ key: 'attention', text: t('connectionAttention', { provider, status: menu.connection.status }), warn: true, settings: true });
  } else if (!menu.readable) {
    tone = 'attention';
    header = t('headerAttention', { provider });
    lines.push({ key: 'unreadable', text: t('unreadable', { provider }), warn: true });
  } else if (coverage) {
    tone = 'live';
    header = t('headerLive', { provider });
    if (!coverage.soldOut.length && !coverage.missing.length) {
      lines.push({ key: 'all', text: t('allOnMenu', { count, provider }) });
    }
    if (coverage.soldOut.length) {
      lines.push({ key: 'sold', text: t('soldOutNow', { count: coverage.soldOut.length, names: nameList(coverage.soldOut) }), warn: true });
    }
    if (coverage.missing.length) {
      lines.push({ key: 'missing', text: t('missingNow', { count: coverage.missing.length, provider, names: nameList(coverage.missing) }), warn: true });
      lines.push({ key: 'missing-hint', text: t('missingHint', { provider }) });
    }
  }

  const live = menu?.connection && menu.connection.status === 'ACTIVE' ? menu.connection.live : null;
  const cadence = live
    ? ({
        'publish-5min': t('cadencePublish', { provider }),
        webhook: t('cadenceWebhook'),
        hourly: t('cadenceHourly', { provider }),
        push: t('cadencePush'),
      } as Record<string, string>)[live.cadence]
    : null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 space-y-2" data-testid="pos-bound-board-panel">
      <div className="flex items-center gap-2">
        <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${DOT[tone]}`} aria-hidden="true" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">{header}</span>
        {tone === 'checking' && <Loader2 className="w-3 h-3 animate-spin text-slate-400" aria-hidden="true" />}
      </div>
      <div className="text-[12px] font-semibold text-slate-800">{t('boundTitle', { provider, count })}</div>

      {lines.map((l) => (
        <p key={l.key} className={`text-[11px] leading-snug ${l.warn ? 'text-amber-800' : 'text-slate-600'}`}>
          {l.text}
          {l.settings && (
            <>
              {' '}
              <a href={settingsHref} className="font-semibold underline inline-flex items-center gap-0.5">
                {t('openPosSettings')} <ExternalLink className="w-2.5 h-2.5" aria-hidden="true" />
              </a>
            </>
          )}
        </p>
      ))}

      {live && (
        <div className="text-[10px] leading-snug text-slate-500 space-y-0.5">
          {cadence && <p>{cadence}</p>}
          <p>{live.soldOut ? tc('liveSoldOut') : tc('liveNoSoldOut', { provider })}</p>
        </div>
      )}

      {coverage && coverage.rows.length > 0 && (
        <details className="text-[11px] text-slate-700">
          <summary className="cursor-pointer select-none text-[10px] font-semibold text-indigo-600">
            {t('showRows', { count: coverage.rows.length })}
          </summary>
          <ol className="mt-1.5 space-y-0.5">
            {coverage.rows.map((r) => (
              <li key={r.slot} className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate">
                  {r.row != null ? `${Number(r.row) + 1}. ` : ''}{nameOf(r)}{r.item ? ` · ${r.item.price}` : ''}
                </span>
                <span
                  className={`shrink-0 text-[9px] font-bold uppercase tracking-wide ${
                    r.state === 'live' ? 'text-emerald-600' : 'text-amber-700'
                  }`}
                >
                  {r.state === 'live' ? t('rowLive') : r.state === 'soldout' ? t('rowSoldOut') : t('rowMissing')}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-[10px] font-semibold text-slate-500 hover:text-rose-600 underline"
        >
          {t('stopLive')}
        </button>
      ) : (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 space-y-1.5">
          <p className="text-[11px] leading-snug text-rose-800">{t('stopConfirm', { provider })}</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { setConfirming(false); setField(stopLivePatch(cfg)); }}
              className="px-2 py-1 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold"
            >
              {t('stopYes')}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="px-2 py-1 rounded-md bg-white border border-slate-200 text-slate-600 text-[10px] font-semibold"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A field in a bound row: what the screens show for it, and "unbind this row".
 * Focusing it activates the field for the style bar, exactly like a text field.
 */
export function PosSlotFieldChip({ cfg, setField, fieldKey, label }: {
  cfg: Cfg;
  setField: SetField;
  fieldKey: string;
  label: string;
}) {
  const t = useTranslations('posLiveMenu');
  const ref = slotOfField(fieldKey);
  const slots = inlineBoardSlots(cfg);
  const externalId = ref ? slots[ref.slot] : undefined;
  const q = useBoundMenu(cfg);
  const provider = providerNameOf(cfg, q.data, t('yourPos'));
  const readable = !!q.data?.connection && q.data.readable;
  const item = readable ? q.data!.items.find((i) => i.externalId === externalId) : undefined;
  const state = readable ? bindingStateOf(item) : null;

  let detail = '';
  if (state === 'missing') detail = t('fieldMissing', { provider });
  else if (state === 'soldout' && ref?.leaf === 'price') detail = t('fieldSoldOut');
  else if (item && ref?.leaf === 'price') detail = t('fieldLiveValue', { value: item.price });
  else if (item && ref?.leaf === 'name') detail = t('fieldLiveValue', { value: item.name });

  const setActiveFieldName = useBuilderStore((s) => s.setActiveFieldName);
  const selectedIds = useBuilderStore((s) => s.selectedIds);
  const activate = () => {
    setActiveFieldName(fieldKey);
    const zoneId = selectedIds[0];
    if (zoneId && typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new CustomEvent('template-edit-field', { detail: { zoneId, fieldKey } }));
      } catch { /* CustomEvent unsupported in older runtimes */ }
    }
  };

  if (!ref || !externalId) return null;
  return (
    <div
      className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5"
      data-testid="pos-slot-field-chip"
      onFocusCapture={activate}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 flex items-center gap-1">
            <Link2 className="w-3 h-3" aria-hidden="true" /> {label}
          </div>
          <div className={`text-[11px] leading-snug ${state === 'missing' ? 'text-amber-800' : 'text-emerald-800'}`}>
            {t('fieldLive', { provider })}{detail ? ` · ${detail}` : ''}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setField(unbindRowsPatch(cfg, [ref.slot]))}
          title={t('unbindRowTitle', { provider })}
          aria-label={t('unbindRow')}
          className="inline-flex items-center justify-center w-6 h-6 rounded text-emerald-700 hover:text-rose-600 hover:bg-white transition-colors shrink-0"
        >
          <Unlink className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
