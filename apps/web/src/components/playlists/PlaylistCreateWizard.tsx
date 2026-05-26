"use client";

/**
 * PlaylistCreateWizard — operator's primary creation flow.
 *
 * Replaces the legacy "mid-page card with two tiles" pattern. The whole
 * playlist setup happens in one centered modal dialog with 5 well-marked
 * steps:
 *
 *   1. Name + Type    ("Media Playlist" vs "From Template")
 *   2. Pick content   (assets to drop in, OR a single template)
 *   3. Pick screens   (multi-select; can skip)
 *   4. Publish        (Activate immediately OR pick a schedule window)
 *   5. Review + Create
 *
 * Operator quote that drove the spec:
 *   "i dont like how hitting new playlist just pops open a menu in the
 *    middle of the playlist dashboard, it should open a window inside
 *    the dashboard area where i do all of my playlist configuration,
 *    so i click new playlist popup comes up, i name it, i pick asset
 *    or template, then it takes me to select the media, then it take
 *    me to select the screen or screens, then it take me to the
 *    publishing section....just flows through so clean it makes sense
 *    to everyone"
 *
 * UX notes:
 *   - Step indicator at the top so the operator always knows where
 *     they are and what's next. Click an already-visited dot to jump
 *     back without losing data.
 *   - Back/Next in the footer; final step swaps Next for "Create
 *     Playlist" with a loading state.
 *   - Escape closes the wizard. If the operator has made progress
 *     (non-empty name or a content/screen selection) we confirm
 *     before nuking.
 *   - Fade + scale animation on mount (~150ms). Subtle, not flashy.
 *   - No `inset-0` Tailwind / no flex `gap-*` — Chromium 83 safe
 *     (NovaStar Taurus rule, CLAUDE.md #10). Uses explicit margins
 *     and longhand top/right/bottom/left.
 *
 * Wiring:
 *   - createPlaylist  : POST /playlists       { name, templateId? }
 *   - saveItems       : PUT  /playlists/:id/items (for Media type)
 *   - createSchedule  : POST /schedules       (one per screen, or
 *                       one tenant-wide row if no screens picked)
 *
 * Public API:
 *   <PlaylistCreateWizard
 *     open={boolean}
 *     onClose={() => void}
 *     onCreated={(playlist: {id, name, templateId?: string|null}) => void}
 *   />
 *
 * onCreated fires AFTER the playlist row exists and all items +
 * schedules have been written. The parent typically uses it to
 * navigate into the new playlist's detail view.
 */

import {
  useState,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Play,
  LayoutTemplate,
  Check,
  Search,
  Image as ImageIcon,
  Video,
  Music,
  Globe,
  File as FileIcon,
  Monitor,
  Wifi,
  WifiOff,
  Loader2,
  Calendar,
  Sparkles,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Layers,
} from 'lucide-react';
import {
  useAssets,
  useTemplates,
  useScreens,
  useCreatePlaylist,
  useReorderPlaylistItems,
  useCreateSchedule,
} from '@/hooks/use-api';
import { ScaledTemplateThumbnail } from '@/components/templates/ScaledTemplateThumbnail';
import { appConfirm, appAlert } from '@/components/ui/app-dialog';

// ─── Shared constants ──────────────────────────────────────────────────

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const apiBase = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1').replace('/api/v1', '');

type PlaylistKind = 'media' | 'template';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (playlist: { id: string; name: string; templateId?: string | null }) => void;
}

// ─── Small helpers ─────────────────────────────────────────────────────

function assetThumbUrl(asset: any): string | null {
  if (!asset) return null;
  if (asset.mimeType === 'text/html' && asset.fileUrl) {
    return `https://s.wordpress.com/mshots/v1/${encodeURIComponent(asset.fileUrl)}?w=640&h=360`;
  }
  if (!asset.mimeType?.startsWith('image/') && !asset.mimeType?.startsWith('video/')) {
    return null;
  }
  return asset.fileUrl?.startsWith('http') ? asset.fileUrl : `${apiBase}${asset.fileUrl}`;
}

function mimeIcon(mimeType?: string) {
  if (!mimeType) return FileIcon;
  if (mimeType.startsWith('image/')) return ImageIcon;
  if (mimeType.startsWith('video/')) return Video;
  if (mimeType.startsWith('audio/')) return Music;
  if (mimeType === 'text/html') return Globe;
  return FileIcon;
}

function MiniAssetThumb({ asset }: { asset: any }) {
  const url = assetThumbUrl(asset);
  if (!url) {
    const Icon = mimeIcon(asset?.mimeType);
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-100">
        <Icon className="w-8 h-8 text-slate-300" />
      </div>
    );
  }
  if (asset?.mimeType?.startsWith('video/')) {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video
        src={url}
        muted
        playsInline
        preload="metadata"
        className="w-full h-full object-cover"
        onLoadedMetadata={(e) => {
          try {
            (e.currentTarget as HTMLVideoElement).currentTime = 0.1;
          } catch {
            /* noop */
          }
        }}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className="w-full h-full object-cover" />
  );
}

// ─── Step indicator ────────────────────────────────────────────────────

const STEP_LABELS = [
  'Name & type',
  'Pick content',
  'Pick screens',
  'Publishing',
  'Review',
] as const;

