/**
 * §11.5 + §14.2 prohibited status language — a SOURCE-LEVEL gate over the
 * whole mobile shell.
 *
 * The render suites sweep the branches they happen to mount. This sweeps the
 * strings the components can RENDER AT ALL: it parses every file of the phone
 * surface with the TypeScript compiler, pulls out string literals and JSX text
 * (comments and identifiers excluded — a comment quoting a banned word is
 * documentation, not copy), and checks them against the design package's own
 * two lists.
 *
 * WHY THE PHONE NEEDS ITS OWN COPY OF THIS GATE. Three of these words were
 * retracted on the desktop hours before this surface existed: "Content
 * current" became "App current" and "Emergency ready" became "Emergency setup
 * ready", because the platform stores no expected content revision and the
 * district readiness check verifies wiring rather than cached alert media.
 * A phone that re-types the retracted wording would quietly reinstate the
 * claim on the surface nobody re-reads. The four labels this surface renders
 * come from ASSURANCE_LABEL rather than literals for the same reason; this
 * gate is what stops the next edit from typing them back in.
 *
 * Sibling gate, same technique: components/playlists/v1/__tests__/
 * prohibited-language.test.ts.
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const SRC = path.resolve(__dirname, '../../../..');

const FILES = [
  // The phone home.
  ...fs.readdirSync(path.join(SRC, 'components/dashboard/mobile'))
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => path.join(SRC, 'components/dashboard/mobile', f)),
  // The shell around it.
  path.join(SRC, 'components/layout/MobileNavV1.tsx'),
  path.join(SRC, 'components/layout/MobileTabBar.tsx'),
  path.join(SRC, 'components/layout/InstallPromptBanner.tsx'),
  // The front door.
  path.join(SRC, 'app/launch/page.tsx'),
];

const RULES: Array<[RegExp, string]> = [
  [/\bContent current\b/i, '§11.5 — only the app bundle is comparable; the label is "App current"'],
  [/\bEmergency ready\b/i, '§11.5 — needs a denominator and a readiness source; the label is "Emergency setup ready"'],
  [/\bDelivered\b/i, '§11.5 — "Delivered" claims a server copy reached the glass'],
  [/\bConfirmed\b/i, '§11.5 — "Confirmed" is reserved for a reported picture'],
  [/\bLive\b/i, '§11.5 — "Live" is not a status this platform can prove'],
  [/\bHealthy\b/i, '§14.2 — "Healthy" merges evidence families §5.3 keeps apart'],
  [/\bSent\b/i, '§14.2 — "Sent" claims a delivery the API acceptance does not prove'],
  [/\bon the glass\b/i, 'no physical-panel evidence exists (2026-09-01 truth audit)'],
  [/\bmanifest\b/i, 'operator-facing jargon: manifest'],
  [/\brender(ed|ing)?\b/i, 'operator-facing jargon: render'],
  [/\brevision\b/i, 'no expected content revision exists to name (§19)'],
];

/**
 * A string reaches a human only if it looks like prose. Class names, testids,
 * CSS values, URLs and kebab tokens are excluded by shape — including them
 * would drown the signal in Tailwind.
 */
function isCopy(s: string): boolean {
  if (s.trim().length < 3) return false;
  if (/^(var\(|--|#[0-9a-f]{3,}|https?:|\/|\.)/i.test(s)) return false;
  if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s)) return false;                     // kebab / single token
  if (/(^|\s)(text-|bg-|border-|rounded|flex|grid|px-|py-|w-|h-|gap-|hover:|md:|lg:|sm:|xl:)/.test(s)) return false;
  return /[A-Za-z]{3,}/.test(s);
}

function extract(file: string): Array<{ text: string; line: number }> {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Array<{ text: string; line: number }> = [];
  const visit = (node: ts.Node) => {
    let text: string | null = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    else if (ts.isJsxText(node)) text = node.text.trim();
    else if (ts.isTemplateExpression(node)) {
      text = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(' ');
    }
    if (text) {
      const t = text.trim();
      if (isCopy(t)) out.push({ text: t, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/**
 * The three sanctioned uses, each narrow enough that the string itself has to
 * carry the justification — leaning on the sentence above it is exactly the
 * ambiguity this gate exists to remove.
 */
function isExempt(text: string, why: string): boolean {
  // "…reporting a confirmed picture": the device's own picture proof, which is
  // the one thing "confirmed" is allowed to describe.
  if (why.includes('reported picture') && /picture/i.test(text)) return true;
  // §M04 prescribes the collapse line verbatim: "4 locations healthy". It is
  // a count of locations with no exception, and every exception is enumerated
  // directly above it — the precise definition §14.2 asks for.
  if (why.includes('"Healthy" merges') && /location/i.test(text)) return true;
  // "Nothing has been sent or changed" — the offline screen DENYING a
  // delivery. The ban exists to stop the claim, not its negation.
  if (why.includes('"Sent" claims') && /nothing has been sent/i.test(text)) return true;
  return false;
}

const corpus = FILES.flatMap((f) =>
  extract(f).map((e) => ({ ...e, file: path.relative(SRC, f) })),
);

describe('§11.5 / §14.2 prohibited language, across every mobile shell file', () => {
  it('finds a real corpus to check (a sweep over nothing proves nothing)', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(5);
    for (const f of FILES) expect(fs.existsSync(f)).toBe(true);
    expect(corpus.length).toBeGreaterThan(80);
  });

  it.each(RULES)('never says %s', (re, why) => {
    const hits = corpus.filter(({ text }) => re.test(text) && !isExempt(text, why));
    expect(
      hits.map((h) => `${h.file}:${h.line} — ${JSON.stringify(h.text)}`),
    ).toEqual([]);
  });
});
