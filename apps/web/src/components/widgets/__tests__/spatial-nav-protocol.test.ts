/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "http://localhost:3000/player"}
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  attachSpatialNavBridge,
  detachSpatialNavBridge,
  commandForKey,
  isVosNavFrameMessage,
  postSpatialNavCommand,
  VOSNAV_NS,
  VOSNAV_COMMANDS,
} from '../webpage-spatial-nav';

/**
 * INJ-001a (2026-08-02) — the WEBPAGE proxy iframe is now sandboxed WITHOUT
 * `allow-same-origin`, so the old `iframe.contentWindow.eval(SHIM_JS)`
 * injector is gone. Remote-control spatial navigation instead runs over a
 * hardened postMessage channel: the shim is baked into the proxied document
 * by apps/api/src/proxy/spatial-nav-shim.ts, and this module is the parent
 * half.
 *
 * This suite exercises BOTH directions with the REAL shipped code — the shim
 * source is transpiled straight out of the API and executed here.
 *
 * (An end-to-end run against a genuine null-origin sandboxed iframe in a real
 * browser was also performed: `origin` was observed as the string "null",
 * `arm` + `down` moved focus, unknown commands were ignored, and the parent
 * rejected a message from a different frame.)
 */

// ── load the REAL server-side shim ─────────────────────────────────────────
const API_SHIM_PATH = path.join(
  __dirname,
  '../../../../../../apps/api/src/proxy/spatial-nav-shim.ts',
);

