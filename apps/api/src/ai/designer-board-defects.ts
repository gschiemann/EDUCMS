/**
 * designer-board-defects.ts — what is wrong with a drawn AI Designer board that
 * can be known WITHOUT rendering it (2026-09-23, Codex finding 3).
 *
 * The review loop (designer-review.ts) looks at a RENDERED board. These checks
 * run on every draft first, renderer or not, because the worst drafts are broken
 * in ways a string can prove:
 *
 *   truncated            the vendor stopped at its output ceiling — the answer is
 *                        cut off (ai-providers.ts `truncated`). BLOCKER.
 *   incomplete-document  it opens a document (`<!doctype` / `<html`) and never
 *                        closes `</html>`, or opens `<body` and never closes it —
 *                        half a board. BLOCKER (sanitizeDesignerHtml now refuses
 *                        one outright; see DesignerHtmlIncompleteError).
 *   no-editable-text     text with no `data-field` on it or around it — words the
 *                        operator cannot click and change. BLOCKER when NONE of
 *                        the board's text is editable; otherwise major/minor by
 *                        how much is not.
 *   no-image-slot        a logo or photo was supplied and the board does not use
 *                        it. MAJOR (the critique and the reviser see it).
 *   binding-incomplete   a POS-bound board lost a planned row (the binder's own
 *                        verdict, designer-pos-binding.ts). BLOCKER.
 *
 * A blocker earns the draft ONE redraw, with `staticRedrawNudge` naming what was
 * wrong (the POS row nudge, `missingRowsNudge`, rides along when rows were lost).
 *
 * Pure: string in, list out. No I/O, no Nest.
 */
import * as cheerio from 'cheerio';

export type DefectSeverity = 'blocker' | 'major' | 'minor';

export type StaticDefectCode =
  | 'truncated'
  | 'incomplete-document'
  | 'no-editable-text'
  | 'no-image-slot'
  | 'binding-incomplete';

export interface BoardDefect<C extends string = string> {
  code: C;
  severity: DefectSeverity;
  detail: string;
}

export type StaticBoardDefect = BoardDefect<StaticDefectCode>;

export interface BoardDefectContext {
  /** The vendor stopped at its output ceiling (DispatchOutput.truncated). */
  truncated?: boolean;
  /** Output tokens the vendor reported for the draft (for the "cut off after N tokens" nudge). */
  outputTokens?: number | null;
  /** A logo / photo URL the board was asked to use. */
  logoUrl?: string | null;
  heroImageUrl?: string | null;
  /** The POS binder's verdict (finishDesignerBoard), null for an unbound board. */
  binding?: { ok: boolean; missing: number[] } | null;
}

// The two cheerio-free pieces the PROMPT module needs live in a dependency-free
// module (web tests load designer-prompt.ts from source and cannot parse cheerio);
// re-exported here so every other caller keeps one import.
export { DesignerHtmlIncompleteError, documentIncompleteness } from './designer-document-completeness';
import { documentIncompleteness } from './designer-document-completeness';

const WORD_CHARS = /[\p{L}\p{N}]/gu;

/**
 * How much of the board's visible copy the operator can edit. Text inside an
 * image slot (a logo's typeset fallback, a frame's glyph) and aria-hidden
 * ornament are not copy and are not counted. Counted in letters + digits, so a
 * "✹" or a "·" never decides anything.
 */
export function textEditability(html: string): {
  chars: number;
  editableChars: number;
  samples: string[];
} {
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(String(html || ''));
  } catch {
    return { chars: 0, editableChars: 0, samples: [] };
  }
  $('script, style, noscript, template, title, head').remove();
  const elements = $('body').length ? $('body').find('*').addBack() : $('*');
  let chars = 0;
  let editableChars = 0;
  const samples: string[] = [];
  elements.contents().each((_i, node) => {
    const textNode = node as { type?: string; data?: unknown };
    if (textNode.type !== 'text' || typeof textNode.data !== 'string') return;
    const text = textNode.data.replace(/\s+/g, ' ').trim();
    const n = (text.match(WORD_CHARS) || []).length;
    const $parent = $(node).parent();
    if (!n || !$parent.length) return;
    if (
      $parent.closest('[aria-hidden="true"], [data-imgslot], [data-img]').length
    )
      return;
    chars += n;
    if ($parent.closest('[data-field]').length) editableChars += n;
    else if (samples.length < 5) samples.push(text.slice(0, 40));
  });
  return { chars, editableChars, samples };
}

