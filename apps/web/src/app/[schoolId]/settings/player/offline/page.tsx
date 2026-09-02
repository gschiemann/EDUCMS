/**
 * /[schoolId]/settings/player/offline — signed USB / offline ingest.
 *
 * Handoff §8: this is the `/settings/usb` surface, moved under Player &
 * offline and rendered inside the shared shell. `/[schoolId]/settings/usb`
 * re-exports this module byte-for-byte, so every bookmark and support link
 * still resolves (old URL preserved, no redirect hop).
 *
 * The operator flow it implements is unchanged:
 *
 *   Insert USB → log in → pick playlists → download directly to USB
 *   → player accepts it because it was signed by the app.
 *
 * Backend signs the bundle with the tenant's HMAC key (POST
 * /api/v1/usb-export/bundle); this UI:
 *   1. Lets the admin choose which playlists + which screen to bundle.
 *   2. Prompts for a USB folder via the File System Access API
 *      (`window.showDirectoryPicker`). Chromium-only — we fall back to a
 *      regular ZIP download on Safari/Firefox so the flow still works
 *      end-to-end (operator extracts manually).
 *   3. Unzips the signed bundle into that folder using JSZip.
 *
 * Also the key lifecycle: the USB signing key is shown ONCE on rotation,
 * with a two-way enable toggle. Both live here — no separate settings row.
 *
 * Only the chrome changed in the move (§6.2 owns the breadcrumb, H1 and
 * purpose line now, so the page-level back-link and heading are gone, and
 * the two cards became editor sections). Every handler, guard, endpoint and
 * fallback below is the code that shipped at /settings/usb.
 */
'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import JSZip from 'jszip';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Usb, ShieldCheck, Check, Loader2, AlertTriangle, Copy, RefreshCw, Power } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { apiFetch, getApiUrl } from '@/lib/api-client';
import { useUIStore } from '@/store/ui-store';
import { usePlaylists, useScreens, useTenant } from '@/hooks/use-api';
import { appConfirm } from '@/components/ui/app-dialog';
import { SettingsPageFrame } from '@/components/settings/shell/SettingsPageFrame';
import { ContextModule, EditorHead, EditorSection } from '@/components/settings/shell/primitives';

interface UsbConfig {
  enabled: boolean;
  hasKey: boolean;
  keyRotatedAt: string | null;
}

