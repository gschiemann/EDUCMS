/**
 * AiKeyCard — settings card for BYOK AI integration.
 *
 * 2026-05-04. Operator: "let the end user just type in their
 * credentials of their AI of choice and then use their account."
 *
 * Three states:
 *   - Not configured + platform fallback available — "AI works on
 *     our trial key. Add your own to remove the cap and route
 *     usage to your account."
 *   - Not configured + no platform fallback — "AI is unavailable.
 *     Add your provider key to enable the sparkle button."
 *   - Configured — show provider + masked key + when/by whom.
 *     "Replace" or "Disconnect."
 *
 * Provider options for v1: Anthropic, OpenAI. Adding more is a
 * three-line change in apps/api/src/ai/ai-providers.ts.
 *
 * Test-before-save: the backend POST /ai/key endpoint fires a tiny
 * test generation BEFORE persisting. If the key is wrong the operator
 * sees a clean error here and the bad key never touches the DB.
 */
'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { appConfirm } from '@/components/ui/app-dialog';
import { Sparkles, Key, Loader2, Check, AlertCircle, Trash2, Eye, EyeOff } from 'lucide-react';

type ProviderId = 'anthropic' | 'openai' | 'google';

interface AiKeyStatus {
  configured: boolean;
  provider: ProviderId | null;
  model: string | null;
  keyMask: string | null;
  setAt: string | null;
  setByUserId: string | null;
  platformFallbackAvailable: boolean;
}

interface AiModelInfo {
  id: string;
  label: string;
  tagline: string;
  inputPer1M: number;
  outputPer1M: number;
  estCostPerCallUsd: number;
  default?: boolean;
}
interface AiProviderInfo {
  id: ProviderId;
  label: string;
  description: string;
  getKeyUrl: string;
  models: AiModelInfo[];
}

function formatPerCallCost(usd: number): string {
  if (usd <= 0) return '—';
  if (usd < 0.001) return `< $0.001 / generation`;
  if (usd < 0.01) return `~$${usd.toFixed(4)} / generation`;
  return `~$${usd.toFixed(3)} / generation`;
}

