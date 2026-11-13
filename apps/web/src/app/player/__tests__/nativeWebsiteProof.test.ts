import * as fs from 'fs';
import * as path from 'path';
import {
  URL_OVERLAY_REPORT_METHOD,
  URL_OVERLAY_STATE_EVENT,
  WEBSITE_BLANK_SIG,
  WEBSITE_FAILED_SIG,
  WEBSITE_PROOF_STAND_DOWN,
  acceptWebsiteViewReport,
  parseWebsiteViewReport,
  websiteCountsAsShown,
  websiteProofFor,
  websiteProofSig,
  websiteProofSwitchedOff,
  type WebsiteProof,
} from '../nativeWebsiteProof';
import { bundleReloadIdle, provablyHealthyPlaying } from '../refreshAdmission';
import { deriveRenderTrustGrade } from '../../../components/screens/renderTrust';

const URL = 'https://playlist.example.org/';

describe('parseWebsiteViewReport', () => {
  it('accepts exactly the five states', () => {
    for (const state of ['loading', 'drawn', 'blank', 'failed', 'unknown']) {
      expect(parseWebsiteViewReport({ url: URL, state, attempts: 0 })).toEqual({ url: URL, state, attempts: 0 });
    }
  });

  it('refuses anything that is not a report', () => {
    const bad: unknown[] = [
      null, undefined, 'drawn', 7, [], {},
      { url: URL }, { state: 'drawn' },
      { url: 5, state: 'drawn' }, { url: '', state: 'drawn' },
      { url: URL, state: 'DRAWN' }, { url: URL, state: 'ok' }, { url: URL, state: 1 },
      { url: `https://x/${'a'.repeat(3000)}`, state: 'drawn' },
    ];
    for (const b of bad) expect(parseWebsiteViewReport(b)).toBeNull();
  });

  it('bounds the attempt count and tolerates a missing one', () => {
    expect(parseWebsiteViewReport({ url: URL, state: 'blank' })?.attempts).toBe(0);
    expect(parseWebsiteViewReport({ url: URL, state: 'blank', attempts: 3.9 })?.attempts).toBe(3);
    expect(parseWebsiteViewReport({ url: URL, state: 'blank', attempts: -2 })?.attempts).toBe(0);
    expect(parseWebsiteViewReport({ url: URL, state: 'blank', attempts: 1e9 })?.attempts).toBe(99);
    expect(parseWebsiteViewReport({ url: URL, state: 'blank', attempts: NaN })?.attempts).toBe(0);
    expect(parseWebsiteViewReport({ url: URL, state: 'blank', attempts: '4' })?.attempts).toBe(0);
  });
});

describe('acceptWebsiteViewReport', () => {
  it('believes a report only for the URL this page handed over', () => {
    expect(acceptWebsiteViewReport(URL, { url: URL, state: 'drawn', attempts: 0 })?.state).toBe('drawn');
    // A late event from the previous slide.
    expect(acceptWebsiteViewReport(URL, { url: 'https://other.example/', state: 'drawn', attempts: 0 })).toBeNull();
    // No website slide on glass.
    expect(acceptWebsiteViewReport(null, { url: URL, state: 'drawn', attempts: 0 })).toBeNull();
    expect(acceptWebsiteViewReport(URL, { nonsense: true })).toBeNull();
  });

  it('compares the way the APK does — it trims the URL it is handed', () => {
    expect(acceptWebsiteViewReport(`  ${URL} `, { url: URL, state: 'blank', attempts: 1 })?.state).toBe('blank');
  });
});

describe('websiteProofFor', () => {
  it('is none without a website slide, loading until this URL has a report of its own', () => {
    expect(websiteProofFor(null, null)).toBe('none');
    expect(websiteProofFor(null, { url: URL, state: 'drawn', attempts: 0 })).toBe('none');
    expect(websiteProofFor(URL, null)).toBe('loading');
    expect(websiteProofFor(URL, { url: 'https://other.example/', state: 'drawn', attempts: 0 })).toBe('loading');
    expect(websiteProofFor(URL, { url: URL, state: 'blank', attempts: 2 })).toBe('blank');
    expect(websiteProofFor(URL, { url: URL, state: 'drawn', attempts: 0 })).toBe('drawn');
  });
});

describe('what the page may claim', () => {
  const all: WebsiteProof[] = ['none', 'loading', 'drawn', 'blank', 'failed', 'unknown'];

  it('only drawn and unknown count as shown', () => {
    expect(all.filter(websiteCountsAsShown)).toEqual(['drawn', 'unknown']);
  });

  it('blank and failed prove under their own idle signatures; loading under the existing one', () => {
    expect(websiteProofSig('blank')).toBe('idle:website-blank');
    expect(websiteProofSig('failed')).toBe('idle:website-failed');
    expect(websiteProofSig('loading')).toBe('idle:content-loading');
    expect(websiteProofSig('drawn')).toBeNull();
    expect(websiteProofSig('unknown')).toBeNull();
    expect(websiteProofSig('none')).toBeNull();
    expect(WEBSITE_BLANK_SIG).toBe('idle:website-blank');
    expect(WEBSITE_FAILED_SIG).toBe('idle:website-failed');
  });

  it('no state both counts as shown and holds the proof back', () => {
    for (const p of all) expect(websiteCountsAsShown(p) && websiteProofSig(p) !== null).toBe(false);
  });

  it('a held website is never read as content by anything downstream', () => {
    for (const sig of [WEBSITE_BLANK_SIG, WEBSITE_FAILED_SIG]) {
      // never `pl:` — the refresh admission's "healthy, do not interrupt" test fails
      expect(provablyHealthyPlaying({
        phase: 'playing', rendering: false, sig, kind: 'idle', emergency: false, mediaStalled: false,
        nowMs: 1_000_000, lastPaintAtMs: 999_000, lastManifestOkAtMs: 999_000,
      })).toBe(false);
      // and a waiting bundle may be picked up: nothing of the operator's is on the glass
      expect(bundleReloadIdle({ rendering: false, sig, kind: 'idle', emergency: false })).toBe(true);
      // the dashboard grades it as its own state, never green and never "nothing scheduled"
      const grade = deriveRenderTrustGrade({ status: 'ONLINE', renderHealth: 'OK', lastRenderedHash: sig });
      expect(grade).toBe(sig === WEBSITE_BLANK_SIG ? 'website-blank' : 'website-failed');
    }
  });
});