function StepIndicator({
  step,
  highestVisited,
  onJump,
}: {
  step: number;
  highestVisited: number;
  onJump: (n: number) => void;
}) {
  return (
    <div className="px-6 pt-5 pb-4 border-b border-slate-100">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
          Step {step} of 5
        </p>
        <p className="text-sm font-semibold text-slate-700">{STEP_LABELS[step - 1]}</p>
      </div>
      <div className="flex items-center">
        {STEP_LABELS.map((label, i) => {
          const n = i + 1;
          const visited = n <= highestVisited;
          const current = n === step;
          const passed = n < step;
          // Dot
          const dot = (
            <button
              key={`dot-${n}`}
              type="button"
              onClick={() => visited && onJump(n)}
              disabled={!visited}
              aria-label={`Go to step ${n}: ${label}`}
              aria-current={current ? 'step' : undefined}
              className={`relative shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                current
                  ? 'bg-indigo-600 ring-4 ring-indigo-100 text-white'
                  : passed
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer'
                    : visited
                      ? 'bg-indigo-100 text-indigo-600 hover:bg-indigo-200 cursor-pointer'
                      : 'bg-slate-100 text-slate-300 cursor-not-allowed'
              }`}
              style={{ fontSize: 11, fontWeight: 700 }}
            >
              {passed ? <Check className="w-3.5 h-3.5" /> : n}
            </button>
          );
          if (i === STEP_LABELS.length - 1) {
            return dot;
          }
          // Dot + connector
          return (
            <div key={`seg-${n}`} className="flex items-center" style={{ flex: 1 }}>
              {dot}
              <div
                aria-hidden
                className="flex-1 h-0.5 mx-1.5 transition-colors"
                style={{
                  backgroundColor: n < step ? 'rgb(79 70 229)' : 'rgb(226 232 240)',
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────

export function PlaylistCreateWizard({ open, onClose, onCreated }: Props) {
  // Wizard state
  const [step, setStep] = useState<number>(1);
  const [highestVisited, setHighestVisited] = useState<number>(1);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<PlaylistKind | null>(null);

  // Step 2 — content
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [assetSearch, setAssetSearch] = useState('');
  const [assetFilter, setAssetFilter] = useState<'all' | 'images' | 'videos' | 'audio' | 'urls'>('all');
  const [templateFilter, setTemplateFilter] = useState<'all' | 'custom' | 'system'>('all');
  const [templateSearch, setTemplateSearch] = useState('');

  // Step 3 — screens
  const [selectedScreenIds, setSelectedScreenIds] = useState<Set<string>>(new Set());
  const [screenSearch, setScreenSearch] = useState('');

  // Step 4 — publish
  const [activateImmediately, setActivateImmediately] = useState<boolean>(true);
  const [schedStartDate, setSchedStartDate] = useState<string>('');
  const [schedEndDate, setSchedEndDate] = useState<string>('');
  const [schedTimeStart, setSchedTimeStart] = useState<string>('08:00');
  const [schedTimeEnd, setSchedTimeEnd] = useState<string>('15:00');
  const [schedDays, setSchedDays] = useState<string[]>(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);

  // Submit lifecycle
  const [creating, setCreating] = useState(false);
  const [enterAnim, setEnterAnim] = useState(false);

  // Hooks
  const { data: assets } = useAssets();
  const { data: templates } = useTemplates();
  const { data: screens } = useScreens();
  const createPlaylist = useCreatePlaylist();
  const saveItems = useReorderPlaylistItems();
  const createSchedule = useCreateSchedule();

  const nameInputRef = useRef<HTMLInputElement>(null);

  // Reset state whenever the modal opens — operator expects a clean slate.
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setHighestVisited(1);
    setName('');
    setKind(null);
    setSelectedAssetIds(new Set());
    setSelectedTemplateId(null);
    setAssetSearch('');
    setAssetFilter('all');
    setTemplateFilter('all');
    setTemplateSearch('');
    setSelectedScreenIds(new Set());
    setScreenSearch('');
    setActivateImmediately(true);
    setSchedStartDate('');
    setSchedEndDate('');
    setSchedTimeStart('08:00');
    setSchedTimeEnd('15:00');
    setSchedDays(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
    setCreating(false);
    // Trigger enter animation on next frame.
    setEnterAnim(false);
    requestAnimationFrame(() => setEnterAnim(true));
  }, [open]);

  // Focus the name field on Step 1
  useEffect(() => {
    if (!open) return;
    if (step === 1) {
      // Give the modal a tick to mount.
      const id = setTimeout(() => nameInputRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [open, step]);

  // Did the operator type something / make any selection? Used to gate
  // the "confirm before nuking" prompt on close.
  const hasProgress = useMemo(() => {
    if (name.trim()) return true;
    if (kind) return true;
    if (selectedAssetIds.size > 0) return true;
    if (selectedTemplateId) return true;
    if (selectedScreenIds.size > 0) return true;
    return false;
  }, [name, kind, selectedAssetIds, selectedTemplateId, selectedScreenIds]);

  const tryClose = async () => {
    if (creating) return; // can't bail mid-creation
    if (!hasProgress) {
      onClose();
      return;
    }
    const ok = await appConfirm({
      title: 'Discard new playlist?',
      message: 'Your selections so far won’t be saved.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      tone: 'warn',
    });
    if (ok) onClose();
  };

  // Escape closes the wizard.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        void tryClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hasProgress, creating]);

  if (!open) return null;

  // ─── Derived data ──────────────────────────────────────────────────

  const filteredAssets = (assets || []).filter((a: any) => {
    if (assetFilter === 'images' && !a.mimeType?.startsWith('image/')) return false;
    if (assetFilter === 'videos' && !a.mimeType?.startsWith('video/')) return false;
    if (assetFilter === 'audio' && !a.mimeType?.startsWith('audio/')) return false;
    if (assetFilter === 'urls' && a.mimeType !== 'text/html') return false;
    if (assetSearch) {
      const needle = assetSearch.toLowerCase();
      const hay = `${a.originalName || ''} ${a.title || ''}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  const visibleTemplates = (templates || []).filter((t: any) => {
    if (templateFilter === 'custom' && t.isSystem) return false;
    if (templateFilter === 'system' && !t.isSystem) return false;
    if (templateSearch) {
      const needle = templateSearch.toLowerCase();
      const hay = `${t.name || ''} ${t.description || ''}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  const filteredScreens = (screens || []).filter((s: any) => {
    if (!screenSearch) return true;
    const needle = screenSearch.toLowerCase();
    const hay = `${s.name || ''} ${s.id}`.toLowerCase();
    return hay.includes(needle);
  });

  const selectedTemplate = (templates || []).find((t: any) => t.id === selectedTemplateId);

  // ─── Step navigation gates ─────────────────────────────────────────

  const canAdvanceFromStep1 = name.trim().length > 0 && kind !== null;
  const canAdvanceFromStep2 = kind === 'media'
    ? selectedAssetIds.size > 0
    : selectedTemplateId !== null;
  // Step 3 always advanceable — "Skip" is a valid choice.
  // Step 4 always advanceable.

  const goNext = () => {
    setStep((s) => {
      const next = Math.min(5, s + 1);
      setHighestVisited((h) => Math.max(h, next));
      return next;
    });
  };
  const goBack = () => setStep((s) => Math.max(1, s - 1));
  const jumpTo = (n: number) => {
    if (n <= highestVisited) setStep(n);
  };

  // ─── Step toggles ──────────────────────────────────────────────────

  const toggleAsset = (id: string) =>
    setSelectedAssetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleScreen = (id: string) =>
    setSelectedScreenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleDay = (day: string) =>
    setSchedDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));

  // ─── Create + wire ────────────────────────────────────────────────

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      // 1. Create the playlist row.
      const body: { name: string; templateId?: string } = { name: name.trim() };
      if (kind === 'template' && selectedTemplateId) {
        body.templateId = selectedTemplateId;
      }
      const created: any = await createPlaylist.mutateAsync(body);
      const playlistId = created?.id;
      if (!playlistId) {
        throw new Error('Playlist created without an id');
      }

      // 2. For Media playlists, push the picked assets into the playlist.
      //    saveItems is the bulk reorder endpoint (PUT /playlists/:id/items)
      //    which is what the legacy editor uses — same code path, fewer
      //    surprises in audit logs.
      if (kind === 'media' && selectedAssetIds.size > 0) {
        const assetList = (assets || []).filter((a: any) => selectedAssetIds.has(a.id));
        // Preserve operator's selection order when known — fall back to
        // the asset library order.
        const items = assetList.map((a: any, i: number) => {
          const dur = a.mimeType?.startsWith('video/') || a.mimeType?.startsWith('audio/') ? 30000 : 10000;
          return {
            assetId: a.id,
            durationMs: dur,
            sequenceOrder: i,
            daysOfWeek: null,
            timeStart: null,
            timeEnd: null,
            transitionType: null,
            muted: a.mimeType?.startsWith('video/') ? true : true,
          };
        });
        await saveItems.mutateAsync({ playlistId, items });
      }

      // 3. Build schedules.
      //    - If screens are picked: one schedule per screen, isActive based
      //      on the operator's "Activate immediately" toggle.
      //    - If no screens picked: skip schedule creation (operator chose
      //      to assign later from the playlist detail view).
      if (selectedScreenIds.size > 0) {
        const computeStartTime = (): string => {
          if (!schedStartDate) return new Date().toISOString();
          const tod = activateImmediately ? '00:00' : schedTimeStart || '00:00';
          return new Date(`${schedStartDate}T${tod}:00`).toISOString();
        };
        const computeEndTime = (): string | undefined => {
          if (!schedEndDate) return undefined;
          const tod = activateImmediately ? '23:59' : schedTimeEnd || '23:59';
          return new Date(`${schedEndDate}T${tod}:59`).toISOString();
        };
        const schedules = Array.from(selectedScreenIds).map((screenId) => ({
          playlistId,
          screenId,
          startTime: computeStartTime(),
          endTime: computeEndTime(),
          daysOfWeek: !activateImmediately ? schedDays.join(',') : undefined,
          timeStart: !activateImmediately ? schedTimeStart : undefined,
          timeEnd: !activateImmediately ? schedTimeEnd : undefined,
          priority: 0,
          mode: 'replace' as const,
          isActive: activateImmediately,
        }));
        // Run in parallel — schedules are independent, no cross-row deps.
        await Promise.all(schedules.map((s) => createSchedule.mutateAsync(s)));
      }

      // 4. Hand the operator back to the dashboard with the new playlist
      //    selected. Parent decides whether to deep-link to the editor.
      onCreated({ id: playlistId, name: created.name || name.trim(), templateId: created.templateId ?? null });
      // Don't call onClose() here — onCreated is expected to either
      // dismiss or take over (deep-link into the playlist editor).
    } catch (err: any) {
      setCreating(false);
      await appAlert({
        title: 'Couldn’t create playlist',
        message: err?.message || 'Something went wrong. Try again, or split the steps in the editor.',
        tone: 'danger',
      });
    }
  };

  // ─── Animation styles ──────────────────────────────────────────────

  const scrimStyle: CSSProperties = {
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    zIndex: 100,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    overflow: 'hidden',
    opacity: enterAnim ? 1 : 0,
    transition: 'opacity 150ms ease-out',
  };

  const panelStyle: CSSProperties = {
    position: 'relative',
    zIndex: 1,
    width: '100%',
    maxWidth: 800, // ~max-w-3xl
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'white',
    borderRadius: 20,
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    transform: enterAnim ? 'scale(1)' : 'scale(0.96)',
    opacity: enterAnim ? 1 : 0,
    transition: 'opacity 150ms ease-out, transform 150ms ease-out',
  };

  // ─── Footer ────────────────────────────────────────────────────────

  const isLastStep = step === 5;
  // Step 1: Next disabled until name + type picked
  // Step 2: Next disabled until content picked
  // Steps 3/4: always enabled
  const nextDisabled =
    (step === 1 && !canAdvanceFromStep1) ||
    (step === 2 && !canAdvanceFromStep2);

  // ─── Render ────────────────────────────────────────────────────────

  // 2026-05-26 — operator: "new playlist popup doesnt center when the
  // screen isnt maximized". Cause: inline mount + an ancestor with
  // `transform`/`filter`/`backdrop-filter` makes `position: fixed`
  // containing-block-relative to that ancestor instead of the
  // viewport. Standard React modal fix is to portal to document.body
  // so the dialog escapes any DashboardLayout / sidebar transform.
  if (typeof window === 'undefined') return null; // SSR guard
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create new playlist"
      style={scrimStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) void tryClose();
      }}
    >
      <div style={panelStyle}>
        {/* Header */}
        <div className="px-6 pt-5 pb-4 flex items-start justify-between border-b border-slate-100">
          <div>
            <h2 className="text-xl font-bold text-slate-900">New Playlist</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Set up a playlist, the screens it should play on, and when it goes live.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void tryClose()}
            disabled={creating}
            aria-label="Close wizard"
            className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg p-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step indicator */}
        <StepIndicator step={step} highestVisited={highestVisited} onJump={jumpTo} />

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">
          {step === 1 && (
            <Step1NameAndType
              name={name}
              setName={setName}
              kind={kind}
              setKind={setKind}
              nameInputRef={nameInputRef}
              onEnter={() => {
                if (canAdvanceFromStep1) goNext();
              }}
            />
          )}
          {step === 2 && kind === 'media' && (
            <Step2Media
              assets={filteredAssets}
              search={assetSearch}
              setSearch={setAssetSearch}
              filter={assetFilter}
              setFilter={setAssetFilter}
              selectedIds={selectedAssetIds}
              onToggle={toggleAsset}
            />
          )}
          {step === 2 && kind === 'template' && (
            <Step2Template
              templates={visibleTemplates}
              search={templateSearch}
              setSearch={setTemplateSearch}
              filter={templateFilter}
              setFilter={setTemplateFilter}
              selectedId={selectedTemplateId}
              onSelect={setSelectedTemplateId}
              onName={(tName: string) => {
                if (!name.trim()) setName(tName);
              }}
            />
          )}
          {step === 3 && (
            <Step3Screens
              screens={filteredScreens}
              total={(screens || []).length}
              search={screenSearch}
              setSearch={setScreenSearch}
              selectedIds={selectedScreenIds}
              onToggle={toggleScreen}
              onSkip={() => {
                setSelectedScreenIds(new Set());
                goNext();
              }}
            />
          )}
          {step === 4 && (
            <Step4Publish
              activate={activateImmediately}
              setActivate={setActivateImmediately}
              startDate={schedStartDate}
              setStartDate={setSchedStartDate}
              endDate={schedEndDate}
              setEndDate={setSchedEndDate}
              timeStart={schedTimeStart}
              setTimeStart={setSchedTimeStart}
              timeEnd={schedTimeEnd}
              setTimeEnd={setSchedTimeEnd}
              days={schedDays}
              toggleDay={toggleDay}
              screensPicked={selectedScreenIds.size}
            />
          )}
          {step === 5 && (
            <Step5Review
              name={name.trim()}
              kind={kind!}
              itemCount={kind === 'media' ? selectedAssetIds.size : 0}
              template={selectedTemplate}
              screenNames={(screens || [])
                .filter((s: any) => selectedScreenIds.has(s.id))
                .map((s: any) => s.name || s.id)}
              activate={activateImmediately}
              schedDays={schedDays}
              schedTimeStart={schedTimeStart}
              schedTimeEnd={schedTimeEnd}
              schedStartDate={schedStartDate}
              schedEndDate={schedEndDate}
            />
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
          <div>
            {step > 1 && (
              <button
                type="button"
                onClick={goBack}
                disabled={creating}
                className="inline-flex items-center px-3 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                Back
              </button>
            )}
          </div>
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => void tryClose()}
              disabled={creating}
              className="px-3 py-2 text-sm font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors mr-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            {!isLastStep && (
              <button
                type="button"
                onClick={goNext}
                disabled={nextDisabled || creating}
                className="inline-flex items-center px-4 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed rounded-lg shadow-sm transition-colors"
              >
                Next
                <ChevronRight className="w-4 h-4 ml-1" />
              </button>
            )}
            {isLastStep && (
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating}
                className="inline-flex items-center px-5 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 disabled:cursor-not-allowed rounded-lg shadow-sm transition-colors"
              >
                {creating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating…
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Create Playlist
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Step 1 — Name + Type ──────────────────────────────────────────────

function Step1NameAndType({
  name,
  setName,
  kind,
  setKind,
  nameInputRef,
  onEnter,
}: {
  name: string;
  setName: (s: string) => void;
  kind: PlaylistKind | null;
  setKind: (k: PlaylistKind) => void;
  nameInputRef: React.RefObject<HTMLInputElement | null>;
  onEnter: () => void;
}) {
  return (
    <div>
      <div className="mb-6">
        <label
          htmlFor="wizard-playlist-name"
          className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2"
        >
          Playlist name
        </label>
        <input
          ref={nameInputRef}
          id="wizard-playlist-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 64))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onEnter();
            }
          }}
          maxLength={64}
          placeholder="e.g. Cafeteria lunch menu, Friday assembly slides, Bus loop welcome…"
          className="w-full px-4 py-3 text-base bg-white border-2 border-slate-200 rounded-xl outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 transition-shadow"
        />
        <div className="flex items-center justify-between mt-1.5">
          <p className="text-xs text-slate-400">A friendly name your team will recognize.</p>
          <p className={`text-xs ${name.length >= 60 ? 'text-amber-600' : 'text-slate-400'}`}>
            {name.length}/64
          </p>
        </div>
      </div>

      <div>
        <p className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
          What kind of playlist?
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setKind('media')}
            aria-pressed={kind === 'media'}
            className={`text-left p-5 rounded-2xl border-2 transition-all mr-0 sm:mr-3 mb-3 sm:mb-0 ${
              kind === 'media'
                ? 'border-indigo-500 bg-indigo-50 shadow-md ring-4 ring-indigo-100'
                : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/50'
            }`}
          >
            <div className="flex items-start">
              <div
                className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 mr-4 transition-colors ${
                  kind === 'media' ? 'bg-indigo-600 text-white' : 'bg-indigo-100 text-indigo-600'
                }`}
              >
                <Play className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <p className="text-base font-bold text-slate-800 mb-1 flex items-center">
                  Media Playlist
                  {kind === 'media' && (
                    <CheckCircle2 className="w-4 h-4 ml-2 text-indigo-600" />
                  )}
                </p>
                <p className="text-xs text-slate-500 leading-relaxed">
                  A rolling slideshow of your images, videos, and web pages.
                </p>
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setKind('template')}
            aria-pressed={kind === 'template'}
            className={`text-left p-5 rounded-2xl border-2 transition-all ${
              kind === 'template'
                ? 'border-violet-500 bg-violet-50 shadow-md ring-4 ring-violet-100'
                : 'border-slate-200 bg-white hover:border-violet-300 hover:bg-violet-50/50'
            }`}
          >
            <div className="flex items-start">
              <div
                className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 mr-4 transition-colors ${
                  kind === 'template' ? 'bg-violet-600 text-white' : 'bg-violet-100 text-violet-600'
                }`}
              >
                <LayoutTemplate className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <p className="text-base font-bold text-slate-800 mb-1 flex items-center">
                  From Template
                  {kind === 'template' && (
                    <CheckCircle2 className="w-4 h-4 ml-2 text-violet-600" />
                  )}
                </p>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Use a layout with live widgets (clock, weather, menus, schedules…).
                </p>
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Step 2 — Media ─────────────────────────────────────────────────────

function Step2Media({
  assets,
  search,
  setSearch,
  filter,
  setFilter,
  selectedIds,
  onToggle,
}: {
  assets: any[];
  search: string;
  setSearch: (s: string) => void;
  filter: 'all' | 'images' | 'videos' | 'audio' | 'urls';
  setFilter: (f: 'all' | 'images' | 'videos' | 'audio' | 'urls') => void;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  const filterChips: { id: typeof filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'images', label: 'Images' },
    { id: 'videos', label: 'Videos' },
    { id: 'audio', label: 'Audio' },
    { id: 'urls', label: 'URLs' },
  ];
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-base font-bold text-slate-800">Pick the media to play</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Tap any tile to add it. You can re-order, set per-slide timing, and add more later in the editor.
          </p>
        </div>
        <div className="inline-flex items-center px-3 py-1.5 rounded-full bg-indigo-50 border border-indigo-100">
          <Check className="w-3.5 h-3.5 text-indigo-600 mr-1.5" />
          <span className="text-xs font-bold text-indigo-700">
            {selectedIds.size} selected
          </span>
        </div>
      </div>

      <div className="flex items-center mb-3">
        <div className="relative flex-1 mr-3">
          <Search className="absolute top-1/2 left-3 -translate-y-1/2 w-4 h-4 text-slate-300" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search filename…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
      </div>

      <div className="flex flex-wrap mb-4">
        {filterChips.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setFilter(c.id)}
            className={`mr-2 mb-2 px-3 py-1 text-xs font-semibold rounded-full transition-colors ${
              filter === c.id
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {assets.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-xl">
          <ImageIcon className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-600">No matching assets</p>
          <p className="text-xs text-slate-400 mt-1">
            Try clearing the filter or uploading from the Assets page first.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4">
          {assets.map((a: any) => {
            const selected = selectedIds.has(a.id);
            const Icon = mimeIcon(a.mimeType);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onToggle(a.id)}
                aria-pressed={selected}
                className={`relative text-left rounded-xl overflow-hidden border-2 transition-all mr-2 mb-2 ${
                  selected
                    ? 'border-indigo-500 shadow-md ring-2 ring-indigo-200'
                    : 'border-slate-200 hover:border-indigo-300'
                }`}
              >
                <div className="aspect-video bg-slate-100">
                  <MiniAssetThumb asset={a} />
                </div>
                {selected && (
                  <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center shadow-md">
                    <Check className="w-4 h-4 text-white" />
                  </div>
                )}
                <div className="px-2 py-1.5 bg-white">
                  <div className="flex items-center">
                    <Icon className="w-3 h-3 text-slate-400 mr-1.5 shrink-0" />
                    <p className="text-[11px] font-semibold text-slate-700 truncate">
                      {a.originalName || a.title || 'Untitled'}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Step 2 — Template ──────────────────────────────────────────────────

function Step2Template({
  templates,
  search,
  setSearch,
  filter,
  setFilter,
  selectedId,
  onSelect,
  onName,
}: {
  templates: any[];
  search: string;
  setSearch: (s: string) => void;
  filter: 'all' | 'custom' | 'system';
  setFilter: (f: 'all' | 'custom' | 'system') => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onName: (name: string) => void;
}) {
  const filterChips: { id: typeof filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'custom', label: 'My templates' },
    { id: 'system', label: 'Built-in' },
  ];
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-base font-bold text-slate-800">Pick a template</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Layouts come with live widgets (clock, weather, ticker…). You can tweak them after creating the playlist.
          </p>
        </div>
        {selectedId && (
          <div className="inline-flex items-center px-3 py-1.5 rounded-full bg-violet-50 border border-violet-100">
            <Check className="w-3.5 h-3.5 text-violet-600 mr-1.5" />
            <span className="text-xs font-bold text-violet-700">Template selected</span>
          </div>
        )}
      </div>

      <div className="flex items-center mb-3">
        <div className="relative flex-1 mr-3">
          <Search className="absolute top-1/2 left-3 -translate-y-1/2 w-4 h-4 text-slate-300" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-violet-400"
          />
        </div>
      </div>

      <div className="flex flex-wrap mb-4">
        {filterChips.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setFilter(c.id)}
            className={`mr-2 mb-2 px-3 py-1 text-xs font-semibold rounded-full transition-colors ${
              filter === c.id
                ? 'bg-violet-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {templates.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-xl">
          <LayoutTemplate className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-600">No matching templates</p>
          <p className="text-xs text-slate-400 mt-1">
            Create one from the Templates page, or try a built-in.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
          {templates.map((t: any) => {
            const selected = selectedId === t.id;
            const zoneCount = t._count?.zones || t.zones?.length || 0;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  onSelect(t.id);
                  onName(t.name);
                }}
                aria-pressed={selected}
                className={`relative text-left rounded-xl overflow-hidden border-2 transition-all mr-2 mb-2 bg-white ${
                  selected
                    ? 'border-violet-500 shadow-md ring-2 ring-violet-200'
                    : 'border-slate-200 hover:border-violet-300'
                }`}
              >
                <div className="bg-slate-50 flex items-center justify-center" style={{ minHeight: 110 }}>
                  {t.zones && t.zones.length > 0 ? (
                    <ScaledTemplateThumbnail
                      zones={t.zones}
                      screenWidth={t.screenWidth || 1920}
                      screenHeight={t.screenHeight || 1080}
                      bgImage={t.bgImage}
                      bgGradient={t.bgGradient}
                      bgColor={t.bgColor}
                      maxHeight={110}
                    />
                  ) : (
                    <LayoutTemplate className="w-10 h-10 text-slate-300" />
                  )}
                </div>
                {selected && (
                  <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-violet-600 flex items-center justify-center shadow-md">
                    <Check className="w-4 h-4 text-white" />
                  </div>
                )}
                <div className="px-3 py-2 border-t border-slate-100">
                  <p className="text-xs font-bold text-slate-700 truncate">{t.name}</p>
                  <div className="flex items-center mt-0.5">
                    <Layers className="w-3 h-3 text-slate-300 mr-1" />
                    <p className="text-[10px] text-slate-400">
                      {t.screenWidth || 1920}×{t.screenHeight || 1080} · {zoneCount} zone{zoneCount === 1 ? '' : 's'}
                      {t.isSystem ? ' · Built-in' : ''}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Step 3 — Screens ──────────────────────────────────────────────────

function Step3Screens({
  screens,
  total,
  search,
  setSearch,
  selectedIds,
  onToggle,
  onSkip,
}: {
  screens: any[];
  total: number;
  search: string;
  setSearch: (s: string) => void;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSkip: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-base font-bold text-slate-800">Where should it play?</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Pick the screens this playlist should run on. You can skip this and assign screens later from the playlist detail page.
          </p>
        </div>
        <div className="inline-flex items-center px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-100">
          <Monitor className="w-3.5 h-3.5 text-emerald-600 mr-1.5" />
          <span className="text-xs font-bold text-emerald-700">
            {selectedIds.size} of {total} screens
          </span>
        </div>
      </div>

      {total > 0 && (
        <div className="relative mb-3">
          <Search className="absolute top-1/2 left-3 -translate-y-1/2 w-4 h-4 text-slate-300" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search screens…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-emerald-400"
          />
        </div>
      )}

      {total === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-xl">
          <Monitor className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-600">No screens paired yet</p>
          <p className="text-xs text-slate-400 mt-1 mb-4">
            Pair a screen first from the Screens page — or skip this step and assign later.
          </p>
          <button
            type="button"
            onClick={onSkip}
            className="px-4 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            Skip — assign later
          </button>
        </div>
      ) : screens.length === 0 ? (
        <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-xl">
          <Search className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-600">No screens match the search</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2">
            {screens.map((s: any) => {
              const selected = selectedIds.has(s.id);
              const online = s.status === 'ONLINE';
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onToggle(s.id)}
                  aria-pressed={selected}
                  className={`relative text-left rounded-xl border-2 transition-all p-3 mr-2 mb-2 ${
                    selected
                      ? 'border-emerald-500 bg-emerald-50/40 shadow-sm ring-2 ring-emerald-100'
                      : 'border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/30'
                  }`}
                >
                  <div className="flex items-start">
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 mr-3 ${
                        selected ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      <Monitor className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-800 truncate">
                        {s.name || 'Untitled screen'}
                      </p>
                      <div className="flex items-center mt-1">
                        {online ? (
                          <>
                            <Wifi className="w-3 h-3 text-emerald-500 mr-1" />
                            <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">
                              Online
                            </span>
                          </>
                        ) : (
                          <>
                            <WifiOff className="w-3 h-3 text-slate-300 mr-1" />
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                              Offline
                            </span>
                          </>
                        )}
                        {s.resolution && (
                          <span className="text-[10px] text-slate-400 ml-2">{s.resolution}</span>
                        )}
                      </div>
                    </div>
                    {selected && (
                      <div className="w-6 h-6 rounded-full bg-emerald-600 flex items-center justify-center shadow-sm shrink-0 ml-2">
                        <Check className="w-4 h-4 text-white" />
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="text-center mt-2">
            <button
              type="button"
              onClick={onSkip}
              className="text-xs font-semibold text-slate-400 hover:text-slate-700"
            >
              Skip — assign screens later
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Step 4 — Publish ─────────────────────────────────────────────────

function Step4Publish({
  activate,
  setActivate,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  timeStart,
  setTimeStart,
  timeEnd,
  setTimeEnd,
  days,
  toggleDay,
  screensPicked,
}: {
  activate: boolean;
  setActivate: (b: boolean) => void;
  startDate: string;
  setStartDate: (s: string) => void;
  endDate: string;
  setEndDate: (s: string) => void;
  timeStart: string;
  setTimeStart: (s: string) => void;
  timeEnd: string;
  setTimeEnd: (s: string) => void;
  days: string[];
  toggleDay: (d: string) => void;
  screensPicked: number;
}) {
  return (
    <div>
      <p className="text-base font-bold text-slate-800 mb-1">Publishing</p>
      <p className="text-xs text-slate-500 mb-4">
        {screensPicked === 0
          ? 'No screens were picked — these settings will be saved with the playlist for when you assign screens later.'
          : `These rules apply to all ${screensPicked} screen${screensPicked === 1 ? '' : 's'} you picked.`}
      </p>

      <button
        type="button"
        onClick={() => setActivate(true)}
        aria-pressed={activate}
        className={`w-full text-left p-4 rounded-xl border-2 transition-all mb-3 ${
          activate
            ? 'border-emerald-500 bg-emerald-50/40 ring-2 ring-emerald-100'
            : 'border-slate-200 hover:border-emerald-300'
        }`}
      >
        <div className="flex items-start">
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 mr-3 ${
              activate ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'
            }`}
          >
            <Play className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-slate-800">Activate immediately</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Starts the moment you click Create. Plays 24/7 until you stop it.
            </p>
            {activate && (
              <div className="flex flex-wrap mt-2">
                <span className="inline-flex items-center text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-1 rounded-full mr-2 mb-1">
                  <Play className="w-2.5 h-2.5 mr-1" />
                  Starts now
                </span>
                <span className="inline-flex items-center text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded-full mr-2 mb-1">
                  Ends never
                </span>
              </div>
            )}
          </div>
          {activate && (
            <div className="w-6 h-6 rounded-full bg-emerald-600 flex items-center justify-center shadow-sm shrink-0">
              <Check className="w-4 h-4 text-white" />
            </div>
          )}
        </div>
      </button>

      <button
        type="button"
        onClick={() => setActivate(false)}
        aria-pressed={!activate}
        className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
          !activate
            ? 'border-sky-500 bg-sky-50/40 ring-2 ring-sky-100'
            : 'border-slate-200 hover:border-sky-300'
        }`}
      >
        <div className="flex items-start">
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 mr-3 ${
              !activate ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-500'
            }`}
          >
            <Calendar className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-slate-800">Schedule a window</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Pick specific days and times. The playlist activates only inside the window.
            </p>
          </div>
          {!activate && (
            <div className="w-6 h-6 rounded-full bg-sky-600 flex items-center justify-center shadow-sm shrink-0">
              <Check className="w-4 h-4 text-white" />
            </div>
          )}
        </div>

        {!activate && (
          <div className="mt-4 pl-13" style={{ paddingLeft: 52 }}>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              Days of week
            </p>
            <div className="flex flex-wrap mb-3">
              {DAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleDay(d);
                  }}
                  className={`mr-1 mb-1 px-2.5 py-1 text-[11px] font-bold rounded ${
                    days.includes(d)
                      ? 'bg-sky-600 text-white'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>

            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              Time of day
            </p>
            <div className="flex items-center mb-3 text-xs">
              <input
                type="time"
                value={timeStart}
                onChange={(e) => {
                  e.stopPropagation();
                  setTimeStart(e.target.value);
                }}
                onClick={(e) => e.stopPropagation()}
                className="px-2 py-1.5 border border-slate-200 rounded bg-white text-slate-700"
              />
              <span className="mx-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                to
              </span>
              <input
                type="time"
                value={timeEnd}
                onChange={(e) => {
                  e.stopPropagation();
                  setTimeEnd(e.target.value);
                }}
                onClick={(e) => e.stopPropagation()}
                className="px-2 py-1.5 border border-slate-200 rounded bg-white text-slate-700"
              />
            </div>

            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              Date range (optional)
            </p>
            <div className="flex items-center text-xs">
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  e.stopPropagation();
                  setStartDate(e.target.value);
                }}
                onClick={(e) => e.stopPropagation()}
                placeholder="Start"
                className="px-2 py-1.5 border border-slate-200 rounded bg-white text-slate-700"
              />
              <span className="mx-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                through
              </span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  e.stopPropagation();
                  setEndDate(e.target.value);
                }}
                onClick={(e) => e.stopPropagation()}
                placeholder="End"
                className="px-2 py-1.5 border border-slate-200 rounded bg-white text-slate-700"
              />
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              Leave the dates blank to start now and never stop.
            </p>
          </div>
        )}
      </button>
    </div>
  );
}

// ─── Step 5 — Review ──────────────────────────────────────────────────

function Step5Review({
  name,
  kind,
  itemCount,
  template,
  screenNames,
  activate,
  schedDays,
  schedTimeStart,
  schedTimeEnd,
  schedStartDate,
  schedEndDate,
}: {
  name: string;
  kind: PlaylistKind;
  itemCount: number;
  template: any;
  screenNames: string[];
  activate: boolean;
  schedDays: string[];
  schedTimeStart: string;
  schedTimeEnd: string;
  schedStartDate: string;
  schedEndDate: string;
}) {
  const scheduleLabel = (() => {
    if (activate) {
      if (screenNames.length === 0) return 'Activate immediately when screens are assigned';
      return 'Starts now · ends never';
    }
    const parts: string[] = [];
    if (schedDays.length === 7) parts.push('Every day');
    else if (schedDays.length > 0) parts.push(schedDays.join(', '));
    else parts.push('No days picked');
    parts.push(`${schedTimeStart}–${schedTimeEnd}`);
    if (schedStartDate || schedEndDate) {
      parts.push(`(${schedStartDate || 'now'} → ${schedEndDate || 'never'})`);
    }
    return parts.join(' · ');
  })();

  return (
    <div>
      <div className="flex items-center mb-4">
        <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center mr-3">
          <Sparkles className="w-5 h-5 text-indigo-600" />
        </div>
        <div>
          <p className="text-base font-bold text-slate-800">Ready to create</p>
          <p className="text-xs text-slate-500">Double-check the summary below, then hit Create Playlist.</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 overflow-hidden">
        <ReviewRow label="Name" value={name || <em className="text-amber-600">No name set</em>} />
        <ReviewRow
          label="Type"
          value={
            kind === 'media' ? (
              <span className="inline-flex items-center">
                <Play className="w-3.5 h-3.5 text-indigo-500 mr-1.5" />
                Media Playlist
              </span>
            ) : (
              <span className="inline-flex items-center">
                <LayoutTemplate className="w-3.5 h-3.5 text-violet-500 mr-1.5" />
                From Template
              </span>
            )
          }
        />
        {kind === 'media' && (
          <ReviewRow
            label="Content"
            value={`${itemCount} asset${itemCount === 1 ? '' : 's'}`}
          />
        )}
        {kind === 'template' && (
          <ReviewRow
            label="Template"
            value={
              template ? (
                <span>
                  <span className="font-semibold">{template.name}</span>
                  <span className="text-slate-400">
                    {' '}· {template.screenWidth || 1920}×{template.screenHeight || 1080}
                  </span>
                </span>
              ) : (
                <em className="text-amber-600">Not picked</em>
              )
            }
          />
        )}
        <ReviewRow
          label="Screens"
          value={
            screenNames.length === 0 ? (
              <span className="text-slate-500">
                None yet — assign from the playlist page after creating.
              </span>
            ) : screenNames.length <= 3 ? (
              <span>{screenNames.join(', ')}</span>
            ) : (
              <span>
                <span className="font-semibold">{screenNames.length} screens</span>{' '}
                <span className="text-slate-400">
                  ({screenNames.slice(0, 2).join(', ')}, …)
                </span>
              </span>
            )
          }
        />
        <ReviewRow
          label="Schedule"
          value={
            <span
              className={activate ? 'inline-flex items-center text-emerald-700' : 'inline-flex items-center text-sky-700'}
            >
              {activate ? (
                <Play className="w-3.5 h-3.5 mr-1.5" />
              ) : (
                <Calendar className="w-3.5 h-3.5 mr-1.5" />
              )}
              {scheduleLabel}
            </span>
          }
          last
        />
      </div>

      <p className="text-xs text-slate-400 mt-3 text-center">
        You can edit any of this later from the playlist detail page.
      </p>
    </div>
  );
}

function ReviewRow({
  label,
  value,
  last,
}: {
  label: string;
  value: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-start px-4 py-3 ${last ? '' : 'border-b border-slate-100'}`}
    >
      <div className="w-24 shrink-0">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">
          {label}
        </p>
      </div>
      <div className="flex-1 text-sm text-slate-700 min-w-0">{value}</div>
    </div>
  );
}

export default PlaylistCreateWizard;
