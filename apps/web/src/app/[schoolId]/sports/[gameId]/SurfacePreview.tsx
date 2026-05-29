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

export function SurfacePreview({ gameId }: { gameId: string }) {
  const [key, setKey] = useState('board');
  const surface = SURFACES.find((s) => s.key === key) || SURFACES[0];
  const src = `/${surface.path}/${gameId}`;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
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
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
        >
          Full screen <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      <div
        className="overflow-hidden rounded-lg border border-slate-200 bg-slate-950"
        style={surface.aspect ? { aspectRatio: surface.aspect } : { height: surface.height }}
      >
        {/* the real public surface — a live mirror of the screen */}
        <iframe
          key={key}
          src={src}
          title={`${surface.label} preview`}
          className="h-full w-full"
          style={{ border: 0 }}
        />
      </div>

      <p className="mt-1.5 text-xs text-slate-400">
        Live preview — reflects sponsors, images, messages, presets and the score
        within ~1s as you edit. Load everything in, watch it here, then push it to
        your screens below.
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
