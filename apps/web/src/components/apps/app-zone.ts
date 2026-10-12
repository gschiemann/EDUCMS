/**
 * app-zone — an App Library app as a ZONE on the canvas.
 *
 * Owner, 2026-10-12: "I still can't add any apps to my templates." Clicking
 * an Apps tile used to swap the whole sidebar for a config form and put
 * NOTHING on the canvas until a link was pasted and a second button pressed.
 * From the operator's chair that is "I clicked YouTube and nothing happened".
 *
 * So an app now lands on the board the moment it is clicked (or dropped),
 * like any widget. A zone that still needs its link / account carries
 * `_appSetupPending`; the canvas draws a clear "Set up <App>" card for it and
 * the Properties panel opens straight on the app's setup form. Once the form
 * is valid the zone takes the app's REAL config through `buildApp` — the one
 * gate between an operator's form and a zone (M6-1) — and the pending flag
 * goes away.
 *
 * Every app zone also keeps `_appId` + `_appValues`, so Properties can offer
 * the same form later ("Change link") with what was typed already filled in.
 */
import type { Zone } from '@/components/template-builder/types';
import { useBuilderStore } from '@/components/template-builder/useBuilderStore';
import { getApp, type AppDefinition, type AppStarterLayout } from './app-registry';
import { buildApp } from './build-app';

export const APP_ID_KEY = '_appId';
export const APP_VALUES_KEY = '_appValues';
export const APP_PENDING_KEY = '_appSetupPending';

/** Smart-placement fallback for apps without an explicit `defaultSize`. */
export const WIDGET_TYPE_DEFAULT_SIZE: Record<string, { w: number; h: number }> = {
  STREAMING: { w: 60, h: 45 },
  WEBPAGE: { w: 60, h: 55 },
  WEATHER: { w: 28, h: 22 },
  CLOCK: { w: 28, h: 22 },
  COUNTDOWN: { w: 28, h: 22 },
};

export function appDefaultValues(app: AppDefinition, initialValues?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of app.configSchema) {
    if (f.defaultValue !== undefined) out[f.key] = String(f.defaultValue);
  }
  if (initialValues) Object.assign(out, initialValues);
  return out;
}

/** The widget an app's zone is, even before it is set up. `build()` is pure,
 *  so calling it on the blank defaults tells us; a throw falls back to a web
 *  page, which renders its own empty state. */
export function appWidgetType(app: AppDefinition): string {
  try {
    return app.build(appDefaultValues(app)).widgetType || 'WEBPAGE';
  } catch {
    return 'WEBPAGE';
  }
}

export function appZoneSize(app: AppDefinition, widgetType: string): { w: number; h: number } | undefined {
  return app.defaultSize ?? WIDGET_TYPE_DEFAULT_SIZE[widgetType];
}

export interface AppZoneInfo {
  app: AppDefinition;
  pending: boolean;
  values: Record<string, string>;
}

/** The app behind a zone, or null for a plain widget. */
export function appZoneInfo(zone: Pick<Zone, 'defaultConfig'> | null | undefined): AppZoneInfo | null {
  const cfg = (zone?.defaultConfig || {}) as Record<string, unknown>;
  const id = cfg[APP_ID_KEY];
  if (typeof id !== 'string') return null;
  const app = getApp(id);
  if (!app) return null;
  const raw = cfg[APP_VALUES_KEY];
  const values: Record<string, string> = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string') values[k] = v;
    }
  }
  return { app, pending: cfg[APP_PENDING_KEY] === true, values };
}

/**
 * Put an app on the canvas NOW. With values that already build (a pasted
 * link the detector recognised, a Concierge suggestion) the zone is live at
 * once; otherwise it lands as a "Set up <App>" zone. Fills the blank starter
 * exactly like a widget does. Returns the new zone's id, already selected —
 * the builder's selection subscription then opens Properties on it.
 *
 * A coming-soon tile is refused (null): nothing it could add would show.
 */
