/**
 * Glass continuity, wired (2026-10-11, launch W4):
 *   1. every reload borrows the off-hours update's cover — and only borrows it
 *      (no update evidence, no convergence hold);
 *   4. the red "Player did not start" line waits longer on a paired screen and
 *      is taken down the moment the app boots;
 *   6. an ALERT still paints over every new state: the cover, the quiet-boot
 *      mark and the black hold.
 *
 * The page is a 14k-line component that cannot be mounted in jsdom, so its
 * wiring is checked the way softBlankRenderExits.test.ts checks it — by
 * reading the source the browser will run — and every DOM/CSS claim that CAN
 * run in jsdom does.
 */
import * as fs from 'fs';
import * as path from 'path';
import { UPDATE_COVER_KEY, UPDATE_EVIDENCE_KEY, convergenceHoldUntil, parseUpdateAppliedRecord } from '../offHoursUpdate';
import { BLACK_COVER_FRAME, reloadCoverRecord, removeUpdateCover, writeUpdateCover } from '../updateCover';
import { UPDATE_COVER_ATTR, UPDATE_COVER_INLINE_JS } from '../updateCoverInline';
import { QUIET_BOOT_ATTR } from '../quietBootInline';

const PAGE = fs.readFileSync(path.resolve(__dirname, '../page.tsx'), 'utf8');
const LAYOUT = fs.readFileSync(path.resolve(__dirname, '../layout.tsx'), 'utf8');
const OVERLAY = fs.readFileSync(path.resolve(__dirname, '../../../components/player/EmergencyOverlay.tsx'), 'utf8');

/** The layout's own <style> block, as the browser receives it. */
function layoutCss(): string {
  const m = /<style>\{`([\s\S]*?)`\}<\/style>/.exec(LAYOUT);
  if (!m) throw new Error('layout <style> block not found');
  return m[1];
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.documentElement.removeAttribute(UPDATE_COVER_ATTR);
  document.documentElement.removeAttribute(QUIET_BOOT_ATTR);
  document.documentElement.removeAttribute('data-edu-booted');
  document.documentElement.style.cssText = '';
  sessionStorage.clear();
  delete (window as unknown as { __eduUpdateCover?: unknown }).__eduUpdateCover;
});

describe('1 — every reload goes out under the cover', () => {
  it('a borrowed-cover record is painted first by the next document', () => {
    const frame = { kind: 'image' as const, data: 'data:image/jpeg;base64,/9j/4AAQ', color: '#123456', capture: 'live' as const, w: 480, h: 270 };
    expect(writeUpdateCover(sessionStorage, reloadCoverRecord('refresh-ws', frame, Date.now()))).toBe(true);
    // eslint-disable-next-line no-new-func
    new Function(UPDATE_COVER_INLINE_JS)();
    const html = document.documentElement;
    expect(html.getAttribute(UPDATE_COVER_ATTR)).toBe('image');
    expect(html.style.backgroundImage).toContain('data:image/jpeg');
  });

  it('the crash reload opens on black, never the splash', () => {
    writeUpdateCover(sessionStorage, reloadCoverRecord('error-boundary', BLACK_COVER_FRAME, Date.now()));
    // eslint-disable-next-line no-new-func
    new Function(UPDATE_COVER_INLINE_JS)();
    expect(document.documentElement.getAttribute(UPDATE_COVER_ATTR)).toBe('color');
    expect(document.documentElement.style.backgroundColor).toMatch(/^(#000|rgb\(0, 0, 0\))$/);
  });

  it('a borrowed cover is only borrowed: no update evidence, no convergence hold', () => {
    const rec = reloadCoverRecord('refresh-durable', BLACK_COVER_FRAME, Date.now());
    writeUpdateCover(sessionStorage, rec);
    expect(convergenceHoldUntil(parseUpdateAppliedRecord(sessionStorage.getItem(UPDATE_COVER_KEY)), 'anything')).toBe(0);
    // eslint-disable-next-line no-new-func
    new Function(UPDATE_COVER_INLINE_JS)();
    expect(removeUpdateCover(document, sessionStorage, Date.now())).toBeNull();
    expect(document.documentElement.hasAttribute(UPDATE_COVER_ATTR)).toBe(false);
    expect(sessionStorage.getItem(UPDATE_COVER_KEY)).toBeNull();
    expect(sessionStorage.getItem(UPDATE_EVIDENCE_KEY)).toBeNull();
  });

  it('a real off-hours update record still reports evidence (unchanged)', () => {
    writeUpdateCover(sessionStorage, {
      v: 1, from: 'a', to: 'b', window: 'nightly', boundary: 'item', zone: 'UTC', zoneSource: 'utc',
      capture: 'color', navigatedAtMs: Date.now(), kind: 'color', color: '#000', w: 0, h: 0,
    });
    expect(removeUpdateCover(document, sessionStorage, Date.now())).not.toBeNull();
    expect(sessionStorage.getItem(UPDATE_EVIDENCE_KEY)).not.toBeNull();
  });

  it('every automatic and operator reload path of the page uses reloadUnderCover', () => {
    for (const reason of ['refresh-ws', 'refresh-sse', 'refresh-durable', 'canvas', 'sync']) {
      expect(PAGE).toContain(`reloadUnderCover('${reason}')`);
    }
    // The bare "native reload, else cache-busting reload" ladder is gone from
    // the REFRESH_WEB arms (it lives inside reloadUnderCover now).
    expect(PAGE).not.toMatch(/if \(!nativeFire\('reload'\)\) hardCacheBustingReload\(\);/);
    expect(PAGE).toContain("reloadCoverRecord('error-boundary', BLACK_COVER_FRAME");
  });
});

describe('4 — the red "Player did not start" line', () => {
  function watchdogBody(): string {
    const re = /__html:\s*`([\s\S]*?)`\s*,?\s*\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(LAYOUT))) {
      if (!m[1].includes('edu-boot-failed')) continue;
      const raw = m[1].replace(/\$\{[\s\S]*?\}/g, '""');
      // eslint-disable-next-line no-new-func
      return new Function('return `' + raw + '`;')() as string;
    }
    throw new Error('boot watchdog not found');
  }
  const run = () => { new Function(watchdogBody())(); }; // eslint-disable-line no-new-func

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('first-run screen: shown after 25 s when the script never booted (unchanged)', () => {
    run();
    jest.advanceTimersByTime(25_000);
    expect(document.getElementById('edu-boot-failed')).not.toBeNull();
  });

  it('paired screen (quiet boot): a slow 4K cold boot gets 60 s, not 25 s', () => {
    document.documentElement.setAttribute(QUIET_BOOT_ATTR, '1');
    run();
    jest.advanceTimersByTime(30_000);
    expect(document.getElementById('edu-boot-failed')).toBeNull();
    jest.advanceTimersByTime(30_000);
    expect(document.getElementById('edu-boot-failed')).not.toBeNull();
  });

  it('never shown when the app booted', () => {
    run();
    document.documentElement.setAttribute('data-edu-booted', '1');
    jest.advanceTimersByTime(60_000);
    expect(document.getElementById('edu-boot-failed')).toBeNull();
  });

  it('the page takes the line down the moment it boots', () => {
    const stamp = PAGE.indexOf("document.documentElement.setAttribute('data-edu-booted', '1');");
    expect(stamp).toBeGreaterThan(0);
    expect(PAGE.slice(stamp, stamp + 600)).toContain("document.getElementById('edu-boot-failed')?.remove()");
  });
});

