/**
 * No yellow popups pinned to the bottom of the dashboard (2026-11-14).
 *
 * The owner asked whether "the ugly alert screens in the bottom right of the
 * dashboard … yellow background" were gone. The first removal (61bdbf873,
 * 2026-11-02) deleted the CALLER and left the yellow style in the toast host,
 * so nothing stopped the next one. AppToaster.design.test.tsx now locks the
 * toast host; this gate covers every OTHER popup: it parses each .tsx under
 * src/app and src/components with the TypeScript compiler, finds the elements
 * positioned `fixed`/`sticky` against the bottom of the viewport (corner
 * toasts, status cards, bars — full-screen modals and backdrops are excluded
 * by shape), and fails if one of them paints a yellow / amber / orange
 * BACKGROUND. The dashboard's floating surfaces are white cards that carry
 * their tone in an icon or an outline (AppToaster, app-dialog, the bell);
 * a tinted fill belongs to in-flow banners and pills.
 *
 * Out of scope by path: what renders on the screens themselves — the player,
 * widgets, and the board / ribbon / scorebug / overlay broadcast surfaces.
 * (The player's amber "Real-time disabled" chip is a deliberate on-glass
 * alert; it is the positive control below.)
 *
 * Limits: it reads the positioned element's own classes and inline style, not
 * its children; a background set from a variable it cannot see is invisible.
 *
 * Controls (apps/web/CLAUDE.md rule 9 — an analysis that answers "nothing"
 * for everything proves nothing): the same scan must FIND the dashboard's real
 * bottom-anchored popups, must FLAG the player's amber chip when the glass
 * exclusion is lifted, and must FLAG synthetic yellow popups.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const SRC = path.resolve(__dirname, '..', '..', '..');
const GLASS = ['app/player/', 'app/board/', 'app/ribbon/', 'app/scorebug/', 'app/overlay/', 'components/player/', 'components/widgets/'];

const VARIANT = '(?:[a-z0-9_\\-\\[\\]]+:)*';
const has = (tokens: string[], body: string) => tokens.some((t) => new RegExp(`^${VARIANT}${body}$`).test(t));
const YELLOW_CLASS = new RegExp(`(?:^|\\s)${VARIANT}bg-(?:amber|yellow|orange)-`);
const YELLOW_STYLE = /#(?:fffbeb|fef3c7|fde68a|fcd34d|fbbf24|f59e0b|d97706|fefce8|fef9c3|fef08a|fde047|facc15|eab308|fff7ed|ffedd5|fed7aa|fdba74|fb923c|f97316)\b|\b(?:amber|gold|yellow|orange)\b/i;

interface Hit { file: string; line: number; yellow: boolean; what: string }

/** Every string fragment inside an expression: literals, template parts, cn()/ternary arms. */
function fragments(node: ts.Node, out: string[] = []): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
  else if (ts.isTemplateExpression(node)) {
    out.push(node.head.text);
    for (const span of node.templateSpans) {
      fragments(span.expression, out);
      out.push(span.literal.text);
    }
  } else ts.forEachChild(node, (c) => { fragments(c, out); });
  return out;
}

function scanSource(rel: string, text: string): Hit[] {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits: Hit[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      let cls = '';
      const style: Record<string, string> = {};
      for (const attr of node.attributes.properties) {
        if (!ts.isJsxAttribute(attr) || !attr.initializer) continue;
        const name = attr.name.getText(sf);
        if (name === 'className') cls = fragments(attr.initializer).join(' ');
        if (name === 'style' && ts.isJsxExpression(attr.initializer) && attr.initializer.expression
          && ts.isObjectLiteralExpression(attr.initializer.expression)) {
          for (const p of attr.initializer.expression.properties) {
            if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) {
              style[p.name.text] = p.initializer.getText(sf);
            }
          }
        }
      }
      const tokens = cls.split(/\s+/).filter(Boolean);
      const positioned = has(tokens, '(?:fixed|sticky)') || /['"](?:fixed|sticky)['"]/.test(style.position ?? '');
      const bottom = has(tokens, '-?bottom-\\S+') || 'bottom' in style;
      const fullBleed = has(tokens, 'inset-0')
        || (has(tokens, 'top-0') && has(tokens, 'left-0') && has(tokens, '(?:right|bottom)-0'))
        || ['top', 'right', 'bottom', 'left'].every((k) => k in style);
      if (positioned && bottom && !fullBleed) {
        const background = [style.background, style.backgroundColor].filter(Boolean).join(' ');
        hits.push({
          file: rel,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          yellow: YELLOW_CLASS.test(cls) || YELLOW_STYLE.test(background),
          what: (cls || JSON.stringify(style)).replace(/\s+/g, ' ').slice(0, 160),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name !== '__tests__' && ent.name !== 'node_modules') walk(p, out);
    } else if (ent.name.endsWith('.tsx') && !/\.(test|spec)\.tsx$/.test(ent.name)) out.push(p);
  }
  return out;
}

function scanDashboard(): Hit[] {
  const files = ['app', 'components'].flatMap((d) => walk(path.join(SRC, d)));
  const hits: Hit[] = [];
  for (const abs of files) {
    const rel = path.relative(SRC, abs).split(path.sep).join('/');
    if (GLASS.some((g) => rel.startsWith(g))) continue;
    const text = fs.readFileSync(abs, 'utf8');
    if (!/\b(?:fixed|sticky)\b/.test(text)) continue;
    hits.push(...scanSource(rel, text));
  }
  return hits;
}

describe('bottom-anchored popups on the dashboard never paint a yellow background', () => {
  const dashboard = scanDashboard();

  it('no dashboard popup pinned to the bottom of the viewport has a yellow / amber / orange fill', () => {
    const offenders = dashboard.filter((h) => h.yellow).map((h) => `${h.file}:${h.line}  ${h.what}`);
    expect(offenders).toEqual([]);
  });

  it('control: the scan sees the real bottom-corner popups', () => {
    const files = new Set(dashboard.map((h) => h.file));
    for (const f of [
      'components/layout/StaleBundleWatcher.tsx',
      'components/assets/UploadActivity.tsx',
      'components/playlists/UsbExport.tsx',
      'components/bug-reporter/BugReporterButton.tsx',
    ]) expect(files).toContain(f);
  });

  it("control: outside the glass exclusion it flags the player's amber corner chip", () => {
    const rel = 'app/player/page.tsx';
    const glass = scanSource(rel, fs.readFileSync(path.join(SRC, rel), 'utf8')).filter((h) => h.yellow);
    expect(glass.length).toBeGreaterThan(0);
  });

  it('control: it flags synthetic yellow corner popups and passes a white one', () => {
    const src = `
      export function A({ tone }: { tone: string }) {
        return <>
          <div className={cn('fixed bottom-6 right-6 rounded-xl', tone === 'warn' && 'bg-amber-50 border-amber-200')} />
          <div className={\`fixed md:bottom-6 right-4 \${tone} bg-yellow-100/90\`} />
          <aside style={{ position: 'fixed', bottom: 24, right: 24, background: '#fef3c7' }} />
          <div className="fixed bottom-6 right-6 bg-white border border-amber-200" />
          <div className="fixed top-0 right-0 bottom-0 left-0 bg-amber-50" />
        </>;
      }`;
    const hits = scanSource('synthetic.tsx', src);
    // Four bottom-anchored popups (the full-screen backdrop is not one), three yellow.
    expect(hits).toHaveLength(4);
    expect(hits.map((h) => h.yellow)).toEqual([true, true, true, false]);
  });
});