describe('the kill switch (PLAYER_WEBSITE_PROOF=off → playback.websiteProof)', () => {
  it('is thrown only by exactly off, and a manifest that does not say keeps what was known', () => {
    expect(websiteProofSwitchedOff({ loopMode: 'continuous', mediaFit: 'fill', websiteProof: 'off' })).toBe(true);
    expect(websiteProofSwitchedOff({ loopMode: 'continuous', mediaFit: 'fill' })).toBe(false);
    expect(websiteProofSwitchedOff({ websiteProof: 'on' })).toBe(false);
    expect(websiteProofSwitchedOff({ websiteProof: true })).toBe(false);
    for (const absent of [undefined, null, 'off', 0]) expect(websiteProofSwitchedOff(absent)).toBeNull();
  });

  it('the API sends the key only when the switch is thrown', () => {
    const api = path.resolve(__dirname, '../../../../../api/src/screens/playback-config.ts');
    if (!fs.existsSync(api)) return;
    const src = fs.readFileSync(api, 'utf8');
    expect(src).toContain("...(websiteProofOff(env) ? { websiteProof: 'off' as const } : {})");
    expect(src).toContain("env.PLAYER_WEBSITE_PROOF");
  });
});

describe('the contract with the APK and the page', () => {
  const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

  it('uses the event and state names the Kotlin policy dispatches', () => {
    const kt = path.resolve(__dirname, '../../../../../player/app/src/main/java/com/educms/player/UrlOverlayDrawProofPolicy.kt');
    if (!fs.existsSync(kt)) return; // a checkout without the player sources
    const src = fs.readFileSync(kt, 'utf8');
    expect(src).toContain(`const val STATE_EVENT = "${URL_OVERLAY_STATE_EVENT}"`);
    expect(src).toContain(`const val STAND_DOWN = "${WEBSITE_PROOF_STAND_DOWN}"`);
    for (const state of ['loading', 'drawn', 'blank', 'failed', 'unknown']) {
      expect(src).toContain(`const val STATE_${state.toUpperCase()} = "${state}"`);
    }
    const bridge = fs.readFileSync(path.resolve(path.dirname(kt), 'WebAppBridge.kt'), 'utf8');
    expect(bridge).toMatch(new RegExp(`@JavascriptInterface\\s+fun ${URL_OVERLAY_REPORT_METHOD}\\(url: String\\)`));
  });

  it('the page hands over without claiming ready only when the APK reports, and stays tiny', () => {
    const page = read('../page.tsx');
    const effect = page.slice(page.indexOf('// Native Android URL overlay.'), page.indexOf('// Device play log (2026-11-09)'));
    expect(effect.length).toBeGreaterThan(0);
    // The old APK / browser path is the old line, unchanged.
    expect(effect).toContain("if (!nativeHas('showUrlOverlay') || !nativeHas('hideUrlOverlay')) return;");
    // Without a reporting APK (or with the kill switch thrown) the slide is ready on hand-over, as before.
    const unreported = effect.slice(effect.indexOf('if (!reports) {'), effect.indexOf('// A reporting viewer:'));
    expect(unreported).toContain('setMediaReady(true);\n      return;');
    expect(effect).toContain('const reports = canReport && !websiteProofOff;');
    expect(effect).toContain('nativeHas(URL_OVERLAY_REPORT_METHOD)');
    // With one, hand-over alone never marks the slide ready.
    const reported = effect.slice(effect.indexOf('// A reporting viewer:'), effect.indexOf('nativeFire(URL_OVERLAY_REPORT_METHOD, url);'));
    expect(reported).toContain('if (websiteCountsAsShown(proof)) setMediaReady(true);');
    expect(reported.match(/setMediaReady\(true\)/g)).toHaveLength(1);
    expect(effect).toContain('window.addEventListener(URL_OVERLAY_STATE_EVENT');
    // Taurus: this is player code.
    expect(effect).not.toMatch(/inset|gap:/);
    // The proof effect reads the website state and never lets it be `pl:`.
    const proof = page.slice(page.indexOf('const contentUnavailable = allAssetsFailed'), page.indexOf('// ── PAUSED IS A DIFFERENT FACT FROM IDLE'));
    expect(proof).toContain('websiteProofSig(websiteProof)');
    expect(proof).toMatch(/const playingContent = [^;]*!websiteSig/);
  });
});