describe('the service worker offline page', () => {
  const SW = fs.readFileSync(path.resolve(__dirname, '../../../../public/sw-player.js'), 'utf8');
  it('is black, and shows no text on a paired screen (device credential present)', () => {
    const at = SW.indexOf('<title>Reconnecting');
    expect(at).toBeGreaterThan(0);
    const page = SW.slice(at, SW.indexOf('{ status: 200', at));
    expect(page).not.toContain('#0b1020');
    expect(page).toContain('background:#000');
    expect(page).toContain('localStorage.getItem("edu_device_token")');
    expect(page).toContain('.q #w{display:none}');
    expect(page).toContain('id="w"');
  });
});

describe('6 — an alert still paints over every new state', () => {
  it('every emergency surface carries data-edu-emergency-root (live overlay + crash fallback)', () => {
    expect(OVERLAY).toContain('data-edu-emergency-root="banner"');
    expect(OVERLAY).toContain('data-edu-emergency-root="full"');
    expect(PAGE).toContain('data-edu-emergency-root="crash"');
  });

  it('CSS: an emergency root stays VISIBLE through the cover and the quiet-boot mark; content does not', () => {
    const style = document.createElement('style');
    style.textContent = layoutCss();
    document.head.appendChild(style);
    document.body.innerHTML =
      '<div class="player-root-wrapper"><div id="content">content</div><div id="alert" data-edu-emergency-root="full">LOCKDOWN</div></div>';
    const vis = (id: string) => getComputedStyle(document.getElementById(id)!).visibility;
    for (const attr of [UPDATE_COVER_ATTR, QUIET_BOOT_ATTR]) {
      document.documentElement.setAttribute(attr, '1');
      expect(vis('alert')).toBe('visible');
      expect(vis('content')).toBe('hidden');
      document.documentElement.removeAttribute(attr);
    }
    expect(vis('content')).toBe('visible');
  });

  it('the page drops the cover and the quiet mark the moment an alert (or a pushed message) is up', () => {
    const at = PAGE.indexOf('if (!activeEmergency && !pushedEmergencyMessage) return;');
    expect(at).toBeGreaterThan(0);
    const body = PAGE.slice(at, at + 500);
    expect(body).toContain('clearQuietBoot(document)');
    expect(body).toContain('removeUpdateCover(document');
  });

  it('the black hold is never stacked over an alert: no z-index, and the overlay is not gated by glassQuiet', () => {
    const decl = PAGE.indexOf('const glassHoldNode = (');
    expect(decl).toBeGreaterThan(0);
    const node = PAGE.slice(decl, PAGE.indexOf(');', decl));
    expect(node).not.toMatch(/zIndex|z-\[/);
    // <EmergencyOverlay> renders from `tenantId` alone — nothing about quiet glass.
    const overlayAt = PAGE.indexOf('<EmergencyOverlay');
    expect(overlayAt).toBeGreaterThan(0);
    const guard = PAGE.slice(PAGE.lastIndexOf('{tenantId && (', overlayAt), overlayAt);
    expect(guard).not.toContain('glassQuiet');
    // No drill banner on the glass (owner 2026-10-12).
    expect(PAGE).not.toContain('<DrillBanner');
  });

  it('quiet glass is computed OFF while any alert is up (activeEmergency, pushed message, emergency phase or playlist)', () => {
    const at = PAGE.indexOf('const glassQuiet = quietGlass({');
    const call = PAGE.slice(at, PAGE.indexOf('});', at));
    expect(call).toMatch(/emergency: !!activeEmergency \|\| !!pushedEmergencyMessage \|\| phase === 'emergency' \|\| playlist\?\.isEmergency === true/);
  });

  it('the last-good retry path never touches an emergency playlist', () => {
    const at = PAGE.indexOf('const markItemFailed = useCallback(');
    const body = PAGE.slice(at, PAGE.indexOf('const markItemSucceeded', at));
    expect(body).toMatch(/if \(!playlist\?\.isEmergency\) \{\s*const failing/);
  });
});
