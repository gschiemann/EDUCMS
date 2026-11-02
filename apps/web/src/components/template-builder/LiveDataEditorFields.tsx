"use client";
import { useEffect, useState } from 'react';
import React from 'react';
import { INTEGRATION_GATED_WIDGETS } from '../widgets/widget-discovery';
import { DEFAULT_CRYPTO_COINS, DEFAULT_STOCK_SYMBOLS } from '../widgets/data-widget-meta';
import { fetchLiveDataStatus, fetchScoreLeagues, type LiveDataStatus, type ScoreLeague } from '@/lib/live-data/live-data-client';
import { SelectField, TextField } from './field-controls';

/** Builder-only status of the paid data families; `null` until known. */
function useLiveDataStatusOnce(): LiveDataStatus | null {
  const [status, setStatus] = useState<LiveDataStatus | null>(null);
  useEffect(() => { let off = false; void fetchLiveDataStatus().then(s => { if (!off) setStatus(s); }); return () => { off = true; }; }, []);
  return status;
}

const LIVE_FAMILY_FOR: Record<string, 'stocks' | 'crypto' | 'flights' | 'scores'> = INTEGRATION_GATED_WIDGETS;

export function LiveDataSourceFields({ variant, cfg, automatic, setField }: { variant: string; cfg: any; automatic: boolean; setField: (patch: Record<string, any>) => void }) {
  const status = useLiveDataStatusOnce();
  const family = LIVE_FAMILY_FOR[variant];
  const fam = status?.[family];
  const [leagues, setLeagues] = useState<ScoreLeague[]>([]);
  useEffect(() => { if (variant === 'sports-scoreboard' && fam?.enabled) void fetchScoreLeagues().then(setLeagues); }, [variant, fam?.enabled]);
  const source = fam?.source || '';
  // Dormant (or not yet known) on this deploy: the existing manual editor is
  // the whole story. Say why only to someone who chose Automatic.
  if (!fam?.enabled) {
    return cfg.dataMode === 'automatic' && fam
      ? <p className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">Live data for this board is not set up on this deploy. Ask your administrator to add <code>{fam.missing.join(', ')}</code>. Until then the board shows what you enter. <button type="button" className="underline" onClick={() => setField({ dataMode: 'manual' })}>Enter my own values</button></p>
      : null;
  }
  const out: React.ReactNode[] = [];
  out.push(<SelectField key="mode" label="Data" value={automatic ? 'automatic' : 'manual'} options={[["automatic", source ? `Automatic · ${source}` : 'Automatic'], ["manual", "Enter my own values"]]} onChange={v => setField({ dataMode: v })} />);
  if (automatic) {
    if (variant === 'stock-ticker') out.push(<TextField key="symbols" label="Ticker symbols (up to 8, comma-separated)" value={cfg.symbolList ?? DEFAULT_STOCK_SYMBOLS} placeholder={DEFAULT_STOCK_SYMBOLS} onChange={v => setField({ symbolList: v.toUpperCase().replace(/[^A-Z0-9.,\s-]/g, '').slice(0, 90) })} />);
    if (variant === 'crypto-ticker') {
      out.push(<TextField key="coins" label="Coins (names or symbols, up to 8)" value={cfg.coinList ?? DEFAULT_CRYPTO_COINS} placeholder={DEFAULT_CRYPTO_COINS} onChange={v => setField({ coinList: v.toLowerCase().replace(/[^a-z0-9,\s-]/g, '').slice(0, 200) })} />);
      out.push(<SelectField key="currency" label="Currency" value={cfg.currency || 'usd'} options={[["usd","US dollar"],["eur","Euro"],["gbp","Pound sterling"],["cad","Canadian dollar"]]} onChange={v => setField({ currency: v })} />);
    }
    if (variant === 'departures-board') {
      out.push(<TextField key="airport" label="Airport code" value={cfg.airportCode || ''} placeholder="SFO" onChange={v => setField({ airportCode: v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) })} />);
      out.push(<SelectField key="direction" label="Show" value={cfg.direction === 'arrivals' ? 'arrivals' : 'departures'} options={[["departures","Departures"],["arrivals","Arrivals"]]} onChange={v => setField({ direction: v })} />);
    }
    if (variant === 'sports-scoreboard') {
      out.push(<SelectField key="league" label="League" value={cfg.leagueId || ''} options={[["", leagues.length ? 'Choose a league' : 'Loading leagues…'], ...leagues.map(l => [l.id, l.name] as [string, string])]} onChange={v => setField({ leagueId: v })} />);
      out.push(<TextField key="team" label="Only games with (optional team name)" value={cfg.teamFilter || ''} placeholder="e.g. Chicago" onChange={v => setField({ teamFilter: v.slice(0, 40) })} />);
    }
    if (variant === 'stock-ticker' || variant === 'crypto-ticker') out.push(<p key="colors-help" className="text-xs text-slate-500">Rising and falling values use green and red; background, text colour and font follow the Style section.</p>);
  }
  return <>{out}</>;
}
