/**
 * Shared HTML sanitizer for widget content rendered via
 * dangerouslySetInnerHTML.
 *
 * Operators and contributors author rich widget content (bold, line
 * breaks, headings, highlight spans) in widget config. That content is
 * rendered verbatim on the player fleet AND the dashboard, so an
 * un-sanitized config value — `<img src=x onerror=...>`, `<script>` —
 * is stored XSS on every screen. Every dangerouslySetInnerHTML sink
 * that renders operator/contributor-supplied content MUST run its
 * input through this helper.
 *
 * DOMPurify keeps formatting markup (b, i, em, strong, br, h1-h6, p,
 * span, ul/ol/li, a, plus class/style attributes) and strips
 * <script>, event handlers, javascript: URLs, and every other XSS
 * vector.
 *
 * 2026-06-03 — switched from `isomorphic-dompurify` to browser-only
 * `dompurify`. The isomorphic build drags in `jsdom` so it can sanitize
 * under Node; on Vercel's serverless runtime jsdom@29's transitive
 * `html-encoding-sniffer@6 → @exodus/bytes` is ESM-only and blows up
 * `require()`, which 500'd every `[schoolId]` route's SSR (the layout
 * module graph imported this file via the widgets). The web client has a
 * real browser, so it never needed jsdom. Widget content is always
 * rendered CLIENT-side (the player kiosk + dashboard previews fetch and
 * render after mount), so sanitization runs in the browser where
 * DOMPurify is fully supported. On the server (no `window`) DOMPurify's
 * default export is the un-instantiated factory, so we return '' rather
 * than emit ANY un-sanitized markup into server HTML; the client
 * re-renders the sanitized value on hydration.
 */
import DOMPurify from 'dompurify';

/** Sanitize operator-authored HTML before dangerouslySetInnerHTML. */
export function sanitizeWidgetHtml(html: string | null | undefined): string {
  const input = html ?? '';
  // Server / no-window: DOMPurify is the factory (no `.sanitize`). Never
  // emit un-sanitized markup server-side — return empty and let the client
  // render the sanitized value on hydration.
  if (typeof window === 'undefined' || typeof (DOMPurify as { sanitize?: unknown }).sanitize !== 'function') {
    return '';
  }
  return DOMPurify.sanitize(input);
}
