/**
 * buildApp — the ONE gate between an operator's Apps form and a zone on the
 * canvas. Nothing else may call `app.build()` directly.
 *
 * M6-1 (2026-09-12). The Apps tab's green "Add to canvas" button accepted
 * broken sources in two ways, and both looked like success:
 *
 *   1. `AppConfigForm` wrapped `app.build(values)` in a try/catch that
 *      returned `{ widgetType: 'WEBPAGE', defaultConfig: {} }` — so a
 *      Google Calendar link with malformed percent-encoding (which throws
 *      inside `decodeURIComponent` in `toGoogleCalendarEmbedUrl`) became a
 *      "successful" EMPTY webpage zone.
 *   2. `canConfirm` only checked that required strings were non-empty, and
 *      `isValidHttpsUrl` gated the live PREVIEW only — never Add. Typing
 *      `not a valid url` into the Website app added a zone pointed at
 *      `https://not a valid url`.
 *
 * Either way the operator saw a green button, watched a zone appear, and got
 * nothing on screen. Same defect class as every Milestone-0 item: a control
 * that visibly works and silently produces nothing.
 *
 * So this returns a DISCRIMINATED result. There is no third state and no
 * empty-config fallback: either the zone is worth writing, or the operator
 * gets a sentence explaining what's wrong with their link.
 *
 * Note the `preview` field on the failure branch — it exists ONLY so the
 * config form can keep drawing a partial preview while a required field is
 * still blank. It must never be written to a zone; that is the bug.
 */

import type { AppBuildResult, AppDefinition } from './app-registry';
import { isUsableWebUrl, parseWebUrl } from './url-transforms';
import { isAllowedStreamingHost } from '@/components/widgets/streaming-hosts';

export type AppBuildErrorCode =
  /** The tile is honestly not buildable yet (social embeds — see registry). */
  | 'coming-soon'
  /** A required field is still blank. The form's own "Paste your X to
   *  continue" copy covers this one; nothing is wrong with what they typed. */
  | 'missing'
  /** They typed something, and it will not produce working content. */
  | 'invalid';

export type AppBuildOutcome =
  | { ok: true; widgetType: string; defaultConfig: Record<string, unknown> }
  | {
      ok: false;
      code: AppBuildErrorCode;
      /** Plain English, specific to what went wrong. Shown to the operator. */
      reason: string;
      /**
       * What `build()` produced, for DRAWING THE CONFIG-FORM PREVIEW ONLY
       * while the operator is still filling the form. NEVER write this to a
       * zone — an unvalidated config reaching the canvas is the entire bug
       * this module closes. Absent when `build()` threw.
       */
      preview?: AppBuildResult;
    };

/**
 * Which key in a built `defaultConfig` carries the URL its widget will try to
 * load. A built config for one of these widget types with a URL that can't
 * resolve is a zone that renders nothing — checked here, on the OUTPUT,
 * because checking the raw input is exactly what wasn't enough.
 */
const URL_FIELD_BY_WIDGET: Record<string, string> = {
  WEBPAGE: 'url',
  STREAMING: 'embedUrl',
  RSS_FEED: 'feedUrl',
};

/**
 * "That doesn't look like a Google Calendar link. Copy the Public URL…"
 *
 * An app may override this for a paste it RECOGNISES as unusable — see
 * `AppInputExpectation.explain`. The Social Wall app uses it to say why a
 * Curator.io link can't be framed, which the generic sentence cannot.
 */
function notWhatWeExpected(app: AppDefinition, values: Record<string, string>): string {
  if (!app.expects) return 'That link won’t load anything. Check it and try again.';
  const { what, hint, explain } = app.expects;
  const specific = explain?.(values);
  if (specific) return specific;
  return `That doesn’t look like ${what}.${hint ? ` ${hint}` : ''}`;
}

export function buildApp(app: AppDefinition, values: Record<string, string>): AppBuildOutcome {
  if (app.comingSoon) {
    return {
      ok: false,
      code: 'coming-soon',
      reason: 'This app isn’t ready to add yet — nothing would show on your screens.',
    };
  }

  // `build()` is contractually pure-and-total, but a transform that calls
  // decodeURIComponent on operator input is one bad paste away from a
  // URIError. A throw is an ERROR STATE, never an empty config.
  let built: AppBuildResult | null = null;
  try {
    built = app.build(values);
  } catch {
    built = null;
  }

  // A blank required field is not a broken link — it's an unfinished form,
  // and the form has its own (better) copy for that case.
  const missing = app.configSchema.filter((f) => f.required && !values[f.key]?.trim());
  if (missing.length > 0) {
    return {
      ok: false,
      code: 'missing',
      reason: `${missing[0].label} is required.`,
      ...(built ? { preview: built } : {}),
    };
  }

  if (!built) {
    return { ok: false, code: 'invalid', reason: notWhatWeExpected(app, values) };
  }

  // The app's own "is this really my service's content?" check. A transform
  // that passed an unrecognised URL straight through lands here.
  if (app.expects?.recognises && !app.expects.recognises(built)) {
    return { ok: false, code: 'invalid', reason: notWhatWeExpected(app, values), preview: built };
  }

  // Generic structural check on the BUILT output.
  const urlField = URL_FIELD_BY_WIDGET[built.widgetType];
  if (urlField) {
    const url = built.defaultConfig[urlField];
    if (typeof url !== 'string' || !isUsableWebUrl(url)) {
      return { ok: false, code: 'invalid', reason: notWhatWeExpected(app, values), preview: built };
    }
    // STREAMING zones are framed only if the host is on the player's embed
    // allowlist (streaming-hosts.ts) — off it, the widget renders its
    // "unsupported streaming host" placeholder. Refuse at add-time instead.
    if (built.widgetType === 'STREAMING') {
      const parsed = parseWebUrl(url);
      if (!parsed || !isAllowedStreamingHost(parsed.hostname)) {
        return { ok: false, code: 'invalid', reason: notWhatWeExpected(app, values), preview: built };
      }
    }
  }

  return { ok: true, widgetType: built.widgetType, defaultConfig: built.defaultConfig };
}
