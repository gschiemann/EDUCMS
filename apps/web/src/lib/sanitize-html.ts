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
 * vector. isomorphic-dompurify runs in both the browser and Node
 * (SSR / static export), so it is safe on the player and dashboard.
 */
import DOMPurify from 'isomorphic-dompurify';

/** Sanitize operator-authored HTML before dangerouslySetInnerHTML. */
export function sanitizeWidgetHtml(html: string | null | undefined): string {
  return DOMPurify.sanitize(html ?? '');
}
