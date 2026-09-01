/**
 * §4.3 prohibited language — a SOURCE-LEVEL gate over the whole v1 surface.
 *
 * playlistOps.test.ts sweeps the strings the derivation can PRODUCE. This
 * sweeps the strings the components can RENDER: it parses every file of the
 * Operations v1 tree with the TypeScript compiler, pulls out the string
 * literals and JSX text (comments and identifiers excluded — a comment quoting
 * a banned word is documentation, not copy), and checks them against §4.3 plus
 * the operator-facing-jargon list.
 *
 * Why a source parse rather than a render test: a render test only covers the
 * branches it happens to mount. The empty states, the error states, the filter
 * options, the tooltips and the confirmation copy are all reachable by an
 * operator, and this reaches all of them.
 *
 * THE RULE IT ENFORCES. The mock's Delivery column reads "Confirmed 4/4". The
 * platform stores no expected per-target content signature (handoff §10.3), so
 * that claim cannot be made. The single sanctioned use of the word is about a
 * PICTURE the device itself reported painting — which is why the exemption
 * below requires the word "picture" to be in the same string, not merely in the
 * column header above it.
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const V1_DIR = path.join(__dirname, '..');
const PAGES_DIR = path.resolve(__dirname, '../../../../app/[schoolId]/playlists');

const FILES = [
  ...fs.readdirSync(V1_DIR)
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => path.join(V1_DIR, f)),
  path.join(PAGES_DIR, 'page.tsx'),
  path.join(PAGES_DIR, '[playlistId]', 'page.tsx'),
];

const RULES: Array<[RegExp, string]> = [
  [/\bLIVE\b/i, '§4.3 — "LIVE" is not a status this platform can prove'],
  [/\bConfirmed\b/i, '§4.3 — "Confirmed" is reserved for a reported picture'],
  [/\bDelivered\b/i, '§4.3 — "Delivered" claims a server copy reached the glass'],
  [/\bReady\b/i, '§4.3 — "Ready" needs readiness telemetry that does not exist'],
  [/\bmanifest\b/i, 'operator-facing jargon: manifest'],
  [/\bpainting\b/i, 'operator-facing jargon: painting'],
  [/\brender\b/i, 'operator-facing jargon: render'],
  [/\back\b/i, 'operator-facing jargon: ack'],
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

const corpus = FILES.flatMap((f) =>
  extract(f).map((e) => ({ ...e, file: path.relative(path.resolve(__dirname, '../../../../..'), f) })),
);

describe('§4.3 prohibited language, across every Operations v1 file', () => {
  it('finds a real corpus to check (a sweep over nothing proves nothing)', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(6);
    expect(corpus.length).toBeGreaterThan(150);
  });

  it.each(RULES)('never says %s', (re, why) => {
    const hits = corpus.filter(({ text }) => {
      if (!re.test(text)) return false;
      // The one sanctioned use of "confirmed": the device's own picture proof.
      // The string itself must say so — leaning on the column header above it
      // is exactly the ambiguity this gate exists to remove.
      if (why.includes('reported picture') && /picture/i.test(text)) return false;
      return true;
    });
    expect(
      hits.map((h) => `${h.file}:${h.line} — ${JSON.stringify(h.text)}`),
    ).toEqual([]);
  });
});