export function addAppZone(
  app: AppDefinition,
  opts?: { dropAt?: { x: number; y: number }; values?: Record<string, string> },
): string | null {
  if (app.comingSoon) return null;
  const st = useBuilderStore.getState();
  const values = appDefaultValues(app, opts?.values);
  const built = buildApp(app, values);
  const widgetType = built.ok ? built.widgetType : appWidgetType(app);
  const id = st.addZone(widgetType, opts?.dropAt, appZoneSize(app, widgetType), { replacePlaceholder: true });
  const defaultConfig: Record<string, unknown> = built.ok
    ? { ...built.defaultConfig, [APP_ID_KEY]: app.id, [APP_VALUES_KEY]: values }
    : { [APP_ID_KEY]: app.id, [APP_VALUES_KEY]: values, [APP_PENDING_KEY]: true };
  const name = `${app.name} ${useBuilderStore.getState().zones.length}`;
  useBuilderStore.getState().updateZone(id, { defaultConfig, name });
  useBuilderStore.getState().select(id);
  // The operator came to paste a link: put the caret in it.
  if (!built.ok) requestAppSetupFocus(id);
  return id;
}

/**
 * Write a finished setup into an existing app zone. Re-validates through
 * `buildApp` at the boundary that writes — UI state is not enforcement.
 * One undo step. Returns false (and writes nothing) for a form that would
 * not show anything.
 */
export function applyAppToZone(zoneId: string, app: AppDefinition, values: Record<string, string>): boolean {
  const built = buildApp(app, values);
  if (!built.ok) return false;
  const st = useBuilderStore.getState();
  if (!st.zones.some((z) => z.id === zoneId)) return false;
  st.updateZone(
    zoneId,
    {
      widgetType: built.widgetType,
      defaultConfig: { ...built.defaultConfig, [APP_ID_KEY]: app.id, [APP_VALUES_KEY]: values },
    },
    true,
  );
  return true;
}

/** Take an app zone off the board (one undo step) — the setup card's
 *  "Remove", and a finished layout replacing the pending zone. */
export function removeAppZone(zoneId: string): void {
  const st = useBuilderStore.getState();
  if (!st.zones.some((z) => z.id === zoneId)) return;
  st.select(zoneId, false, { source: 'panel' });
  useBuilderStore.getState().removeSelected();
}

// ─────────────────────────────────────────────────────────────────────────
// "Set up <App>" — open the setup AND put the caret in it.
//
// Owner, 2026-10-12: "i click setup and nothing happens". The canvas button
// only selected the zone. Right after an app is dropped that zone is already
// selected and Properties is already showing its form, so selecting it again
// changed NOTHING on screen. The button now also asks the form to focus its
// first field (scrolled into view, briefly highlighted).
//
// The request is kept for a moment because the form may not be mounted yet —
// selecting the zone is what switches the left panel to Properties.
// ─────────────────────────────────────────────────────────────────────────

export const APP_SETUP_FOCUS_EVENT = 'venueos:app-setup-focus';
let pendingFocus: { zoneId: string; at: number } | null = null;

export function requestAppSetupFocus(zoneId: string): void {
  pendingFocus = { zoneId, at: Date.now() };
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(APP_SETUP_FOCUS_EVENT, { detail: { zoneId } }));
  }
}

/** True (once) when a focus request for this zone is waiting — the setup
 *  form calls this on mount. A request older than 4 s is stale. */
export function takeAppSetupFocus(zoneId: string): boolean {
  if (!pendingFocus || pendingFocus.zoneId !== zoneId) return false;
  const fresh = Date.now() - pendingFocus.at < 4000;
  pendingFocus = null;
  return fresh;
}

/** The canvas card's button: select the zone (which opens Properties) and
 *  focus the app's first field. */
export function openAppSetup(zoneId: string): void {
  useBuilderStore.getState().select(zoneId);
  requestAppSetupFocus(zoneId);
}

// ─────────────────────────────────────────────────────────────────────────
// Finished layouts — the plan (drawn on the card) and the build (one undo).
// ─────────────────────────────────────────────────────────────────────────

export type PlannedZoneRole = 'app' | 'title' | 'clock' | 'other';

export interface PlannedLayoutZone {
  role: PlannedZoneRole;
  widgetType: string;
  x: number;
  y: number;
  width: number;
  height: number;
  defaultConfig: Record<string, unknown>;
  /** App zone only: still waiting for its link / account. */
  pending?: boolean;
}

/**
 * What a finished layout puts on the board, in stacking order (the app
 * first, the brand title / clock above it). Pure: the layout card draws this
 * and `applyStarterLayout` builds exactly this, so the thumbnail cannot drift
 * from the result.
 *
 * With no link yet the app's slot is a "Set up <App>" zone — a layout is
 * never a dead control just because the form is still empty.
 */