/** Is `url` on the board (as written, or HTML-escaped the way an attribute carries it)? */
function usesUrl(html: string, url: string): boolean {
  const u = String(url || '').trim();
  if (!u) return true;
  return html.includes(u) || html.includes(u.replace(/&/g, '&amp;'));
}

/** Every defect a string can prove, blockers first. */
export function designerBoardDefects(
  html: string,
  ctx: BoardDefectContext = {},
): StaticBoardDefect[] {
  const out: StaticBoardDefect[] = [];
  const doc = String(html || '');

  if (ctx.truncated) {
    const n =
      typeof ctx.outputTokens === 'number' && ctx.outputTokens > 0
        ? ` after ${ctx.outputTokens} output tokens`
        : '';
    out.push({
      code: 'truncated',
      severity: 'blocker',
      detail: `the answer was cut off at the output ceiling${n}`,
    });
  }
  const incomplete = documentIncompleteness(doc);
  if (incomplete)
    out.push({
      code: 'incomplete-document',
      severity: 'blocker',
      detail: incomplete,
    });

  if (ctx.binding && !ctx.binding.ok) {
    const rows = ctx.binding.missing
      .slice(0, 12)
      .map((n) => `[item.${n}]`)
      .join(', ');
    out.push({
      code: 'binding-incomplete',
      severity: 'blocker',
      detail: `planned POS rows missing: ${rows || 'unknown'}`,
    });
  }

  // Editability and image use are only meaningful on a whole document.
  if (!incomplete) {
    const t = textEditability(doc);
    const uneditable = t.chars - t.editableChars;
    if (t.chars > 0 && t.editableChars === 0) {
      out.push({
        code: 'no-editable-text',
        severity: 'blocker',
        detail:
          'none of the text carries data-field — nothing on the board can be edited',
      });
    } else if (uneditable > 0) {
      const share = uneditable / t.chars;
      out.push({
        code: 'no-editable-text',
        severity: share > 0.25 ? 'major' : 'minor',
        detail: `${Math.round(share * 100)}% of the text has no data-field${t.samples.length ? `: "${t.samples.join('", "')}"` : ''}`,
      });
    }
    if (ctx.logoUrl && !usesUrl(doc, ctx.logoUrl)) {
      out.push({
        code: 'no-image-slot',
        severity: 'major',
        detail:
          'the supplied logo is not on the board (expected <img data-imgslot="logo" src="…"> in the header)',
      });
    }
    if (ctx.heroImageUrl && !usesUrl(doc, ctx.heroImageUrl)) {
      out.push({
        code: 'no-image-slot',
        severity: 'major',
        detail:
          'the supplied photo is not on the board (expected <img data-imgslot="hero" src="…"> in a framed panel)',
      });
    }
  }

  const rank: Record<DefectSeverity, number> = {
    blocker: 0,
    major: 1,
    minor: 2,
  };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export function hasBlocker(defects: readonly BoardDefect[]): boolean {
  return defects.some((d) => d.severity === 'blocker');
}

/**
 * The line a redraw adds to the user prompt for the STATIC blockers (the POS
 * rows have their own, missingRowsNudge). Empty when there is nothing to say.
 */
export function staticRedrawNudge(
  defects: readonly StaticBoardDefect[],
  outputTokens?: number | null,
): string {
  const lines: string[] = [];
  const cut = defects.some(
    (d) =>
      d.severity === 'blocker' &&
      (d.code === 'truncated' || d.code === 'incomplete-document'),
  );
  if (cut) {
    const n =
      typeof outputTokens === 'number' && outputTokens > 0
        ? ` after ${outputTokens} tokens`
        : '';
    lines.push(
      `your previous answer was cut off${n} before the document ended — return the COMPLETE document this time, ending with </html>: tighter CSS, no comments, nothing after </html>.`,
    );
  }
  if (
    defects.some(
      (d) => d.severity === 'blocker' && d.code === 'no-editable-text',
    )
  ) {
    lines.push(
      'your previous answer had text with no data-field — every text element needs data-field="<key>" so the operator can edit it.',
    );
  }
  return lines.length ? `\n\nIMPORTANT — ${lines.join(' Also: ')}` : '';
}