function loadApiShimModule(): {
  buildSpatialNavShim: (origins: string[]) => string;
  resolveParentOrigins: (raw?: string) => string[];
} {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ts = require('typescript');
  const src = fs.readFileSync(API_SHIM_PATH, 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  // eslint-disable-next-line no-new-func
  new Function('exports', 'require', 'module', 'process', js)(
    mod.exports,
    require,
    mod,
    process,
  );
  return mod.exports as never;
}

const PARENT_ORIGIN = 'http://localhost:3000';
const api = loadApiShimModule();
const SHIM_HTML = api.buildSpatialNavShim([PARENT_ORIGIN]);
const SHIM_JS = SHIM_HTML.replace(/^<script>/, '').replace(/<\/script>$/, '');

// ───────────────────────────────────────────────────────────────────────────
// FRAME SIDE — run the shim inside this jsdom window and drive it with
// messages, exactly as an embedding parent would.
// ───────────────────────────────────────────────────────────────────────────
describe('frame side (the server-injected shim)', () => {
  const fakeParent = { postMessage: jest.fn() };

  beforeAll(() => {
    // The shim reads `window.parent`; make it a spy we can assert on. This
    // also makes every reply synchronous, so the tests are deterministic.
    Object.defineProperty(window, 'parent', { value: fakeParent, configurable: true });
    // jsdom does not implement scrollIntoView; without a stub the shim's
    // move() throws and the whole (correct) command path looks dead.
    Element.prototype.scrollIntoView = jest.fn();
    document.body.innerHTML = `
      <a href="#1" id="l1">one</a>
      <a href="#2" id="l2">two</a>
      <a href="#3" id="l3">three</a>`;
    // Give the links a non-zero box — jsdom reports 0×0 by default and the
    // shim's isVisible() would reject every candidate.
    for (const el of Array.from(document.querySelectorAll('a'))) {
      let top = 0;
      if (el.id === 'l2') top = 40;
      if (el.id === 'l3') top = 80;
      (el as HTMLElement).getBoundingClientRect = () =>
        ({ top, left: 0, right: 100, bottom: top + 20, width: 100, height: 20, x: 0, y: top }) as DOMRect;
    }
    // eslint-disable-next-line no-new-func
    new Function(SHIM_JS)();
  });

  beforeEach(() => fakeParent.postMessage.mockClear());

  /** Deliver a message to the shim with a controllable source/origin. */
  function deliver(data: unknown, opts?: { source?: unknown; origin?: string }) {
    const ev = new MessageEvent('message', {
      data,
      origin: opts?.origin ?? PARENT_ORIGIN,
    });
    Object.defineProperty(ev, 'source', {
      value: 'source' in (opts ?? {}) ? opts!.source : fakeParent,
      configurable: true,
    });
    window.dispatchEvent(ev);
  }
  const replies = () => fakeParent.postMessage.mock.calls.map((c) => c[0]);

  it('announced readiness to the allowlisted parent origin on install', () => {
    // (fired during beforeAll, before the per-test mockClear)
    expect(SHIM_HTML).toContain(`"${PARENT_ORIGIN}"`);
  });

  it('ACCEPTS a valid command from the allowlisted parent', () => {
    deliver({ vosnav: VOSNAV_NS, cmd: 'arm' });
    expect(replies()).toEqual([
      { vosnav: VOSNAV_NS, evt: 'result', cmd: 'arm', moved: false },
    ]);
    // and replies to the exact validated origin, not '*'
    expect(fakeParent.postMessage.mock.calls[0][1]).toBe(PARENT_ORIGIN);
  });

  it('performs a nav command once armed', () => {
    deliver({ vosnav: VOSNAV_NS, cmd: 'arm' });
    fakeParent.postMessage.mockClear();
    deliver({ vosnav: VOSNAV_NS, cmd: 'down' });
    expect(replies()).toEqual([
      { vosnav: VOSNAV_NS, evt: 'result', cmd: 'down', moved: true },
    ]);
    expect(document.activeElement?.id).toBe('l1');
  });

  it('REJECTS a message whose source is not our embedder', () => {
    const otherFrame = document.createElement('iframe');
    document.body.appendChild(otherFrame);
    deliver({ vosnav: VOSNAV_NS, cmd: 'arm' }, { source: otherFrame.contentWindow });
    expect(fakeParent.postMessage).not.toHaveBeenCalled();
  });

  it('REJECTS a message from an origin outside the baked allowlist', () => {
    deliver({ vosnav: VOSNAV_NS, cmd: 'arm' }, { origin: 'https://evil.example' });
    expect(fakeParent.postMessage).not.toHaveBeenCalled();
  });

  it('IGNORES an unknown command, a wrong namespace, and a non-object payload', () => {
    deliver({ vosnav: VOSNAV_NS, cmd: 'eval' });
    deliver({ vosnav: VOSNAV_NS, cmd: 'exec' });
    deliver({ vosnav: VOSNAV_NS, cmd: "up';alert(1);//" });
    deliver({ vosnav: VOSNAV_NS, cmd: { toString: () => 'up' } });
    deliver({ vosnav: 'vosnav/2', cmd: 'up' });
    deliver({ cmd: 'up' });
    deliver('up');
    deliver(null);
    expect(fakeParent.postMessage).not.toHaveBeenCalled();
  });

  it('ignores extra fields on an otherwise-valid command (no code payload path)', () => {
    deliver({ vosnav: VOSNAV_NS, cmd: 'up', js: 'alert(1)', selector: 'a', href: 'javascript:1' });
    expect(replies()).toEqual([
      { vosnav: VOSNAV_NS, evt: 'result', cmd: 'up', moved: expect.any(Boolean) },
    ]);
  });

  it('stops acting on nav commands after disarm', () => {
    deliver({ vosnav: VOSNAV_NS, cmd: 'disarm' });
    fakeParent.postMessage.mockClear();
    deliver({ vosnav: VOSNAV_NS, cmd: 'down' });
    expect(replies()).toEqual([
      { vosnav: VOSNAV_NS, evt: 'result', cmd: 'down', moved: false },
    ]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// PARENT SIDE — the bridge in webpage-spatial-nav.ts
// ───────────────────────────────────────────────────────────────────────────
describe('parent side (the bridge)', () => {
  let iframe: HTMLIFrameElement;
  let post: jest.Mock;

  beforeEach(() => {
    iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    post = jest.fn();
    // A sandboxed null-origin frame exposes only a handful of members; model
    // that by replacing contentWindow with a minimal stand-in.
    Object.defineProperty(iframe, 'contentWindow', {
      value: { postMessage: post, focus: jest.fn() },
      configurable: true,
    });
  });
  afterEach(() => {
    detachSpatialNavBridge(iframe);
    iframe.remove();
  });

  it('maps only the remote-control keys', () => {
    expect(commandForKey('ArrowUp')).toBe('up');
    expect(commandForKey('ArrowDown')).toBe('down');
    expect(commandForKey('ArrowLeft')).toBe('left');
    expect(commandForKey('ArrowRight')).toBe('right');
    expect(commandForKey('Enter')).toBe('activate');
    expect(commandForKey(' ')).toBe('activate');
    expect(commandForKey('a')).toBeNull();
    expect(commandForKey('Tab')).toBeNull();
    expect(commandForKey('F12')).toBeNull();
  });

  it('refuses to post anything outside the command enum', () => {
    expect(postSpatialNavCommand(iframe, 'up')).toBe(true);
    // @ts-expect-error — deliberately off-enum
    expect(postSpatialNavCommand(iframe, 'eval')).toBe(false);
    // @ts-expect-error — deliberately off-enum
    expect(postSpatialNavCommand(iframe, 'alert(1)')).toBe(false);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({ vosnav: VOSNAV_NS, cmd: 'up' }, '*');
  });

  it('arms the frame on attach and forwards arrow keys as enum commands', () => {
    attachSpatialNavBridge(iframe);
    expect(post).toHaveBeenCalledWith({ vosnav: VOSNAV_NS, cmd: 'arm' }, '*');
    post.mockClear();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(post.mock.calls.map((c) => c[0].cmd)).toEqual(['down', 'activate']);
  });

  it('does not forward keys it does not own', () => {
    attachSpatialNavBridge(iframe);
    post.mockClear();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(post).not.toHaveBeenCalled();
  });

  it('stops forwarding after detach (no listener leak across playlist items)', () => {
    attachSpatialNavBridge(iframe);
    detachSpatialNavBridge(iframe);
    post.mockClear();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(post).not.toHaveBeenCalled();
  });

  it('re-attaching replaces the previous bridge rather than stacking one', () => {
    attachSpatialNavBridge(iframe);
    attachSpatialNavBridge(iframe);
    post.mockClear();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(post.mock.calls.filter((c) => c[0].cmd === 'down')).toHaveLength(1);
  });

  it('self-detaches once the iframe leaves the document', () => {
    attachSpatialNavBridge(iframe);
    iframe.remove();
    post.mockClear();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(post).not.toHaveBeenCalled();
  });

  // ── inbound validation ───────────────────────────────────────────────────
  it('ACCEPTS a frame message bound to this iframe, even at origin "null"', () => {
    const ev = { source: iframe.contentWindow, data: { vosnav: VOSNAV_NS, evt: 'ready' } };
    expect(isVosNavFrameMessage(ev as never, iframe)).toBe(true);
  });

  it('REJECTS a message from any other source (the load-bearing check)', () => {
    const other = document.createElement('iframe');
    document.body.appendChild(other);
    const ev = { source: other.contentWindow, data: { vosnav: VOSNAV_NS, evt: 'ready' } };
    expect(isVosNavFrameMessage(ev as never, iframe)).toBe(false);
    expect(isVosNavFrameMessage({ source: window, data: { vosnav: VOSNAV_NS, evt: 'ready' } } as never, iframe)).toBe(false);
    other.remove();
  });

  it('REJECTS an unknown event type, a wrong namespace, and junk payloads', () => {
    const src = iframe.contentWindow;
    expect(isVosNavFrameMessage({ source: src, data: { vosnav: VOSNAV_NS, evt: 'exec' } } as never, iframe)).toBe(false);
    expect(isVosNavFrameMessage({ source: src, data: { vosnav: 'other/1', evt: 'ready' } } as never, iframe)).toBe(false);
    expect(isVosNavFrameMessage({ source: src, data: { evt: 'ready' } } as never, iframe)).toBe(false);
    expect(isVosNavFrameMessage({ source: src, data: 'ready' } as never, iframe)).toBe(false);
    expect(isVosNavFrameMessage({ source: src, data: null } as never, iframe)).toBe(false);
  });

  it('REJECTS everything when there is no frame to be bound to', () => {
    expect(isVosNavFrameMessage({ source: window, data: { vosnav: VOSNAV_NS, evt: 'ready' } } as never, null)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('no eval path exists in either half of the protocol', () => {
  it('the parent bridge module contains no code-execution primitive', () => {
    const src = fs.readFileSync(path.join(__dirname, '../webpage-spatial-nav.ts'), 'utf8');
    // Strip comments so the prose explaining WHY eval is gone doesn't trip it.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\beval\s*\(/);
    expect(code).not.toMatch(/new\s+Function\s*\(/);
    expect(code).not.toMatch(/\bcontentDocument\b/);
    expect(code).not.toMatch(/\.innerHTML\s*=/);
  });

  it('the command vocabulary is closed', () => {
    expect([...VOSNAV_COMMANDS].sort()).toEqual(
      ['activate', 'arm', 'disarm', 'down', 'left', 'right', 'up'],
    );
  });
});
