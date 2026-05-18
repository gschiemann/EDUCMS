'use client';

/**
 * VenueOS Sports — ribbon image slides.
 *
 * The operator uploads full-bleed images — sponsor banners, promos,
 * "Welcome" graphics — and each one rides the ribbon reel filling the
 * board edge-to-edge (full ribbon height), instead of the small
 * logo-and-text sponsor card.
 *
 * Upload reuses the hardened /assets/upload chain via AssetPicker.
 * Saved through the ribbon-slides endpoint; the ribbon picks the
 * list up within ~1s (it polls the same board feed every 750ms).
 * Tip: upload WIDE, ribbon-shaped art so it reads well on the strip.
 */

import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGame, useGameControl } from '@/hooks/use-api';
import { AssetPicker } from '@/components/assets/AssetPicker';

const MAX_SLIDES = 20;

export function RibbonImagesPanel({ gameId }: { gameId: string }) {
  const { data: game } = useGame(gameId);
  const ctl = useGameControl(gameId);

  // Local slide list, seeded once from the game — don't re-seed on
  // later polls or an in-progress edit gets yanked.
  const [slides, setSlides] = useState<string[]>([]);
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current && game) {
      seeded.current = true;
      setSlides((game as { ribbonSlides?: string[] }).ribbonSlides || []);
    }
  }, [game]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  const addSlide = (url: string) => {
    setSaved(false);
    setSlides((prev) => (prev.length >= MAX_SLIDES ? prev : [...prev, url]));
    setPickerOpen(false);
  };
  const removeSlide = (index: number) => {
    setSaved(false);
    setSlides((prev) => prev.filter((_, i) => i !== index));
  };

  const save = async () => {
    await ctl.ribbonSlides.mutateAsync({ slides });
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 2400);
  };

  return (
    <div>
      <p className="mb-3 text-xs text-slate-400">
        Full-bleed images that fill the whole ribbon as they scroll past — sponsor
        banners, promos, welcome graphics. Upload wide, ribbon-shaped art for the
        best fit. They rotate with the rest of the reel.
      </p>

      {slides.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 py-4 text-center text-sm text-slate-400">
          No ribbon images yet — add a sponsor banner or a promo graphic.
        </p>
      ) : (
        <div className="space-y-2">
          {slides.map((url, i) => (
            <div key={`${url}-${i}`} className="flex items-center gap-2">
              <div className="h-14 flex-1 overflow-hidden rounded-md bg-slate-900">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="h-full w-full object-contain" />
              </div>
              <button
                type="button"
                onClick={() => removeSlide(i)}
                className="shrink-0 rounded-md border border-slate-200 p-1.5 text-slate-400 transition-colors hover:border-red-300 hover:text-red-600"
                aria-label="Remove image"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => setPickerOpen(true)}
          disabled={slides.length >= MAX_SLIDES}
        >
          <Plus className="h-3.5 w-3.5" /> Add image
        </Button>
        <Button onClick={save} disabled={ctl.ribbonSlides.isPending} className="gap-1.5">
          {ctl.ribbonSlides.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : saved ? (
            <Check className="h-4 w-4" />
          ) : null}
          {saved ? 'Saved' : 'Save ribbon images'}
        </Button>
        <span className="text-xs text-slate-400">
          {slides.length} of {MAX_SLIDES}
        </span>
      </div>

      {pickerOpen && (
        <AssetPicker
          kind="image"
          title="Choose a ribbon image"
          onPick={addSlide}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
