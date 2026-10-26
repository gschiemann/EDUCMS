/**
 * The player's question dialog, wired (2026-10-26, Goodview 24" on site).
 *
 * page.tsx is a 15k-line component that cannot mount in jsdom, so — like
 * softBlankRenderExits.test.ts and glassContinuityWiring.test.ts — its wiring
 * is checked by reading the source the browser will run. The behaviour itself
 * is covered by remoteConfirm.test.ts (the machine), RemoteDialog.test.tsx
 * (the component) and tests/e2e/player-unpair-confirm.spec.ts (the real page,
 * chromium + webkit).
 */
import * as fs from 'fs';
import * as path from 'path';

const PLAYER_DIR = path.resolve(__dirname, '..');
const COMPONENTS_PLAYER_DIR = path.resolve(__dirname, '../../../components/player');
const PAGE = fs.readFileSync(path.join(PLAYER_DIR, 'page.tsx'), 'utf8');
const LAYOUT = fs.readFileSync(path.join(PLAYER_DIR, 'layout.tsx'), 'utf8');
const DIALOG = fs.readFileSync(path.join(PLAYER_DIR, 'RemoteDialog.tsx'), 'utf8');

/** Comments never ship; prose about the old dialog must not trip the guard. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
}

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...sourceFiles(abs));
    } else if (/\.(tsx?|jsx?)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
      out.push(abs);
    }
  }
  return out;
}

/** The body of `const onShowStop = () => { … };` inside the Back effect. */
function onShowStopBody(): string {
  const src = code(PAGE);
  const start = src.indexOf('const onShowStop = () => {');
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf("window.addEventListener('edu-show-stop-overlay'", start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe('the dashboard dialog never reaches the player glass', () => {
  const files = [...sourceFiles(PLAYER_DIR), ...sourceFiles(COMPONENTS_PLAYER_DIR)];

  it('scans the player route (negative control: page.tsx and layout.tsx are in the set)', () => {
    expect(files).toContain(path.join(PLAYER_DIR, 'page.tsx'));
    expect(files).toContain(path.join(PLAYER_DIR, 'layout.tsx'));
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(['app-dialog', 'appConfirm(', 'appAlert(', 'appChoose(', 'appPrompt(', '<AppDialogHost'])(
    'no player-route source uses %s',
    (needle) => {
      const offenders = files.filter((f) => code(fs.readFileSync(f, 'utf8')).includes(needle));
      expect(offenders.map((f) => path.relative(PLAYER_DIR, f))).toEqual([]);
    },
  );

  it('the guard itself works: it would have caught the code it replaced', () => {
    const before = "import { appConfirm, appAlert } from '@/components/ui/app-dialog';\nconst ok = await appConfirm({ title: 'x' });";
    expect(code(before).includes('app-dialog')).toBe(true);
    expect(code(before).includes('appConfirm(')).toBe(true);
    expect(code('// appConfirm( in a comment').includes('appConfirm(')).toBe(false);
  });

  it('the player layout no longer mounts the dashboard host', () => {
    expect(code(LAYOUT)).not.toMatch(/AppDialogHost/);
  });

  it('the player dialog is never a portal — it is drawn inside the surface that asked', () => {
    expect(code(DIALOG)).not.toMatch(/createPortal|react-dom/);
  });
});

describe("the page's Back authority cancels the question before anything else it does", () => {
  it('the alert lock first, then the question, then the editor, then the menu toggle', () => {
    const body = onShowStopBody();
    const lock = body.indexOf('activeEmergencyRef.current || pushedEmergencyMessageRef.current');
    const question = body.indexOf("if (remoteDialogRef.current.open) {");
    const back = body.indexOf("dispatchRemoteDialog({ type: 'back' });");
    const editor = body.indexOf('showCanvasEditorRef.current');
    const toggle = body.indexOf('setPlaybackStopped(false);');
    for (const at of [lock, question, back, editor, toggle]) expect(at).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(question);
    expect(question).toBeLessThan(back);
    expect(back).toBeLessThan(editor);
    expect(editor).toBeLessThan(toggle);
    // …and it RETURNS after cancelling: one Back press, one step back.
    expect(body.slice(back, editor)).toMatch(/^dispatchRemoteDialog\(\{ type: 'back' \}\);\s*return;/);
  });

  it('the same handler serves the APK event AND the raw remote keys', () => {
    const src = code(PAGE);
    expect(src).toContain("window.addEventListener('edu-show-stop-overlay', onShowStop as EventListener);");
    expect(src).toMatch(/if \(key === 'Escape' \|\| key === 'Backspace' \|\| key === 'GoBack' \|\| key === 'Back'\) \{\s*e\.preventDefault\(\);\s*onShowStop\(\);/);
  });
});

describe('an alert always wins', () => {
  it('every alert signal blocks the question', () => {
    const src = code(PAGE);
    const m = /const remoteDialogBlockedByAlert =([\s\S]*?);/.exec(src);
    expect(m).not.toBeNull();
    const expr = m![1];
    for (const signal of [
      '!!activeEmergency',
      '!!pushedEmergencyMessage',
      'polledEmergencyHeld',
      'emergencyRenderHold',
      "phase === 'emergency'",
      'playlist?.isEmergency === true',
    ]) {
      expect(expr).toContain(signal);
    }
  });

  it('an alert closes it, it cannot open during one, and it is hidden in the same commit', () => {
    const src = code(PAGE);
    expect(src).toMatch(/if \(remoteDialogBlockedByAlert\) dispatchRemoteDialog\(\{ type: 'emergency' \}\);/);
    expect(src).toMatch(/const openRemoteDialog = [\s\S]{0,200}if \(remoteDialogBlockedByAlert \|\| remoteDialogRef\.current\.open\) return;/);
    expect(src).toContain('{remoteDialog.open && !remoteDialogBlockedByAlert && remoteSurfaceStillUp(remoteDialog, playbackStopped) ? (');
  });
});

describe('it never outlives its menu', () => {
  it('a playbackStopped change that takes its surface away closes it', () => {
    expect(code(PAGE)).toMatch(
      /if \(s\.open && !remoteSurfaceStillUp\(s, playbackStopped\)\) dispatchRemoteDialog\(\{ type: 'surface-closed' \}\);\s*\}, \[playbackStopped, dispatchRemoteDialog\]\);/,
    );
  });

  it('it is mounted INSIDE the paired card, after the card body, before the card closes', () => {
    const src = code(PAGE);
    const card = src.indexOf('className="edu-paired-view ');
    const mount = src.indexOf('<RemoteDialog');
    const unpairLink = src.indexOf('className="edu-unpair-link ');
    expect(card).toBeGreaterThan(-1);
    expect(unpairLink).toBeGreaterThan(card);
    expect(mount).toBeGreaterThan(unpairLink);
    // Exactly one mount site.
    expect(src.indexOf('<RemoteDialog', mount + 1)).toBe(-1);
  });
});

describe('the controls that ask', () => {
  it('both Unpair controls ask the remote question; neither shrinks on focus', () => {
    const src = code(PAGE);
    const opens = src.match(/openRemoteDialog\('unpair', e\.currentTarget\)/g) || [];
    expect(opens).toHaveLength(2);
    for (const marker of ['data-edu-unpair=""']) {
      let at = src.indexOf(marker);
      let seen = 0;
      while (at !== -1) {
        seen += 1;
        const tag = src.slice(at, src.indexOf('>', src.indexOf('className="', at)) + 1);
        expect(tag).not.toContain('focus:scale-95');
        at = src.indexOf(marker, at + 1);
      }
      expect(seen).toBe(2);
    }
  });

  it('the "Unpair device" link below the action row has a loud focus ring of its own', () => {
    const src = PAGE;
    expect(src).toMatch(/\.edu-paired-view \.edu-unpair-link:focus,\s*\.edu-paired-view \.edu-unpair-link:focus-visible \{\s*outline: calc\(3px \* var\(--splash-k, 1\)\) solid #fde047 !important;/);
  });

  it('Auto-Play asks the one-answer notice', () => {
    expect(code(PAGE)).toContain("openRemoteDialog('nothing-to-play', e.currentTarget)");
  });
});
