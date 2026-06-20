// Field-resolution map — the single source of truth for which widget
// config keys hold editable TEXT (and, later, which keys a chat-edit may
// mutate). Shared by the API (server-side validation for the inline
// rewrite + chat-to-edit endpoints) and the web (chip eligibility in the
// builder). See docs/research/2026-06-16-touch-editor-flagship/
// 03-IN-EDITOR-AI-EDITING-SPEC.md §0.1.
//
// widgetType keys are plain UPPERCASE strings (not the Prisma enum) so this
// stays importable from both apps without a cross-package enum dependency.

export type TextFieldKind = 'plain' | 'rich' | 'list';

export interface TextFieldDescriptor {
  /** defaultConfig key that holds the editable text. */
  key: string;
  /** Operator-facing label. */
  label: string;
  /** plain = no markup; rich = whitelisted inline tags; list = string[]. */
  kind: TextFieldKind;
}

/**
 * Per-widget editable text fields. A widget absent here (CLOCK, WEATHER,
 * IMAGE, …) has NO rewriteable text → the inline rewrite chips never show.
 * `list` widgets (TICKER) are intentionally EXCLUDED from inline-rewrite v1
 * (the per-item array round-trip is a fast-follow) — see spec P1-6.
 */
export const TEXT_FIELDS: Record<string, TextFieldDescriptor[]> = {
  TEXT: [{ key: 'content', label: 'Text', kind: 'plain' }],
  RICH_TEXT: [{ key: 'content', label: 'Text', kind: 'rich' }],
  HEADLINE: [{ key: 'content', label: 'Text', kind: 'plain' }],
  ANNOUNCEMENT: [{ key: 'message', label: 'Message', kind: 'plain' }],
  QUOTE: [
    { key: 'quote', label: 'Quote', kind: 'plain' },
    { key: 'author', label: 'Author', kind: 'plain' },
  ],
  TICKER: [{ key: 'messages', label: 'Messages', kind: 'list' }],
};

/** Resolve the descriptor for a (widgetType, fieldKey) pair, or undefined. */
export function getTextFieldDescriptor(
  widgetType: string,
  fieldKey: string,
): TextFieldDescriptor | undefined {
  const list = TEXT_FIELDS[String(widgetType || '').toUpperCase()];
  if (!list) return undefined;
  return list.find((f) => f.key === fieldKey);
}

/** Does this widget have ANY inline-rewriteable (non-list) text field? */
export function hasRewriteableText(widgetType: string): boolean {
  const list = TEXT_FIELDS[String(widgetType || '').toUpperCase()];
  return !!list && list.some((f) => f.kind !== 'list');
}

/** The inline-rewrite operations the /ai/text/rewrite endpoint understands. */
export const REWRITE_OPS = [
  'rewrite',
  'shorten',
  'expand',
  'fit_to_zone',
  'punch',
  'fix_grammar',
  'translate',
  'custom',
] as const;
export type RewriteOp = (typeof REWRITE_OPS)[number];

export function isRewriteOp(v: unknown): v is RewriteOp {
  return typeof v === 'string' && (REWRITE_OPS as readonly string[]).includes(v);
}
