"use client";
/**
 * StreamingSourceField — the STREAMING widget's "paste a link" editor.
 *
 * 2026-11-07 (streaming-widget flagship audit). Before this the only way to
 * point the widget at a stream was a saved channel from Settings → Live
 * video; an operator holding a .m3u8 link had no field at all. Now:
 *
 *   paste → the shared classifier (`widgets/streaming/stream-source.ts`, the
 *   SAME one the screen uses) names the kind and says honestly whether every
 *   screen will play it, needs a gateway, or will be blocked → the canvas zone
 *   is already the live preview → "Test stream" mounts a second player here
 *   with diagnostics (engine, resolution, live/VOD, frames counted by
 *   requestVideoFrameCallback) so the operator knows it plays before
 *   publishing.
 *
 * Mounted from PropertiesPanel's `case 'STREAMING'`.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { StreamingWidget, type StreamingCfg } from '@/components/widgets/StreamingWidget';
import { detectStreamSource, type StreamSource } from '@/components/widgets/streaming/stream-source';
import type { StreamStatus } from '@/components/widgets/streaming/LiveVideoStream';
import { useBuilderStore } from './useBuilderStore';

const VERDICT_TONE: Record<StreamSource['verdict'], StatusTone> = {
  supported: 'success',
  probable: 'info',
  'needs-gateway': 'warning',
  unsupported: 'danger',
  blocked: 'danger',
  empty: 'neutral',
};

const VERDICT_KEY: Record<Exclude<StreamSource['verdict'], 'empty'>, string> = {
  supported: 'supported',
  probable: 'probable',
  'needs-gateway': 'needsGateway',
  unsupported: 'unsupported',
  blocked: 'blocked',
};

/** The config patch a pasted link produces. Exported for tests. */
export function patchForStreamLink(url: string): Partial<StreamingCfg> & { streamingChannelId?: undefined } {
  const src = detectStreamSource(url);
  const embed = src.engine === 'embed';
  return {
    streamingChannelId: undefined,
    channelTitle: undefined,
    playbackUrl: embed ? undefined : (url.trim() || undefined),
    embedUrl: embed ? url.trim() : undefined,
    playbackType: embed ? 'iframe' : undefined,
  };
}