export default function UsbExportPage() {
  const t = useTranslations();
  const params = useParams();
  const schoolId = params?.schoolId as string;
  const token = useUIStore((s) => s.token);
  const { data: tenant } = useTenant();
  const { data: config, refetch: refetchConfig } = useQuery<UsbConfig>({
    queryKey: ['tenants/me/usb-ingest'],
    queryFn: () => apiFetch('/tenants/me/usb-ingest'),
  });
  const { data: playlists } = usePlaylists();
  const { data: screens } = useScreens();

  const [selectedPlaylistIds, setSelectedPlaylistIds] = useState<string[]>([]);
  const [screenId, setScreenId] = useState<string>('');
  const [includeEmergency, setIncludeEmergency] = useState(true);
  const [bundleLabel, setBundleLabel] = useState('');
  const [status, setStatus] = useState<
    | { phase: 'idle' }
    | { phase: 'fetching'; message: string }
    | { phase: 'extracting'; pct: number; message: string }
    | { phase: 'done'; message: string; outputPath?: string }
    | { phase: 'error'; message: string }
  >({ phase: 'idle' });
  const [newKeyReveal, setNewKeyReveal] = useState<string | null>(null);

  // ─── Enable / disable toggle (was one-way; now bi-directional) ───
  const setEnabledMut = useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch('/tenants/me/usb-ingest', { method: 'PUT', body: JSON.stringify({ enabled }) }),
    onSuccess: () => refetchConfig(),
  });

  // ─── Rotate key — now explicit "Generate new" button; not a trap ──
  const rotateKeyMut = useMutation({
    mutationFn: () => apiFetch<{ key: string }>('/tenants/me/usb-ingest/rotate-key', { method: 'POST' }),
    onSuccess: (res) => {
      setNewKeyReveal(res.key);
      refetchConfig();
    },
  });

  const handleRotate = async () => {
    if (config?.hasKey) {
      const ok = await appConfirm({
        title: t('settings.usb.newKeyConfirmTitle'),
        message: t('settings.usb.newKeyConfirmMessage'),
        tone: 'warn',
        confirmLabel: t('settings.usb.newKeyConfirmLabel'),
      });
      if (!ok) return;
    }
    await rotateKeyMut.mutateAsync();
  };

  const togglePlaylist = (id: string) => {
    setSelectedPlaylistIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  const canExport = !!config?.enabled && !!config?.hasKey && selectedPlaylistIds.length > 0;
  const fsAccessSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  const handleExport = async () => {
    if (!canExport) return;
    setStatus({ phase: 'fetching', message: t('settings.usb.buildingBundle') });

    let dirHandle: any = null;
    // Ask for the USB folder FIRST — Chromium requires a user gesture,
    // and we want to fail fast if the user cancels.
    if (fsAccessSupported) {
      try {
        dirHandle = await (window as any).showDirectoryPicker({
          mode: 'readwrite',
          id: 'edu-cms-usb',
          startIn: 'desktop',
        });
      } catch {
        // User cancelled the picker. Fall through to plain download.
        dirHandle = null;
      }
    }

    try {
      // Call the signed-bundle endpoint directly (NOT apiFetch — we need
      // the raw ArrayBuffer, not a parsed JSON response).
      const res = await fetch(`${getApiUrl()}/usb-export/bundle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          playlistIds: selectedPlaylistIds,
          screenId: screenId || undefined,
          includeEmergency,
          bundleLabel: bundleLabel.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || t('settings.usb.exportFailedStatus', { status: res.status }));
      }
      const assetCount = res.headers.get('X-Bundle-Asset-Count') || '?';
      const truncated = res.headers.get('X-Bundle-Truncated') === 'true';
      const buf = await res.arrayBuffer();
      const sizeMb = (buf.byteLength / 1024 / 1024).toFixed(1);

      if (dirHandle) {
        // Extract the ZIP directly into the picked USB folder.
        setStatus({ phase: 'extracting', pct: 0, message: t('settings.usb.writingAssets', { count: assetCount, size: sizeMb }) });
        const zip = await JSZip.loadAsync(buf);
        const entries = Object.entries(zip.files).filter(([, f]) => !f.dir);
        let done = 0;
        for (const [path, file] of entries) {
          const segments = path.split('/').filter(Boolean);
          // Walk/create the directory tree: edu-cms-content/assets/<hash>.ext
          let dir = dirHandle;
          for (let i = 0; i < segments.length - 1; i++) {
            dir = await dir.getDirectoryHandle(segments[i], { create: true });
          }
          const filename = segments[segments.length - 1];
          const contents = await file.async('uint8array');
          const fileHandle = await dir.getFileHandle(filename, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(contents);
          await writable.close();
          done += 1;
          setStatus({
            phase: 'extracting',
            pct: Math.round((done / entries.length) * 100),
            message: t('settings.usb.writingProgress', { done, total: entries.length, filename }),
          });
        }
        setStatus({
          phase: 'done',
          message: truncated
            ? t('settings.usb.wroteTruncated', { count: assetCount, size: sizeMb })
            : t('settings.usb.wroteComplete', { count: assetCount, size: sizeMb }),
        });
      } else {
        // Fallback: browser doesn't support directory picker OR user cancelled.
        // Download as a normal ZIP attachment. Operator extracts manually.
        const blob = new Blob([buf], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        a.download = `edu-cms-bundle-${stamp}.zip`;
        a.click();
        URL.revokeObjectURL(url);
        setStatus({
          phase: 'done',
          message: `${t('settings.usb.downloadedBundle', { count: assetCount, size: sizeMb })} ${fsAccessSupported ? '' : t('settings.usb.useChromeEdge')}`,
        });
      }
    } catch (e: any) {
      setStatus({ phase: 'error', message: e?.message || t('settings.usb.exportFailed') });
    }
  };

  const tenantName = (tenant as { name?: string } | undefined)?.name ?? '';

  /**
   * Referentially stable — <SettingsPageFrame> registers these through an
   * effect, so an inline array/node would re-register on every render.
   * `t` is intentionally not a dependency (next-intl hands back a fresh
   * function each render; a locale change remounts the tree).
   */
  const scope = useMemo(() => ({ kind: 'organization' as const, label: tenantName }), [tenantName]);
  const searchItems = useMemo(
    () => [
        { label: t('settings.cc.player.searchUsb'), anchor: 'usb-security', keywords: ['usb', 'sneakernet', 'offline', 'signed'] },
        { label: t('settings.cc.player.searchDeviceKey'), anchor: 'usb-security', keywords: ['key', 'hmac', 'rotate', 'signing'] },
        { label: t('settings.cc.player.searchOffline'), anchor: 'usb-build', keywords: ['export', 'bundle', 'download'] },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const contextRail = useMemo(
    () => (
        <>
          <ContextModule
            label={t('settings.cc.player.railOfflineState')}
            title={config?.enabled ? t('settings.usb.ingestEnabled') : t('settings.usb.ingestDisabled')}
          >
            {config?.hasKey
              ? config.keyRotatedAt
                ? t('settings.usb.rotatedAt', { date: new Date(config.keyRotatedAt).toLocaleString() })
                : t('settings.cc.player.railKeySetUndated')
              : t('settings.cc.player.railNoKey')}
          </ContextModule>
          <ContextModule label={t('settings.cc.player.railBrowserSupport')} title={fsAccessSupported ? t('settings.cc.player.railDirectToUsb') : t('settings.cc.player.railZipFallback')}>
            {fsAccessSupported ? t('settings.usb.fsSupported') : t('settings.usb.fsUnsupported')}
          </ContextModule>
        </>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config, fsAccessSupported],
  );

  return (
    <SettingsPageFrame
      section="player"
      subtitle={t('settings.cc.player.offlineBreadcrumb')}
      title={t('settings.usb.title')}
      description={t('settings.usb.subtitle')}
      scope={scope}
      searchItems={searchItems}
      context={contextRail}
    >
      <EditorHead
        icon={Usb}
        title={t('settings.usb.title')}
        description={t('settings.usb.subtitle')}
      />

      {/* ─── USB ingest on/off + key management ─── */}
      <EditorSection id="usb-security" title={t('settings.usb.securityHeading')}>
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => setEnabledMut.mutate(!config?.enabled)}
              disabled={setEnabledMut.isPending}
              aria-pressed={!!config?.enabled}
              className={`px-3 py-2 text-xs font-bold rounded-lg flex items-center gap-1.5 transition-colors ${
                config?.enabled
                  ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <Power className="w-3.5 h-3.5" aria-hidden />
              {config?.enabled ? t('settings.usb.ingestEnabled') : t('settings.usb.ingestDisabled')}
            </button>
            <p className="text-xs text-slate-500 flex-1">
              {t('settings.usb.ingestToggleHint')}
            </p>
          </div>
          <div className="flex items-start gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={handleRotate}
              disabled={rotateKeyMut.isPending}
              className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 disabled:opacity-50"
            >
              {rotateKeyMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <RefreshCw className="w-3.5 h-3.5" aria-hidden />}
              {config?.hasKey ? t('settings.usb.generateNewKey') : t('settings.usb.generateSigningKey')}
            </button>
            <div className="flex-1 text-xs text-slate-500">
              {config?.hasKey ? (
                <>
                  {t.rich('settings.usb.keySetHint', {
                    rotated: config.keyRotatedAt ? ` ${t('settings.usb.rotatedAt', { date: new Date(config.keyRotatedAt).toLocaleString() })}` : '',
                    code: (chunks) => <code className="font-mono">{chunks}</code>,
                  })}
                </>
              ) : (
                <>{t('settings.usb.noKeyHint')}</>
              )}
            </div>
          </div>

          {newKeyReveal && (
            <div className="mt-3 p-4 rounded-xl border-2 border-amber-300 bg-amber-50">
              <div className="flex items-start gap-2 mb-3">
                <AlertTriangle className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" aria-hidden />
                <div className="text-xs font-bold text-amber-900">
                  {t('settings.usb.saveKeyNow')}
                  <span className="font-normal"> {t('settings.usb.saveKeyNowDetail')}</span>
                </div>
              </div>
              <div className="flex gap-2">
                <label htmlFor="usb-new-key" className="sr-only">{t('settings.usb.saveKeyNow')}</label>
                <input
                  id="usb-new-key"
                  readOnly
                  value={newKeyReveal}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 px-3 py-2 font-mono text-xs bg-white border border-amber-300 rounded-lg"
                />
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(newKeyReveal)}
                  className="px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5" aria-hidden /> {t('settings.common.copy')}
                </button>
                <button
                  type="button"
                  onClick={() => setNewKeyReveal(null)}
                  className="px-3 py-2 bg-white border border-slate-200 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-50"
                >
                  {t('settings.usb.hide')}
                </button>
              </div>
            </div>
          )}
        </div>
      </EditorSection>

      {/* ─── Export bundle ─── */}
      <EditorSection
        id="usb-build"
        title={t('settings.usb.buildHeading')}
        description={fsAccessSupported ? t('settings.usb.fsSupported') : t('settings.usb.fsUnsupported')}
      >
        <div className="space-y-5">
          <div>
            <label htmlFor="bundle-label" className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {t('settings.usb.bundleLabel')}
            </label>
            <input
              id="bundle-label"
              value={bundleLabel}
              onChange={(e) => setBundleLabel(e.target.value)}
              placeholder={t('settings.usb.bundleLabelPlaceholder')}
              className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          <div>
            <label htmlFor="screen-select" className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{t('settings.usb.targetScreen')}</label>
            <select
              id="screen-select"
              value={screenId}
              onChange={(e) => setScreenId(e.target.value)}
              className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm"
            >
              <option value="">{t('settings.usb.anyPairedPlayer')}</option>
              {(screens || []).map((s: any) => (
                <option key={s.id} value={s.id}>{s.name || s.id.slice(0, 8)}</option>
              ))}
            </select>
            <p className="text-[11px] text-slate-400 mt-1">
              {t('settings.usb.screenScopeHint')}
            </p>
          </div>

          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
              {t('settings.usb.playlistsSelected', { count: selectedPlaylistIds.length })}
            </div>
            <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {(playlists || []).map((p: any) => {
                const checked = selectedPlaylistIds.includes(p.id);
                return (
                  <label key={p.id} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePlaylist(p.id)}
                      className="w-4 h-4 accent-indigo-600"
                    />
                    <span className="flex-1 truncate">{p.name}</span>
                    <span className="text-[10px] text-slate-400">{t('settings.usb.itemCount', { count: p.items?.length || 0 })}</span>
                  </label>
                );
              })}
              {(!playlists || playlists.length === 0) && (
                <div className="px-3 py-4 text-xs text-slate-400 text-center">{t('settings.usb.noPlaylists')}</div>
              )}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeEmergency}
              onChange={(e) => setIncludeEmergency(e.target.checked)}
              className="w-4 h-4 accent-rose-600"
            />
            <ShieldCheck className="w-3.5 h-3.5 text-rose-600" aria-hidden />
            {t('settings.usb.includeEmergency')}
          </label>

          <div className="pt-4 border-t border-slate-100 flex items-center gap-3">
            <button
              type="button"
              onClick={handleExport}
              disabled={!canExport || status.phase === 'fetching' || status.phase === 'extracting'}
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold rounded-lg flex items-center gap-2"
            >
              {status.phase === 'fetching' || status.phase === 'extracting' ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
              ) : (
                <Usb className="w-4 h-4" aria-hidden />
              )}
              {fsAccessSupported ? t('settings.usb.pickAndDownload') : t('settings.usb.downloadSigned')}
            </button>
            {!config?.enabled && <span className="text-xs text-amber-700">{t('settings.usb.enableFirst')}</span>}
            {config?.enabled && !config?.hasKey && <span className="text-xs text-amber-700">{t('settings.usb.generateKeyFirst')}</span>}
          </div>

          {status.phase !== 'idle' && (
            <div
              aria-live="polite"
              className={`p-3 rounded-lg text-sm ${
                status.phase === 'error' ? 'bg-rose-50 text-rose-800 border border-rose-200'
                : status.phase === 'done' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-indigo-50 text-indigo-800 border border-indigo-200'
              }`}
            >
              {status.phase === 'done' && <Check className="w-4 h-4 inline mr-1.5" aria-hidden />}
              {status.phase === 'error' && <AlertTriangle className="w-4 h-4 inline mr-1.5" aria-hidden />}
              {(status.phase === 'fetching' || status.phase === 'extracting') && <Loader2 className="w-4 h-4 inline mr-1.5 animate-spin" aria-hidden />}
              {status.message}
              {status.phase === 'extracting' && (
                <div className="mt-2 w-full h-1.5 bg-indigo-100 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-600 transition-all" style={{ width: `${status.pct}%` }} />
                </div>
              )}
            </div>
          )}
        </div>
      </EditorSection>

      <p className="mt-1 text-[12px] text-slate-500">
        <a href={`/${schoolId}/settings/player`} className="underline underline-offset-2" style={{ color: 'var(--brand-primary)' }}>
          {t('settings.cc.player.backToPlayer')}
        </a>
      </p>
    </SettingsPageFrame>
  );
}