export function planStarterLayout(
  app: AppDefinition,
  layout: AppStarterLayout,
  values: Record<string, string>,
): PlannedLayoutZone[] {
  const built = buildApp(app, values);
  const appType = built.ok ? built.widgetType : appWidgetType(app);
  const appConfig: Record<string, unknown> = built.ok
    ? { ...built.defaultConfig, [APP_ID_KEY]: app.id, [APP_VALUES_KEY]: values }
    : { [APP_ID_KEY]: app.id, [APP_VALUES_KEY]: values, [APP_PENDING_KEY]: true };
  const appZones: PlannedLayoutZone[] = [];
  const others: PlannedLayoutZone[] = [];
  for (const z of layout.zones) {
    const isApp = !z.widgetType;
    const widgetType = isApp ? appType : (z.widgetType as string);
    const planned: PlannedLayoutZone = {
      role: isApp ? 'app' : widgetType === 'TEXT' ? 'title' : widgetType === 'CLOCK' ? 'clock' : 'other',
      widgetType,
      x: z.x,
      y: z.y,
      width: z.width,
      height: z.height,
      defaultConfig: isApp ? { ...appConfig, ...z.defaultConfig } : { ...z.defaultConfig },
      ...(isApp && !built.ok ? { pending: true } : {}),
    };
    (isApp ? appZones : others).push(planned);
  }
  return [...appZones, ...others];
}

/**
 * Run several store writes as ONE undo step. Each store action pushes its own
 * snapshot; keep the first (the board before the gesture) and drop the rest,
 * so Cmd/Ctrl+Z puts back exactly what was there.
 */
function asOneUndoStep(fn: () => void): void {
  const before = useBuilderStore.getState().past;
  fn();
  const after = useBuilderStore.getState().past;
  if (after === before) return;
  const first = after.find((entry) => !before.includes(entry));
  if (!first) return;
  useBuilderStore.setState({ past: [...before, first].slice(-HISTORY_DEPTH) });
}
/** Mirrors useBuilderStore's HISTORY_LIMIT. */
const HISTORY_DEPTH = 50;

/**
 * Build a finished layout on the board. From a zone's setup card the layout
 * REPLACES that zone, and an untouched blank placeholder goes too. Any other
 * content stays (the new zones stack above it). Undo takes the whole layout
 * back in one step. Returns the app zone's id, selected — with a focus
 * request when it still needs its link.
 */
export function applyStarterLayout(
  app: AppDefinition,
  layout: AppStarterLayout,
  values: Record<string, string>,
  opts?: { replaceZoneId?: string },
): string | null {
  if (app.comingSoon) return null;
  const plan = planStarterLayout(app, layout, values);
  let appZoneId: string | null = null;
  asOneUndoStep(() => {
    const st = useBuilderStore.getState();
    const rest = st.zones.filter((z) => z.id !== opts?.replaceZoneId);
    // A blank board's lone placeholder is not content — same rule addZone's
    // `replacePlaceholder` uses.
    const lonePlaceholder = rest.length === 1 && rest[0].widgetType === 'EMPTY' ? rest[0].id : null;
    const doomed = st.zones.filter(
      (z) => !z.locked && (z.id === opts?.replaceZoneId || z.id === lonePlaceholder),
    );
    if (doomed.length) {
      st.select(doomed.map((z) => z.id), false, { source: 'panel' });
      useBuilderStore.getState().removeSelected();
    }
    for (const z of plan) {
      const id = useBuilderStore.getState().addZone(z.widgetType, undefined, { w: z.width, h: z.height });
      const count = useBuilderStore.getState().zones.length;
      useBuilderStore.getState().updateZone(id, {
        x: z.x,
        y: z.y,
        width: z.width,
        height: z.height,
        defaultConfig: z.defaultConfig,
        ...(z.role === 'app' ? { name: `${app.name} ${count}` } : {}),
      });
      if (z.role === 'app') appZoneId = id;
    }
  });
  if (appZoneId) {
    useBuilderStore.getState().select(appZoneId);
    if (plan.some((z) => z.pending)) requestAppSetupFocus(appZoneId);
  }
  return appZoneId;
}
