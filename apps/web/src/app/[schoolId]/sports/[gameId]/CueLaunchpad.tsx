'use client';

/**
 * VenueOS Sports — the cue launchpad.
 *
 * ONE grid for every cue the operator can fire: the sport's built-in
 * celebrations ("Touchdown", "GOAL!", "Home Run") AND their own
 * custom cue-deck triggers (a sponsor takeover, a hype graphic).
 *
 * Above the grid is the TARGET picker — the operator decides, before
 * tapping, where the cue lands: the scoreboards, the ribbon boards,
 * or every screen showing the game. As a venue grows to hundreds of
 * displays, "Everywhere" lights up all of them from one tap.
 *
 * Custom cues are still managed here (the "New cue" tile + the hover
 * pencil open the editor); the upload reuses the hardened
 * /assets/upload chain.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Plus, Pencil, Trash2, Loader2, X, ImageIcon, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCues, useCueMutations, useGameControl, type CustomCue } from '@/hooks/use-api';
import { AssetPicker } from '@/components/assets/AssetPicker';
import { useOverlayLock } from '@/hooks/use-overlay-lock';
import type { SportDefinition } from '@cms/api-types';

/** Which surfaces a fired cue lands on. */
type CueTarget = 'ALL' | 'BOARD' | 'RIBBON';

const TARGETS: { key: CueTarget; label: string; desc: string }[] = [
  { key: 'ALL', label: 'Everywhere', desc: 'Every screen showing this game — scoreboards + ribbons.' },
  { key: 'BOARD', label: 'Scoreboard', desc: 'Scoreboards and broadcast scorebugs only.' },
  { key: 'RIBBON', label: 'Ribbon', desc: 'Ribbon and fascia boards only.' },
];

