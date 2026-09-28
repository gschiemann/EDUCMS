'use client';

/**
 * Website Tabs — the ONE panel (2026-09-28).
 *
 * Greg: "a touch template where they can easily just enter multiple URLs,
 * publish it and then easily navigate to them… make it dumb simple." The
 * 30-second happy path is: paste a URL, press Enter. The tab names itself,
 * finds its own icon and reports whether it will show — "✓ Loads",
 * "Needs our app — this site blocks embedding", or "Can't reach this site" —
 * through `POST /api/v1/proxy/site-check` (SSRF-guarded, authenticated). No
 * competitor in the research does the name + icon + verdict from one paste.
 *
 * Everything else is a sensible default the operator can leave alone: tab
 * bar on top, a Home button, back to the first site after 2 minutes idle with
 * a 10-second "Still there?" warning, and "Sign out after idle" ON — explained
 * in plain words, because it is the one switch with a real consequence
 * (a public kiosk must wipe the previous visitor's login; a staff dashboard
 * must not be signed out every two minutes).
 *
 * Mounted by PropertiesPanel's `case 'WEBSITE_TABS'`. Reads and writes the
 * zone's `defaultConfig` through `setField`, exactly like every other editor.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS as DndCSS } from '@dnd-kit/utilities';
import { GripVertical, Loader2, RefreshCw, X as XIcon } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import {
  WEBSITE_TABS_MAX,
  normalizeTabUrl,
  normalizeWebsiteTabsConfig,
  tabHost,
  tabInitials,
  type TabEmbed,
  type WebsiteTab,
} from '@/components/widgets/website-tabs-config';

/** What `POST /proxy/site-check` answers (apps/api/src/proxy/site-check.ts). */
interface SiteCheckResult {
  ok: boolean;
  url: string;
  finalUrl: string | null;
  name: string | null;
  iconUrl: string | null;
  embed: 'ok' | 'blocked' | 'unreachable';
  reason: string | null;
}

let localSeq = 0;
function newTabId(): string {
  localSeq += 1;
  return `tab-${Date.now().toString(36)}-${localSeq}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Ask the API about one URL. Never throws — a failed call is "unreachable". */
async function checkOne(url: string): Promise<SiteCheckResult | null> {
  try {
    const r = await apiFetch<SiteCheckResult>('/proxy/site-check', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
    return r && typeof r === 'object' ? r : null;
  } catch {
    return null;
  }
}

function StatusChip({ embed, checking, t }: { embed: TabEmbed; checking: boolean; t: (k: string) => string }) {
  if (checking) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500" data-testid="wt-status" data-embed="checking">
        <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> {t('statusChecking')}
      </span>
    );
  }
  const cls =
    embed === 'ok'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : embed === 'blocked'
        ? 'bg-amber-50 text-amber-800 border-amber-200'
        : embed === 'unreachable'
          ? 'bg-rose-50 text-rose-700 border-rose-200'
          : 'bg-slate-50 text-slate-500 border-slate-200';
  const label =
    embed === 'ok' ? t('statusOk') : embed === 'blocked' ? t('statusBlocked') : embed === 'unreachable' ? t('statusUnreachable') : t('statusUnknown');
  return (
    <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded border ${cls}`} data-testid="wt-status" data-embed={embed}>
      {label}
    </span>
  );
}

