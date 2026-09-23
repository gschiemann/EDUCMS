'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/api-client';

type Connection = { id: string; providerId: string; status: string; displayName?: string };
type Item = { externalId: string; name: string; category?: string; priceCents: number };
const SLOTS: Record<string, string[]> = {
  '25-super-taco-tacos': ['3 Birria Tacos w/ consome', '3 Quesabirrias w/ consome', '3 Street Asada Tacos', '3 Street Grilled Chicken Tacos', 'Carnitas Super Taco', 'Fish Taco'],
  '26-super-taco-burritos': ['Asada Super Burrito', 'Grilled Chicken Super Burrito', 'Steak California Burrito', 'Shredded Chicken Super Nachos', 'Steak Quesadilla', 'Agua Fresca Large'],
  '27-super-taco-combos': ['#1 Shredded Chicken Tacos', '#2 Cheese Enchiladas', '#12 Shredded Chicken Super Taco'],
};
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export function ToastItemBindingsPanel({ cfg, setField, url }: {
  cfg: Record<string, unknown>;
  setField: (patch: Record<string, unknown>) => void;
  url: string;
}) {
  const t = useTranslations('toastBindings');
  const params = useParams<{ schoolId: string }>();
  const board = Object.keys(SLOTS).find((key) => url.includes(key)) || '';
  const seeds = SLOTS[board] || [];
  const isCombo = board.includes('combos');
  const connectionsQ = useQuery<Connection[]>({ queryKey: ['pos-connections'], queryFn: () => apiFetch<Connection[]>('/pos/connections'), staleTime: 60_000, retry: false });
  const connections = (connectionsQ.data || []).filter((connection) => connection.providerId === 'toast' && connection.status === 'ACTIVE');
  const savedConnection = typeof cfg.posConnectionId === 'string' ? cfg.posConnectionId : '';
  const selectedConnection = connections.some((connection) => connection.id === savedConnection)
    ? savedConnection : connections.length === 1 ? connections[0].id : '';
  const itemsQ = useQuery<Item[]>({
    queryKey: ['toast-items', selectedConnection],
    queryFn: () => apiFetch<Item[]>(`/pos/items?connectionId=${encodeURIComponent(selectedConnection)}`),
    enabled: !!selectedConnection,
    staleTime: 30_000,
    retry: false,
  });
  const items = itemsQ.data || [];
  const bindings = (cfg.posItemBindings && typeof cfg.posItemBindings === 'object' ? cfg.posItemBindings : {}) as Record<string, string>;

  useEffect(() => {
    if (connections.length === 1 && (savedConnection !== selectedConnection || cfg.posProvider !== 'toast' || cfg.posSync !== true)) {
      setField({ posConnectionId: selectedConnection, posProvider: 'toast', posSync: true, dataSource: 'POS' });
    }
  }, [connections.length, selectedConnection, savedConnection, cfg.posProvider, cfg.posSync, setField]);

  if (!seeds.length) return null;
  // 2026-09-23 (POS-A) — the intro used to say "availability … comes from
  // Toast". Toast reports no sold-out items (POS_LIVE_FACTS); an 86 in the Menu
  // console is what takes a dish off this wall. Strings are en/es/zh now.
  return <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2 text-xs text-slate-800">
    <div className="font-bold text-sm">{t('title')}</div>
    <p>{t('intro')}</p>
    {!connections.length && <a className="font-bold text-amber-800 underline" href={`/${params?.schoolId || ''}/settings/pos`}>{t('connect')}</a>}
    {connections.length > 1 && <label className="block font-semibold">{t('connectionLabel')}
      <select className="mt-1 block w-full rounded border border-slate-300 bg-white p-2" value={selectedConnection} onChange={(event) => setField({ posConnectionId: event.target.value || undefined, posProvider: 'toast', posSync: true, dataSource: 'POS' })}>
        <option value="">{t('chooseConnection')}</option>
        {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.displayName || t('connectionLabel')}</option>)}
      </select>
    </label>}
    {selectedConnection && itemsQ.isLoading && <p>{t('loading')}</p>}
    {selectedConnection && itemsQ.isError && <p className="text-rose-700">{t('loadFailed')}</p>}
    {selectedConnection && itemsQ.isSuccess && !items.length && <p>{t('empty')}</p>}
    {selectedConnection && items.length > 0 && seeds.map((seed, index) => {
      const key = `${isCombo ? 'combo' : 'item'}.${index}`;
      const automatic = items.find((item) => normalize(item.name) === normalize(seed));
      const bound = bindings[key];
      const missing = !!bound && !items.some((item) => item.externalId === bound);
      return <label key={key} className="block rounded-md border border-amber-100 bg-white p-2">
        <span className="mb-1 block font-semibold">{index + 1}. {seed}</span>
        <select className="block w-full rounded border border-slate-300 bg-white p-2 text-xs" value={bound || ''} onChange={(event) => setField({ posItemBindings: { ...bindings, [key]: event.target.value || undefined } })}>
          <option value="">{automatic ? t('automaticMatch', { name: automatic.name }) : t('automaticNext')}</option>
          {missing && <option value={bound}>{t('missingOption')}</option>}
          {items.map((item) => <option key={`${item.externalId}-${item.name}`} value={item.externalId}>{item.name} · {item.category || t('menuFallback')} · ${(item.priceCents / 100).toFixed(2)}</option>)}
        </select>
        {missing && <span className="mt-1 block text-rose-700">{t('missingNote')}</span>}
      </label>;
    })}
  </div>;
}
