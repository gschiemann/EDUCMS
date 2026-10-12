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
import { getApp, type AppDefinition } from './app-registry';
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
