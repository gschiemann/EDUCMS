/**
 * designer-document-completeness.ts — "was the model's document cut off?"
 *
 * DEPENDENCY-FREE ON PURPOSE. `designer-prompt.ts` imports this, and
 * `designer-prompt.ts` is loaded FROM SOURCE by web tests
 * (apps/web/tests/fixtures/kept-pos-board.ts drives the API's real
 * sanitize → shim → layout-engine → binder pipeline to produce the kept-board
 * fixture). The web Jest transformer cannot parse ESM packages such as
 * `cheerio`, so nothing on the prompt module's import graph may pull one in —
 * the cheerio-based static defect checks live in designer-board-defects.ts,
 * which re-exports these two so its callers see one module.
 * `designer-prompt-purity.spec.ts` guards the graph.
 */

/** Thrown by sanitizeDesignerHtml for a document that was cut off before it ended. */
export class DesignerHtmlIncompleteError extends Error {
  readonly code = 'DESIGNER_HTML_INCOMPLETE' as const;
  constructor(readonly reason: string) {
    super(`Designer HTML is incomplete: ${reason}.`);
    this.name = 'DesignerHtmlIncompleteError';
  }
}

/**
 * Why this is not a complete document, or null when it is. A document that
 * opens `<!doctype` / `<html` must close `</html>`; one that opens `<body` must
 * close `</body>`. A bare fragment (no html/body tags at all) is not judged here.
 */
export function documentIncompleteness(html: string): string | null {
  const s = String(html || '');
  if (
    (/<!doctype\s+html/i.test(s) || /<html[\s>]/i.test(s)) &&
    !/<\/html\s*>/i.test(s)
  ) {
    return 'it opens a document and never closes </html>';
  }
  if (/<body[\s>]/i.test(s) && !/<\/body\s*>/i.test(s))
    return 'it opens <body> and never closes it';
  return null;
}