export function AiKeyCard() {
  const [status, setStatus] = useState<AiKeyStatus | null>(null);
  const [catalog, setCatalog] = useState<AiProviderInfo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState<ProviderId>('anthropic');
  const [model, setModel] = useState<string>('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const currentProviderInfo = catalog?.find((p) => p.id === provider);
  const currentModelInfo = currentProviderInfo?.models.find((m) => m.id === model);

  const load = async () => {
    setLoading(true);
    try {
      const [s, c] = await Promise.all([
        apiFetch<AiKeyStatus>('/ai/key'),
        apiFetch<{ providers: AiProviderInfo[] }>('/ai/key/catalog').catch(() => ({ providers: [] })),
      ]);
      setStatus(s);
      setCatalog(c.providers);
      if (s.provider) setProvider(s.provider);
      // Saved model wins; otherwise pick the provider's default
      // (marked in the catalog) so the form lands on a known-good
      // cheap tier instead of an empty select.
      if (s.model) {
        setModel(s.model);
      } else {
        const initialProvider = s.provider || 'anthropic';
        const p = c.providers.find((x) => x.id === initialProvider);
        const def = p?.models.find((m) => m.default) || p?.models[0];
        if (def) setModel(def.id);
      }
    } catch (e: any) {
      // Pre-migration / backend-not-redeployed case — surface gently.
      setStatus({ configured: false, provider: null, model: null, keyMask: null, setAt: null, setByUserId: null, platformFallbackAvailable: false });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  // When the operator changes provider, jump to that provider's
  // default model so the cost line + key placeholder both reflect
  // the new choice immediately.
  const onProviderChange = (next: ProviderId) => {
    setProvider(next);
    const p = catalog?.find((x) => x.id === next);
    const def = p?.models.find((m) => m.default) || p?.models[0];
    setModel(def?.id || '');
  };

  const handleSave = async () => {
    setMsg(null);
    setSaving(true);
    try {
      const res = await apiFetch<{ ok: true; provider: string; model: string; keyMask: string }>('/ai/key', {
        method: 'POST',
        body: JSON.stringify({ provider, apiKey, model }),
      });
      const providerLabel = catalog?.find((p) => p.id === res.provider)?.label || res.provider;
      const modelLabel = catalog?.find((p) => p.id === res.provider)?.models.find((m) => m.id === res.model)?.label || res.model;
      setMsg({ kind: 'ok', text: `Saved. AI generations now route through ${providerLabel} (${modelLabel}).` });
      setApiKey('');
      setEditing(false);
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || 'Could not save the key.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    if (!(await appConfirm({
      title: 'Disconnect AI?',
      message: 'Generations will fall back to the platform free trial (if available) or stop working until you reconnect.',
      confirmLabel: 'Disconnect',
      tone: 'danger',
    }))) return;
    setSaving(true);
    setMsg(null);
    try {
      await apiFetch('/ai/key', { method: 'DELETE' });
      setMsg({ kind: 'ok', text: 'Disconnected. Add a new key any time.' });
      setApiKey('');
      setEditing(false);
      await load();
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || 'Could not disconnect.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl bg-white border border-slate-200 p-6 flex items-center gap-3 text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading AI integration…
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-6 space-y-5">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white flex-shrink-0">
          <Sparkles className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-bold text-slate-900">AI provider</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Bring your own API key. AI-generated copy (announcements, tickers, menu items, etc.) routes through your account at your provider's rates.
            Keys are encrypted at rest and never exposed in API responses.
          </p>
        </div>
      </div>

      {/* CONFIGURED STATE */}
      {status?.configured && !editing && (() => {
        const cfgProvider = catalog?.find((p) => p.id === status.provider);
        const cfgModel = cfgProvider?.models.find((m) => m.id === status.model);
        return (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-emerald-900">
                Connected — {cfgProvider?.label || status.provider}
                {cfgModel && (
                  <span className="font-normal text-emerald-800"> · {cfgModel.label}</span>
                )}
              </div>
              <div className="text-xs text-emerald-700 mt-0.5 font-mono truncate">{status.keyMask}</div>
              {cfgModel && (
                <div className="text-[11px] text-emerald-700/80 mt-0.5">
                  {formatPerCallCost(cfgModel.estCostPerCallUsd)} — paid to {cfgProvider?.label}.
                </div>
              )}
              {status.setAt && (
                <div className="text-[11px] text-emerald-700/80 mt-0.5">
                  Set {new Date(status.setAt).toLocaleDateString()} {new Date(status.setAt).toLocaleTimeString()}
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setEditing(true); setMsg(null); setApiKey(''); }}
              className="flex-1 px-3 py-2 rounded-lg text-xs font-bold bg-white border border-emerald-200 text-emerald-800 hover:bg-emerald-50"
            >
              Replace key
            </button>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={saving}
              className="px-3 py-2 rounded-lg text-xs font-bold bg-white border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-60 inline-flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" /> Disconnect
            </button>
          </div>
        </div>
        );
      })()}

      {/* PLATFORM-FALLBACK NOTICE (when not configured but trial works) */}
      {!status?.configured && status?.platformFallbackAvailable && (
        <div className="rounded-lg border border-violet-200 bg-violet-50/50 px-4 py-3 text-xs text-violet-800">
          <strong>AI works on our free trial key</strong> — limited to 30 generations/hour for the whole tenant. Add your own key below to remove the cap and route usage to your provider.
        </div>
      )}

      {/* NO PLATFORM FALLBACK (BYOK required) */}
      {!status?.configured && !status?.platformFallbackAvailable && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3 text-xs text-amber-900 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <strong>AI is currently unavailable.</strong> Add your provider key below to enable the ✨ sparkle buttons in template editors.
          </div>
        </div>
      )}

      {/* FORM (always shown when not configured, or when "Replace" is hit) */}
      {(!status?.configured || editing) && (
        <div className="space-y-3">
          {/* Provider picker — driven by GET /ai/key/catalog so the
              FE picks up new providers (e.g. Google added 2026-05-25)
              without a redeploy of this card. */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-2">Provider</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(catalog || []).map((p) => (
                <label
                  key={p.id}
                  className={`flex flex-col gap-1 rounded-lg border p-3 cursor-pointer transition-colors ${
                    provider === p.id ? 'border-violet-400 bg-violet-50/40 ring-2 ring-violet-200' : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="ai-provider"
                    value={p.id}
                    checked={provider === p.id}
                    onChange={() => onProviderChange(p.id)}
                    className="sr-only"
                  />
                  <div className="text-sm font-semibold text-slate-900">{p.label}</div>
                  <div className="text-[11px] text-slate-500 leading-snug">{p.description}</div>
                  <a
                    href={p.getKeyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-violet-600 hover:text-violet-700 font-medium mt-auto"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Get a key →
                  </a>
                </label>
              ))}
            </div>
          </div>

          {/* Model picker — list filtered to the chosen provider.
              Cost-per-call is pre-computed server-side from the
              published price-per-1M-tokens; the FE only formats it. */}
          {currentProviderInfo && (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white"
              >
                {currentProviderInfo.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}{m.default ? ' (recommended)' : ''} — {formatPerCallCost(m.estCostPerCallUsd)}
                  </option>
                ))}
              </select>
              {currentModelInfo && (
                <div className="mt-2 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-[11px] text-slate-600 space-y-0.5">
                  <div className="font-semibold text-slate-700">{currentModelInfo.label}</div>
                  <div>{currentModelInfo.tagline}</div>
                  <div className="text-slate-500">
                    Cost: ${currentModelInfo.inputPer1M.toFixed(2)} / 1M input tokens
                    · ${currentModelInfo.outputPer1M.toFixed(2)} / 1M output tokens.
                    {' '}A typical signage generation runs ~300 output tokens, so expect{' '}
                    {formatPerCallCost(currentModelInfo.estCostPerCallUsd)}.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Key input */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">API key</label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  provider === 'anthropic' ? 'sk-ant-api03-…'
                  : provider === 'openai' ? 'sk-…'
                  : 'AIza…'
                }
                className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-400"
                autoComplete="off"
                spellCheck={false}
              />
              <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                aria-label={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">
              We send one tiny test request to {currentProviderInfo?.label || 'the provider'} with the chosen model BEFORE saving.
              Invalid keys (or keys without access to the model) are rejected and never stored.
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !apiKey.trim()}
              className="flex-1 px-4 py-2.5 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white text-sm font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:from-violet-700 hover:to-fuchsia-700"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {saving ? 'Testing key…' : 'Test & save'}
            </button>
            {editing && (
              <button
                type="button"
                onClick={() => { setEditing(false); setMsg(null); setApiKey(''); }}
                className="px-4 py-2.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {msg && (
        <div className={`rounded-lg px-3 py-2 text-xs flex items-start gap-2 ${
          msg.kind === 'ok' ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-rose-50 border border-rose-200 text-rose-800'
        }`}>
          {msg.kind === 'ok' ? <Check className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
          {msg.text}
        </div>
      )}
    </div>
  );
}
