'use client';

/**
 * VenueOS Sports — live surface preview.
 *
 * An embedded, live view of exactly what each game-day surface looks
 * like right now — the scoreboard, the ribbon, the broadcast
 * scorebug. It is the real public surface in an <iframe>, so it
 * reflects every edit (sponsors, image slides, messages, presets,
 * the score, the clock) within ~1s — the operator builds the look
 * before the game and watches it come together, then pushes it to
 * the screens.
 *
 * The Scorebug surface also carries the "Copy stream-overlay URL"
 * affordance — the transparent broadcast overlay you add as a Browser
 * Source in OBS / vMix / Hudl. Same live game state as the in-venue
 * board, so the stream bug and the big board can never disagree.
 */

import { useState } from 'react';
import { ExternalLink, Copy, Check } from 'lucide-react';

interface Surface {
  key: string;
  label: string;
  path: string;
  /** Board + scorebug preview at 16:9; the ribbon is a wide strip. */
  aspect?: string;
  height?: number;
}

const SURFACES: Surface[] = [
  { key: 'board', label: 'Scoreboard', path: 'board', aspect: '16 / 9' },
  { key: 'ribbon', label: 'Ribbon', path: 'ribbon', height: 132 },
  { key: 'scorebug', label: 'Scorebug', path: 'scorebug', aspect: '16 / 9' },
];

// item D (2026-06-21) — preview at a SPECIFIC target resolution. The operator
// tests on a real 4K TV / a wide LED ribbon, where auto-fit + ticker issues
// only show at the true pixel shape. "Fit" keeps the old behavior; a preset (or
// custom W×H) sets the preview box to that exact aspect AND — for the ribbon,
// which renders at its native window size — forces the scene's canvas via the
// route's existing ?canvas=WxH override, so the in-app preview clips/sizes
// IDENTICALLY to the screen. (The board/scorebug are a fixed 1920×1080 scene
// that contain-scales, so they look the same at any 16:9 resolution — picking
// 4K vs 1080p just relabels; a non-16:9 target correctly pillar/letterboxes.)
interface ResPreset {
  key: string;
  label: string;
  w: number;
  h: number;
}
const RES_PRESETS: ResPreset[] = [
  { key: '1080', label: '1080p · 1920×1080', w: 1920, h: 1080 },
  { key: '4k', label: '4K · 3840×2160', w: 3840, h: 2160 },
  { key: 'ribbon-wide', label: 'Wide ribbon · 3840×256', w: 3840, h: 256 },
  { key: 'ribbon-tall', label: 'Tall ribbon · 1920×360', w: 1920, h: 360 },
  { key: 'portrait', label: 'Portrait · 1080×1920', w: 1080, h: 1920 },
];

