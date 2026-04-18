"use client";

import { useState } from 'react';
import { Usb, KeyRound, AlertTriangle, Copy, Check, Loader2, ShieldCheck, ShieldOff, ClipboardList } from 'lucide-react';
import { useUsbIngestConfig, useToggleUsbIngest, useRotateUsbIngestKey, useUsbIngestEvents } from '@/hooks/use-api';
import { appConfirm } from '@/components/ui/app-dialog';

/**
 * Settings card for the Sprint 7B USB sneakernet ingest feature. Lets the
 * tenant admin enable the feature, rotate the HMAC key (shown ONCE), and
 * inspect the recent ingest event log.
 */
export function UsbIngestCard() {
  const { data: cfg, isLoading } = useUsbIngestConfig();
  const toggle = useToggleUsbIngest();
  const rotate = useRotateUsbIngestKey();
  const { data: events } = useUsbIngestEvents();

  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const handleToggle = async (next: boolean) => {
    if (next && !cfg?.hasKey) {
      // Enabling for the first time — auto-rotate so an admin doesn't end
      // up with the feature on but no key issued.
      const ok = await appConfirm({
        title: 'Enable USB sneakernet ingest?',
        message:
          'This will generate an HMAC signing key for this tenant and let paired Android players accept content sideloaded via USB stick. Operators will need this key to build signed bundles.',
        confirmLabel: 'Enable & generate key',
      });
      if (!ok) return;
      toggle.mutate(true, {
        onSuccess: () => {
          rotate.mutate(undefined, {
            onSuccess: (r) => setRevealedKey(r.key),
          });
        },
      });
      return;
    }
    if (!next) {
      const ok = await appConfirm({
        title: 'Disable USB sneakernet ingest?',
        message:
          'Paired players will refuse new USB content immediately. Existing on-disk content keeps playing until cleared. The HMAC key is preserved (re-enable to use the same key, or rotate to invalidate).',
        confirmLabel: 'Disable',
        tone: 'danger',
      });
      if (!ok) return;
    }
    toggle.mutate(next);
  };

  const handleRotate = async () => {
    const ok = await appConfirm({
      title: 'Rotate USB ingest HMAC key?',
      message:
        'Bundles signed with the old key will be REJECTED by every player on next ingest attempt. Operators will need the new key to sign future bundles. The new key is shown ONCE — save it immediately.',
      confirmLabel: 'Rotate key',
      tone: 'danger',
    });
    if (!ok) return;
    rotate.mutate(undefined, {
      onSuccess: (r) => setRevealedKey(r.key),
    });
  };

  const copyKey = async () => {
    if (!revealedKey) return;
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(revealedKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (e: any) {
      // MED-5 audit fix: surface the error visibly. Previously we
      // silently swallowed clipboard failures — admin would assume the
      // key was copied and lose it on modal close.
      setCopyError(
        'Browser blocked clipboard access. Triple-click the key above to select all, then Ctrl+C / Cmd+C to copy manually.',
      );
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100">
        <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2">
          <Usb className="w-4 h-4 text-violet-500" /> USB Sneakernet Ingest
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Sideload content to paired Android players over USB — for buildings with no WiFi, isolated VLANs, or content updates during a network outage.
        </p>
      </div>

      <div className="p-6 space-y-5">
        {isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin text-slate-400 mx-auto" />
        ) : (
          <>
            {/* Enable toggle */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  {cfg?.enabled ? (
                    <ShieldCheck className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <ShieldOff className="w-4 h-4 text-slate-400" />
                  )}
                  {cfg?.enabled ? 'USB ingest is enabled' : 'USB ingest is disabled'}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {cfg?.enabled
                    ? 'Players issued a USB key on next pair will accept signed content bundles.'
                    : 'Enable to start issuing USB keys to paired players.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleToggle(!cfg?.enabled)}
                disabled={toggle.isPending}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors ${
                  cfg?.enabled
                    ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200'
                    : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                } disabled:opacity-50`}
              >
                {toggle.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : cfg?.enabled ? 'Disable' : 'Enable'}
              </button>
            </div>

            {/* Key status + rotate */}
            {cfg?.enabled && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5 text-violet-500" /> HMAC signing key
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {cfg.hasKey
                        ? `Active — last rotated ${cfg.keyRotatedAt ? new Date(cfg.keyRotatedAt).toLocaleString() : 'unknown'}`
                        : 'No key generated yet — rotate to create one.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleRotate}
                    disabled={rotate.isPending}
                    className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-xs font-bold rounded-lg disabled:opacity-50"
                  >
                    {rotate.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (cfg.hasKey ? 'Rotate key' : 'Generate key')}
                  </button>
                </div>
                <div className="flex items-start gap-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>
                    Rotating invalidates every previously-signed USB bundle. All operators must use the new key to sign new bundles. Players themselves pick up the new key on their next pair.
                  </span>
                </div>
              </div>
            )}

            {/* Recent ingest events */}
            {cfg?.enabled && events && events.length > 0 && (
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                  <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <ClipboardList className="w-3.5 h-3.5 text-slate-500" /> Recent ingest events ({events.length})
                  </div>
                </div>
                <ul className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                  {events.slice(0, 25).map((e: any) => {
                    const ok = e.outcome === 'ACCEPTED';
                    return (
                      <li key={e.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
                        <div className="min-w-0">
                          <div className="font-bold text-slate-700 truncate">
                            {e.bundleVersion || '(no version)'} · {e.assetCount} assets
                            {e.emergencyAssets && <span className="ml-1.5 text-rose-600">🛡️ emergency</span>}
                          </div>
                          <div className="text-slate-400 text-[11px] truncate">
                            {new Date(e.createdAt).toLocaleString()}
                            {e.deviceSerial && <> · USB {e.deviceSerial.slice(0, 8)}…</>}
                            {e.reason && <> · {e.reason}</>}
                          </div>
                        </div>
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                            ok
                              ? 'bg-emerald-50 text-emerald-700'
                              : e.outcome === 'CANCELLED_BY_OPERATOR'
                                ? 'bg-slate-100 text-slate-500'
                                : 'bg-rose-50 text-rose-700'
                          }`}
                        >
                          {e.outcome}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Bundler usage hint */}
            {cfg?.enabled && cfg.hasKey && (
              <details className="text-xs">
                <summary className="cursor-pointer text-slate-500 hover:text-slate-700 font-semibold">
                  How to build a USB bundle →
                </summary>
                <pre className="mt-2 bg-slate-900 text-slate-100 rounded-lg p-3 overflow-x-auto text-[11px]">{`export EDU_USB_KEY=<paste from Rotate response>

pnpm tsx scripts/usb-bundler.ts \\
  --tenant <your-tenant-id> \\
  --key $EDU_USB_KEY \\
  --out /media/USBSTICK \\
  --asset https://cdn.example/welcome.mp4 \\
  --emergency-asset https://cdn.example/lockdown-2026.mp4`}</pre>
              </details>
            )}
          </>
        )}
      </div>

      {/* Key reveal modal — shown ONCE after rotation */}
      {revealedKey && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-4">
            <div>
              <h3 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-violet-600" /> New HMAC key
              </h3>
              <p className="text-xs text-rose-700 mt-1 font-medium flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                This key is shown ONCE. Copy it now — the dashboard will never show it again.
              </p>
            </div>
            <div className="bg-slate-900 rounded-lg p-4 break-all font-mono text-xs text-emerald-300 select-all">
              {revealedKey}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copyKey}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-2"
              >
                {copied ? <><Check className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Copy to clipboard</>}
              </button>
              <button
                type="button"
                onClick={() => { setRevealedKey(null); setCopied(false); setCopyError(null); }}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg"
              >
                I&apos;ve saved it
              </button>
            </div>
            {copyError && (
              <div className="flex items-start gap-2 px-3 py-2.5 bg-rose-50 border border-rose-200 rounded-lg text-[11px] text-rose-700 font-medium">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{copyError}</span>
              </div>
            )}
            <p className="text-[11px] text-slate-500">
              Store this in a password manager or your build environment as <code className="bg-slate-100 px-1 py-0.5 rounded">EDU_USB_KEY</code>. Anyone with this key can sign USB bundles for your tenant.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