/** The target picker — a 3-way segmented control. */
function TargetPicker({
  value,
  onChange,
}: {
  value: CueTarget;
  onChange: (t: CueTarget) => void;
}) {
  return (
    <div className="mb-3">
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
        Fire to
      </p>
      <div className="flex gap-1.5">
        {TARGETS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors ${
              value === t.key
                ? 'border-indigo-600 bg-indigo-600 text-white'
                : 'border-slate-200 text-slate-600 hover:border-indigo-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-slate-400">
        {TARGETS.find((t) => t.key === value)?.desc}
      </p>
    </div>
  );
}

/** One launchpad tile — a fixed-height face + a label strip. */
function LaunchTile({
  face,
  label,
  fired,
  onFire,
  onEdit,
}: {
  face: ReactNode;
  label: string;
  fired: boolean;
  onFire: () => void;
  onEdit?: () => void;
}) {
  return (
    <div className="relative group">
      <button
        type="button"
        onClick={onFire}
        className={`w-full overflow-hidden rounded-xl border-2 transition-all ${
          fired
            ? 'border-green-500 scale-95'
            : 'border-slate-200 hover:border-indigo-300 hover:bg-indigo-50'
        }`}
      >
        <div className="flex h-16 items-center justify-center">{face}</div>
        <div className="truncate px-2 py-1.5 text-center text-xs font-semibold text-slate-700">
          {fired ? 'Fired!' : label}
        </div>
      </button>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="absolute right-1 top-1 rounded bg-white/90 p-1 text-slate-500 opacity-0 transition-opacity group-hover:opacity-100"
          aria-label="Edit cue"
        >
          <Pencil className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

export function CueLaunchpad({
  gameId,
  def,
  onFired,
}: {
  gameId: string;
  def: SportDefinition;
  /** Called shortly after a cue fires — lets a host popup auto-close. */
  onFired?: () => void;
}) {
  const { data, isLoading } = useCues();
  const m = useCueMutations();
  const ctl = useGameControl(gameId);

  const [target, setTarget] = useState<CueTarget>('ALL');
  const [editing, setEditing] = useState<CustomCue | 'new' | null>(null);
  const [fired, setFired] = useState<string | null>(null);
  const firedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (firedTimer.current) clearTimeout(firedTimer.current);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const customCues: CustomCue[] = Array.isArray(data) ? data : [];

  // Flash "Fired!" on the tapped tile — keyed by a tile id so a
  // built-in and a custom cue can't collide.
  const flash = (tileId: string) => {
    setFired(tileId);
    if (firedTimer.current) clearTimeout(firedTimer.current);
    firedTimer.current = setTimeout(() => setFired(null), 1500);
  };

  // After a cue fires: if hosted in a popup, let the host auto-close
  // after a beat — the operator sees it land, then drops straight back
  // to the live Run screen.
  const afterFire = () => {
    if (!onFired) return;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(onFired, 650);
  };

  const fireBuiltin = (key: string) => {
    ctl.cue.mutate({ key, target });
    flash(`builtin:${key}`);
    afterFire();
  };
  const fireCustom = (cue: CustomCue) => {
    ctl.cue.mutate({ cueId: cue.id, target });
    flash(`custom:${cue.id}`);
    afterFire();
  };

  return (
    <div>
      <p className="mb-3 text-xs text-slate-400">
        Tap a cue to fire the celebration. Built-in celebrations and your own custom
        cues all live here — pick where it fires above first.
      </p>

      <TargetPicker value={target} onChange={setTarget} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {/* built-in sport celebrations */}
        {def.celebrations.map((c) => (
          <LaunchTile
            key={`builtin:${c.key}`}
            label={c.label}
            fired={fired === `builtin:${c.key}`}
            onFire={() => fireBuiltin(c.key)}
            face={
              <div className="flex h-full w-full items-center justify-center bg-slate-100">
                <span className="text-3xl">{c.emoji}</span>
              </div>
            }
          />
        ))}

        {/* operator-built custom cues */}
        {customCues.map((c) => (
          <LaunchTile
            key={`custom:${c.id}`}
            label={c.name}
            fired={fired === `custom:${c.id}`}
            onFire={() => fireCustom(c)}
            onEdit={() => setEditing(c)}
            face={
              <div
                className="flex h-full w-full items-center justify-center bg-cover bg-center"
                style={{
                  backgroundImage: c.mediaUrl ? `url(${c.mediaUrl})` : undefined,
                  backgroundColor: !c.mediaUrl ? c.color || '#e2e8f0' : undefined,
                }}
              >
                {!c.mediaUrl && <Zap className="h-5 w-5 text-slate-400" />}
              </div>
            }
          />
        ))}

        {/* new custom cue */}
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="flex h-[88px] flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 text-slate-400 transition-colors hover:border-indigo-400 hover:text-indigo-500"
        >
          <Plus className="h-5 w-5" />
          <span className="text-xs font-semibold">New cue</span>
        </button>
      </div>

      {isLoading && (
        <p className="mt-2 text-xs text-slate-400">Loading custom cues…</p>
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

/** Create / edit a custom cue — a named button + its takeover content. */
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
  useOverlayLock(); // hide mobile tab bar so the modal footer clears it
  // a11y wave (2026-08-24) — jsx-a11y/label-has-associated-control.
  const nameFieldId = useId();
  const [name, setName] = useState(cue?.name || '');
  const [mediaUrl, setMediaUrl] = useState(cue?.mediaUrl || '');
  const [durationMs, setDurationMs] = useState(cue?.durationMs || 6000);
  const [displayMode, setDisplayMode] = useState<'overlay' | 'takeover'>(
    (cue?.displayMode as 'overlay' | 'takeover') || 'overlay',
  );
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
      await onSave({ name: name.trim(), mediaUrl: mediaUrl.trim(), durationMs, displayMode });
    } catch (e: any) {
      setErr(e?.message || 'Could not save the cue.');
      setBusy(false);
    }
  };

  return (
    // Backdrop — mouse-only convenience; the aria-label="Close" button
    // below is the keyboard/AT-accessible dismissal path. a11y wave
    // (2026-08-24).
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900">{cue ? 'Edit cue' : 'New cue'}</h3>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-hidden rounded-lg bg-slate-100" style={{ aspectRatio: '16 / 9' }}>
          {mediaUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaUrl} alt="" className="h-full w-full object-contain" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
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
              className="cursor-pointer text-xs text-slate-400 hover:text-red-600"
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

        {/* a11y wave (2026-08-24) — jsx-a11y/label-has-associated-control */}
        <label htmlFor={nameFieldId} className="mt-4 block text-xs font-semibold text-slate-500">Button name</label>
        <Input
          id={nameFieldId}
          className="mt-1"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="T-Shirt Toss"
          maxLength={60}
        />

        {/* How the cue shows on the board — overlay (board stays visible)
            vs full-screen takeover. a11y wave (2026-08-24) — heads a row
            of choice buttons below, not one control
            (jsx-a11y/label-has-associated-control). */}
        <div className="mt-3 block text-xs font-semibold text-slate-500">On the board</div>
        <div className="mt-1 flex gap-1.5">
          {([
            ['overlay', 'Overlay', 'Drops into a lower band — score stays visible'],
            ['takeover', 'Full screen', 'Covers the whole board'],
          ] as const).map(([v, label, hint]) => (
            <button
              key={v}
              type="button"
              title={hint}
              onClick={() => setDisplayMode(v)}
              className={`flex-1 rounded-lg border px-2 py-2 text-xs font-bold transition-colors ${
                displayMode === v
                  ? 'border-indigo-600 bg-indigo-600 text-white'
                  : 'border-slate-200 text-slate-600 hover:border-indigo-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="mt-3 block text-xs font-semibold text-slate-500">
          On screen for {(durationMs / 1000).toFixed(0)}s
        </label>
        <input
          type="range"
          min={2000}
          max={20000}
          step={1000}
          value={durationMs}
          onChange={(e) => setDurationMs(Number(e.target.value))}
          className="mt-1 w-full accent-indigo-600"
        />

        {err && <p className="mt-3 text-xs font-medium text-red-600">{err}</p>}

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
              className="ml-auto flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
