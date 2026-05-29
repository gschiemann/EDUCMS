'use client';

/**
 * VenueOS Sports — team roster manager.
 *
 * Build each side's roster: add a player (name, number, position),
 * upload a headshot, and edit a flexible stat map — or bulk-import the
 * whole roster from a CSV exported out of a spreadsheet. The roster
 * feeds the player cards on the scoreboard and the ribbon.
 *
 * Player photos go through the existing /assets/upload endpoint (the
 * hardened Supabase upload chain) — we just store the returned URL.
 */

import { useRef, useState } from 'react';
import { UserPlus, Upload, Pencil, Trash2, Loader2, X, ImageIcon, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useGameRoster, useRosterMutations, type RosterPlayer } from '@/hooks/use-api';
import { AssetPicker } from '@/components/assets/AssetPicker';
import { useOverlayLock } from '@/hooks/use-overlay-lock';

type Editing =
  | { mode: 'add'; team: 'home' | 'away' }
  | { mode: 'edit'; player: RosterPlayer }
  | null;

export function RosterPanel({
  gameId,
  homeTeam,
  awayTeam,
  statKeys,
}: {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  statKeys: string[];
}) {
  const { data, isLoading } = useGameRoster(gameId);
  const m = useRosterMutations(gameId);
  const [editing, setEditing] = useState<Editing>(null);
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvMsg, setCsvMsg] = useState('');
  const csvInput = useRef<HTMLInputElement>(null);

  const roster: RosterPlayer[] = Array.isArray(data) ? data : [];
  const home = roster.filter((p) => p.team !== 'away');
  const away = roster.filter((p) => p.team === 'away');

  /**
   * Download a ready-to-fill CSV template. Header is the exact column
   * set the importer expects — `team,name,number,position` plus this
   * sport's typical stat columns — followed by two example rows the
   * operator overwrites with their real roster. Generated client-side
   * (no server round-trip) as a Blob download.
   */
  const downloadTemplate = () => {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const cols = ['team', 'name', 'number', 'position', ...statKeys];
    // team = the literal word `home` or `away`; position is optional.
    const exampleRow = (team: string, name: string, num: string) =>
      [team, name, num, '', ...statKeys.map(() => '')].map(esc).join(',');
    const csv =
      [
        cols.map(esc).join(','),
        exampleRow('home', 'Example Player A', '12'),
        exampleRow('away', 'Example Player B', '7'),
      ].join('\r\n') + '\r\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'roster-template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const onCsv = async (file: File | undefined) => {
    if (!file) return;
    setCsvBusy(true);
    setCsvMsg('');
    try {
      const text = await file.text();
      const res: any = await m.importCsv.mutateAsync(text);
      const n = Array.isArray(res) ? res.length : 0;
      setCsvMsg(`Imported — the roster now has ${n} player${n === 1 ? '' : 's'}.`);
    } catch (e: any) {
      setCsvMsg(e?.message || 'CSV import failed.');
    } finally {
      setCsvBusy(false);
      if (csvInput.current) csvInput.current.value = '';
    }
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-xs text-slate-400">
          Build each side&rsquo;s roster — players, headshots, and stats. It drives the
          player cards on the scoreboard and the ribbon.
        </p>
        <div className="shrink-0 flex items-center gap-2">
          <input
            ref={csvInput}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => onCsv(e.target.files?.[0])}
          />
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={downloadTemplate}
            title="Download a ready-to-fill CSV with the correct columns"
          >
            <Download className="h-4 w-4" />
            Template
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={csvBusy}
            onClick={() => csvInput.current?.click()}
          >
            {csvBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Import CSV
          </Button>
        </div>
      </div>
      <p className="text-[11px] text-slate-400 mb-3">
        Download the <strong className="font-semibold text-slate-500">Template</strong>,
        fill it in a spreadsheet, then <strong className="font-semibold text-slate-500">Import CSV</strong>{' '}
        — you can still edit players and add photos after. Columns:{' '}
        <code className="text-slate-500">team, name, number, position</code>{' '}
        plus stat columns. <code className="text-slate-500">team</code> is{' '}
        <code className="text-slate-500">home</code> or <code className="text-slate-500">away</code>.
        One player per row.
      </p>
      {csvMsg && <p className="text-xs text-slate-500 mb-3">{csvMsg}</p>}

      <div className="grid md:grid-cols-2 gap-4">
        <TeamColumn
          label={homeTeam || 'Home'}
          players={home}
          onAdd={() => setEditing({ mode: 'add', team: 'home' })}
          onEdit={(p) => setEditing({ mode: 'edit', player: p })}
          onDelete={(p) => m.remove.mutate(p.id)}
        />
        <TeamColumn
          label={awayTeam || 'Away'}
          players={away}
          onAdd={() => setEditing({ mode: 'add', team: 'away' })}
          onEdit={(p) => setEditing({ mode: 'edit', player: p })}
          onDelete={(p) => m.remove.mutate(p.id)}
        />
      </div>

      {isLoading && <p className="text-sm text-slate-400 mt-2">Loading roster…</p>}

      {editing && (
        <PlayerEditorModal
          editing={editing}
          statKeys={statKeys}
          onClose={() => setEditing(null)}
          onSave={async (vals) => {
            if (editing.mode === 'add') {
              await m.add.mutateAsync({ ...vals, team: editing.team });
            } else {
              await m.update.mutateAsync({ playerId: editing.player.id, ...vals });
            }
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function TeamColumn({
  label,
  players,
  onAdd,
  onEdit,
  onDelete,
}: {
  label: string;
  players: RosterPlayer[];
  onAdd: () => void;
  onEdit: (p: RosterPlayer) => void;
  onDelete: (p: RosterPlayer) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-slate-800 truncate">
          {label} <span className="text-slate-400 font-medium">· {players.length}</span>
        </h3>
        <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={onAdd}>
          <UserPlus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>
      {players.length === 0 ? (
        <p className="text-xs text-slate-400 py-4 text-center">
          No players yet — add one, or import a CSV.
        </p>
      ) : (
        <div className="space-y-1.5">
          {players.map((p) => (
            <PlayerRow
              key={p.id}
              player={p}
              onEdit={() => onEdit(p)}
              onDelete={() => onDelete(p)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PlayerRow({
  player,
  onEdit,
  onDelete,
}: {
  player: RosterPlayer;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const statKeys = Object.keys(player.stats || {});
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-slate-200 px-2.5 py-2">
      {player.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={player.photoUrl}
          alt=""
          className="h-10 w-10 rounded-md object-cover bg-slate-100 shrink-0"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
          }}
        />
      ) : (
        <div className="h-10 w-10 rounded-md bg-slate-100 flex items-center justify-center shrink-0">
          <ImageIcon className="h-4 w-4 text-slate-300" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-800 truncate">
          {player.number ? <span className="text-slate-400">#{player.number} </span> : null}
          {player.name}
        </div>
        <div className="text-[11px] text-slate-500 truncate">
          {player.position || '—'}
          {statKeys.length > 0 && (
            <span className="text-slate-400">
              {'  ·  '}
              {statKeys
                .slice(0, 4)
                .map((k) => `${k} ${player.stats[k]}`)
                .join('   ')}
            </span>
          )}
        </div>
      </div>
      <button
        onClick={onEdit}
        className="p-1.5 text-slate-400 hover:text-slate-700 shrink-0"
        aria-label="Edit player"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={onDelete}
        className="p-1.5 text-slate-400 hover:text-red-600 shrink-0"
        aria-label="Remove player"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function PlayerEditorModal({
  editing,
  statKeys,
  onClose,
  onSave,
}: {
  editing: Exclude<Editing, null>;
  statKeys: string[];
  onClose: () => void;
  onSave: (vals: Partial<RosterPlayer>) => Promise<void>;
}) {
  useOverlayLock(); // hide mobile tab bar so the modal footer clears it
  const existing = editing.mode === 'edit' ? editing.player : null;
  const [name, setName] = useState(existing?.name || '');
  const [number, setNumber] = useState(existing?.number || '');
  const [position, setPosition] = useState(existing?.position || '');
  const [photoUrl, setPhotoUrl] = useState(existing?.photoUrl || '');
  const [stats, setStats] = useState<Array<{ k: string; v: string }>>(() => {
    const rows = Object.entries(existing?.stats || {}).map(([k, v]) => ({ k, v: String(v) }));
    // Seed the sport's typical player stats so the keys make sense for
    // this sport (basketball → PTS/REB/AST, not baseball's AVG/HR).
    for (const key of statKeys) {
      if (rows.length >= 6) break;
      if (!rows.some((r) => r.k.toUpperCase() === key.toUpperCase())) {
        rows.push({ k: key, v: '' });
      }
    }
    while (rows.length < 4) rows.push({ k: '', v: '' });
    return rows;
  });
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [err, setErr] = useState('');

  const setStat = (i: number, key: 'k' | 'v', val: string) =>
    setStats((s) => s.map((row, idx) => (idx === i ? { ...row, [key]: val } : row)));

  const save = async () => {
    if (!name.trim()) {
      setErr('Player name is required.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const statMap: Record<string, string> = {};
      for (const { k, v } of stats) {
        if (k.trim() && v.trim()) statMap[k.trim()] = v.trim();
      }
      await onSave({
        name: name.trim(),
        number: number.trim(),
        position: position.trim(),
        photoUrl: photoUrl.trim(),
        stats: statMap,
      });
    } catch (e: any) {
      setErr(e?.message || 'Could not save the player.');
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
          <h3 className="text-base font-bold text-slate-900">
            {editing.mode === 'add' ? 'Add player' : 'Edit player'}
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* headshot */}
        <div className="flex items-center gap-3 mb-4">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl}
              alt=""
              className="h-16 w-16 rounded-lg object-cover bg-slate-100 ring-1 ring-slate-200"
            />
          ) : (
            <div className="h-16 w-16 rounded-lg bg-slate-100 flex items-center justify-center">
              <ImageIcon className="h-5 w-5 text-slate-300" />
            </div>
          )}
          <div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setPickerOpen(true)}
            >
              <ImageIcon className="h-4 w-4" />
              {photoUrl ? 'Replace photo' : 'Choose photo'}
            </Button>
            {photoUrl && (
              <button
                type="button"
                onClick={() => setPhotoUrl('')}
                className="ml-2 text-xs text-slate-400 hover:text-red-600 cursor-pointer"
              >
                Remove
              </button>
            )}
          </div>
        </div>
        {pickerOpen && (
          <AssetPicker
            kind="image"
            title="Choose player photo"
            onPick={(url) => {
              setPhotoUrl(url);
              setPickerOpen(false);
            }}
            onClose={() => setPickerOpen(false)}
          />
        )}

        <div className="space-y-3">
          <EditorField label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Mookie Betts"
              maxLength={80}
            />
          </EditorField>
          <div className="grid grid-cols-2 gap-3">
            <EditorField label="Number">
              <Input
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="50"
                maxLength={8}
              />
            </EditorField>
            <EditorField label="Position">
              <Input
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                placeholder="RF"
                maxLength={24}
              />
            </EditorField>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Stats</label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {stats.map((row, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Input
                    className="w-20"
                    value={row.k}
                    onChange={(e) => setStat(i, 'k', e.target.value)}
                    placeholder="Stat"
                    maxLength={24}
                  />
                  <Input
                    value={row.v}
                    onChange={(e) => setStat(i, 'v', e.target.value)}
                    placeholder="Value"
                    maxLength={40}
                  />
                </div>
              ))}
            </div>
            <button
              onClick={() => setStats((s) => [...s, { k: '', v: '' }])}
              className="mt-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
            >
              + Add stat
            </button>
          </div>
        </div>

        {err && <p className="mt-3 text-xs text-red-600 font-medium">{err}</p>}

        <div className="mt-5 flex items-center gap-2">
          <Button onClick={save} disabled={busy || !name.trim()} className="gap-1.5">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {editing.mode === 'add' ? 'Add player' : 'Save'}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

function EditorField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-500">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
