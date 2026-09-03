'use client';

/**
 * ONE LAZY PROXY FOR A WIDGET COMPONENT (P1-1, 2026-09-03).
 *
 * ── WHY ──────────────────────────────────────────────────────────────────
 * `WidgetRenderer.tsx` statically imported 429 widget/theme components from
 * ~160 modules, so every surface that mounts `WidgetPreview` — the player,
 * the builder, the gallery — parsed the ENTIRE widget catalog. Measured on a
 * production build, a paired screen showing a CLOCK, a TEXT and an IMAGE
 * downloaded a 3.37 MB / 692 KB-gzip chunk that is almost entirely widget
 * families the manifest never references. P0-3 moved that chunk OFF the
 * pairing path; this wave splits the chunk itself, so a screen loads the
 * families its manifest actually names and nothing else.
 *
 * ── THE CONTRACT ─────────────────────────────────────────────────────────
 * `lazyWidget(loader, exportName)` returns a component that renders
 * `null` until its chunk resolves, then renders the real component with the
 * SAME props it was given. Call sites in `WidgetRenderer.tsx` are unchanged —
 * only the import specifier moved (see `widget-families.tsx`), which is what
 * makes this reviewable: no prop set, no dispatch condition and no widget
 * implementation was touched.
 *
 * ── WHY NOT `React.lazy` + `<Suspense>` ──────────────────────────────────
 * Two reasons, both reliability, both learned on this fleet:
 *   1. `React.lazy` CACHES A REJECTED PROMISE FOREVER. One failed chunk
 *      fetch — a kiosk that boots while its uplink is still coming up, a CDN
 *      blip, a captive portal — would blank that widget until the page is
 *      reloaded. Here a failure clears the latch and the mounted proxy
 *      retries on a bounded interval, so the screen HEALS. (Same reasoning as
 *      `lazyRenderer.ts`'s `warming = null` on failure.)
 *   2. A Suspense boundary suspends its whole subtree. The player renders all
 *      of a template's zones together; one slow chunk must not blank the
 *      zones that are already loaded.
 * Nothing here is on the emergency path: `EmergencyOverlay` is statically
 * imported by `page.tsx` and renders outside the renderer island entirely, so
 * an alert never waits on any of these chunks (player rule 11).
 *
 * ── OLD-ENGINE NOTES ─────────────────────────────────────────────────────
 * The only new runtime primitive is `import()`, which Turbopack compiles
 * against this app's browserslist (Chrome ≥ 60) and which the P0-3 renderer
 * island already proved on real Chromium 67/68. `Map`/`Set` are Chrome 38+.
 * This file renders no DOM of its own, so it adds no CSS surface for the
 * Chromium-83 gates to police.
 */

import { createElement, useEffect, useState, type ComponentType } from 'react';

/** The shape a dynamic `import()` of a widget module resolves to. */
export type WidgetChunkModule = Record<string, unknown>;
export type WidgetChunkLoader = () => Promise<WidgetChunkModule>;

/**
 * Widget components take heterogeneous, historically-untyped config props
 * (`WidgetRenderer` types every `config` as its own shape). The proxy passes
 * whatever it is handed straight through without inspecting it, so an
 * index-signature prop bag is the honest type here — not `any`.
 */
type WidgetProxyProps = Record<string, unknown>;

interface ChunkState {
  /** Resolved module, or null while unloaded. */
  mod: WidgetChunkModule | null;
  /** In-flight load. Cleared on settle so a failure can be retried. */
  pending: Promise<WidgetChunkModule | null> | null;
  /** Mounted proxies to re-render once the chunk lands. */
  subs: Set<() => void>;
}

/**
 * Loader identity → state. Loaders are module-scope constants in
 * `widget-families.tsx` (one per source module), so this map is bounded by
 * the number of widget modules and never grows at runtime.
 */
const CHUNKS = new Map<WidgetChunkLoader, ChunkState>();

function stateFor(loader: WidgetChunkLoader): ChunkState {
  let st = CHUNKS.get(loader);
  if (!st) {
    st = { mod: null, pending: null, subs: new Set() };
    CHUNKS.set(loader, st);
  }
  return st;
}

/**
 * Start (or join) the download of a widget chunk.
 *
 * Never rejects: a failure resolves `null` and clears the latch, so the next
 * caller — or the retry timer in a mounted proxy — gets a fresh attempt
 * rather than inheriting a permanently-rejected promise.
 */
export function loadWidgetChunk(loader: WidgetChunkLoader): Promise<WidgetChunkModule | null> {
  const st = stateFor(loader);
  if (st.mod) return Promise.resolve(st.mod);
  if (!st.pending) {
    st.pending = loader().then(
      (mod) => {
        st.mod = mod;
        st.pending = null;
        // Copy before iterating: a subscriber may unmount (and unsubscribe)
        // synchronously inside its own re-render.
        for (const fn of Array.from(st.subs)) {
          try {
            fn();
          } catch {
            /* one bad subscriber must not stop the rest */
          }
        }
        return mod;
      },
      () => {
        st.pending = null;
        return null;
      },
    );
  }
  return st.pending;
}

/** Has this chunk already resolved? (Diagnostics + tests.) */
export function isWidgetChunkLoaded(loader: WidgetChunkLoader): boolean {
  return stateFor(loader).mod !== null;
}

/**
 * Retry cadence for a mounted proxy whose chunk failed to load. Short enough
 * that a screen whose uplink came up seconds after boot heals on its own,
 * long enough that a genuinely-missing chunk is not a request storm.
 */
const RETRY_MS = 4000;

/**
 * Subscribe this component to one widget chunk: starts the download on mount,
 * retries on failure while mounted, re-renders when it lands.
 *
 * Returns the resolved module, or `null` while it is not (yet) available.
 * Callers MUST render something safe for `null` — never a guess at what the
 * chunk would have rendered.
 */
export function useWidgetChunk(loader: WidgetChunkLoader): WidgetChunkModule | null {
  const st = stateFor(loader);
  const [, bump] = useState(0);

  useEffect(() => {
    if (st.mod) return undefined;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const sub = () => {
      if (alive) bump((n) => n + 1);
    };
    st.subs.add(sub);
    const attempt = () => {
      loadWidgetChunk(loader).then((mod) => {
        if (!alive || mod) return;
        timer = setTimeout(attempt, RETRY_MS);
      });
    };
    attempt();
    return () => {
      alive = false;
      st.subs.delete(sub);
      if (timer) clearTimeout(timer);
    };
    // `loader` is a module-scope constant and `st` is its stable state object,
    // so this effect runs once per mount.
  }, [loader, st]);

  return st.mod;
}

/**
 * Wrap one export of one lazily-loaded widget module as a drop-in component.
 *
 * `exportName` is resolved at RENDER time, not load time, so a module whose
 * export is missing (a stale service-worker copy from an older build) renders
 * an empty zone rather than throwing into the per-zone error boundary.
 */
export function lazyWidget<P extends object = WidgetProxyProps>(
  loader: WidgetChunkLoader,
  exportName: string,
): ComponentType<P> {
  function LazyWidget(props: P) {
    const mod = useWidgetChunk(loader);
    if (!mod) return null;
    const Comp = mod[exportName] as ComponentType<P> | undefined;
    if (!Comp) return null;
    // `createElement` rather than JSX spread: `<Comp {...props} />` on an
    // unresolved generic P is a long-standing TS friction point, and this is
    // exactly the same call.
    return createElement(Comp, props);
  }
  LazyWidget.displayName = `Lazy(${exportName})`;
  return LazyWidget;
}
