'use client';

/**
 * VenueOS Sports — ribbon sponsor manager.
 *
 * Sponsors scroll across the LED ribbon board (and the scoreboard's
 * banner slot) alongside the live score and player cards. This panel
 * is the operator's "upload a brand, it scrolls" surface — the thing
 * that turns the ribbon into sellable ad inventory.
 *
 * Sponsors are tenant-wide: add a brand once and it rotates on every
 * game's ribbon (same model as the cue deck). `weight` controls how
 * often a sponsor comes around per loop. Logo upload reuses the
 * hardened /assets/upload chain.
 */

import { useRef, useState } from 'react';
import { Plus, Pencil, Trash2, Loader2, X, Upload, ImageIcon, Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useSponsors,
  useCreateSponsor,
  useUpdateSponsor,
  useDeleteSponsor,
} from '@/hooks/use-api';
import { useUIStore } from '@/store/ui-store';
import { API_URL } from '@/lib/api-url';

interface Sponsor {
  id: string;
  name: string;
  logoUrl?: string | null;
  tagline?: string | null;
  color?: string | null;
  tier?: string | null;
  weight: number;
  active: boolean;
}

/** Common sponsor-tier labels — offered as datalist hints, freeform. */
const TIER_SUGGESTIONS = ['Title', 'Presenting', 'Gold', 'Silver', 'Bronze', 'Community'];

