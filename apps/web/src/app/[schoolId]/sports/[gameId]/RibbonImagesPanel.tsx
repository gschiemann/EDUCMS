'use client';

/**
 * VenueOS Sports — ribbon image slides.
 *
 * The operator uploads full-bleed images — sponsor banners, promos,
 * "Welcome" graphics — and each rides the ribbon reel filling the
 * board edge-to-edge (full ribbon height), instead of the small
 * logo-and-text sponsor card.
 *
 * Every change AUTO-SAVES — adding or removing an image persists
 * immediately through the ribbon-slides endpoint; the ribbon picks
 * it up within ~1s. Upload reuses the hardened /assets/upload chain
 * via AssetPicker. Tip: upload WIDE, ribbon-shaped art.
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

  // Local slide list, seeded once — don't re-seed on later polls.
  const [slides, setSlides] = useState<string[]>([]);
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current && game) {
      seeded.current = true;
      setSlides((game as { ribbonSlides?: string[] }).ribbonSlides || []);
    }
  }, [game]);

  const [pickerOpen, setPickerOpen] = useState(false);

  // Every change auto-saves immediately — no Save button.
  const persist = (next: string[]) => {
    setSlides(next);
    ctl.ribbonSlides.mutate({ slides: next });
  };
  const addSlide = (url: string) => {
    setPickerOpen(false);
    if (slides.length >= MAX_SLIDES) return;
    persist([...slides, url]);
  };
  const removeSlide = (index: number) => {
    persist(slides.filter((_, i) => i !== index));
  };

  const saving = ctl.ribbonSlides.isPending;

  return (
    <div>
      <p className="mb-2.5 text-xs text-slate-400">
        Full-bleed images or videos that fill the ribbon at native height and scroll —
        sponsor banners, promos, scroll clips. Cut them to the ribbon HEIGHT (e.g. 256px
        tall for a 1000mm / 3.9mm ribbon); any width is fine — they loop to fill the run.
      </p>

      {slides.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 py-4 text-center text-sm text-slate-400">
          No ribbon media yet — add a sponsor banner, promo graphic, or scroll video.
        </p>
      ) : (
        <div className="space-y-2">
          {slides.map((url, i) => (
            <div key={`${url}-${i}`} className="flex items-center gap-2">
              <div className="h-14 flex-1 overflow-hidden rounded-md bg-slate-900">
                {/\.(mp4|webm|mov|m4v|ogv|ogg)(\?|#|$)/i.test(url) ? (
                  <video src={url} muted playsInline className="h-full w-full object-contain" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt="" className="h-full w-full object-contain" />
                )}
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
          <Plus className="h-3.5 w-3.5" /> Add media
        </Button>
        <span className="flex items-center gap-1 text-xs text-slate-400">
          {saving ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> Saving…
            </>
          ) : (
            <>
              <Check className="h-3 w-3 text-green-500" /> {slides.length} of {MAX_SLIDES} · saved
            </>
          )}
        </span>
      </div>

      {pickerOpen && (
        <AssetPicker
          kind="all"
          title="Choose ribbon media — image or video"
          onPick={addSlide}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