function TabRow({
  tab,
  index,
  count,
  checking,
  t,
  onRename,
  onRemove,
  onRecheck,
  onMove,
  onSignIn,
}: {
  tab: WebsiteTab;
  index: number;
  count: number;
  checking: boolean;
  t: (k: string, v?: Record<string, string | number>) => string;
  onRename: (name: string) => void;
  onRemove: () => void;
  onRecheck: () => void;
  onMove: (dir: -1 | 1) => void;
  onSignIn: (v: 'none' | 'once') => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id });
  const style = { transform: DndCSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  const [iconBroken, setIconBroken] = useState(false);
  return (
    <div ref={setNodeRef} style={style} className="bg-white border border-slate-200 rounded-lg p-2 shadow-sm" data-testid={`wt-row-${tab.id}`}>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={t('dragHandle')}
          className="w-6 h-6 shrink-0 rounded text-slate-400 hover:text-indigo-600 flex items-center justify-center cursor-grab active:cursor-grabbing"
        >
          <GripVertical className="w-3.5 h-3.5" aria-hidden />
        </button>
        <span className="w-6 h-6 shrink-0 rounded bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden text-[10px] font-bold text-slate-600" aria-hidden>
          {tab.iconUrl && !iconBroken ? (
            // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/no-noninteractive-element-interactions -- onError is the initials fallback's only signal
            <img src={tab.iconUrl} alt="" className="w-full h-full object-contain" onError={() => setIconBroken(true)} />
          ) : (
            tabInitials(tab.name)
          )}
        </span>
        <input
          type="text"
          value={tab.name}
          onChange={(e) => onRename(e.target.value)}
          aria-label={t('nameLabel')}
          className="flex-1 min-w-0 px-2 py-1 text-xs font-semibold rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
        <button type="button" onClick={() => onMove(-1)} disabled={index === 0} aria-label={t('moveUp')} className="w-6 h-6 shrink-0 rounded border border-slate-200 text-slate-400 hover:text-indigo-600 disabled:opacity-30 flex items-center justify-center text-[11px]">↑</button>
        <button type="button" onClick={() => onMove(1)} disabled={index === count - 1} aria-label={t('moveDown')} className="w-6 h-6 shrink-0 rounded border border-slate-200 text-slate-400 hover:text-indigo-600 disabled:opacity-30 flex items-center justify-center text-[11px]">↓</button>
        <button type="button" onClick={onRemove} aria-label={`${t('remove')} ${tab.name}`} className="w-6 h-6 shrink-0 rounded border border-slate-200 text-slate-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 flex items-center justify-center">
          <XIcon className="w-3 h-3" aria-hidden />
        </button>
      </div>
      <div className="pl-8 mt-1.5 flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-slate-400 truncate max-w-[60%]" title={tab.url}>
          {tabHost(tab.url) || tab.url}
        </span>
        <StatusChip embed={tab.embed ?? 'unknown'} checking={checking} t={t} />
        <button type="button" onClick={onRecheck} disabled={checking} aria-label={`${t('checkAgain')} ${tab.name}`} className="inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-indigo-600 disabled:opacity-40">
          <RefreshCw className="w-3 h-3" aria-hidden /> {t('checkAgain')}
        </button>
      </div>
      {tab.embed === 'blocked' && !checking && <p className="pl-8 mt-1 text-[10px] text-amber-800">{t('blockedHint')}</p>}
      <label className="pl-8 mt-1.5 flex items-center gap-2 text-[10px] text-slate-500">
        <span className="font-semibold">{t('signInLabel')}</span>
        <select
          value={tab.signIn === 'once' ? 'once' : 'none'}
          onChange={(e) => onSignIn(e.target.value === 'once' ? 'once' : 'none')}
          aria-label={`${t('signInLabel')} — ${tab.name}`}
          className="flex-1 min-w-0 px-1.5 py-0.5 text-[11px] rounded border border-slate-200 bg-white"
        >
          <option value="none">{t('signInNone')}</option>
          <option value="once">{t('signInOnce')}</option>
        </select>
      </label>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-semibold text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

function Toggle({ label, value, onChange, testId }: { label: string; value: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return (
    <label className="flex items-center justify-between gap-2 cursor-pointer">
      <span className="text-[10px] font-semibold text-slate-500">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        data-testid={testId}
        onClick={() => onChange(!value)}
        className={`relative w-9 h-5 rounded-full transition-colors ${value ? 'bg-indigo-600' : 'bg-slate-200'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${value ? 'translate-x-4' : ''}`} />
      </button>
    </label>
  );
}

function ColourRow({ label, value, onChange, brandLabel }: { label: string; value: string | undefined; onChange: (v: string | undefined) => void; brandLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] font-semibold text-slate-500">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#0f172a'}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          className="w-7 h-6 p-0 border border-slate-200 rounded cursor-pointer"
        />
        <button
          type="button"
          onClick={() => onChange(undefined)}
          disabled={!value}
          className="text-[10px] text-slate-400 hover:text-indigo-600 disabled:opacity-40"
        >
          {brandLabel}
        </button>
      </div>
    </div>
  );
}

const SECTION = 'pt-3 pb-1 px-1 text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200';

export function WebsiteTabsEditor({ cfg, setField }: { cfg: Record<string, unknown>; setField: (patch: Record<string, unknown>) => void }) {
  const t = useTranslations('websiteTabs');
  const norm = normalizeWebsiteTabsConfig(cfg);
  const tabs = norm.tabs;

  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState<Record<string, boolean>>({});
  // The latest tabs, for async completions (a check resolves after the
  // operator may have renamed or reordered).
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const setFieldRef = useRef(setField);
  setFieldRef.current = setField;

  const writeTabs = useCallback((next: WebsiteTab[]) => {
    setFieldRef.current({ tabs: next });
  }, []);

  const patchTab = useCallback(
    (id: string, patch: Partial<WebsiteTab>) => {
      writeTabs(tabsRef.current.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    },
    [writeTabs],
  );

  const runCheck = useCallback(
    async (id: string, url: string, keepName: boolean) => {
      setChecking((m) => ({ ...m, [id]: true }));
      const r = await checkOne(url);
      setChecking((m) => {
        const n = { ...m };
        delete n[id];
        return n;
      });
      const current = tabsRef.current.find((x) => x.id === id);
      if (!current) return; // removed while checking
      if (!r) {
        patchTab(id, { embed: 'unreachable' });
        return;
      }
      const patch: Partial<WebsiteTab> = { embed: r.embed };
      if (r.iconUrl && normalizeTabUrl(r.iconUrl)) patch.iconUrl = r.iconUrl;
      // A redirect to ANOTHER host (a short link, a vendor portal) becomes the
      // stored URL: what the check judged is what the screen loads, and the
      // native allowlist is built from the stored host. A same-host redirect
      // (http→https, www.) keeps the operator's pasted form.
      const finalUrl = r.finalUrl ? normalizeTabUrl(r.finalUrl) : null;
      if (finalUrl && tabHost(finalUrl) && tabHost(finalUrl) !== tabHost(current.url)) patch.url = finalUrl;
      // Only auto-name a tab the operator has not renamed (still the host).
      const autoName = tabHost(current.url) || '';
      if (!keepName || current.name === autoName) {
        if (r.name) patch.name = r.name.slice(0, 40);
      }
      patchTab(id, patch);
    },
    [patchTab],
  );

  const add = useCallback(() => {
    const url = normalizeTabUrl(draft);
    if (!url) {
      setError(t('invalidUrl'));
      return;
    }
    if (tabs.length >= WEBSITE_TABS_MAX) {
      setError(t('maxReached', { max: WEBSITE_TABS_MAX }));
      return;
    }
    if (tabs.some((x) => x.url === url)) {
      setError(t('duplicate'));
      return;
    }
    setError(null);
    const id = newTabId();
    const tab: WebsiteTab = { id, name: tabHost(url) || url, url, embed: 'unknown', signIn: 'none' };
    writeTabs([...tabs, tab]);
    setDraft('');
    void runCheck(id, url, false);
  }, [draft, tabs, t, writeTabs, runCheck]);

  // Tabs that were never checked (a preset's samples, a hand-edited JSON)
  // are checked once when the panel opens — sequentially, so a long list
  // does not burst the rate limit.
  const autoCheckedRef = useRef(false);
  useEffect(() => {
    if (autoCheckedRef.current) return;
    autoCheckedRef.current = true;
    const pending = tabs.filter((x) => (x.embed ?? 'unknown') === 'unknown');
    if (!pending.length) return;
    let cancelled = false;
    (async () => {
      for (const x of pending) {
        if (cancelled) return;
        await runCheck(x.id, x.url, true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Once per mount, by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastIdleRef = useRef(norm.idleReturnSec > 0 ? norm.idleReturnSec : 120);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = tabs.findIndex((x) => x.id === active.id);
    const to = tabs.findIndex((x) => x.id === over.id);
    if (from === -1 || to === -1) return;
    writeTabs(arrayMove(tabs, from, to));
  };

  const onDraftKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  };

  // "Go back to the first site" is an on/off choice; "After" is how long.
  // A value that is not in the list (set elsewhere) is shown as itself,
  // never silently as 2 minutes.
  const idleOn = norm.idleReturnSec > 0;
  const idleSteps = [30, 60, 120, 180, 300, 600, 900, 1800, 3600];
  const idleChoices = idleOn && !idleSteps.includes(norm.idleReturnSec) ? [...idleSteps, norm.idleReturnSec].sort((a, b) => a - b) : idleSteps;
  const idleLabel = (sec: number) => (sec < 60 ? t('idleSec', { n: sec }) : t('idleMin', { n: Math.round(sec / 60) }));

  return (
    <div className="space-y-3" data-testid="website-tabs-editor">
      <div className={SECTION}>{t('sectionSites')}</div>
      <Row label={t('pasteLabel')}>
        <div className="flex items-center gap-1.5">
          <input
            type="url"
            inputMode="url"
            autoComplete="off"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={onDraftKey}
            placeholder={t('pastePlaceholder')}
            aria-label={t('pasteLabel')}
            data-testid="wt-paste"
            className="flex-1 min-w-0 px-2 py-1.5 text-xs rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <button
            type="button"
            onClick={add}
            data-testid="wt-add"
            className="shrink-0 px-3 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded"
          >
            {t('add')}
          </button>
        </div>
        {error && (
          <p className="mt-1 text-[10px] text-rose-600" role="alert">
            {error}
          </p>
        )}
      </Row>
      {tabs.length === 0 && <p className="text-[11px] text-slate-400 italic px-1">{t('emptyHint')}</p>}
      {tabs.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={tabs.map((x) => x.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {tabs.map((x, i) => (
                <TabRow
                  key={x.id}
                  tab={x}
                  index={i}
                  count={tabs.length}
                  checking={!!checking[x.id]}
                  t={t}
                  onRename={(name) => patchTab(x.id, { name: name.slice(0, 40) })}
                  onRemove={() => writeTabs(tabs.filter((y) => y.id !== x.id))}
                  onRecheck={() => void runCheck(x.id, x.url, true)}
                  onMove={(dir) => {
                    const j = i + dir;
                    if (j < 0 || j >= tabs.length) return;
                    writeTabs(arrayMove(tabs, i, j));
                  }}
                  onSignIn={(v) => patchTab(x.id, { signIn: v })}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      <p className="text-[10px] text-slate-400 px-0.5">{t('appOnlyNote')}</p>

      <div className={SECTION}>{t('sectionLayout')}</div>
      <Row label={t('barPosition')}>
        <select
          value={norm.barPosition}
          onChange={(e) => setField({ barPosition: e.target.value === 'bottom' ? 'bottom' : 'top' })}
          aria-label={t('barPosition')}
          data-testid="wt-bar-position"
          className="w-full px-2 py-1 text-xs rounded border border-slate-200 bg-white"
        >
          <option value="top">{t('barTop')}</option>
          <option value="bottom">{t('barBottom')}</option>
        </select>
      </Row>
      <Toggle label={t('showHome')} value={norm.showHome} onChange={(v) => setField({ showHome: v })} testId="wt-show-home" />

      <div className={SECTION}>{t('sectionIdle')}</div>
      <Toggle
        label={t('idleToggle')}
        value={idleOn}
        onChange={(v) => setField({ idleReturnSec: v ? lastIdleRef.current : 0 })}
        testId="wt-idle-on"
      />
      {idleOn && (
        <>
          <Row label={t('idleReturn')}>
            <select
              value={String(norm.idleReturnSec)}
              onChange={(e) => {
                const sec = Number(e.target.value);
                lastIdleRef.current = sec;
                setField({ idleReturnSec: sec });
              }}
              aria-label={t('idleReturn')}
              data-testid="wt-idle"
              className="w-full px-2 py-1 text-xs rounded border border-slate-200 bg-white"
            >
              {idleChoices.map((sec) => (
                <option key={sec} value={String(sec)}>
                  {idleLabel(sec)}
                </option>
              ))}
            </select>
          </Row>
          <p className="text-[10px] text-slate-400 px-0.5">{t('idleWarnNote')}</p>
        </>
      )}
      <Toggle label={t('incognito')} value={norm.incognito} onChange={(v) => setField({ incognito: v })} testId="wt-incognito" />
      <p className="text-[10px] text-slate-500 px-0.5" data-testid="wt-incognito-help">
        {norm.incognito ? t('incognitoOn') : t('incognitoOff')}
      </p>
      <p className="text-[10px] text-slate-400 px-0.5">{t('signInHelp')}</p>

      <div className={SECTION}>{t('sectionColors')}</div>
      <ColourRow label={t('barColor')} value={norm.barColor} onChange={(v) => setField({ barColor: v ?? '' })} brandLabel={t('useBrand')} />
      <ColourRow label={t('activeColor')} value={norm.activeColor} onChange={(v) => setField({ activeColor: v ?? '' })} brandLabel={t('useBrand')} />
      <ColourRow label={t('textColor')} value={norm.textColor} onChange={(v) => setField({ textColor: v ?? '' })} brandLabel={t('useBrand')} />
      <p className="text-[10px] text-slate-400 px-0.5">{t('brandDefault')}</p>

      <Row label={t('language')}>
        <select
          value={norm.lang ?? ''}
          onChange={(e) => setField({ lang: e.target.value || '' })}
          aria-label={t('language')}
          className="w-full px-2 py-1 text-xs rounded border border-slate-200 bg-white"
        >
          <option value="">{t('langAuto')}</option>
          <option value="en">English</option>
          <option value="es">Español</option>
          <option value="zh">中文</option>
        </select>
      </Row>
    </div>
  );
}
