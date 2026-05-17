'use client';

/**
 * VenueOS Sports — the cue deck.
 *
 * Operator-built triggers. Each cue is a named button with uploaded
 * takeover content; clicking one fires a full-screen takeover on every
 * scoreboard playing the game. The deck is per-tenant — build it once,
 * use it every game (a sponsor takeover, a "Make some noise" graphic,
 * a promo). Content upload reuses the hardened /assets/upload chain.
 */

import { useRef, useState } from 'react';
import { Plus, Pencil, Trash2, Loader2, X, ImageIcon, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCues, useCueMutations, useGameControl, type CustomCue } from '@/hooks/use-api';
import { AssetPicker } from '@/components/assets/AssetPicker';

export function CueDeckPanel({ gameId }: { gameId: string }) {
  const { data, isLoading } = useCues();
  const m = useCueMutations();
  const ctl = useGameControl(gameId);
  const [editing, setEditing] = useState<CustomCue | 'new' | null>(null);
  const [fired, setFired] = useState<string | null>(null);
  const firedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cues: CustomCue[] = Array.isArray(data) ? data : [];

  const fire = (cue: CustomCue) => {
    ctl.cue.mutate({ cueId: cue.id });
    setFired(cue.id);
    if (firedTimer.current) clearTimeout(firedTimer.current);
    firedTimer.current = setTimeout(() => setFired(null), 1600);
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-xs text-slate-400">
          Your own trigger buttons — upload a graphic, name it, and it fires a full-screen
          takeover on the scoreboard on click. Reused across every game.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 shrink-0"
          onClick={() => setEditing('new')}
        >
          <Plus className="h-3.5 w-3.5" /> New cue
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-400">Loading cue deck…</p>
      ) : cues.length === 0 ? (
        <p className="text-sm text-slate-400 py-3">
          No cues yet — create one: a sponsor takeover, a hype graphic, a promo.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {cues.map((c) => (
            <div key={c.id} className="relative group">
              <button
                onClick={() => fire(c)}
                className={`w-full rounded-xl border-2 overflow-hidden transition-all ${
                  fired === c.id
                    ? 'border-green-500 scale-95'
                    : 'border-slate-200 hover:border-indigo-300'
                }`}
              >
                <div
                  className="h-16 bg-slate-100 bg-cover bg-center flex items-center justify-center"
                  style={{
                    backgroundImage: c.mediaUrl ? `url(${c.mediaUrl})` : undefined,
                    backgroundColor: !c.mediaUrl ? c.color || undefined : undefined,
                  }}
                >
                  {!c.mediaUrl && <Zap className="h-5 w-5 text-slate-300" />}
                </div>
                <div className="px-2 py-1.5 text-xs font-semibold text-slate-700 truncate">
                  {fired === c.id ? 'Fired!' : c.name}
                </div>
              </button>
              <button
                onClick={() => setEditing(c)}
                className="absolute top-1 right-1 p-1 rounded bg-white/90 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Edit cue"
              >
                <Pencil className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <CueEditorModal
          cue={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (vals) => {
            if (editing === 'new') await m.create.mutateAsync(vals);
            else await m.update.mutateAsync({ id: editing.id, ...vals });
            setEditing(null);
          }}
          onDelete={
            editing === 'new'
              ? undefined
              : async () => {
                  await m.remove.mutateAsync(editing.id);
                  setEditing(null);
                }
          }
        />
      )}
    </div>
  );
}

function CueEditorModal({
  cue,
  onClose,
  onSave,
  onDelete,
}: {
  cue: CustomCue | null;
  onClose: () => void;
  onSave: (vals: Partial<CustomCue>) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [name, setName] = useState(cue?.name || '');
  const [mediaUrl, setMediaUrl] = useState(cue?.mediaUrl || '');
  const [durationMs, setDurationMs] = useState(cue?.durationMs || 6000);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (!name.trim()) {
      setErr('Cue name is required.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await onSave({ name: name.trim(), mediaUrl: mediaUrl.trim(), durationMs });
    } catch (e: any) {
      setErr(e?.message || 'Could not save the cue.');
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-slate-900">{cue ? 'Edit cue' : 'New cue'}</h3>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="rounded-lg bg-slate-100 overflow-hidden" style={{ aspectRatio: '16 / 9' }}>
          {mediaUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaUrl} alt="" className="w-full h-full object-contain" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <ImageIcon className="h-6 w-6 text-slate-300" />
            </div>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setPickerOpen(true)}
          >
            <ImageIcon className="h-4 w-4" />
            {mediaUrl ? 'Replace content' : 'Choose content'}
          </Button>
          {mediaUrl && (
            <button
              type="button"
              onClick={() => setMediaUrl('')}
              className="text-xs text-slate-400 hover:text-red-600 cursor-pointer"
            >
              Remove
            </button>
          )}
        </div>
        {pickerOpen && (
          <AssetPicker
            kind="image"
            title="Choose cue content"
            onPick={(url) => {
              setMediaUrl(url);
              setPickerOpen(false);
            }}
            onClose={() => setPickerOpen(false)}
          />
        )}

        <label className="text-xs font-semibold text-slate-500 mt-4 block">Button name</label>
        <Input
          className="mt-1"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="T-Shirt Toss"
          maxLength={60}
        />

        <label className="text-xs font-semibold text-slate-500 mt-3 block">
          On screen for {(durationMs / 1000).toFixed(0)}s
        </label>
        <input
          type="range"
          min={2000}
          max={20000}
          step={1000}
          value={durationMs}
          onChange={(e) => setDurationMs(Number(e.target.value))}
          className="w-full mt-1 accent-indigo-600"
        />

        {err && <p className="mt-3 text-xs text-red-600 font-medium">{err}</p>}

        <div className="mt-5 flex items-center gap-2">
          <Button onClick={save} disabled={busy || !name.trim()} className="gap-1.5">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {cue ? 'Save' : 'Create cue'}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {onDelete && (
            <button
              onClick={onDelete}
              disabled={busy}
              className="ml-auto text-xs font-semibold text-red-600 hover:text-red-700 flex items-center gap-1"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
