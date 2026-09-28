/**
 * slideLoaded — "is the picture on this slide actually decoded?", asked of the
 * browser instead of inferred from an event that may never fire again.
 *
 * Why this exists (2026-09-28, "why do all the screens say Loading content?"):
 * the player's render proof says `pl:…` (operator content playing) only while a
 * `mediaReady` flag is true. That flag was reset to false at EVERY slide change
 * and set true only by a media element's `load` / `playing` event. An image
 * slideshow mounts every image at once and changes only their opacity, so after
 * the first advance each `<img>` is already loaded and never fires `load`
 * again: the flag stayed false for the rest of the show and the whole fleet
 * proved `idle:content-loading` — "Loading content" on the dashboard — while
 * the slides played.
 *
 * The browser knows the answer directly: an `<img>` is done when `complete` is
 * true and it has a decoded size (`complete` alone is also true for a broken
 * image). Pure, so it is unit-tested without mounting the 12k-line player page.
 */

/** The parts of an `<img>` this reads — a plain object satisfies it in tests. */
export interface ImageLike {
  complete: boolean;
  naturalWidth: number;
  currentSrc?: string;
}

export function isImageLoaded(img: ImageLike | null | undefined): boolean {
  if (!img || !img.complete) return false;
  if (img.naturalWidth > 0) return true;
  // An SVG with no intrinsic size reports naturalWidth 0 even when it drew fine.
  return /\.svg(\?|#|$)/i.test(img.currentSrc || '');
}

/**
 * The `<img>` the player rendered for a playlist item. The render tags each one
 * with `data-slide-id`; a scan (not a selector built from the id) so an unusual
 * id can never break the query.
 */
export function findSlideImage(itemId: string, root: ParentNode = document): HTMLImageElement | null {
  const nodes = root.querySelectorAll<HTMLImageElement>('img[data-slide-id]');
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].getAttribute('data-slide-id') === itemId) return nodes[i];
  }
  return null;
}
