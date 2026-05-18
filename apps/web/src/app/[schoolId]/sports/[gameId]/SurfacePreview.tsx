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
 */

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';

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
    </div>
  );
}