export function StreamingSourceField({
  cfg,
  setField,
}: {
  cfg: StreamingCfg & { streamingChannelId?: string };
  setField: (patch: Record<string, unknown>) => void;
}) {
  const t = useTranslations('streamingWidget');
  const te = useTranslations('streamingWidget.editor');
  const id = useId();
  const current = (cfg.embedUrl || cfg.playbackUrl || '').trim();
  const [local, setLocal] = useState(current);
  useEffect(() => { setLocal(current); }, [current]);
  const beginTransaction = useBuilderStore((s) => s.beginTransaction);
  const endTransaction = useBuilderStore((s) => s.endTransaction);

  const src = useMemo(() => detectStreamSource(local), [local]);
  const [testKey, setTestKey] = useState(0);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<StreamStatus | null>(null);
  const [frames, setFrames] = useState(0);
  const testRef = useRef<HTMLDivElement | null>(null);

  // Stop a running test when the link changes.
  useEffect(() => { setTesting(false); setStatus(null); setFrames(0); }, [current]);

  // Read the frame counter off the test player's <video> (no re-render per frame).
  useEffect(() => {
    if (!testing) return;
    const timer = setInterval(() => {
      const v = testRef.current?.querySelector('video[data-stream-frames]');
      const n = Number(v?.getAttribute('data-stream-frames') || 0);
      setFrames((prev) => (prev === n ? prev : n));
    }, 1000);
    return () => clearInterval(timer);
  }, [testing, testKey]);

  const commit = (value: string) => {
    if (value.trim() === current) return;
    setField(patchForStreamLink(value));
  };

  const explain = (() => {
    if (src.verdict === 'empty') return null;
    if (src.verdict === 'blocked') {
      return src.reason === 'insecure' ? t('insecureHint') : src.reason === 'private-host' ? t('privateHint') : t('notUrlHint');
    }
    if (src.verdict === 'needs-gateway') {
      const protocol = src.kind === 'srt' ? 'SRT / UDP' : src.kind.toUpperCase();
      return t('gatewayHint', { protocol });
    }
    if (src.kind === 'dash') return t('dashHint');
    if (src.verdict === 'probable') return te('explain.probable');
    if (src.engine === 'embed') return te('explain.embed');
    if (src.kind === 'progressive') return te('explain.progressive');
    if (src.kind === 'mjpeg') return te('explain.mjpeg');
    if (src.kind === 'snapshot') return te('explain.snapshot');
    return te('explain.hls');
  })();

  const testable = src.verdict === 'supported' || src.verdict === 'probable';
  const testLine = (() => {
    if (!testing) return null;
    if (src.engine === 'embed') return te('testEmbed');
    if (!status || status.phase === 'connecting') return te('testConnecting');
    if (status.phase === 'unsupported') return te('testUnsupported');
    if (status.phase === 'offline' || status.phase === 'reconnecting') {
      return te('testOffline', { reason: status.lastError || 'no frames' });
    }
    const dims = { width: status.width || 0, height: status.height || 0 };
    return status.isLive ? te('testPlayingLive', dims) : te('testPlaying', dims);
  })();
  const testTone: StatusTone = !status ? 'neutral'
    : status.phase === 'playing' ? 'success'
      : status.phase === 'offline' || status.phase === 'unsupported' ? 'danger' : 'warning';

  return (
    <div className="space-y-2" data-streaming-source-field>
      <label htmlFor={id} className="block text-[10px] font-semibold text-slate-500 mb-1.5">
        {te('linkLabel')}
      </label>
      <input
        id={id}
        type="url"
        inputMode="url"
        spellCheck={false}
        autoComplete="off"
        value={local}
        placeholder={te('linkPlaceholder')}
        onFocus={beginTransaction}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => { commit(local); endTransaction(); }}
        onPaste={(e) => {
          // A paste is a finished link: apply it now so the canvas previews it.
          const pasted = e.clipboardData.getData('text');
          if (pasted) {
            e.preventDefault();
            setLocal(pasted.trim());
            commit(pasted.trim());
          }
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(local); } }}
        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all shadow-sm"
      />
      {src.verdict !== 'empty' && (
        <div className="rounded-lg border border-slate-200/70 bg-slate-50/70 px-2.5 py-2" data-stream-verdict={src.verdict} data-stream-kind={src.kind}>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill tone="neutral">{te(`kind.${src.kind}`)}</StatusPill>
            <StatusPill tone={VERDICT_TONE[src.verdict]}>{te(`verdict.${VERDICT_KEY[src.verdict]}`)}</StatusPill>
          </div>
          {explain && <p className="mt-1.5 text-[11px] leading-snug text-slate-600">{explain}</p>}
          {testable && (
            <div className="mt-2 flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-stream-test-button
                onClick={() => {
                  if (local.trim() !== current) commit(local);
                  setStatus(null);
                  setFrames(0);
                  setTesting(true);
                  setTestKey((k) => k + 1);
                }}
              >
                {testing ? te('testAgain') : te('testButton')}
              </Button>
              {testing && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setTesting(false)}>
                  {te('testStop')}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      {testing && testable && (
        <div className="space-y-1.5" data-stream-test>
          <div
            ref={testRef}
            className="relative w-full overflow-hidden rounded-lg bg-black shadow-sm ring-1 ring-slate-900/10"
            style={{ aspectRatio: '16 / 9' }}
          >
            <StreamingWidget
              key={testKey}
              live
              config={{ ...cfg, ...patchForStreamLink(local), muted: true, allowAdOverlay: false }}
              onStatus={setStatus}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5" aria-live="polite">
            {testLine && <StatusPill tone={src.engine === 'embed' ? 'info' : testTone} data-testid="stream-test-status">{testLine}</StatusPill>}
            {src.engine === 'video' && frames > 0 && <StatusPill tone="neutral">{te('testFrames', { count: frames })}</StatusPill>}
            {status?.engine && status.engine !== 'none' && <StatusPill tone="neutral">{status.engine === 'hlsjs' ? 'hls.js' : status.engine}</StatusPill>}
          </div>
          {status?.mutedByPolicy && <p className="text-[11px] text-slate-500">{t('mutedByPolicy')}</p>}
        </div>
      )}
    </div>
  );
}

/** Volume, shown only when the widget is unmuted. */
export function StreamingVolumeField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const te = useTranslations('streamingWidget.editor');
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="flex items-center justify-between text-[10px] font-semibold text-slate-500 mb-1.5">
        <span>{te('volumeLabel')}</span>
        <span className="tabular-nums text-slate-400">{Math.round(value)}%</span>
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-indigo-600"
      />
    </div>
  );
}
