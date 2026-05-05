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
import { Sparkles, Key, Loader2, Check, AlertCircle, Trash2, Eye, EyeOff } from 'lucide-react';

interface AiKeyStatus {
  configured: boolean;
  provider: 'anthropic' | 'openai' | null;
  keyMask: string | null;
  setAt: string | null;
  setByUserId: string | null;
  platformFallbackAvailable: boolean;
}

const PROVIDERS: { value: 'anthropic' | 'openai'; label: string; help: string; getKeyUrl: string }[] = [
  { value: 'anthropic', label: 'Anthropic (Claude)', help: 'Recommended — best fit for our prompts. ~$0.005 per generation.', getKeyUrl: 'https://console.anthropic.com/settings/keys' },
  { value: 'openai',    label: 'OpenAI (GPT-4o-mini)', help: 'Comparable quality + cost. Good if you already have an OpenAI account.', getKeyUrl: 'https://platform.openai.com/api-keys' },
];

export function AiKeyCard() {
  const [status, setStatus] = useState<AiKeyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState<'anthropic' | 'openai'>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const s = await apiFetch<AiKeyStatus>('/ai/key');
      setStatus(s);
      if (s.provider) setProvider(s.provider);
    } catch (e: any) {
      // Pre-migration / backend-not-redeployed case — surface gently.
      setStatus({ configured: false, provider: null, keyMask: null, setAt: null, setByUserId: null, platformFallbackAvailable: false });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleSave = async () => {
    setMsg(null);
    setSaving(true);
    try {
      const res = await apiFetch<{ ok: true; provider: string; keyMask: string }>('/ai/key', {
        method: 'POST',
        body: JSON.stringify({ provider, apiKey }),
      });
      setMsg({ kind: 'ok', text: `Saved. AI generations now route through your ${res.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} account.` });
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
    if (!confirm('Disconnect AI? Generations will fall back to the platform free trial (if available) or stop working until you reconnect.')) return;
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
      {status?.configured && !editing && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-emerald-900">
                Connected — {status.provider === 'anthropic' ? 'Anthropic (Claude)' : 'OpenAI (GPT-4o-mini)'}
              </div>
              <div className="text-xs text-emerald-700 mt-0.5 font-mono truncate">{status.keyMask}</div>
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
      )}

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
          {/* Provider picker */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-2">Provider</label>
            <div className="space-y-2">
              {PROVIDERS.map((p) => (
                <label
                  key={p.value}
                  className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                    provider === p.value ? 'border-violet-400 bg-violet-50/40' : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="ai-provider"
                    value={p.value}
                    checked={provider === p.value}
                    onChange={() => setProvider(p.value)}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-900">{p.label}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{p.help}</div>
                    <a
                      href={p.getKeyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-violet-600 hover:text-violet-700 font-medium mt-1 inline-block"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Get a key →
                    </a>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Key input */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">API key</label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={provider === 'anthropic' ? 'sk-ant-api03-…' : 'sk-…'}
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
              We test the key against {provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} before saving — invalid keys are rejected and never stored.
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