export function SurfacePreview({ gameId }: { gameId: string }) {
  const [key, setKey] = useState('board');
  // resolution: '' = Fit (old behavior); 'custom' = the two number inputs;
  // otherwise a preset key.
  const [resKey, setResKey] = useState('');
  const [customW, setCustomW] = useState('');
  const [customH, setCustomH] = useState('');
  const surface = SURFACES.find((s) => s.key === key) || SURFACES[0];

  const preset = RES_PRESETS.find((r) => r.key === resKey) || null;
  const cw = Math.round(Number(customW));
  const ch = Math.round(Number(customH));
  const customValid = resKey === 'custom' && cw >= 64 && cw <= 8192 && ch >= 64 && ch <= 8192;
  const res =
    preset != null
      ? { w: preset.w, h: preset.h }
      : customValid
        ? { w: cw, h: ch }
        : null;

  // The ribbon route honors ?canvas=WxH (renders at that fixed pixel canvas,
  // letterboxed); the board contain-scales to its container so it needs no
  // query. So only the ribbon carries the canvas override.
  const src =
    res && surface.key === 'ribbon'
      ? `/${surface.path}/${gameId}?canvas=${res.w}x${res.h}`
      : `/${surface.path}/${gameId}`;

  // Box geometry: a chosen resolution sets the true aspect; otherwise the
  // surface's own default (16:9 board / a ribbon strip).
  const boxStyle: React.CSSProperties = res
    ? { aspectRatio: `${res.w} / ${res.h}` }
    : surface.aspect
      ? { aspectRatio: surface.aspect }
      : { height: surface.height };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {SURFACES.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setKey(s.key)}
              className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors ${
                key === s.key
                  ? 'border-indigo-600 bg-indigo-600 text-white'
                  : 'border-slate-200 text-slate-600 hover:border-indigo-300'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {/* item D — resolution picker */}
          <label className="sr-only" htmlFor="surface-res">Preview resolution</label>
          <select
            id="surface-res"
            value={resKey}
            onChange={(e) => setResKey(e.target.value)}
            className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 bg-white cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-400"
            title="Preview at a specific screen resolution"
          >
            <option value="">Fit to panel</option>
            {RES_PRESETS.map((r) => (
              <option key={r.key} value={r.key}>{r.label}</option>
            ))}
            <option value="custom">Custom…</option>
          </select>
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            className="flex shrink-0 items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
          >
            Open on screen <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      {resKey === 'custom' && (
        <div className="mb-2 flex items-center gap-1.5 text-xs text-slate-500">
          <span>Custom px:</span>
          <input
            type="number" min={64} max={8192} value={customW}
            onChange={(e) => setCustomW(e.target.value)} placeholder="W"
            className="w-20 rounded border border-slate-200 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <span>×</span>
          <input
            type="number" min={64} max={8192} value={customH}
            onChange={(e) => setCustomH(e.target.value)} placeholder="H"
            className="w-20 rounded border border-slate-200 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          {!customValid && (customW || customH) && (
            <span className="text-[11px] text-amber-600">64–8192 each</span>
          )}
        </div>
      )}

      <div
        className="overflow-hidden rounded-lg border border-slate-200 bg-slate-950"
        style={boxStyle}
      >
        {/* the real public surface — a live mirror of the screen */}
        <iframe
          key={`${key}:${src}`}
          src={src}
          title={`${surface.label} preview`}
          className="h-full w-full"
          style={{ border: 0 }}
        />
      </div>

      <p className="mt-1.5 text-xs text-slate-400">
        {res ? (
          <>
            Previewing at <span className="font-semibold text-slate-500">{res.w}×{res.h}</span>
            {surface.key !== 'ribbon' && ' (16:9 looks identical at any resolution — a different shape pillar/letterboxes)'}
            . Live — reflects every edit within ~1s.
          </>
        ) : (
          <>
            Live preview — reflects sponsors, images, messages, presets and the score within
            ~1s as you edit. Pick a resolution above to check the exact shape your screen shows.
          </>
        )}
      </p>

      {/* Streaming a game on NFHS Network / Hudl / OBS? The Scorebug
          surface doubles as a transparent broadcast overlay. Surface
          the copy-URL + Browser-Source helper right here, next to the
          live preview, so the operator finds it while setting up the
          broadcast. */}
      {key === 'scorebug' && <StreamOverlayHelper gameId={gameId} />}
    </div>
  );
}

/**
 * "Copy stream-overlay URL" + a 2-line "Add as a Browser Source in
 * OBS / vMix / Hudl" helper. Points at the full-canvas /overlay route
 * (the broadcast variant that pins the bug inside a fixed 1920×1080
 * canvas so it renders identically at 720p / 1080p / 4K output).
 */
function StreamOverlayHelper({ gameId }: { gameId: string }) {
  const [copied, setCopied] = useState(false);

  const overlayUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/overlay/${gameId}?surface=stream`
      : `/overlay/${gameId}?surface=stream`;

  const copy = () => {
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    };
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(overlayUrl)
        .then(done)
        .catch(() => window.prompt('Copy the stream-overlay URL:', overlayUrl));
    } else if (typeof window !== 'undefined') {
      window.prompt('Copy the stream-overlay URL:', overlayUrl);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold text-indigo-900">Stream overlay (OBS / vMix / Hudl)</p>
          <p className="mt-0.5 text-[11px] leading-snug text-indigo-700/80">
            Transparent broadcast scorebug, driven by this same game — your stream
            and the in-venue board can never disagree.
          </p>
        </div>
        <button
          type="button"
          onClick={copy}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-700"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied!' : 'Copy URL'}
        </button>
      </div>

      <code className="mt-2 block truncate rounded border border-indigo-200 bg-white px-2 py-1 text-[11px] text-slate-700">
        {overlayUrl}
      </code>

      {/* The 2-line "how to add it" helper. */}
      <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-[11px] leading-snug text-indigo-800/80">
        <li>
          In OBS / vMix / Hudl, add a <strong>Browser Source</strong> and paste this URL.
        </li>
        <li>
          Set its size to your stream canvas (e.g. <strong>1920 × 1080</strong>) — the
          background is transparent, so the bug composites over your video.
        </li>
      </ol>
    </div>
  );
}
