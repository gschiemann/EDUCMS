'use client';

/**
 * "Download to USB" — the hook + status line every surface shares, so the
 * playlists menu, the playlist page and the create wizard say the same words
 * and run the same code (`@/lib/usb-export`). No setting gates any of it.
 */

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Loader2, AlertCircle, X } from 'lucide-react';
import { useUIStore } from '@/store/ui-store';
import { exportPlaylistToUsb, type UsbSchedule } from '@/lib/usb-export';

export type UsbExportStatus =
  | { state: 'busy'; label: string }
  | { state: 'done'; label: string }
  | { state: 'error'; label: string };

export function useUsbExport() {
  const t = useTranslations('usbDelivery');
  const token = useUIStore((s) => s.token);
  const [status, setStatus] = useState<UsbExportStatus | null>(null);

  const run = useCallback(
    async (args: { playlistId: string; playlistName: string; schedule?: UsbSchedule | null; allowFolder?: boolean }) => {
      const name = args.playlistName || 'Playlist';
      setStatus({ state: 'busy', label: t('building', { name }) });
      try {
        const out = await exportPlaylistToUsb({
          token,
          ...args,
          playlistName: name,
          onProgress: (p) =>
            setStatus({
              state: 'busy',
              label: p.phase === 'writing' ? t('writing', { done: p.done, total: p.total }) : t('building', { name }),
            }),
        });
        if (out.kind === 'cancelled') { setStatus(null); return out; }
        setStatus({ state: 'done', label: out.kind === 'folder' ? t('doneFolder', { name }) : t('doneZip', { name }) });
        return out;
      } catch (e) {
        setStatus({ state: 'error', label: t('failed', { message: (e as Error)?.message || '' }) });
        return null;
      }
    },
    [t, token],
  );

  return { run, status, clear: () => setStatus(null), busy: status?.state === 'busy' };
}

/** One status line, fixed at the bottom of the page. */
export function UsbExportToast({ status, onDismiss }: { status: UsbExportStatus | null; onDismiss: () => void }) {
  const t = useTranslations('usbDelivery');
  if (!status) return null;
  const tone =
    status.state === 'error'
      ? 'bg-red-50 border-red-200 text-red-800'
      : status.state === 'done'
        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
        : 'bg-white border-slate-200 text-slate-800';
  return (
    <div
      role={status.state === 'error' ? 'alert' : 'status'}
      data-testid="usb-export-status"
      className={`fixed bottom-20 md:bottom-6 left-4 right-4 md:left-auto md:right-6 md:max-w-md z-[60] rounded-xl border shadow-lg p-3 flex items-start gap-2 text-sm ${tone}`}
    >
      {status.state === 'busy' && <Loader2 className="w-4 h-4 mt-0.5 animate-spin flex-shrink-0" aria-hidden />}
      {status.state === 'done' && <Check className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden />}
      {status.state === 'error' && <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden />}
      <span className="flex-1 leading-snug">{status.label}</span>
      {status.state !== 'busy' && (
        <button type="button" onClick={onDismiss} aria-label={t('dismiss')} className="p-1 -m-1 rounded hover:bg-black/5">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