/** Upload one logo file, return its hosted URL. Reuses /assets/upload. */
async function uploadLogo(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  // Bypass the JSON apiFetch helper — multipart needs its own boundary.
  const token = useUIStore.getState().token;
  const res = await fetch(`${API_URL}/assets/upload`, {
    method: 'POST',
    body: fd,
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Logo upload failed (${res.status}) ${t}`.trim());
  }
  const data = await res.json().catch(() => ({}) as any);
  const url = data.fileUrl || data.url || data?.asset?.fileUrl || '';
  if (!url) throw new Error('Upload succeeded but no URL came back.');
  return url;
}

export function SponsorPanel() {
  const { data, isLoading } = useSponsors();
  const create = useCreateSponsor();
  const update = useUpdateSponsor();
  const remove = useDeleteSponsor();
  const [editing, setEditing] = useState<Sponsor | 'new' | null>(null);

  const sponsors: Sponsor[] = Array.isArray(data) ? data : [];
  const activeCount = sponsors.filter((s) => s.active).length;

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-xs text-slate-400">
          Sponsors scroll across the LED ribbon alongside the score and player cards.
          Add a brand once — its logo rotates on every game&rsquo;s ribbon. Put the ribbon
          on a screen with <span className="font-semibold text-slate-500">Put it on your
          screens</span> above.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 shrink-0"
          onClick={() => setEditing('new')}
        >
          <Plus className="h-3.5 w-3.5" /> Add sponsor
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-400 py-3">Loading sponsors…</p>
      ) : sponsors.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center">
          <Megaphone className="h-6 w-6 text-slate-300 mx-auto mb-1.5" />
          <p className="text-sm text-slate-400">
            No sponsors yet — add a brand&rsquo;s logo and it starts scrolling on the ribbon.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {sponsors.map((s) => (
            <SponsorRow
              key={s.id}
              sponsor={s}
              busy={update.isPending}
              onEdit={() => setEditing(s)}
              onToggle={() => update.mutate({ id: s.id, data: { active: !s.active } })}
            />
          ))}
        </div>
      )}

      {sponsors.length > 0 && (
        <p className="text-[11px] text-slate-400 mt-2">
          {activeCount} of {sponsors.length} active on the ribbon. Higher rotation
          weight = a brand comes around more often per loop.
        </p>
      )}

      {editing && (
        <SponsorEditorModal
          sponsor={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (vals) => {
            if (editing === 'new') await create.mutateAsync(vals);
            else await update.mutateAsync({ id: editing.id, data: vals });
            setEditing(null);
          }}
          onDelete={
            editing === 'new'
              ? undefined
              : async () => {
                  await remove.mutateAsync(editing.id);
                  setEditing(null);
                }
          }
        />
      )}
    </div>
  );
}

function SponsorRow({
  sponsor,
  busy,
  onEdit,
  onToggle,
}: {
  sponsor: Sponsor;
  busy: boolean;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const s = sponsor;
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-slate-200 px-2.5 py-2">
      {s.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={s.logoUrl}
          alt=""
          className="h-10 w-10 rounded-md object-contain bg-slate-50 ring-1 ring-slate-100 shrink-0"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
          }}
        />
      ) : (
        <div
          className="h-10 w-10 rounded-md flex items-center justify-center shrink-0"
          style={{ background: s.color || '#eef2ff' }}
        >
          <ImageIcon className="h-4 w-4 text-white/80" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-800 truncate">{s.name}</div>
        <div className="text-[11px] text-slate-500 truncate">
          {s.tier ? <span className="font-semibold text-slate-600">{s.tier}</span> : null}
          {s.tier ? '  ·  ' : ''}
          rotation &times;{s.weight}
          {s.tagline ? `  ·  ${s.tagline}` : ''}
        </div>
      </div>
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold cursor-pointer transition-colors disabled:opacity-50 ${
          s.active
            ? 'bg-green-100 text-green-700 hover:bg-green-200'
            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
        }`}
        title={s.active ? 'Showing on the ribbon — click to pause' : 'Paused — click to show on the ribbon'}
      >
        {s.active ? 'On ribbon' : 'Off'}
      </button>
      <button
        type="button"
        onClick={onEdit}
        className="p-1.5 text-slate-400 hover:text-slate-700 shrink-0 cursor-pointer"
        aria-label="Edit sponsor"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function SponsorEditorModal({
  sponsor,
  onClose,
  onSave,
  onDelete,
}: {
  sponsor: Sponsor | null;
  onClose: () => void;
  onSave: (vals: {
    name: string;
    logoUrl: string;
    tagline: string;
    color: string;
    tier: string;
    weight: number;
    active: boolean;
  }) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [name, setName] = useState(sponsor?.name || '');
  const [logoUrl, setLogoUrl] = useState(sponsor?.logoUrl || '');
  const [tagline, setTagline] = useState(sponsor?.tagline || '');
  const [color, setColor] = useState(sponsor?.color || '#4f46e5');
  const [tier, setTier] = useState(sponsor?.tier || '');
  const [weight, setWeight] = useState(sponsor?.weight || 1);
  const [active, setActive] = useState(sponsor ? sponsor.active : true);
  const [busy, setBusy] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const pickLogo = async (file: File | undefined) => {
    if (!file) return;
    setLogoBusy(true);
    setErr('');
    try {
      setLogoUrl(await uploadLogo(file));
    } catch (e: any) {
      setErr(e?.message || 'Logo upload failed.');
    } finally {
      setLogoBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const save = async () => {
    if (!name.trim()) {
      setErr('Sponsor name is required.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await onSave({
        name: name.trim(),
        logoUrl: logoUrl.trim(),
        tagline: tagline.trim(),
        color: color.trim(),
        tier: tier.trim(),
        weight,
        active,
      });
    } catch (e: any) {
      setErr(e?.message || 'Could not save the sponsor.');
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
            {sponsor ? 'Edit sponsor' : 'New sponsor'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* logo */}
        <div
          className="rounded-lg bg-slate-100 overflow-hidden flex items-center justify-center"
          style={{ aspectRatio: '16 / 9' }}
        >
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="w-full h-full object-contain" />
          ) : (
            <ImageIcon className="h-6 w-6 text-slate-300" />
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => pickLogo(e.target.files?.[0])}
          />
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={logoBusy}
            onClick={() => fileRef.current?.click()}
          >
            {logoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {logoUrl ? 'Replace logo' : 'Upload logo'}
          </Button>
          {logoUrl && (
            <button
              type="button"
              onClick={() => setLogoUrl('')}
              className="text-xs text-slate-400 hover:text-red-600 cursor-pointer"
            >
              Remove
            </button>
          )}
        </div>

        <div className="space-y-3 mt-4">
          <Field label="Sponsor name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Hardware"
              maxLength={120}
            />
          </Field>
          <Field label="Tagline" hint="Optional — shows under the name on the ribbon.">
            <Input
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="Your hometown hardware store since 1962"
              maxLength={160}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tier" hint="Optional label.">
              <Input
                value={tier}
                onChange={(e) => setTier(e.target.value)}
                placeholder="Gold"
                maxLength={40}
                list="sponsor-tiers"
              />
              <datalist id="sponsor-tiers">
                {TIER_SUGGESTIONS.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </Field>
            <Field label="Banner accent">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#4f46e5'}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-9 w-12 rounded border border-slate-200 cursor-pointer bg-white p-0.5"
                  aria-label="Banner accent color"
                />
                <Input
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder="#4f46e5"
                  maxLength={32}
                />
              </div>
            </Field>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-500">
              Rotation weight — {weight}
            </label>
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={weight}
              onChange={(e) => setWeight(Number(e.target.value))}
              className="w-full mt-1 accent-indigo-600 cursor-pointer"
            />
            <p className="text-[11px] text-slate-400">
              Higher = this brand comes around more often on the ribbon loop.
            </p>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4 accent-indigo-600 cursor-pointer"
            />
            <span className="text-sm font-medium text-slate-700">
              Show on the ribbon now
            </span>
          </label>
        </div>

        {err && <p className="mt-3 text-xs text-red-600 font-medium">{err}</p>}

        <div className="mt-5 flex items-center gap-2">
          <Button onClick={save} disabled={busy || !name.trim()} className="gap-1.5">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {sponsor ? 'Save' : 'Add sponsor'}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              className="ml-auto text-xs font-semibold text-red-600 hover:text-red-700 flex items-center gap-1 cursor-pointer disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-500">{label}</label>
      <div className="mt-1">{children}</div>
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}
